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
import {
  type AttachChromeFamily,
  attachChromeByLocale,
  dashboardChromeByLocale,
} from './dashboard.generated.js';
import type { McpEnvironment } from './environment.js';

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
  /**
   * 현재 세션의 Chii 인스펙터 URL — 살아있는 세션 기준 DevTools 진입점 (#503).
   *
   * - `string` — relay up + 페이지 attached → `buildChiiInspectorUrl`로 조립된 URL.
   *   TOTP at= 코드는 이 URL 안에 캡슐화. 대시보드 HTML 내 렌더는 의도된 transport.
   * - `null` — relay up이지만 페이지 미첨부, 또는 relay down, 또는 env 1(mock).
   *
   * SECRET-HANDLING: 이 URL은 relay host + TOTP at= 코드를 담을 수 있다.
   * 대시보드 HTML 본문에 렌더되는 건 의도된 transport(attachUrl과 동일 취급)이지만,
   * stdout/stderr/로그/에러 메시지에는 절대 출력하지 않는다.
   */
  inspectorUrl?: string | null;
  /**
   * 현재 세션 환경 — /attach 스캔 절차·체크리스트 카피 분기 + 상단 환경 라벨 (#468).
   *
   * - `'relay-mobile'` → sandbox family (환경 2: launcher PWA 절차, 토스 앱·_deploymentId 없음)
   * - `'relay-dev'`    → intoss family (환경 3: 토스 앱 deep-link 절차)
   * - `'mock'` / 미지정 → intoss family, 환경 라벨 없음 (환경 1은 /attach 표면이
   *   없어 사실상 도달 불가 — legacy 카피 유지 fallback)
   * - `relay-live` (환경 4) 제거 (#665) — positive-allowlist kill-switch.
   *
   * 호출처는 자기 mode를 명시적으로 전달한다: debug-server는 active connection에서
   * `deriveEnvironment(...)`로 파생, unplugin tunnel 대시보드는 `'relay-mobile'` 고정.
   */
  mode?: McpEnvironment;
  /**
   * 세션 생애주기 phase (#730) — 클라이언트가 "진행 중" vs "완료" vs "종료"를
   * SSE 데이터만으로 구분한다. `tunnel.up`과 직교: tunnel은 "터널이 살아있나",
   * phase는 "러너/데몬 프로세스가 의도적으로 끝냈나".
   *
   * - `'active'`   — 평상시(기본값). attach 대기/완료, run 대기.
   * - `'running'`  — CLI: 테스트 파일 실행 중. daemon은 사용하지 않는다(항상 `'active'`).
   * - `'complete'` — CLI: run 종료, exitCode 확정, `close()` 직전 마지막 push.
   * - `'shutdown'` — daemon: SIGINT/SIGTERM/SIGHUP 종료 확정, `close()` 직전 마지막 push.
   *
   * SECRET-HANDLING: enum 문자열은 시크릿이 아니다 — 그대로 SSE payload에 싣는다.
   */
  phase: 'active' | 'running' | 'complete' | 'shutdown';
  /**
   * `--manual-blocking` 수동-변형 모드(devtools#741)의 현재 프롬프트 — 사람이
   * 대시보드를 보며 다음에 무엇을 할지 알 수 있도록 파일명 + 진행도를 싣는다.
   *
   * - `null`/미지정 — 수동 단계 아님(평상시).
   * - `{ file, index, total }` — CLI가 manual 파일을 inject하기 직전에 push.
   *   `file`은 basename만(절대경로 없음), `index`는 1-based.
   *
   * SECRET-HANDLING: 파일명만 담는다 — relay wss/TOTP/scheme URL 없음.
   */
  manualPrompt?: { file: string; index: number; total: number } | null;
}

/** mode → 어느 precompiled attach chrome family를 쓰는가 (#468). */
function attachFamilyForMode(mode: McpEnvironment | undefined): AttachChromeFamily {
  return mode === 'relay-mobile' ? 'sandbox' : 'intoss';
}

/**
 * mode → 페이지 상단 환경 라벨 HTML (`__MODE_LABEL__` 토큰 채움, #468).
 * 사용자가 fidelity 사다리의 어느 겹에 있는지 즉시 알게 하는 환경 가시화 배지.
 * mode 미지정/'mock'은 빈 문자열 — 알 수 없는 환경을 거짓으로 라벨링하지 않는다.
 */
function buildModeLabel(
  mode: McpEnvironment | undefined,
  s: ReturnType<typeof resolveLocaleStrings>,
): string {
  let label: string;
  switch (mode) {
    case 'relay-mobile':
      label = s('attach.mode.sandbox');
      break;
    case 'relay-dev':
      label = s('attach.mode.intossDev');
      break;
    // relay-live (env 4) removed (#665) — positive-allowlist kill-switch.
    case 'mock':
    case undefined:
      return '';
  }
  return `<p class="mode-label">${escapeHtml(label)}</p>`;
}

