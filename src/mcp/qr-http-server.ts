/**
 * 로컬 HTTP 서버 — QR 페이지를 `http://127.0.0.1:<port>` 에서 서빙한다.
 *
 * file:// origin 대신 HTTP origin을 쓰는 이유: 브라우저 보안 정책상 file://에서
 * 로드된 페이지는 외부 fetch/script가 전부 차단되며, file:// 절대 경로를 <img src>에
 * 넣으면 브라우저에 따라 빈 화면이 된다. 127.0.0.1 HTTP는 modern 브라우저가 fully trust.
 *
 * INSTALL-GRAPH INVARIANT:
 *   이 모듈은 react/react-dom을 절대 import하지 않는다. dashboard/attach HTML은
 *   scripts/build-dashboard-html.ts가 빌드 타임에 precompile해 dashboard.generated.ts
 *   (plain string exports)로 커밋한다. 이 모듈은 그 생성된 string만 import한다.
 *   check-mcp-react-free.sh 가드가 dist/mcp/cli.js·server.js의 react 유입을 기계적으로 검증.
 *
 * HTML 조립 전략 (token-fill vs runtime builder):
 *   - static chrome (head/style/섹션 레이블) → 빌드타임 precompile, dashboard.generated.ts
 *   - 동적 부분 → 런타임 string 조립:
 *       __NOW__             : per-request ISO timestamp
 *       __TUNNEL_CLASS__    : "status-up" | "status-down"
 *       __TUNNEL_STATUS__   : 로컬라이즈된 tunnel 상태 레이블
 *       __ATTACH_SECTION__  : QR img+url-box, 또는 hint 텍스트
 *       __PAGES_SECTION__   : pages <section> 블록, 또는 빈 문자열 (null → '')
 *   - inline SSE <script> → 런타임 suffix로 append (localised string 포함)
 *
 * i18n:
 *   GET / 와 GET /attach 라우트에서 req.headers['accept-language']를 읽어
 *   parseAcceptLanguage()로 locale 결정. resolveLocaleStrings()로 동적 부분의
 *   localised 문자열을 해결. navigator 없음, React hook 없음 (Node 표면).
 *
 * SECRET-HANDLING:
 *   - 127.0.0.1 바인딩만 — 외부 노출 0.
 *   - attachUrl은 HTML 본문과 /qr.png query에만 들어간다 (의도된 전달 경로).
 *   - wssUrl은 dashboard HTML에 절대 들어가지 않는다. tunnel.up boolean만 사용.
 *   - stdout/stderr/로그에 별도 출력하지 않는다.
 *   - tmp 파일 만들지 않음 — 모든 응답을 메모리에서 생성.
 *   - TOTP at= 코드는 attachUrl 캡슐 안에서만 노출 — SSE payload나 page 목록 등
 *     다른 필드에 TOTP 코드를 평문으로 싣지 않는다.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { parseAcceptLanguage, resolveLocaleStrings } from '../i18n/index.js';
import { attachChromeByLocale, dashboardChromeByLocale } from './dashboard.generated.js';

/** dashboard에 노출되는 현재 상태 스냅샷. */
export interface DashboardState {
  /** 현재 터널 상태 — up/down + wssUrl. SECRET: wssUrl은 로그 출력 금지. */
  tunnel: { up: boolean; wssUrl: string | null };
  /**
   * 현재 연결된 page 목록 (id/url만).
   *
   * - `Array<…>` — env 3/4(MCP): relay에 attach된 페이지를 라이브 조회한 목록.
   *   빈 배열 `[]`은 "attach된 페이지 없음"으로 정직하게 표시한다.
   * - `null` — env 2(unplugin 터널): 플러그인 핸들이 connected target을 노출하지
   *   않아 라이브 page 목록을 알 수 없다. 거짓 빈 목록을 보여주느니 "연결된 Pages"
   *   섹션 자체를 숨긴다(#411). 정적 렌더와 SSE 갱신 양쪽에서 섹션이 사라진다.
   */
  pages: Array<{ id: string; url: string }> | null;
  /** 마지막으로 생성된 attachUrl (없으면 null). TOTP at= 코드는 이 안에 캡슐화. */
  attachUrl: string | null;
}

