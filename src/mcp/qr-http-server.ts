/**
 * 로컬 HTTP 서버 — QR 페이지를 `http://127.0.0.1:<port>` 에서 서빙한다.
 *
 * file:// origin 대신 HTTP origin을 쓰는 이유: 브라우저 보안 정책상 file://에서
 * 로드된 페이지는 외부 fetch/script가 전부 차단되며, file:// 절대 경로를 <img src>에
 * 넣으면 브라우저에 따라 빈 화면이 된다. 127.0.0.1 HTTP는 modern 브라우저가 fully trust.
 *
 * SECRET-HANDLING:
 *   - 127.0.0.1 바인딩만 — 외부 노출 0.
 *   - attachUrl은 HTML 본문과 /qr.png query에만 들어간다 (의도된 전달 경로).
 *   - stdout/stderr/로그에 별도 출력하지 않는다.
 *   - tmp 파일 만들지 않음 — 모든 응답을 메모리에서 생성.
 *   - TOTP at= 코드는 attachUrl 캡슐 안에서만 노출 — SSE payload나 page 목록 등
 *     다른 필드에 TOTP 코드를 평문으로 싣지 않는다.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

/** dashboard에 노출되는 현재 상태 스냅샷. */
export interface DashboardState {
  /** 현재 터널 상태 — up/down + wssUrl. SECRET: wssUrl은 로그 출력 금지. */
  tunnel: { up: boolean; wssUrl: string | null };
  /** 현재 연결된 page 목록 (id/url만). */
  pages: Array<{ id: string; url: string }>;
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
      const html = buildDashboardHtml(state, qrDataUrl);
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
          const safeLabel = deploymentIdLabel.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
          const safeAttachUrl = attachUrl.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
          const html = buildAttachHtml(dataUrl, safeLabel, safeAttachUrl);
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

/**
 * Dashboard HTML — 터널/page/attachUrl 상태를 표시하고 SSE로 자동 갱신.
 *
 * SECRET-HANDLING:
 *   - attachUrl은 url-box 안에서만 노출 (TOTP at= 코드 캡슐 그대로).
 *   - tunnel wssUrl은 "터널 연결됨" 상태 표시에서 HOST가 아닌 UP/DOWN만 노출.
 *     wssUrl 값 자체는 dashboard HTML에 넣지 않는다 — 브라우저 탭이 보안 경계 밖에 있음.
 *   - inline <script>로 /events SSE 구독 — 빌드 파이프라인 추가 없음.
 */
function buildDashboardHtml(state: DashboardState, qrDataUrl: string | null): string {
  const tunnelStatus = state.tunnel.up ? '연결됨' : '끊어짐';
  const tunnelClass = state.tunnel.up ? 'status-up' : 'status-down';
  const now = new Date().toISOString();

  // page 목록 HTML
  const pagesHtml =
    state.pages.length > 0
      ? state.pages
          .map((p) => {
            const safeId = p.id.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
            const safeUrl = p.url.slice(0, 120).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
            return `<li><span class="page-id">${safeId}</span> <span class="page-url">${safeUrl}</span></li>`;
          })
          .join('\n')
      : '<li class="empty">attach된 페이지 없음</li>';

  // attachUrl QR + fallback
  let attachSection: string;
  if (qrDataUrl && state.attachUrl) {
    const safeAttachUrl = state.attachUrl.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
    attachSection = `
      <img class="qr" src="${qrDataUrl}" alt="attach QR" />
      <p class="url-box">${safeAttachUrl}</p>`;
  } else {
    attachSection =
      '<p class="hint">build_attach_url MCP tool을 호출하면 QR이 여기에 표시됩니다.</p>';
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIT 디버그 Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0d1117; color: #c9d1d9;
      display: flex; flex-direction: column; align-items: center;
      min-height: 100vh; margin: 0; padding: 2rem 1rem;
      gap: 1.5rem;
    }
    h1 { font-size: 1.25rem; font-weight: 600; color: #e6edf3; margin: 0; text-align: center; }
    .updated { font-size: 0.75rem; opacity: 0.4; font-family: monospace; margin: 0; }
    section { width: 100%; max-width: 520px; }
    h2 { font-size: 1rem; font-weight: 600; color: #e6edf3; margin: 0 0 0.5rem; }
    .status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .status-up { background: #238636; color: #fff; }
    .status-down { background: #6e7681; color: #fff; }
    img.qr {
      width: min(80vw, 300px); height: auto;
      image-rendering: pixelated;
      background: #fff; padding: 0.75rem; border-radius: 10px;
      display: block; margin: 0.5rem auto;
    }
    .url-box {
      font-family: monospace; font-size: 0.7rem;
      word-break: break-all; opacity: 0.45;
      background: #161b22; padding: 0.6rem 0.85rem;
      border-radius: 6px; border: 1px solid #30363d; margin: 0.5rem 0 0;
    }
    .hint { font-size: 0.85rem; opacity: 0.5; margin: 0.25rem 0 0; }
    ul { margin: 0; padding-left: 1.25rem; }
    li { margin-bottom: 0.35rem; font-size: 0.85rem; line-height: 1.5; }
    li.empty { opacity: 0.4; list-style: none; padding-left: 0; }
    .page-id { font-family: monospace; font-size: 0.75rem; opacity: 0.5; margin-right: 0.4rem; }
    .page-url { word-break: break-all; }
    hr { border: none; border-top: 1px solid #21262d; width: 100%; margin: 0; }
  </style>
</head>
<body>
  <h1>AIT 디버그 Dashboard</h1>
  <p class="updated" id="updated">마지막 갱신: ${now}</p>

  <section>
    <h2>터널 상태</h2>
    <span class="status ${tunnelClass}" id="tunnel-status">${tunnelStatus}</span>
  </section>

  <hr />

  <section>
    <h2>Attach QR</h2>
    <div id="attach-section">${attachSection}</div>
  </section>

  <hr />

  <section>
    <h2>연결된 Pages</h2>
    <ul id="pages-list">${pagesHtml}</ul>
  </section>

  <script>
    // SSE — /events 구독해 상태 자동 갱신. 빌드 파이프라인 없는 인라인 스크립트.
    (function () {
      var src = new EventSource('/events');
      src.onmessage = function (e) {
        try {
          var s = JSON.parse(e.data);
          // 터널 상태 갱신
          var el = document.getElementById('tunnel-status');
          if (el) {
            el.textContent = s.tunnel && s.tunnel.up ? '연결됨' : '끊어짐';
            el.className = 'status ' + (s.tunnel && s.tunnel.up ? 'status-up' : 'status-down');
          }
          // page 목록 갱신
          var ul = document.getElementById('pages-list');
          if (ul) {
            if (!s.pages || s.pages.length === 0) {
              ul.innerHTML = '<li class="empty">attach된 페이지 없음</li>';
            } else {
              ul.innerHTML = s.pages.map(function (p) {
                var sid = String(p.id || '').slice(0, 36).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
                var su = String(p.url || '').slice(0, 120).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
                return '<li><span class="page-id">' + sid + '</span> <span class="page-url">' + su + '</span></li>';
              }).join('');
            }
          }
          // attachUrl QR 갱신 — attachUrl이 없으면 hint 표시.
          var sec = document.getElementById('attach-section');
          if (sec) {
            if (s.attachUrl) {
              // QR은 서버에서 새로 렌더한 /qr.png?u= 로 img src 교체.
              // TOTP at= 코드는 attachUrl 안에 캡슐화 — 별도 노출 없음.
              var encoded = encodeURIComponent(s.attachUrl);
              var safeUrl = String(s.attachUrl).slice(0, 2000).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
              sec.innerHTML =
                '<img class="qr" src="/qr.png?u=' + encoded + '" alt="attach QR" />' +
                '<p class="url-box">' + safeUrl + '</p>';
            } else {
              sec.innerHTML = '<p class="hint">build_attach_url MCP tool을 호출하면 QR이 여기에 표시됩니다.</p>';
            }
          }
          // 갱신 시각
          var upd = document.getElementById('updated');
          if (upd) upd.textContent = '마지막 갱신: ' + new Date().toISOString();
        } catch (_) { /* 파싱 오류 무시 */ }
      };
      src.onerror = function () {
        // 재연결은 EventSource가 자동 처리 (spec 기본 동작).
      };
    })();
  </script>
</body>
</html>`;
}

/**
 * QR 스캔 페이지 HTML 본문.
 * dark theme, inline style, 외부 fetch 없음.
 */
function buildAttachHtml(qrDataUrl: string, safeLabel: string, safeAttachUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIT 디버그 세션 — QR 스캔</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0d1117; color: #c9d1d9;
      display: flex; flex-direction: column; align-items: center;
      min-height: 100vh; margin: 0; padding: 2rem 1rem;
      gap: 1.5rem;
    }
    h1 { font-size: 1.25rem; font-weight: 600; color: #e6edf3; margin: 0; text-align: center; }
    .label { font-size: 0.8rem; opacity: 0.5; font-family: monospace; margin: 0; }
    img.qr {
      width: min(90vw, 360px); height: auto;
      image-rendering: pixelated;
      background: #fff; padding: 1rem; border-radius: 12px;
    }
    section { width: 100%; max-width: 480px; }
    h2 { font-size: 1rem; font-weight: 600; color: #e6edf3; margin: 0 0 0.5rem; }
    ol, ul { margin: 0; padding-left: 1.25rem; }
    li { margin-bottom: 0.4rem; font-size: 0.9rem; line-height: 1.5; }
    .url-box {
      font-family: monospace; font-size: 0.72rem;
      word-break: break-all; opacity: 0.4;
      background: #161b22; padding: 0.75rem 1rem;
      border-radius: 6px; border: 1px solid #30363d;
    }
    hr { border: none; border-top: 1px solid #21262d; width: 100%; margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>AIT 디버그 세션 — QR 스캔</h1>
  <p class="label">deployment: ${safeLabel}</p>
  <img class="qr" src="${qrDataUrl}" alt="attach QR" />

  <section>
    <h2>스캔 절차</h2>
    <ol>
      <li>토스 앱을 실행하세요.</li>
      <li>폰 카메라 앱으로 QR 코드를 스캔하세요.</li>
      <li>팝업이 뜨면 <strong>"토스로 열기"</strong>를 탭하세요.</li>
      <li>미니앱이 열리고 디버그 세션이 자동으로 attach됩니다.</li>
    </ol>
  </section>

  <hr />

  <section>
    <h2>진단 체크리스트</h2>
    <ul>
      <li><strong>토스 앱이 안 열리는 경우</strong> — 앱 버전 확인, 카메라 앱으로 스캔 (토스 앱 내 QR 리더 X)</li>
      <li><strong>미니앱이 PREPARE 상태에서 멈추는 경우</strong> — deep-link에 <code>_deploymentId</code> 파라미터가 있는지 확인</li>
      <li><strong>Chii 주입 실패 / 콘솔이 비어 있는 경우</strong> — 미니앱 번들에 <code>in-app</code> debug import가 있는지 확인</li>
      <li><strong>TOTP gate Layer C가 비활성인 경우</strong> — relay 서버에 <code>AIT_DEBUG_TOTP_SECRET</code>이 설정돼 있는지 확인</li>
    </ul>
  </section>

  <hr />

  <section>
    <h2>URL (fallback)</h2>
    <p class="url-box">${safeAttachUrl}</p>
  </section>
</body>
</html>`;
}