export interface QrHttpServer {
  port: number;
  /** `http://127.0.0.1:<port>/attach?u=<encoded>` URL 생성 헬퍼. */
  buildAttachPageUrl(attachUrl: string): string;
  /**
   * 안정 인스펙터 진입점 URL — `http://127.0.0.1:<port>/inspector` (issue #530).
   * 클릭 시점에 TOTP를 mint하고 302 redirect하므로 URL 자체에 시크릿이 없다.
   * 대시보드/stdout/로그 어디든 출력 가능.
   */
  readonly inspectorStableUrl: string;
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
 * 현재 path+query에서 lang 파라미터만 교체한 ko/en 토글 링크를 생성한다.
 *
 * SECRET-HANDLING: u= (attachUrl, TOTP at= 캡슐 포함) 등 기존 query를 보존한다.
 * lang= 만 덮어쓴다. 링크 href에 at= 코드가 들어가는 건 의도된 전달 경로.
 */
function buildLangSwitcher(
  path: string,
  existingParams: URLSearchParams,
  locale: 'ko' | 'en',
  s: ReturnType<typeof resolveLocaleStrings>,
): string {
  function switcherHref(targetLang: 'ko' | 'en'): string {
    const p = new URLSearchParams(existingParams);
    p.set('lang', targetLang);
    return `${escapeHtml(path)}?${p.toString()}`;
  }
  const koLabel = escapeHtml(s('dashboard.lang.ko'));
  const enLabel = escapeHtml(s('dashboard.lang.en'));
  const koClass = locale === 'ko' ? 'active' : '';
  const enClass = locale === 'en' ? 'active' : '';
  return `<div class="lang-switcher"><a href="${switcherHref('ko')}" class="${koClass}">${koLabel}</a><a href="${switcherHref('en')}" class="${enClass}">${enLabel}</a></div>`;
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
 *     __ATTACH_SECTION__, __INSPECTOR_SECTION__)
 *   - "runtime builder": 가변 길이 구조 (__PAGES_SECTION__ — 조건부 렌더 + 가변 rows)
 *   - "suffix": inline SSE <script> (빌드 파이프라인 없는 클라이언트 스크립트, locale
 *     aware 문자열 포함)
 *
 * SECRET-HANDLING:
 *   - attachUrl은 url-box 안에서만 노출 (TOTP at= 코드 캡슐 그대로).
 *   - inspectorUrl은 anchor href 안에서만 노출 (TOTP at= 코드 캡슐 그대로).
 *     relay host + TOTP 코드가 담길 수 있으나 대시보드 HTML은 의도된 transport.
 *   - tunnel wssUrl은 "터널 연결됨" 상태 표시에서 UP/DOWN만 노출.
 *     wssUrl 값 자체는 dashboard HTML에 넣지 않는다.
 */
function buildDashboardHtml(
  state: DashboardState,
  qrDataUrl: string | null,
  locale: 'ko' | 'en',
  path = '/',
  params = new URLSearchParams(),
  /**
   * /devtools/ 진입로 URL (issue #248).
   *
   * 주입 시: relay 연결 active + pagesAttached 이면 이 URL로 가는 "DevTools 열기" 링크를 렌더한다.
   * null: getDirectInspectorUrl 미주입 (relay 세션 없는 mode) → 링크를 숨기고 hint 표시.
   *
   * /devtools/ 는 relay host + TOTP at= 가 없는 안정 경로이므로 href 노출 가능.
   * SECRET-HANDLING: 링크 클릭 후 302 응답의 Location에만 relay host·TOTP가 담긴다.
   */
  devtoolsEntryUrl: string | null = null,
  /**
   * SSE watchdog timeout 계산에 쓰이는 server refresh 주기 (ms, #681).
   * 미지정 시 기본값 90_000 적용 → watchdog timeout = 90_000 × 2 + 30_000 = 210_000ms.
   */
  sseRefreshIntervalMs = 90_000,
): string {
  const s = resolveLocaleStrings(locale);
  const now = new Date().toISOString();

  const tunnelStatus = state.tunnel.up ? s('dashboard.tunnel.up') : s('dashboard.tunnel.down');
  const tunnelClass = state.tunnel.up ? 'status-up' : 'status-down';

  // attachSection: QR img + url-row(url-box + 복사 버튼), tunnel-down 에러, or hint.
  // dashboard 표면에서 SSE 재렌더 시에도 동일 구조를 유지해 복사 버튼이 생존한다.
  //
  // 렌더 게이트는 attachUrl 유무 외에 tunnel.up도 본다 (issue #631): 터널이
  // 죽으면 attachUrl/QR이 인코딩한 wss·TOTP가 이미 무효이므로, 스캔 가능한
  // 죽은 QR을 계속 그리는 대신 에러 상태로 교체한다. attachUrl이 남아 있어도
  // tunnel.up=false면 QR을 그리지 않는다.
  let attachSection: string;
  if (!state.tunnel.up) {
    attachSection = `<p class="hint error">${escapeHtml(s('dashboard.attach.tunnelDown'))}</p>`;
  } else if (qrDataUrl && state.attachUrl) {
    const safeAttachUrl = escapeHtml(state.attachUrl);
    const copyLabel = escapeHtml(s('dashboard.url.copy'));
    attachSection =
      `<img class="qr" src="${qrDataUrl}" alt="attach QR" />` +
      `<div class="url-row">` +
      `<p class="url-box" id="url-box">${safeAttachUrl}</p>` +
      `<button class="copy-btn" id="copy-btn" type="button" aria-label="${copyLabel}">${copyLabel}</button>` +
      `</div>`;
  } else {
    attachSection = `<p class="hint">${escapeHtml(s('dashboard.attach.hint'))}</p>`;
  }

  // inspectorSection — "DevTools 열기" 링크 또는 대기 힌트 (#503, gate 보정 #544, #248).
  //
  // 게이트: relay active(devtoolsEntryUrl 주입됨) + pages.length > 0 양쪽 모두 true 일 때만 링크 활성.
  //   - devtoolsEntryUrl null → getDirectInspectorUrl 미주입(relay 세션 없는 server mode) → hint 표시.
  //   - relay active이지만 pages 미attach → 버튼을 보여봤자 502 noTarget — hint로 대기 안내.
  //
  // href는 /devtools/ 안정 경로 (issue #248) — relay host·TOTP at= 를 담지 않아 노출 가능.
  // 클릭 시 302 → Location에만 relay host·TOTP가 담긴다(의도된 transport).
  //
  // SSE push 시 inspectorUrl 필드를 기반으로 #inspector-link를 갱신하는 스크립트는 그대로 유지.
  // (SSE에서 inspectorUrl이 null → hint로, non-null + pages > 0 → /devtools/ 링크로 갱신.)
  const pagesAttached = Array.isArray(state.pages) && state.pages.length > 0;
  let inspectorSection: string;
  if (pagesAttached && devtoolsEntryUrl) {
    const safeUrl = escapeHtml(devtoolsEntryUrl);
    const label = escapeHtml(s('dashboard.inspector.open'));
    inspectorSection = `<a class="inspector-link" id="inspector-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  } else {
    const hint = escapeHtml(s('dashboard.inspector.waiting'));
    inspectorSection = `<span class="inspector-hint" id="inspector-link">${hint}</span>`;
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
  // watchdog timeout: server refresh 주기보다 넉넉히 크게 잡아 일시적 끊김을 오탐하지 않는다.
  //   - 기본(90s): 90s × 2 + 30s = 210s — 주기 1회 놓쳐도 정상 케이스 배제.
  //   - 짧은 주기(테스트용, < 5000ms): 주기 × 3 — 절대 30s를 더하지 않아 빠른 검증 가능.
  const watchdogTimeoutMs =
    sseRefreshIntervalMs < 5_000 ? sseRefreshIntervalMs * 3 : sseRefreshIntervalMs * 2 + 30_000;
  const sseStrings: SseScriptStrings = {
    tunnelUp: JSON.stringify(s('dashboard.tunnel.up')),
    tunnelDown: JSON.stringify(s('dashboard.tunnel.down')),
    pagesEmpty: JSON.stringify(s('dashboard.pages.empty')),
    attachHint: JSON.stringify(s('dashboard.attach.hint')),
    attachTunnelDown: JSON.stringify(s('dashboard.attach.tunnelDown')),
    copyLabel: JSON.stringify(s('dashboard.url.copy')),
    copiedLabel: JSON.stringify(s('dashboard.url.copied')),
    inspectorOpenLabel: JSON.stringify(s('dashboard.inspector.open')),
    inspectorWaitingLabel: JSON.stringify(s('dashboard.inspector.waiting')),
    dashboardSurface: true,
    watchdogTimeoutMs,
    watchdogTitle: JSON.stringify(s('dashboard.watchdog.title')),
    watchdogBody: JSON.stringify(s('dashboard.watchdog.body')),
    watchdogCloseLabel: JSON.stringify(s('dashboard.watchdog.close')),
    connectionLost: JSON.stringify(s('dashboard.conn.lost')),
    completeTitle: JSON.stringify(s('dashboard.session.completeTitle')),
    completeBody: JSON.stringify(s('dashboard.session.completeBody')),
    shutdownTitle: JSON.stringify(s('dashboard.session.shutdownTitle')),
    shutdownBody: JSON.stringify(s('dashboard.session.shutdownBody')),
  };

  const langSwitcher = buildLangSwitcher(path, params, locale, s);

  // Fill token placeholders in the precompiled chrome.
  // replaceAll is safe because these __TOKEN__ strings cannot appear in
  // any legitimate user-facing value (they are sentinel strings).
  const chrome = dashboardChromeByLocale[locale];
  const filled = chrome
    .replaceAll('__LANG_SWITCHER__', langSwitcher)
    .replaceAll('__NOW__', escapeHtml(now))
    .replaceAll('__TUNNEL_CLASS__', tunnelClass)
    .replaceAll('__TUNNEL_STATUS__', escapeHtml(tunnelStatus))
    .replaceAll('__ATTACH_SECTION__', attachSection)
    .replaceAll('__INSPECTOR_SECTION__', inspectorSection)
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
  /** 터널 드롭 시 attach-section에 표시할 에러 카피 (JSON.stringify로 이미 escape됨, #631). */
  attachTunnelDown: string;
  /** 복사 버튼 기본 라벨 (JSON.stringify로 이미 escape됨). */
  copyLabel: string;
  /** 복사 완료 피드백 라벨 (JSON.stringify로 이미 escape됨). */
  copiedLabel: string;
  /** "인스펙터 열기" 링크 라벨 (JSON.stringify로 이미 escape됨, #503). */
  inspectorOpenLabel: string;
  /** 인스펙터 URL 대기 힌트 (JSON.stringify로 이미 escape됨, #503). */
  inspectorWaitingLabel: string;
  /**
   * true: dashboard 표면 — `#attach-section` innerHTML 전체 교체 방식 유지.
   *        url-box 텍스트도 innerHTML 교체로 갱신됨.
   * false: /attach 표면 — img src만 교체, url-box는 `#url-box` textContent만 갱신.
   *        이 분기가 url-box 이중 표시 결함을 방지한다.
   */
  dashboardSurface: boolean;
  /**
   * SSE watchdog — server 무응답 판정 임계값 (ms). (#681)
   *
   * server의 SSE refresh 주기(`sseRefreshIntervalMs`, 기본 90s)보다 넉넉히 크게 잡아
   * 한 번 놓쳐도 정상인 경우를 배제한다. token-fill 패턴으로 server refresh 주기를
   * 기반으로 계산한 값을 주입한다 (주기 × 2 + 30s 여유).
   *
   * 테스트에서는 짧은 `sseRefreshIntervalMs`를 주입하면 이 값도 짧아져 빠르게 검증 가능.
   */
  watchdogTimeoutMs: number;
  /** watchdog 발화 후 폴백 UI 제목 (JSON.stringify로 이미 escape됨). */
  watchdogTitle: string;
  /** watchdog 발화 후 폴백 UI 본문 (JSON.stringify로 이미 escape됨). */
  watchdogBody: string;
  /** watchdog 폴백 UI의 "탭 닫기" 버튼 라벨 (JSON.stringify로 이미 escape됨). */
  watchdogCloseLabel: string;
  /**
   * SSE `onerror` 즉시 표시할 "연결 끊김" 라벨 (#730, JSON.stringify로 이미 escape됨).
   * watchdog(최대 210s 지연)과 달리 EventSource `onerror`는 즉시 발화하므로,
   * 서버 재시작/일시 네트워크 끊김을 사용자가 바로 알 수 있게 한다.
   */
  connectionLost: string;
  /** CLI run 종료(`phase: 'complete'`) 시 표시할 terminal 배너 제목 (#730). */
  completeTitle: string;
  /** CLI run 종료 terminal 배너 본문 (#730). */
  completeBody: string;
  /** daemon 종료(`phase: 'shutdown'`) 시 표시할 terminal 배너 제목 (#730). */
  shutdownTitle: string;
  /** daemon 종료 terminal 배너 본문 (#730). */
  shutdownBody: string;
}

/**
 * Inline SSE client <script> — injected into the dashboard HTML at runtime.
 *
 * Subscribes to /events and updates the DOM without a build pipeline.
 * client side: attachUrl은 DOM에 렌더링, wssUrl은 절대 렌더링하지 않는다.
 * pages === null 이면 섹션을 건드리지 않는다 (#411).
 *
 * 두 표면(dashboard / attach) 분기:
 *   - dashboard (dashboardSurface=true): #attach-section innerHTML 전체 교체 방식 유지.
 *     url-box도 innerHTML 재렌더 안에 포함되어 갱신됨.
 *   - /attach (dashboardSurface=false): #attach-section의 img src만 교체하고,
 *     url-box는 #url-box textContent만 갱신한다. (#attach-section에 url-box가 없으므로
 *     innerHTML 교체 시 url-box가 새로 생겨 이중 표시되는 결함을 방지 — #458 결함 수정.)
 *
 * 복사 기능: 이벤트 위임으로 document에 단일 핸들러. innerHTML 재렌더 후에도 생존.
 *   - .url-box 클릭 또는 .copy-btn 클릭 → 현재 #url-box textContent 복사.
 *   - clipboard: navigator.clipboard.writeText → 실패/부재 시 textarea execCommand fallback.
 *   - 피드백: 버튼 라벨이 COPIED_LABEL로 ~1.5초 전환 후 COPY_LABEL로 복귀.
 *
 * SSE watchdog (#681): SSE 주기 갱신이 `watchdogTimeoutMs` 동안 수신되지 않으면
 * server가 종료된 것으로 판단한다. `window.close()`를 시도하고, 닫히지 않으면
 * 폴백 안내 화면으로 교체해 stale QR이 계속 보이는 오해를 항상 방지한다.
 *
 * 문자열 인자는 빌드타임에 ko/en 테이블에서 가져와 JSON.stringify로 이미 escape됨.
 *
 * SECRET-HANDLING: URL 값을 console.log 등으로 출력하지 않는다.
 */
function buildSseScript(strings: SseScriptStrings): string {
  const isDashboard = strings.dashboardSurface;
  return `<script>
    // SSE — /events 구독해 상태 자동 갱신. 빌드 파이프라인 없는 인라인 스크립트.
    (function () {
      var TUNNEL_UP = ${strings.tunnelUp};
      var TUNNEL_DOWN = ${strings.tunnelDown};
      var PAGES_EMPTY = ${strings.pagesEmpty};
      var ATTACH_HINT = ${strings.attachHint};
      var ATTACH_TUNNEL_DOWN = ${strings.attachTunnelDown};
      var COPY_LABEL = ${strings.copyLabel};
      var COPIED_LABEL = ${strings.copiedLabel};
      var INSPECTOR_OPEN_LABEL = ${strings.inspectorOpenLabel};
      var INSPECTOR_WAITING_LABEL = ${strings.inspectorWaitingLabel};

      // ── SSE watchdog 상수 (#681) ──────────────────────────────────────────
      // server의 SSE refresh 주기(기본 90s)보다 넉넉히 큰 값 — 주기 × 2 + 30s 여유.
      // token-fill 패턴으로 server에서 계산해 주입한다.
      var WATCHDOG_TIMEOUT_MS = ${strings.watchdogTimeoutMs};
      var WATCHDOG_TITLE = ${strings.watchdogTitle};
      var WATCHDOG_BODY = ${strings.watchdogBody};
      var WATCHDOG_CLOSE_LABEL = ${strings.watchdogCloseLabel};

      // ── 실시간 상태 표면 상수 (#730) ───────────────────────────────────────
      var CONN_LOST = ${strings.connectionLost};
      var COMPLETE_TITLE = ${strings.completeTitle};
      var COMPLETE_BODY = ${strings.completeBody};
      var SHUTDOWN_TITLE = ${strings.shutdownTitle};
      var SHUTDOWN_BODY = ${strings.shutdownBody};
      var disconnectedShown = false;

      // ── 클립보드 복사 헬퍼 ────────────────────────────────────────────────
      function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text);
        }
        // fallback: textarea + execCommand
        return new Promise(function (resolve, reject) {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try {
            document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'));
          } catch (err) {
            reject(err);
          } finally {
            document.body.removeChild(ta);
          }
        });
      }

      // ── 복사 피드백 ───────────────────────────────────────────────────────
      var copyTimer = null;
      function triggerCopy() {
        var urlBox = document.getElementById('url-box');
        if (!urlBox) return;
        var text = urlBox.textContent || '';
        if (!text) return;
        copyText(text).then(function () {
          var btn = document.getElementById('copy-btn');
          if (btn) {
            btn.textContent = COPIED_LABEL;
            if (copyTimer) clearTimeout(copyTimer);
            copyTimer = setTimeout(function () {
              btn.textContent = COPY_LABEL;
              copyTimer = null;
            }, 1500);
          }
        }).catch(function () { /* 복사 실패 시 조용히 무시 */ });
      }

      // ── 이벤트 위임 — document 레벨에서 단일 핸들러 (innerHTML 재렌더 후에도 생존) ──
      document.addEventListener('click', function (e) {
        var target = e.target;
        if (!target) return;
        // .copy-btn 또는 .url-box 클릭 시 복사
        if (target.closest && (target.closest('.copy-btn') || target.closest('.url-box'))) {
          triggerCopy();
        }
      });

      // ── SSE watchdog (#681) ───────────────────────────────────────────────
      // 마지막으로 SSE 메시지를 수신한 시각. 스크립트 로드 시각으로 초기화한다.
      // (서버가 /events 연결 즉시 초기 상태를 push하므로 onmessage가 곧 갱신한다.)
      var lastSeen = Date.now();
      // watchdog이 한 번 발화하면 타이머를 clear해 중복 실행 방지.
      var watchdogFired = false;
      var watchdogTimer = null;

      // 폴백 UI — window.close()가 무시되면 stale QR 대신 안내 화면을 표시한다.
      function showWatchdogFallback() {
        if (document.body) {
          document.body.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'height:100vh;font-family:sans-serif;text-align:center;padding:2rem;box-sizing:border-box;">' +
            '<p style="font-size:1.4rem;font-weight:bold;margin-bottom:1rem;">' + WATCHDOG_TITLE + '</p>' +
            '<p style="color:#555;margin-bottom:2rem;">' + WATCHDOG_BODY + '</p>' +
            '<button onclick="window.close()" ' +
            'style="padding:0.6rem 1.4rem;font-size:1rem;cursor:pointer;border:1px solid #ccc;' +
            'border-radius:6px;background:#f5f5f5;">' + WATCHDOG_CLOSE_LABEL + '</button>' +
            '</div>';
        }
      }

      // ── Terminal 상태 배너 (#730) ─────────────────────────────────────────
      // "완료"/"종료"는 watchdog(최대 210s 지연)을 기다리지 않고 close() 직전에
      // 서버가 직접 push하는 마지막 SSE 프레임으로 즉시 렌더한다. watchdogFired를
      // 함께 세워 뒤이은 onerror의 showConnLost가 이 배너를 덮어쓰지 않게 한다.
      function showTerminalBanner(title, body) {
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        watchdogFired = true; // 이후 watchdog/onerror 발화를 억제
        if (document.body) {
          document.body.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'height:100vh;font-family:sans-serif;text-align:center;padding:2rem;box-sizing:border-box;">' +
            '<p style="font-size:1.4rem;font-weight:bold;margin-bottom:1rem;">' + title + '</p>' +
            '<p style="color:#555;">' + body + '</p></div>';
        }
      }

      // ── SSE onerror 즉시 신호 (#730) ──────────────────────────────────────
      // EventSource는 "재시도 중"과 "서버 종료"를 구분하지 못하므로, onerror에서
      // 즉시 구분되는 '연결 끊김' 상태를 tunnel-status 배지에 표시한다. 이미
      // terminal 배너가 뜬 뒤(watchdogFired)라면 덮어쓰지 않는다.
      function showConnLost() {
        if (disconnectedShown || watchdogFired) return;
        disconnectedShown = true;
        var el = document.getElementById('tunnel-status');
        if (el) { el.textContent = CONN_LOST; el.className = 'status status-down'; }
      }
      function clearConnLost() {
        disconnectedShown = false;
      }

      function fireWatchdog() {
        if (watchdogFired) return;
        watchdogFired = true;
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        // 폴백 UI를 먼저 표시한다 — close가 성공하면 어차피 페이지가 닫혀 보이지 않는다.
        // close 실패(opener 없는 탭)에 대비해 stale QR 대신 안내 화면을 항상 보장한다.
        showWatchdogFallback();
        // window.close() 시도 — OS가 연 탭은 opener가 없어 무시될 수 있다.
        window.close();
      }

      // 주기적으로 lastSeen을 검사 — WATCHDOG_TIMEOUT_MS 초과 시 발화.
      // 검사 간격: WATCHDOG_TIMEOUT_MS / 6, 단 최소 1s 이상이되 timeout 자체보다 크지 않게 한다.
      // (sseRefreshIntervalMs가 작을 때 최솟값 1s가 timeout을 초과하는 경우 방지 — 테스트 격리.)
      var checkIntervalMs = Math.min(
        Math.max(1000, Math.round(WATCHDOG_TIMEOUT_MS / 6)),
        WATCHDOG_TIMEOUT_MS,
      );
      watchdogTimer = setInterval(function () {
        if (watchdogFired) return;
        if (Date.now() - lastSeen > WATCHDOG_TIMEOUT_MS) {
          fireWatchdog();
        }
      }, checkIntervalMs);

      // ── SSE 구독 ──────────────────────────────────────────────────────────
      var src = new EventSource('/events');
      src.onopen = function () {
        // 연결 복구 시 lastSeen 갱신 — 일시적 끊김이 watchdog을 발화시키지 않게.
        // watchdog이 이미 발화했으면 갱신하지 않는다(폴백 UI를 그대로 유지).
        if (!watchdogFired) { lastSeen = Date.now(); clearConnLost(); }
      };
      src.onmessage = function (e) {
        // SSE 메시지 수신 — lastSeen 갱신으로 watchdog 리셋.
        // watchdog 발화 후라면 갱신해도 타이머가 이미 clear됐으므로 효과 없음.
        if (!watchdogFired) { lastSeen = Date.now(); }
        try {
          var s = JSON.parse(e.data);
          // 어떤 프레임이든 성공적으로 수신됐다는 건 서버가 살아있다는 뜻 —
          // onerror가 세운 '연결 끊김' 표시를 해제한다 (#730).
          clearConnLost();
          // phase gate (#730) — 'complete'/'shutdown'은 terminal 상태이므로
          // 나머지 필드 렌더보다 먼저 처리하고 즉시 반환한다.
          if (s.phase === 'complete') { showTerminalBanner(COMPLETE_TITLE, COMPLETE_BODY); return; }
          if (s.phase === 'shutdown') { showTerminalBanner(SHUTDOWN_TITLE, SHUTDOWN_BODY); return; }
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
          // attachUrl QR + url-box 갱신
          // SECRET-HANDLING: URL 값을 로그로 출력하지 않는다.
          // 터널이 죽으면(s.tunnel.up=false) attachUrl이 남아 있어도 QR을
          // 그리지 않고 에러 상태로 교체한다 — 죽은 QR이 스캔되는 것을 막는다(#631).
          var sec = document.getElementById('attach-section');
          if (sec) {
            if (!(s.tunnel && s.tunnel.up)) {
              sec.innerHTML = '<p class=\\"hint error\\">' + ATTACH_TUNNEL_DOWN + '</p>';
            } else if (s.attachUrl) {
              var encoded = encodeURIComponent(s.attachUrl);
              var safeUrl = String(s.attachUrl).slice(0, 2000).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
              ${
                isDashboard
                  ? `// dashboard: #attach-section innerHTML 전체 교체 (img + url-row).
              // url-box id="url-box" 를 포함해 복사 핸들러가 계속 동작함.
              sec.innerHTML =
                '<img class="qr" src="/qr.png?u=' + encoded + '" alt="attach QR" />' +
                '<div class=\\"url-row\\">' +
                  '<p class=\\"url-box\\" id=\\"url-box\\">' + safeUrl + '</p>' +
                  '<button class=\\"copy-btn\\" id=\\"copy-btn\\" type=\\"button\\" aria-label=\\"' + COPY_LABEL + '\\">' + COPY_LABEL + '</button>' +
                '</div>';`
                  : `// /attach: img src만 교체 — url-box는 별도 #url-section에서 관리해 이중 표시 방지(#458).
              // QR img src 교체: img가 있으면 src만 갱신, 없으면 img 요소 생성.
              var img = sec.querySelector('img.qr');
              if (img) {
                img.src = '/qr.png?u=' + encoded;
              } else {
                sec.innerHTML = '<img class=\\"qr\\" src=\\"/qr.png?u=' + encoded + '\\" alt=\\"attach QR\\" />';
              }
              // url-box textContent만 갱신 (innerHTML 교체하지 않아 복사 버튼/핸들러 생존).
              var ub = document.getElementById('url-box');
              if (ub) ub.textContent = s.attachUrl;`
              }
            } else {
              ${
                isDashboard
                  ? `sec.innerHTML = '<p class=\\"hint\\">' + ATTACH_HINT + '</p>';`
                  : `// /attach에서 hint가 필요한 경우는 없으나 방어 처리.
              sec.innerHTML = '<p class=\\"hint\\">' + ATTACH_HINT + '</p>';`
              }
            }
          }
          // 인스펙터 링크 갱신 — #inspector-link (#503, gate 보정 #544).
          // 게이트: pages.length > 0 (페이지 attach 여부) — inspectorUrl 존재 여부가 아님.
          // #530 이후 inspectorUrl은 항상 안정 URL이므로 null 게이트는 사실상 항상 활성이었다.
          // pages.length > 0 으로 바꿔 미attach 시 대기 힌트를 보여주도록 수정.
          // SECRET-HANDLING: inspectorUrl을 console.log 등으로 출력하지 않는다.
          var insp = document.getElementById('inspector-link');
          if (insp) {
            var pagesAttachedSse = Array.isArray(s.pages) && s.pages.length > 0;
            if (pagesAttachedSse && s.inspectorUrl) {
              var safeInspUrl = String(s.inspectorUrl).slice(0, 2000).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
              insp.outerHTML = '<a class=\\"inspector-link\\" id=\\"inspector-link\\" href=\\"' + safeInspUrl + '\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\">' + INSPECTOR_OPEN_LABEL + '</a>';
            } else {
              insp.outerHTML = '<span class=\\"inspector-hint\\" id=\\"inspector-link\\">' + INSPECTOR_WAITING_LABEL + '</span>';
            }
          }
          // 갱신 시각 (dashboard만 #updated 요소 있음)
          var upd = document.getElementById('updated');
          if (upd) upd.textContent = upd.textContent.replace(/[^ ]+$/, new Date().toISOString());
        } catch (_) { /* 파싱 오류 무시 */ }
      };
      src.onerror = function () {
        // EventSource는 "재시도 중"과 "서버 종료"를 구분하지 못하므로 즉시
        // 구분되는 "연결 끊김"을 표시한다(#730). 네이티브 auto-reconnect는 그대로
        // 진행되며 onopen/onmessage가 성공 즉시 이 상태를 해제한다. watchdog은
        // 여전히 2차 fallback으로 남는다(최종 폴백 UI 전환).
        showConnLost();
      };
    })();
  </script>`;
}

/**
 * Attach 페이지 HTML — precompiled chrome에 per-request 동적 값을 채워 완성한다.
 *
 * 동적 파트:
 *   - __QR_DATA_URL__       : base64 data URL (QR 이미지)
 *   - __SAFE_LABEL__        : HTML-escaped deploymentId label (intoss family에만 존재)
 *   - __SAFE_ATTACH_URL__   : HTML-escaped attach URL (TOTP at= 코드 포함 — 의도된 전달)
 *   - __MODE_LABEL__        : 환경 배지 (`<p class="mode-label">…</p>` 또는 빈 문자열, #468)
 *   - __INSPECTOR_SECTION__ : "디버그 툴 열기" 버튼 또는 대기 힌트 (#544)
 *
 * mode-aware 분기 (#468): mode가 `relay-mobile`이면 sandbox family chrome(launcher
 * PWA 절차), 그 외는 intoss family chrome(토스 앱 절차)을 선택한다.
 * relay-live (env 4) 제거 (#665) — positive-allowlist kill-switch.
 *
 * SSE 스크립트도 주입 — `#attach-section` hook이 있으면 `/events` push 때 QR이
 * `/qr.png?u=<fresh attachUrl>`로 자동 갱신된다. `#inspector-link`도 SSE push로
 * pages.length > 0 게이트에 따라 활성/비활성 전환된다 (#544).
 *
 * SECRET-HANDLING: TOTP at= 코드는 attachUrl 캡슐 안에서만 노출 — 의도된 transport.
 * inspectorStableUrl은 /inspector 안정 URL (127.0.0.1, 시크릿 없음) — 노출 가능.
 */
function buildAttachHtml(
  qrDataUrl: string,
  safeLabel: string,
  safeAttachUrl: string,
  locale: 'ko' | 'en',
  path = '/attach',
  params = new URLSearchParams(),
  mode?: McpEnvironment,
  pagesAttached = false,
  inspectorStableUrl: string | null = null,
  /**
   * SSE watchdog timeout 계산에 쓰이는 server refresh 주기 (ms, #681).
   * 미지정 시 기본값 90_000 적용.
   */
  sseRefreshIntervalMs = 90_000,
): string {
  const s = resolveLocaleStrings(locale);
  const langSwitcher = buildLangSwitcher(path, params, locale, s);
  const family = attachFamilyForMode(mode);

  // inspector 섹션 — pages.length > 0 게이트 (#544).
  // inspectorStableUrl은 /inspector 안정 URL (시크릿 없음) — href 노출 가능.
  let inspectorSection: string;
  if (pagesAttached && inspectorStableUrl) {
    const safeUrl = escapeHtml(inspectorStableUrl);
    const label = escapeHtml(s('dashboard.inspector.open'));
    inspectorSection = `<a class="inspector-link" id="inspector-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  } else {
    const hint = escapeHtml(s('dashboard.inspector.waiting'));
    inspectorSection = `<span class="inspector-hint" id="inspector-link">${hint}</span>`;
  }

  const chrome = attachChromeByLocale[locale][family];
  const filled = chrome
    .replaceAll('__LANG_SWITCHER__', langSwitcher)
    .replaceAll('__MODE_LABEL__', buildModeLabel(mode, s))
    .replaceAll('__QR_DATA_URL__', qrDataUrl)
    .replaceAll('__SAFE_LABEL__', safeLabel)
    .replaceAll('__SAFE_ATTACH_URL__', safeAttachUrl)
    .replaceAll('__INSPECTOR_SECTION__', inspectorSection);

  // Inject SSE script so QR auto-refreshes on each /events push,
  // and #inspector-link updates via pages.length > 0 gate on state change.
  // dashboardSurface: false → /attach 표면 분기 (img src 교체, url-box textContent만 갱신).
  // watchdog timeout: buildDashboardHtml와 동일 공식 (#681).
  const watchdogTimeoutMs =
    sseRefreshIntervalMs < 5_000 ? sseRefreshIntervalMs * 3 : sseRefreshIntervalMs * 2 + 30_000;
  const sseStrings: SseScriptStrings = {
    tunnelUp: JSON.stringify(s('dashboard.tunnel.up')),
    tunnelDown: JSON.stringify(s('dashboard.tunnel.down')),
    pagesEmpty: JSON.stringify(s('dashboard.pages.empty')),
    attachHint: JSON.stringify(s('dashboard.attach.hint')),
    attachTunnelDown: JSON.stringify(s('dashboard.attach.tunnelDown')),
    copyLabel: JSON.stringify(s('dashboard.url.copy')),
    copiedLabel: JSON.stringify(s('dashboard.url.copied')),
    // /attach 페이지의 #inspector-link SSE 갱신에 쓰인다 (#544).
    inspectorOpenLabel: JSON.stringify(s('dashboard.inspector.open')),
    inspectorWaitingLabel: JSON.stringify(s('dashboard.inspector.waiting')),
    // /attach 표면: img src만 교체, #url-box textContent만 갱신 → url-box 이중 표시 방지(#458).
    dashboardSurface: false,
    watchdogTimeoutMs,
    watchdogTitle: JSON.stringify(s('dashboard.watchdog.title')),
    watchdogBody: JSON.stringify(s('dashboard.watchdog.body')),
    watchdogCloseLabel: JSON.stringify(s('dashboard.watchdog.close')),
    connectionLost: JSON.stringify(s('dashboard.conn.lost')),
    completeTitle: JSON.stringify(s('dashboard.session.completeTitle')),
    completeBody: JSON.stringify(s('dashboard.session.completeBody')),
    shutdownTitle: JSON.stringify(s('dashboard.session.shutdownTitle')),
    shutdownBody: JSON.stringify(s('dashboard.session.shutdownBody')),
  };
  const sseScript = buildSseScript(sseStrings);
  return filled.replace('</body>', `${sseScript}\n</body>`);
}

export interface QrHttpServerOptions {
  /**
   * SSE 주기 갱신 간격 (ms). 기본값 90_000 (90초).
   *
   * SSE 구독자가 있는 동안 이 간격마다 `notifyStateChange()`와 동일한 push를 수행한다.
   * `getDashboardState()`가 호출 시점에 `at=` TOTP 코드를 재발급하므로, push 자체가
   * 열린 탭의 인스펙터 링크를 신선하게 유지한다. 90s 주기 < relay gate 허용창 ~3분
   * (±6 TOTP steps)이므로 탭이 열려 있는 한 링크가 항상 유효하다 (issue #509).
   *
   * 테스트에서 짧은 값(예: 50ms)을 주입해 검증한다. `undefined`이면 기본값 90_000.
   */
  sseRefreshIntervalMs?: number;
  /**
   * GET /inspector 라우트에서 클릭 시점 직접 인스펙터 URL을 조립하는 getter.
   *
   * getDashboardState().inspectorUrl(= /inspector 자기 자신)로 redirect하면 무한 루프가
   * 발생하므로, /inspector 라우트 내부는 이 getter로 직접 chii front_end URL을 조립한다.
   * 매 요청마다 호출되므로 TOTP를 요청 시점에 mint한다.
   *
   * - 미주입 → 기존 503 응답 유지.
   * - `ok: false, reason: 'relayDown'` → 502 (relay 미활성).
   * - `ok: false, reason: 'noTarget'` → 502 (relay up이지만 페이지 미attach).
   * - `ok: false, reason: 'totpUnavailable'` → 502 (TOTP secret 미설정, fail-closed).
   * - `ok: true` → 302 Location: url (Cache-Control: no-store).
   *
   * SECRET-HANDLING: ok:true 시 url 안에 relay host + TOTP at= 코드가 담긴다.
   * Location 헤더로 전달되는 건 의도된 transport. 로그/stdout 출력 금지.
   */
  getDirectInspectorUrl?: () =>
    | { ok: true; url: string }
    | { ok: false; reason: 'relayDown' | 'noTarget' | 'totpUnavailable' };
  /**
   * 대시보드 bind base 포트 override. 미지정 시 `AIT_DEBUG_HTTP_PORT` env →
   * {@link DEFAULT_DASHBOARD_PORT} 순으로 결정한다 (devtools#752).
   *
   * `0`을 명시하면 기존 순수 ephemeral 동작(매 run 랜덤 포트)을 유지한다 —
   * 증가 스캔을 타지 않는다.
   */
  dashboardPort?: number;
  /**
   * bind 재시도 스캔 폭 (테스트 전용 주입). 미지정 시 {@link PORT_SCAN_RANGE}.
   * 20개 실 소켓을 점유하지 않고 "범위 소진 → ephemeral fallback" 경로를
   * 검증하기 위한 internal testability hook — 사용자 대면 옵션이 아니다.
   */
  portScanRange?: number;
}

/**
 * 대시보드 기본 base 포트. 흔히 쓰이는 포트와 충돌하지 않는 임의의 값 —
 * 테스트/문서에서 참조할 수 있도록 named export로 유지한다 (devtools#752).
 */
export const DEFAULT_DASHBOARD_PORT = 8317;

/**
 * base 포트에서 EADDRINUSE 시 시도할 증가 스캔 폭. base, base+1, …,
 * base+(PORT_SCAN_RANGE-1)까지 시도하고 전부 점유면 ephemeral(0)로 폴백한다.
 */
export const PORT_SCAN_RANGE = 20;

/**
 * base 포트부터 EADDRINUSE 시 +1씩 증가하며 bind를 시도한다. EADDRINUSE가
 * 아닌 에러는 즉시 reject한다(스캔 대상 아님). `range`번 모두 점유 상태면
 * ephemeral(포트 0)로 폴백하고 한국어 안내를 stderr에 1회 출력한다.
 *
 * 매 시도마다 이전에 등록한 `error` 리스너를 제거한다 — 성공 시 listener가
 * 누적돼 다음 실패에서 중복 reject/EventEmitter 경고가 나는 것을 방지한다.
 *
 * `basePort === 0`이면 스캔 없이 즉시 ephemeral bind (명시적 opt-out, 기존
 * 순수 랜덤 포트 동작 유지).
 */
async function bindWithIncrement(
  server: Server,
  basePort: number,
  range: number = PORT_SCAN_RANGE,
): Promise<void> {
  if (basePort === 0) {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
  }

  for (let attempt = 0; attempt < range; attempt++) {
    const candidatePort = basePort + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('error', onError);
          reject(err);
        };
        server.once('error', onError);
        server.listen(candidatePort, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve();
        });
      });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') throw err;
      // 다음 후보 포트로 계속 — EADDRINUSE만 스캔 대상.
    }
  }

  // range 전부 점유 — ephemeral로 폴백 + 안내 1회.
  process.stderr.write(
    `devtools: 대시보드 포트 ${basePort}~${basePort + range - 1}이 모두 사용 중이라 임의 포트로 대체합니다.\n`,
  );
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

/**
 * 로컬 HTTP 서버를 127.0.0.1에 고정 base 포트({@link DEFAULT_DASHBOARD_PORT},
 * `AIT_DEBUG_HTTP_PORT` env, 또는 `options.dashboardPort`)에서 시작한다.
 * base 포트가 점유(EADDRINUSE) 상태면 +1씩 증가하며 재시도하고(최대
 * {@link PORT_SCAN_RANGE}회), 전부 점유면 ephemeral 포트로 폴백한다 —
 * rerun 시 대시보드 URL이 안정적으로 유지되어 브라우저 탭/북마크가
 * run마다 무효화되지 않는다 (devtools#752). base 포트를 명시적으로 `0`으로
 * 주면(env 또는 옵션) 기존 순수 ephemeral 동작을 유지한다.
 *
 * MCP debug server 생애주기에 묶어 사용 — `runDebugServer` shutdown 시 `close()`로 정리.
 *
 * @param getDashboardState - dashboard 상태를 반환하는 클로저. 주입 시 `GET /` dashboard와
 *   `GET /events` SSE 스트림이 활성화된다. 미주입 시 두 라우트는 204/서비스 없음으로 응답.
 * @param options - 서버 옵션. `sseRefreshIntervalMs`로 idle 탭 TOTP 만료 방지 주기를 조정.
 *   `getDirectInspectorUrl`로 /inspector 라우트에서 직접 조립 URL을 제공해 redirect 루프를 방지.
 *   `dashboardPort`로 bind base 포트를 override.
 */
export async function startQrHttpServer(
  getDashboardState?: () => DashboardState,
  options?: QrHttpServerOptions,
): Promise<QrHttpServer> {
  const { default: QRCode } = await import('qrcode');

  /** SSE 활성 연결 목록 — `notifyStateChange()` 시 전체 push. */
  const sseClients: ServerResponse[] = [];

  // SSE refresh 주기 — 핸들러 클로저 안에서 buildDashboardHtml/buildAttachHtml에 전달하기 위해
  // createServer 앞에서 선언한다 (temporal dead zone 방지, #681).
  const refreshIntervalMs = options?.sseRefreshIntervalMs ?? 90_000;

  /** SSE 연결 하나에 상태 이벤트를 flush한다. */
  function pushStateToClient(res: ServerResponse, state: DashboardState): void {
    const payload = JSON.stringify({
      tunnel: { up: state.tunnel.up, wssUrl: state.tunnel.wssUrl },
      pages: state.pages,
      // attachUrl은 캡슐 그대로 전달 — TOTP at= 코드 분리 없음 (의도된 설계).
      attachUrl: state.attachUrl,
      // inspectorUrl: relay + 페이지 attached 시 살아있는 인스펙터 URL (#503).
      // SECRET-HANDLING: URL(relay host + TOTP at=)은 SSE payload 전달이 의도된 transport.
      // 단 stdout/로그/에러에는 절대 출력하지 않는다.
      inspectorUrl: state.inspectorUrl ?? null,
      // phase: 세션 생애주기 enum (#730) — 시크릿 아님, 그대로 전달.
      phase: state.phase ?? 'active',
      // manualPrompt: 수동-변형 모드 진행 상태 (#741) — 파일명만, 시크릿 없음.
      manualPrompt: state.manualPrompt ?? null,
    });
    // SSE frame: "data: <json>\n\n"
    res.write(`data: ${payload}\n\n`);
  }

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? '/';
    const [path, query = ''] = rawUrl.split('?', 2) as [string, string | undefined];
    const params = new URLSearchParams(query ?? '');

    // per-request locale — ?lang= query param이 있으면 우선 적용, 없으면 Accept-Language header에서 결정.
    const langParam = params.get('lang');
    const locale =
      langParam === 'ko' || langParam === 'en'
        ? langParam
        : parseAcceptLanguage(req.headers['accept-language']);

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
      // devtoolsEntryUrl — getDirectInspectorUrl 주입 시만 /devtools/ 링크를 활성화.
      // 미주입이면 /devtools/ → 503이므로 dashboard에서 링크를 숨긴다.
      // /devtools/ 는 안정 경로 (relay host·TOTP 없음) — stdout/로그 출력 가능.
      const devtoolsEntryUrl: string | null = (() => {
        if (!options?.getDirectInspectorUrl) return null;
        const addr = server.address();
        if (!addr || typeof addr === 'string') return null;
        return `http://127.0.0.1:${addr.port}/devtools/`;
      })();
      const html = buildDashboardHtml(
        state,
        qrDataUrl,
        locale,
        path,
        params,
        devtoolsEntryUrl,
        refreshIntervalMs,
      );
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

      // 현재 세션 mode + pages 상태 — 카피 분기(#468), inspector 게이트(#544).
      // getDashboardState 미주입(legacy) 시 undefined → intoss family + 환경 라벨 없음 fallback.
      const currentState = getDashboardState?.();
      const mode = currentState?.mode;
      const pagesAttached =
        Array.isArray(currentState?.pages) && (currentState?.pages.length ?? 0) > 0;
      // inspectorStableUrl: /inspector 안정 URL (시크릿 없음) — getDirectInspectorUrl 주입 시만 활성.
      // 서버 주소는 listen 후에만 확정되므로 server.address()로 런타임에 읽는다.
      // (요청은 listen 완료 후 들어오므로 address()는 항상 non-null이다.)
      const inspectorStableUrlForAttach: string | null = (() => {
        if (!options?.getDirectInspectorUrl) return null;
        const addr = server.address();
        if (!addr || typeof addr === 'string') return null;
        return `http://127.0.0.1:${addr.port}/inspector`;
      })();

      // QR을 base64 data URL로 인라인 생성 — 외부 fetch 없이 self-contained HTML.
      QRCode.toDataURL(attachUrl, { type: 'image/png', errorCorrectionLevel: 'M' })
        .then((dataUrl: string) => {
          const safeLabel = escapeHtml(deploymentIdLabel);
          const safeAttachUrl = escapeHtml(attachUrl);
          const html = buildAttachHtml(
            dataUrl,
            safeLabel,
            safeAttachUrl,
            locale,
            path,
            params,
            mode,
            pagesAttached,
            inspectorStableUrlForAttach,
            refreshIntervalMs,
          );
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

    // ── GET /inspector — 안정 인스펙터 진입점 (issue #530) ───────────────────
    // ── GET /devtools/ — chii DevTools UI 진입로 (issue #248 옵션 A) ──────────
    //
    // 두 라우트는 동일한 핸들러를 공유한다:
    //   - relay 연결 active + attached target 있음 → chii front_end/chii_app.html?ws=… 302.
    //   - relay down 또는 target 없음 → 502 (사용자에게 원인 + 다음 단계 안내).
    //   - getDirectInspectorUrl 미주입 (relay 연결 없는 server mode) → 503.
    //
    // /inspector: dashboard의 "디버그 툴 열기" 링크가 이 URL을 가리키며, qrServer.inspectorStableUrl로 노출된다.
    // /devtools/: `/ait debug` 문서·가이드에서 직접 참조 가능한 고정 경로 (issue #248).
    //   이 경로가 존재함으로써 사용자가 dashboard를 열지 않고도 직접 DevTools UI에 접근할 수 있다.
    //
    // getDashboardState().inspectorUrl(= /inspector 자기 자신)을 쓰면 무한 루프 → getDirectInspectorUrl로 분리.
    // SECRET-HANDLING: redirect Location(relay host + at=)은 HTTP 응답으로만 전달.
    // 로그에 Location 값 출력 금지.
    if (path === '/inspector' || path === '/devtools' || path === '/devtools/') {
      const getDirectInspectorUrl = options?.getDirectInspectorUrl;
      if (!getDirectInspectorUrl) {
        // /inspector: 기존 영문 메시지를 유지한다.
        //   이 경로는 공개 안정 경로(#530)이고 외부 스크립트가 메시지를 파싱할 수 있어
        //   계약을 깨지 않도록 원문 그대로 유지한다.
        // /devtools[/]: issue #248에서 새로 추가된 경로. 한국어 안내를 반환한다.
        const body =
          path === '/inspector'
            ? 'Inspector endpoint is not available in this server mode.'
            : 'relay 연결 세션에서만 DevTools UI를 열 수 있습니다.';
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
        return;
      }
      // 매 요청마다 getter 호출 — TOTP를 요청 시점에 mint.
      const result = getDirectInspectorUrl();
      const s = resolveLocaleStrings(locale);
      if (!result.ok) {
        const msgKey =
          result.reason === 'noTarget' ? 'inspector.error.noTarget' : 'inspector.error.relayDown';
        const msg = s(msgKey);
        const body =
          `<!DOCTYPE html><html lang="${locale}"><head>` +
          `<meta charset="utf-8"><title>Inspector</title></head><body>` +
          `<p>${escapeHtml(msg)}</p>` +
          `<p style="font-size:0.9em;color:#666">` +
          (locale === 'ko'
            ? '(<a href="/">대시보드로 돌아가기</a>)'
            : '(<a href="/">Back to dashboard</a>)') +
          `</p></body></html>`;
        res.writeHead(502, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(body);
        return;
      }
      // ok: true — 302 redirect. Location에 relay host + TOTP at= 포함.
      // SECRET-HANDLING: Location 값은 HTTP 응답으로만 — 로그/stdout 출력 금지.
      res.writeHead(302, {
        Location: result.url,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    if (path === '/qr.png') {
      const encodedU = params.get('u') ?? '';

      // SECONDARY FIX (devtools#714): an empty or missing `u` means the attach
      // URL is not yet available (tunnel still booting, dashboard in WAITING
      // state). Return 204 No Content instead of passing an empty string to
      // QRCode.toBuffer which would reject and produce a confusing 500.
      // The dashboard SSE will push a refresh once the attach URL is minted.
      if (encodedU === '') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      let attachUrl: string;
      try {
        attachUrl = decodeURIComponent(encodedU);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('잘못된 u 파라미터입니다.');
        return;
      }

      // Guard against an empty decoded string (e.g. `?u=` encoded as `%00`
      // or other edge cases) — same 204 treatment as the missing-u path above.
      if (attachUrl === '') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
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

  // base 포트 결정 순서: options.dashboardPort → AIT_DEBUG_HTTP_PORT env →
  // DEFAULT_DASHBOARD_PORT. 0은 명시적 opt-out(순수 ephemeral) — env/옵션
  // 어느 쪽에서 와도 동일하게 취급한다 (devtools#752).
  const basePort =
    options?.dashboardPort ??
    (process.env.AIT_DEBUG_HTTP_PORT !== undefined
      ? Number(process.env.AIT_DEBUG_HTTP_PORT)
      : DEFAULT_DASHBOARD_PORT);

  await bindWithIncrement(server, basePort, options?.portScanRange);

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('qr-http-server: server.address()가 예상하지 못한 형태입니다.');
  }
  const port = address.port;

  /** idle 탭 TOTP 만료 방지용 주기 SSE 갱신 interval. */
  function notifyStateChangeInternal(): void {
    if (!getDashboardState) return;
    const state = getDashboardState();
    for (const client of sseClients) {
      try {
        pushStateToClient(client, state);
      } catch {
        // 연결이 이미 끊어진 경우 — 무시 (close 핸들러가 목록에서 제거함).
      }
    }
  }

  // 주기 SSE 갱신 — getDashboardState() 호출 시점에 TOTP at=가 재발급되므로
  // push 자체가 열린 탭의 인스펙터 링크를 신선하게 유지한다 (issue #509).
  // .unref()로 프로세스 종료를 막지 않는다.
  // refreshIntervalMs는 createServer 앞에서 이미 선언됨 (#681 — 핸들러 클로저에서 참조).
  const refreshHandle = setInterval(() => {
    if (sseClients.length > 0 && getDashboardState) {
      notifyStateChangeInternal();
    }
  }, refreshIntervalMs).unref();

  return {
    port,
    buildAttachPageUrl(_attachUrl: string): string {
      // 사용자 대면 URL을 루트 `/`로 수렴 (#595).
      // 같은 데몬이 attachUrl을 이미 server-state(getDashboardState)로 보유하므로
      // `/attach?u=<encoded>` 쿼리는 redundant하다.
      // SECRET-HANDLING: 브라우저에 열리는 URL에서 tunnel host·relay wss·TOTP at= 제거.
      // /attach?u= 라우트 자체는 back-compat으로 유지(기존 인쇄된 링크 보호).
      return `http://127.0.0.1:${port}/`;
    },
    // 안정 인스펙터 진입점 URL (issue #530) — 클릭 시 302 redirect (TOTP 클릭 시점 mint).
    // URL 자체에 시크릿 없음 → 대시보드/stdout/로그 어디든 출력 가능.
    get inspectorStableUrl(): string {
      return `http://127.0.0.1:${port}/inspector`;
    },
    notifyStateChange(): void {
      notifyStateChangeInternal();
    },
    close(): Promise<void> {
      clearInterval(refreshHandle);
      // devtools#755: `GET /events`(SSE)로 열린 대시보드 탭 연결은
      // `Connection: keep-alive`로 응답 헤더를 쓴 채 절대 res.end()를 부르지
      // 않는다 — 즉 `server.close()`만 호출하면 새 연결만 막힐 뿐, 이미 열려
      // 있는 SSE 소켓은 클라이언트가 스스로 끊을 때까지 살아남는다. 대시보드
      // 탭을 닫지 않은 채(또는 test-runner CLI 종료 시점에 브라우저가 여전히
      // 열려 있는 채) close()를 부르면 그 콜백이 영원히 안 불려 이벤트 루프가
      // 붙잡힌다(devtools-test CLI run7~10 재현). `closeAllConnections()`로
      // 열려 있는 소켓을 즉시 강제 종료한 뒤 `close()`를 불러 항상 resolve를
      // 보장한다 — SSE 탭이 없을 때도 no-op이라 회귀 없음.
      server.closeAllConnections();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