export interface QrHttpServer {
  port: number;
  /** `http://127.0.0.1:<port>/attach?u=<encoded>` URL 생성 헬퍼. */
  buildAttachPageUrl(attachUrl: string): string;
  /**
   * 상태 변경 시 호출 — SSE 구독자에게 최신 상태를 push한다.
   * `getDashboardState`가 주입돼 있지 않으면 no-op.
   */
  notifyStateChange(): void;
  close(): Promise<void>;
}

/** HTML 특수문자를 이스케이프한다. */
function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Dashboard HTML — precompiled chrome에 per-request 동적 값을 채워 완성한다.
 *
 * 토큰 채우기 순서:
 *   1. chrome string(locale별 precompile)을 가져온다.
 *   2. 동적 부분을 단순 replaceAll로 채운다 (토큰이 HTML context 밖에 있으므로 안전).
 *   3. inline SSE <script>를 </body> 직전에 주입한다.
 *
 * 동적 파트 분류:
 *   - "token-fill": 단일 값 교체 (__NOW__, __TUNNEL_CLASS__, __TUNNEL_STATUS__,
 *     __ATTACH_SECTION__)
 *   - "runtime builder": 가변 길이 구조 (__PAGES_SECTION__ — 조건부 렌더 + 가변 rows)
 *   - "suffix": inline SSE <script> (빌드 파이프라인 없는 클라이언트 스크립트, locale
 *     aware 문자열 포함)
 *
 * SECRET-HANDLING:
 *   - attachUrl은 url-box 안에서만 노출 (TOTP at= 코드 캡슐 그대로).
 *   - tunnel wssUrl은 "터널 연결됨" 상태 표시에서 UP/DOWN만 노출.
 *     wssUrl 값 자체는 dashboard HTML에 넣지 않는다.
 */
function buildDashboardHtml(
  state: DashboardState,
  qrDataUrl: string | null,
  locale: 'ko' | 'en',
): string {
  const s = resolveLocaleStrings(locale);
  const now = new Date().toISOString();

  const tunnelStatus = state.tunnel.up ? s('dashboard.tunnel.up') : s('dashboard.tunnel.down');
  const tunnelClass = state.tunnel.up ? 'status-up' : 'status-down';

  // attachSection: QR img + url-box, or hint
  let attachSection: string;
  if (qrDataUrl && state.attachUrl) {
    const safeAttachUrl = escapeHtml(state.attachUrl);
    attachSection = `<img class="qr" src="${qrDataUrl}" alt="attach QR" /><p class="url-box">${safeAttachUrl}</p>`;
  } else {
    attachSection = `<p class="hint">${escapeHtml(s('dashboard.attach.hint'))}</p>`;
  }

  // pagesSection — "연결된 Pages" 섹션: env 3/4(pages: Array)에서만 렌더한다.
  // env 2(pages: null)는 라이브 page 목록을 알 수 없어 섹션 자체를 숨긴다(#411).
  // runtime builder: 조건부 블록 + 가변 row 목록이라 token-fill로는 불충분.
  const pagesSection =
    state.pages === null
      ? ''
      : `<hr /><section id="pages-section"><h2>${escapeHtml(s('dashboard.pages.section'))}</h2><ul id="pages-list">${
          state.pages.length > 0
            ? state.pages
                .map((p) => {
                  const safeId = escapeHtml(p.id);
                  const safeUrl = escapeHtml(p.url.slice(0, 120));
                  return `<li><span class="page-id">${safeId}</span> <span class="page-url">${safeUrl}</span></li>`;
                })
                .join('\n')
            : `<li class="empty">${escapeHtml(s('dashboard.pages.empty'))}</li>`
        }</ul></section>`;

  // locale-aware strings for the inline SSE client script
  const sseStrings = {
    tunnelUp: JSON.stringify(s('dashboard.tunnel.up')),
    tunnelDown: JSON.stringify(s('dashboard.tunnel.down')),
    pagesEmpty: JSON.stringify(s('dashboard.pages.empty')),
    attachHint: JSON.stringify(s('dashboard.attach.hint')),
  };

  // Fill token placeholders in the precompiled chrome.
  // replaceAll is safe because these __TOKEN__ strings cannot appear in
  // any legitimate user-facing value (they are sentinel strings).
  const chrome = dashboardChromeByLocale[locale];
  const filled = chrome
    .replaceAll('__NOW__', escapeHtml(now))
    .replaceAll('__TUNNEL_CLASS__', tunnelClass)
    .replaceAll('__TUNNEL_STATUS__', escapeHtml(tunnelStatus))
    .replaceAll('__ATTACH_SECTION__', attachSection)
    .replaceAll('__PAGES_SECTION__', pagesSection);

  // Append the inline SSE <script> suffix directly before </body>.
  // This keeps the client script out of the precompiled chrome (it references
  // locale-aware strings resolved per-request) while staying self-contained.
  const sseScript = buildSseScript(sseStrings);
  return filled.replace('</body>', `${sseScript}\n</body>`);
}

interface SseScriptStrings {
  tunnelUp: string;
  tunnelDown: string;
  pagesEmpty: string;
  attachHint: string;
}

/**
 * Inline SSE client <script> — injected into the dashboard HTML at runtime.
 *
 * Subscribes to /events and updates the DOM without a build pipeline.
 * client side: attachUrl은 DOM에 렌더링, wssUrl은 절대 렌더링하지 않는다.
 * pages === null 이면 섹션을 건드리지 않는다 (#411).
 *
 * 문자열 인자는 빌드타임에 ko/en 테이블에서 가져와 JSON.stringify로 이미 escape됨.
 */
function buildSseScript(strings: SseScriptStrings): string {
  return `<script>
    // SSE — /events 구독해 상태 자동 갱신. 빌드 파이프라인 없는 인라인 스크립트.
    (function () {
      var TUNNEL_UP = ${strings.tunnelUp};
      var TUNNEL_DOWN = ${strings.tunnelDown};
      var PAGES_EMPTY = ${strings.pagesEmpty};
      var ATTACH_HINT = ${strings.attachHint};
      var src = new EventSource('/events');
      src.onmessage = function (e) {
        try {
          var s = JSON.parse(e.data);
          // 터널 상태 갱신
          var el = document.getElementById('tunnel-status');
          if (el) {
            el.textContent = s.tunnel && s.tunnel.up ? TUNNEL_UP : TUNNEL_DOWN;
            el.className = 'status ' + (s.tunnel && s.tunnel.up ? 'status-up' : 'status-down');
          }
          // page 목록 갱신 — pages === null(env 2)이면 섹션 자체를 숨긴 채 둔다.
          // 정적 렌더가 #pages-section을 아예 안 그렸으므로 여기서도 손대지 않아
          // SSE push 때 섹션이 되살아나지 않는다(#411). 배열일 때만 목록을 채운다.
          if (s.pages !== null && s.pages !== undefined) {
            var ul = document.getElementById('pages-list');
            if (ul) {
              if (s.pages.length === 0) {
                ul.innerHTML = '<li class="empty">' + PAGES_EMPTY + '</li>';
              } else {
                ul.innerHTML = s.pages.map(function (p) {
                  var sid = String(p.id || '').slice(0, 36).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
                  var su = String(p.url || '').slice(0, 120).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
                  return '<li><span class="page-id">' + sid + '</span> <span class="page-url">' + su + '</span></li>';
                }).join('');
              }
            }
          }
          // attachUrl QR 갱신 — attachUrl이 없으면 hint 표시.
          var sec = document.getElementById('attach-section');
          if (sec) {
            if (s.attachUrl) {
              // QR은 서버에서 새로 렌더한 /qr.png?u= 로 img src 교체.
              // TOTP at= 코드는 attachUrl 안에 캡슐화 — 별도 노출 없음.
              // wssUrl은 절대 DOM에 렌더하지 않는다 (SECRET-HANDLING).
              var encoded = encodeURIComponent(s.attachUrl);
              var safeUrl = String(s.attachUrl).slice(0, 2000).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
              sec.innerHTML =
                '<img class="qr" src="/qr.png?u=' + encoded + '" alt="attach QR" />' +
                '<p class="url-box">' + safeUrl + '</p>';
            } else {
              sec.innerHTML = '<p class="hint">' + ATTACH_HINT + '</p>';
            }
          }
          // 갱신 시각
          var upd = document.getElementById('updated');
          if (upd) upd.textContent = upd.textContent.replace(/[^ ]+$/, new Date().toISOString());
        } catch (_) { /* 파싱 오류 무시 */ }
      };
      src.onerror = function () {
        // 재연결은 EventSource가 자동 처리 (spec 기본 동작).
      };
    })();
  </script>`;
}

/**
 * Attach 페이지 HTML — precompiled chrome에 per-request 동적 값을 채워 완성한다.
 *
 * 동적 파트:
 *   - __QR_DATA_URL__     : base64 data URL (QR 이미지)
 *   - __SAFE_LABEL__      : HTML-escaped deploymentId label
 *   - __SAFE_ATTACH_URL__ : HTML-escaped attach URL (TOTP at= 코드 포함 — 의도된 전달)
 *
 * SSE 스크립트도 주입 — `#attach-section` hook이 있으면 `/events` push 때 QR이
 * `/qr.png?u=<fresh attachUrl>`로 자동 갱신된다. `#tunnel-status`·`#pages-list` 등
 * 나머지 selector는 /attach 페이지에 없으므로 null-guard로 no-op.
 *
 * SECRET-HANDLING: TOTP at= 코드는 attachUrl 캡슐 안에서만 노출 — 의도된 transport.
 */
function buildAttachHtml(
  qrDataUrl: string,
  safeLabel: string,
  safeAttachUrl: string,
  locale: 'ko' | 'en',
): string {
  const s = resolveLocaleStrings(locale);
  const chrome = attachChromeByLocale[locale];
  const filled = chrome
    .replaceAll('__QR_DATA_URL__', qrDataUrl)
    .replaceAll('__SAFE_LABEL__', safeLabel)
    .replaceAll('__SAFE_ATTACH_URL__', safeAttachUrl);

  // Inject SSE script so QR auto-refreshes on each /events push.
  // `#attach-section` is the only selector present on /attach — other selectors
  // (#tunnel-status, #pages-list, #updated) are null-guarded and are no-ops here.
  const sseStrings = {
    tunnelUp: JSON.stringify(s('dashboard.tunnel.up')),
    tunnelDown: JSON.stringify(s('dashboard.tunnel.down')),
    pagesEmpty: JSON.stringify(s('dashboard.pages.empty')),
    attachHint: JSON.stringify(s('dashboard.attach.hint')),
  };
  const sseScript = buildSseScript(sseStrings);
  return filled.replace('</body>', `${sseScript}\n</body>`);
}

/**
 * 로컬 HTTP 서버를 127.0.0.1 random port(또는 `AIT_DEBUG_HTTP_PORT` env)로 시작한다.
 * MCP debug server 생애주기에 묶어 사용 — `runDebugServer` shutdown 시 `close()`로 정리.
 *
 * @param getDashboardState - dashboard 상태를 반환하는 클로저. 주입 시 `GET /` dashboard와
 *   `GET /events` SSE 스트림이 활성화된다. 미주입 시 두 라우트는 204/서비스 없음으로 응답.
 */
export async function startQrHttpServer(
  getDashboardState?: () => DashboardState,
): Promise<QrHttpServer> {
  const { default: QRCode } = await import('qrcode');

  /** SSE 활성 연결 목록 — `notifyStateChange()` 시 전체 push. */
  const sseClients: ServerResponse[] = [];

  /** SSE 연결 하나에 상태 이벤트를 flush한다. */
  function pushStateToClient(res: ServerResponse, state: DashboardState): void {
    const payload = JSON.stringify({
      tunnel: { up: state.tunnel.up, wssUrl: state.tunnel.wssUrl },
      pages: state.pages,
      // attachUrl은 캡슐 그대로 전달 — TOTP at= 코드 분리 없음 (의도된 설계).
      attachUrl: state.attachUrl,
    });
    // SSE frame: "data: <json>\n\n"
    res.write(`data: ${payload}\n\n`);
  }

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? '/';
    const [path, query = ''] = rawUrl.split('?', 2) as [string, string | undefined];
    const params = new URLSearchParams(query ?? '');

    // per-request locale — Accept-Language header에서 결정.
    const locale = parseAcceptLanguage(req.headers['accept-language']);

    // ── GET / — dashboard 루트 ─────────────────────────────────────────────
    if (path === '/') {
      if (!getDashboardState) {
        res.writeHead(204, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end();
        return;
      }
      const state = getDashboardState();
      let qrDataUrl: string | null = null;
      if (state.attachUrl) {
        try {
          qrDataUrl = await QRCode.toDataURL(state.attachUrl, {
            type: 'image/png',
            errorCorrectionLevel: 'M',
          });
        } catch {
          // QR 생성 실패 시 null 유지 — dashboard는 텍스트 fallback 표시
        }
      }
      const html = buildDashboardHtml(state, qrDataUrl, locale);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    // ── GET /events — SSE 스트림 ──────────────────────────────────────────
    if (path === '/events') {
      if (!getDashboardState) {
        res.writeHead(204, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // 즉시 현재 상태를 한 번 push — 페이지 로드 시 최신 상태 보장.
      const initialState = getDashboardState();
      pushStateToClient(res, initialState);

      sseClients.push(res);

      // 연결 끊기면 목록에서 제거.
      req.once('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    if (path === '/attach') {
      const encodedU = params.get('u') ?? '';
      let attachUrl: string;
      try {
        attachUrl = decodeURIComponent(encodedU);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('잘못된 u 파라미터입니다.');
        return;
      }

      // deploymentId 라벨 — attachUrl에서 _deploymentId 파라미터만 추출 (at= 노출 방지).
      let deploymentIdLabel = 'attach';
      try {
        const dpMatch = attachUrl.match(/[?&]_deploymentId=([^&]+)/);
        if (dpMatch?.[1]) {
          deploymentIdLabel = decodeURIComponent(dpMatch[1]).slice(0, 36);
        }
      } catch {
        // best-effort
      }

      // QR을 base64 data URL로 인라인 생성 — 외부 fetch 없이 self-contained HTML.
      QRCode.toDataURL(attachUrl, { type: 'image/png', errorCorrectionLevel: 'M' })
        .then((dataUrl: string) => {
          const safeLabel = escapeHtml(deploymentIdLabel);
          const safeAttachUrl = escapeHtml(attachUrl);
          const html = buildAttachHtml(dataUrl, safeLabel, safeAttachUrl, locale);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(html);
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('QR 생성에 실패했습니다.');
        });
      return;
    }

    if (path === '/qr.png') {
      const encodedU = params.get('u') ?? '';
      let attachUrl: string;
      try {
        attachUrl = decodeURIComponent(encodedU);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('잘못된 u 파라미터입니다.');
        return;
      }

      QRCode.toBuffer(attachUrl, { type: 'png', errorCorrectionLevel: 'M' })
        .then((buf: Buffer) => {
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': String(buf.length),
          });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('QR PNG 생성에 실패했습니다.');
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  const listenPort = Number(process.env.AIT_DEBUG_HTTP_PORT ?? 0);

  await new Promise<void>((resolve, reject) => {
    server.listen(listenPort, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('qr-http-server: server.address()가 예상하지 못한 형태입니다.');
  }
  const port = address.port;

  return {
    port,
    buildAttachPageUrl(attachUrl: string): string {
      return `http://127.0.0.1:${port}/attach?u=${encodeURIComponent(attachUrl)}`;
    },
    notifyStateChange(): void {
      if (!getDashboardState) return;
      const state = getDashboardState();
      for (const client of sseClients) {
        try {
          pushStateToClient(client, state);
        } catch {
          // 연결이 이미 끊어진 경우 — 무시 (close 핸들러가 목록에서 제거함).
        }
      }
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
