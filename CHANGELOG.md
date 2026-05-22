# Changelog

## 0.1.30

### Patch Changes

- 090d02f: SDK 2.6.0 지원: openPDFViewer·fetchAlbumItems mock 추가

## 0.1.29

### Patch Changes

- 214344d: feat(in-app): add Layer B1 host allowlist to the runtime debug gate

  The runtime gate now requires the page to be served from a
  `*.private-apps.tossmini.com` host before any debug attach is considered.
  A production `intoss://` entry is served from `*.apps.tossmini.com` (no
  `.private-apps.` segment) and is now rejected with `reason: 'host'`.

  This closes a gap: Layer A keeps debug code out of release bundles, but a
  dogfood build that somehow lands on a production entry still had its code
  present. Layer B1 stops that build from attaching on a production host.

  A live CDP probe of dogfood mini-app 31146 confirmed the host is the only
  usable signal — `getSchemeUri()` normalises `intoss-private://` to
  `intoss://`, and `getOperationalEnvironment()` / `getWebViewType()` return
  the same value (`"toss"` / `"partner"`) for dogfood and production entries.

  `GateInput` gains a required `hostname` field; `checkDebugGate()` fills it
  from `window.location.hostname`, so consumers calling it with no arguments
  need no change. New export: `isPrivateAppsHost`.

## 0.1.28

### Patch Changes

- df098d8: fix(in-app): remove Layer A from the runtime gate — it can never pass in a pre-built package

  `evaluateDebugGate`/`checkDebugGate` re-checked `__DEBUG_BUILD__` as "Layer A" and
  returned `reason: 'build'` when it was false. But `@ait-co/devtools` ships pre-built:
  the constant is baked at _this package's_ publish time (always `false`), so the gate
  could never pass on a consumer's phone regardless of query params — the in-app debug
  attach surface was permanently dead.

  Layer A's real mechanism is, and always was, the consumer's
  `if (__DEBUG_BUILD__) { import('@ait-co/devtools/in-app') }` guard, where
  `__DEBUG_BUILD__` is a _consumer_-build-time constant that DCEs the import from
  release bundles. The gate function now evaluates only the runtime layers B
  (`_deploymentId`) and C (`debug=1` + valid `wss:` relay). `GateInput.isDebugBuild`
  and the `'build'` blocked-reason are removed.

## 0.1.27

### Patch Changes

- 3380102: Add `build_attach_url` debug MCP tool: splices `debug=1` + the session's live relay URL into an `ait deploy --scheme-only` deep link so opening it on a phone auto-attaches to the Chii relay with no QR scan or paste. This removes the human-in-loop attach step; the in-app gate already reads the `relay` query param, so the deep link triggers attachment on entry.

## 0.1.26

### Patch Changes

- 6089639: chore: add pnpm-workspace.yaml so sharp/esbuild build scripts run on fresh installs

  `sharp` (used by the OG-image build) and `esbuild` had their postinstall build scripts silently ignored under pnpm 10 because no `onlyBuiltDependencies` allowlist existed. Add `pnpm-workspace.yaml` listing them (and ignoring `@sentry/cli`/`@swc/core`/`protobufjs`), matching the org standard.

## 0.1.25

### Patch Changes

- 1cd518b: fix: remove stdout/stderr listeners on all tunnel exit paths; soften misleading attach-token banner wording; correct CLAUDE.md panel tab list (9→12)

  - `src/unplugin/tunnel.ts`: extract a shared `cleanup()` that calls `tunnel.off('stdout', onUrl)` + `tunnel.off('stderr', onUrl)`, and call it from every exit path — resolve, error handler, exit handler, and the 20 s timeout — so persistent listeners are never left on a stopped process.
  - `src/mcp/tunnel.ts`: replace "secret token used to gate attach" / bare `token:` label with "attach token (pairing hint — relay-side validation lands in a later phase)", matching the existing code comment that ACL enforcement is a future phase.
  - `CLAUDE.md`: update tabs list from 9 to the actual 12 tabs (adds presets, notifications, ads).

## 0.1.24

### Patch Changes

- a1552be: Fix double `res.end()` in the unplugin dev-middleware POST handler. On the
  invalid-JSON path the catch block already ended the response, then a trailing
  `res.end()` ran again and threw `ERR_STREAM_WRITE_AFTER_END`. The success
  response now ends inside its own branch so each path ends the response exactly
  once.

## 0.1.23

### Patch Changes

- e42730a: debug-mode MCP transport을 `devtools-mcp` bin에 추가 (Debugging MCP Phase 1).

  단일 `devtools-mcp` 진입점이 `--mode`로 transport을 분기합니다. 기본(debug) 모드는
  로컬 Chii 릴레이 + cloudflared quick tunnel을 띄워 폰 안 미니앱에 CDP로 attach하고,
  `list_console_messages` / `list_network_requests` / `list_pages` 세 read-only tool을
  `chrome-devtools-mcp` 호환 형태로 노출합니다. `--mode=dev`는 기존 dev-server mock state
  surface(`devtools_get_mock_state`)를 그대로 사용합니다.

  CDP 연결은 주입 가능한 `CdpConnection` 인터페이스 뒤에 있어 tool 계층이 mock으로
  단위 테스트됩니다. 폰 attach 라운드트립은 실기기 검증이 필요해 후속 phase로 분리.

- b8c093f: debug-mode MCP에 DOM/스냅샷/스크린샷 + AIT 도메인 tool 추가 (Debugging MCP Phase 2·3).

  Phase 2 — CDP 커맨드(요청→응답) 기반 read-only tool 3개: `get_dom_document`(`DOM.getDocument`),
  `take_snapshot`(`DOMSnapshot.captureSnapshot`), `take_screenshot`(`Page.captureScreenshot`,
  PNG를 MCP image content block으로 반환). Phase 1의 이벤트 스트림과 달리 요청→응답이라
  `CdpConnection`에 `send(method, params)`를 추가했습니다.

  Phase 3 — CDP가 못 잡는 영역을 위한 AIT 도메인 tool 3개: `AIT.getSdkCallHistory`,
  `AIT.getMockState`, `AIT.getOperationalEnvironment`. debug 모드에서는 Chii 채널로,
  dev 모드에서는 dev server의 mock-state HTTP endpoint로 같은 tool surface를 노출합니다.
  dev 모드(`devtools-mcp --mode=dev`)가 이제 `AIT.*` tool을 노출하며,
  기존 `devtools_get_mock_state`는 `AIT.getMockState`의 하위호환 alias로 유지됩니다.

  모든 tool은 주입 가능한 `CdpConnection` / `AitSource` 뒤에 있어 fake로 단위 테스트됩니다.
  폰 attach 라운드트립(실기기 검증)은 후속 phase로 분리되어 있고, tool 계층은 CI에서 검증됩니다.

- 57bef90: feat(in-app): wire Chii target.js injection — Phase 1 browser-side attach (gate → script inject)
- a46c1ae: feat(in-app): add 3-layer debug activation gate — Phase 1 of Debugging MCP Server (spec 2026-05-18)
- e7e6950: feat(mcp): add stdio MCP server spike with `devtools_get_mock_state` tool

  Adds a minimal MCP (Model Context Protocol) server that exposes the live browser
  mock state to AI coding agents. This is a spike implementation to validate the
  surface and establish the extensibility pattern before adding more tools.

  **What's included:**

  - `src/mcp/server.ts` — Node.js stdio MCP server (`dist/mcp/server.js`)
    Implements `devtools_get_mock_state` tool: fetches a JSON snapshot of the
    current `AitDevtoolsState` from the Vite dev server endpoint.
  - Unplugin option `mcp: true` — registers `GET /api/ait-devtools/state` and
    `POST /api/ait-devtools/state` on the Vite dev server (no-op for other
    bundlers).
  - Panel auto-push — on every `aitState` change the panel silently POSTs the
    current state to the endpoint (fire-and-forget, only active when the endpoint
    exists).

  **Usage:**

  ```js
  // vite.config.ts
  import aitDevtools from "@ait-co/devtools/unplugin";
  export default { plugins: [aitDevtools.vite({ mcp: true })] };
  ```

  ```json
  // MCP client config (e.g. Claude Desktop / Claude Code)
  {
    "mcpServers": {
      "ait-devtools": {
        "command": "node",
        "args": ["node_modules/@ait-co/devtools/dist/mcp/server.js"],
        "env": { "AIT_DEVTOOLS_URL": "http://localhost:5173" }
      }
    }
  }
  ```

  The `AIT_DEVTOOLS_URL` env var defaults to `http://localhost:5173`.

- be23475: docs/config: 2026-05-19 refactor sweep — iPhone Air (est) 라벨에서 (est) 제거 (2026-04 출시 확정), CLAUDE.md 탭 수 9→12 정정, README build tool tsup→tsdown 수정, biome.json·vitest.config.ts에서 .claude/ 워크트리 제외

## 0.1.22

### Patch Changes

- b8c7e92: launcher의 정적 설치 안내 카드를 `@khmyznikov/pwa-install` Web Component로 교체했습니다. "Install launcher to your phone" 버튼 하나로 Android Chrome 인앱 프롬프트, iOS Safari "공유 → 홈 화면에 추가" 일러스트, Firefox/Samsung Internet 수동 안내까지 플랫폼별 네이티브 흐름이 자동으로 안내됩니다 — `beforeinstallprompt` 직접 처리나 플랫폼 분기 코드 없이.

  Replace the launcher's hand-rolled install hint card with the `@khmyznikov/pwa-install` Web Component. A single "Install launcher to your phone" CTA now triggers the platform-native flow automatically — Android Chrome's in-app install prompt, iOS Safari's Share → Add to Home Screen illustration, and Firefox/Samsung Internet's manual instruction card — without us needing to handle `beforeinstallprompt` or branch on user-agent ourselves.

## 0.1.21

### Patch Changes

- bbf2659: launcher PWA를 홈 화면 설치 상태에서만 동작하도록 게이팅하고, 터널 QR을 `…/launcher/?url=<tunnel>` 딥링크로 인코딩해 스캔 한 번으로 자동 진입하도록 변경했습니다. 로컬 dev(`http://localhost`)에서는 게이팅이 풀려 e2e 픽스처가 그대로 동작합니다.

  Gate the launcher PWA to its installed home-screen context (browser-tab visitors now see only the install hint, with the input and scanner hidden) and encode the tunnel QR as a `…/launcher/?url=<tunnel>` deep-link so a single scan auto-opens the dev URL. The gate is relaxed on `http://localhost` so the bundled e2e fixture keeps working in a normal tab.

## 0.1.20

### Patch Changes

- 38db1ce: docs(fixture): SEO/AEO on devtools.aitc.dev — JSON-LD, canonical, sitemap, llms.txt

  Make the live fixture demo (`devtools.aitc.dev`) discoverable:

  - `e2e/fixture/index.html`: descriptive title, meta description, canonical,
    Open Graph + Twitter Card meta with og:image, and a `SoftwareApplication`
    JSON-LD block listing the SDK mock + multi-bundler unplugin + DevTools
    panel.
  - `e2e/fixture/launcher/index.html`: `noindex,nofollow` (the launcher is a
    user-only PWA chrome, not a search target).
  - `e2e/fixture/public/{robots.txt,sitemap.xml,llms.txt}`: standard SEO
    surface + `llmstxt.org` overview for AI answer engines. AI crawlers
    (GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, Applebot-Extended)
    explicitly allowed per org policy; `/launcher/` excluded from crawls.
  - `e2e/fixture/public/og/image.png`: 1200×630 OG image.

- 697870f: feat(telemetry): multi-tier consent — Tier 0 panel-mount ping + Tier 1 retained

  Tier 0 opt-out daily ping (panel mount, fire-and-forget, no anon_id). Tier 1 events
  retain existing behaviour with explicit `tier: 1` field. policy_version bumped to
  `2026-05-18`; existing granted users regress to undecided for re-consent.

- 41add94: docs(npm): add npm/license badges, expand keywords, refresh homepage

  - README.md / README.en.md: add npm version + license badges below the
    lang toggle, move "Reference consumer" section below Install so first-
    paint shows the install command.
  - package.json: extend `keywords` (`miniapp`, `simulator`, `testing`,
    `vite-plugin`, `webpack-plugin`) for better npm discovery; point
    `homepage` at https://devtools.aitc.dev/ instead of the npm page so
    the registry "homepage" link goes to the live demo.

## 0.1.19

### Patch Changes

- aef97d8: feat(panel): full ko/en internationalization

  DevTools panel and consent toast now render in Korean or English based on `navigator.language` (`/^ko\b/i` → ko, else en), persisted under `localStorage['__ait_locale']`. Environment tab gains a Language toggle; switching locales remounts the panel via the new `__ait:localechange` event. Strings are sourced from a typed catalog under `src/i18n/`; missing keys fall back to the key string. Internal devtools chrome (Load / Show / Clear / Apply / Lat / Lng / Send / Cancel) is intentionally left in English in both locales.

- 7ed86f5: unplugin: add a `tunnel` option (Vite dev only) that exposes the dev server via a
  Cloudflare quick tunnel (`*.trycloudflare.com`, no account) and prints the public
  URL + an ASCII QR in the terminal. Pair it with the new launcher PWA at
  `https://devtools.aitc.dev/launcher/` to run the dev app full-screen on a real
  phone — scan/paste the URL once per session; the launcher remembers the last URL.
  `cloudflared` / `qrcode-terminal` are loaded only when the option is on. While
  the tunnel is active the plugin also adds `.trycloudflare.com` to Vite's
  `server.allowedHosts` so the random per-run hostname isn't rejected. See
  "Run on a real phone" in the README.

## 0.1.18

### Patch Changes

- d93ff39: Galaxy S26 시리즈가 2026-03-11 출시되어, viewport preset의 width/height를 phone-simulator.com 측정치(S26 360×773, S26+ 480×1040, S26 Ultra 480×1040, 모두 DPR 3)로 갱신했습니다. 라벨에서 `(S25 fallback)` 접미사가 제거됩니다. safe area insets는 토스 호스트 환경 실측 전까지 S25 값을 잠정 사용합니다.

## 0.1.17

### Patch Changes

- 602a60a: fix(telemetry): use `__VERSION__` compile-time define directly so events carry the actual package version

  `getVersion()` was reading `globalThis.__VERSION__` at runtime, but tsdown's
  `define` substitutes `__VERSION__` at build time (it is not a real global).
  Result: every telemetry event sent `"version":"0.0.0"` instead of the actual
  package version. Switched to a direct `__VERSION__` reference — the same
  pattern the panel header already uses — so the substitution applies.

## 0.1.16

### Patch Changes

- e3bb8e8: Fix telemetry "내 데이터 삭제" button + the 30-day re-prompt after "No, thanks":

  - `deleteMyData` was calling `DELETE https://t.aitc.dev/?anon_id=…` (missing `/e`). Now hits `DELETE /e?anon_id=…` and rotates the local `anon_id` to a fresh UUID on success so future events are unlinkable from deleted history.
  - `shouldShowToast` only re-prompted when consent was `undecided`, so users who picked "No, thanks" never saw the toast again. It now re-prompts denied users once when `reprompt_after` (30 days, or version-bump) has elapsed, and respects `MAX_SAFE_INTEGER` as permanent silence after a second decline.

## 0.1.15

### Patch Changes

- 8ec6337: Add Notifications panel tab for toggling `requestNotificationAgreement` mock result (`newAgreement` / `alreadyAgreed` / `agreementRejected`).
- b0b55c8: Add opt-in anonymous usage telemetry client. Introduces a consent state machine (granted/denied/undecided), a Korean-only bottom-right toast (requestIdleCallback / 1.5 s fallback), send-with-retry-once semantics to `https://t.aitc.dev/e`, session-duration tracking via `pagehide`/sendBeacon, and an Environment-tab Telemetry section (toggle, anon_id display, "내 데이터 삭제", privacy link). Module is panel-internal and not exported to consumers.

## 0.1.14

### Patch Changes

- 6490efa: docs(devices): mark Galaxy S26 / S26+ / S26 Ultra viewport presets as
  unreleased fallback. The dropdown label, source code comment, and README
  device table now make it explicit that these entries currently mirror the
  S25 / S25+ / S25 Ultra spec (`(S25 fallback)`) until the S26 series
  viewport spec is confirmed. Values are unchanged.

## 0.1.13

### Patch Changes

- 8a1fdfb: feat(mock): cover 3 previously-uncovered SDK APIs (getAnonymousKey,
  requestTossPayPaysBilling, requestNotificationAgreement) with proper
  mocks. requestNotificationAgreement signature is verified against
  @apps-in-toss/web-framework via \_\_typecheck.ts; the other two are not
  re-exported from the package's main entry point so their Assert is
  intentionally omitted (mocks remain available for direct deep imports
  and future SDK surface expansion).
- 70d0632: Fix dual `AitStateManager` instance bug in production builds.

  `tsdown.config.ts` builds `mock`, `panel`, and `unplugin` entries as
  self-contained config objects so Rolldown does not emit a shared chunk at
  `dist/` root. As a side effect, `state.ts` was bundled per entry, producing
  two `AitStateManager` instances when consumers imported both
  `@ait-co/devtools` and `@ait-co/devtools/panel` on the same page. The panel
  mutated one instance while the mock SDK observed the other, so toggles in
  Permissions / Presets / Network / IAP appeared to apply in the panel UI but
  had no effect on the running app.

  Fixed with a runtime guard in `src/mock/state.ts`: the `AitStateManager` is
  cached on `globalThis` under `__aitDevtoolsStateSingleton__`, so all entries
  loaded on the same page share a single instance. No build-pipeline change.

  Added two regression tests in `e2e/panel.test.ts` (Layer C):

  - `aitState is a single shared instance (not duplicated per entry)` — asserts
    `window.__ait === globalThis.__aitDevtoolsStateSingleton__` and listener
    count > 0.
  - `preset Apply changes mock state observed by fixture SDK` — applies the
    Offline preset and verifies a subsequent `iap-purchase` call from the
    fixture switches from `success:` to `error:`.

## 0.1.12

### Patch Changes

- 06bdb74: chore(deps): refresh dev dependencies (biome 2.4.15, typescript 6.0.3, vitest 4.1.5, jsdom 29.1.1) and bump `@apps-in-toss/web-framework` peer to `>=2.5.0 <2.6.0` (typecheck green against 2.5.0).

## 0.1.11

### Patch Changes

- 3660a95: feat(panel): export `disposePanel()` for explicit unmount + idempotent re-mount

  Pairs with the existing `disposeViewport()`. The panel side-effect import
  already mounts idempotently; this adds a symmetric teardown for HMR / SPA
  contexts where the panel needs to be removed without a full page reload.
  Removes the toggle, panel root, injected `<style>`, all window/aitState
  listeners, and `disposeViewport()` is called internally. Calling
  `disposePanel()` before mount or twice in a row is a no-op.

## 0.1.10

### Patch Changes

- fca317d: `devtools.aitc.dev`에 `e2e/fixture/`를 GitHub Pages로 배포합니다. 패키지 surface 변경 없음 — 빌드/배포 인프라만 추가.
- 336c447: npm landing용 정적 OG image (1장)을 빌드 시 satori + sharp으로 생성합니다. README 상단에 표시되며 GitHub social preview에 사용됩니다. API 표면 변경 없음.

## 0.1.9

### Patch Changes

- d30bb8b: devtools 패널에 mock state preset library를 추가합니다. 자주 쓰는 QA 시나리오(`permission-denied`, `offline`, `logged-out`, `iap-pending`, `ads-no-fill` 등)를 한 클릭으로 적용/해제할 수 있고, 사용자 정의 preset도 `localStorage`에 저장/불러오기 가능합니다. `applyPreset` / `builtInPresets` / `saveUserPreset` 등은 `@ait-co/devtools`에서도 export되어 코드에서 직접 호출할 수 있습니다. 기존 토글 동작은 변경 없습니다.

## 0.1.8

### Patch Changes

- 236b35c: devtools 패널에 Ads 탭을 추가해 GoogleAdMob/TossAds/FullScreenAd의 load → show → dismiss 이벤트 흐름을 패널에서 직접 trigger/관찰할 수 있습니다. IAP viewer의 짝으로 sdk-example AdsPage 디버깅이 쉬워집니다.

## 0.1.7

### Patch Changes

- 41c185f: devtools 패널 IAP 탭에 pending orders / completed orders viewer 섹션을 추가합니다. mock IAP가 발급한 주문 라이프사이클을 패널 안에서 관찰·조작할 수 있어 sdk-example IAPPage 흐름을 디버깅하기 쉬워집니다.

## 0.1.6

### Patch Changes

- 838fe13: AIT host nav bar `game` 변형을 추가했다. 기존 `partner` 변형(흰 배경 + 뒤로가기 + 앱 아이콘/이름 + ⋯/×)에 더해, `game`은 투명 배경 + ⋯/× 만 그려서 풀스크린 게임 캔버스를 가리지 않게 한다. Viewport 탭의 "Nav bar type" select로 토글 가능하며, `aitState.patch('viewport', { aitNavBarType: 'game' })`로도 변경할 수 있다. 기본값은 `partner`로 기존 동작을 보존한다.

## 0.1.5

### Patch Changes

- ae91fc3: chore(release): switch publish command to `pnpm exec changeset publish` so `changesets/action` creates GitHub Releases. Raw `npm publish` does not emit the `New tag:` lines the action parses, which silently skipped Release creation for 0.1.0–0.1.4 (npm got them, GitHub Releases page did not). No runtime behavior change.

## 0.1.4

### Patch Changes

- eb57b5f: Add device simulation (viewport presets + orientation toggle + optional frame) to the floating panel. Selection persists in sessionStorage under `__ait_viewport`.
- 1a923bf: Polish the device simulation with 2026 presets (iPhone 17 series, iPhone Air, iPhone 16e, SE 3rd gen, Galaxy S26 series, Z Flip7, Z Fold7 folded/unfolded), HiDPI metadata, auto safe-area insets, notch/Dynamic Island/punch-hole overlays, an Apps in Toss host nav bar overlay, and `setDeviceOrientation` sync with the Panel's `auto` orientation mode.
- bf0a40a: Address code-review feedback for the device simulation:

  - Fix `setDeviceOrientation` "auto" mode losing the SDK after the first call. The SDK now writes to a separate `viewport.appOrientation` field; user-controlled `viewport.orientation` stays `auto`, so the same app can rotate freely across multiple calls.
  - Add `viewport.landscapeSide` (`left` | `right`, default `left`). Notch/Dynamic Island insets now move to a single side in landscape, matching real iOS behavior instead of doubling up on both sides.
  - Apps in Toss nav bar now uses `aitState.brand.displayName` (built with `textContent`, not `innerHTML` — XSS-safe) and re-renders when the brand name changes. Back button triggers `__ait:backEvent`; close button calls `closeView()`.
  - Render the home indicator pill at the bottom of the body for devices with `safeAreaBottom > 0`.
  - `body { isolation: isolate }` so notch/navbar z-index can't paint over the floating Panel toggle.
  - Make `initViewport` idempotent (HMR / re-mount safe) and export `disposeViewport()` for consumers that dynamically tear the panel down.
  - Strict integer + clamp on custom width/height (`1 ≤ value ≤ 4096`); session-storage validation matches.
  - Tests for the Viewport tab UI branches (custom inputs, status panel, disabled state, notch-side row visibility).
  - README: document the body-scroll caveat, mark `iPhone Air` and `Galaxy S26` series as `(est)`, drop the bogus Pixel/iPad mentions, refresh the console examples and status-line strings.
  - Reorder Panel tabs so Viewport sits right after Environment (visual setup before SDK plumbing).

## 0.1.3

### Patch Changes

- 0d50bbd: fix(panel): extend fullscreen breakpoint to 720px so panel doesn't overlap mobile containers

  QA로 sdk-example을 브라우저에서 테스트하던 중, viewport 576px에서 DevTools 패널이 mobile-container(`max-w-[430px]` 중앙 정렬) 카드의 오른쪽 절반을 완전히 덮어 실행 버튼을 클릭할 수 없는 UX 이슈가 확인되었다.

  기존에는 `(max-width: 480px)`에서만 패널이 fullscreen이 되어 481~720px 구간에서 360px 폭 floating 패널이 중앙 정렬된 mobile container와 겹쳤다. breakpoint를 720px로 확장해 이 구간에서도 fullscreen으로 동작하도록 한다. 진짜 tablet 이상(768+)에선 floating 모드 유지.

  CSS 미디어쿼리와 `updatePanelPosition`의 JS 분기가 반드시 동일한 값을 써야 해서 `PANEL_FULLSCREEN_BREAKPOINT` 상수를 도입했다.

## 0.1.2

### Patch Changes

- Flip the mock clipboard default mode from `'web'` to `'mock'`. The old default
  called `navigator.clipboard.readText()` directly, which — when paired with
  `@ait-co/polyfill` — recursed infinitely: the polyfill shim routes
  `navigator.clipboard` back to the SDK's `getClipboardText`, which is this
  mock, which calls `navigator.clipboard.readText`, and so on.

  With the new default the mock returns state from `aitState.mockData.clipboardText`,
  so the polyfill + devtools pair works out of the box. Users who still want
  real-browser clipboard integration can flip the mode to `'web'` from the
  DevTools panel.

## 0.1.1

### Patch Changes

- b47021e: Fix unplugin `resolveId` regression that broke Vite dev on 0.1.0. The hook was
  returning the bare specifier `@ait-co/devtools/mock`, which Vite 8+ treats as
  the final resolved id — the module then 404s because no `load` hook is
  provided. `resolveId` now resolves the mock subpath to its absolute file path
  via `import.meta.resolve`, so every supported bundler loads it the normal way.
  Falls back to the bare specifier in runtimes where `import.meta.resolve` is
  unavailable.

## [0.0.3](https://github.com/apps-in-toss-community/devtools/compare/v0.0.2...v0.0.3) (2026-04-18)

### Bug Fixes

- add error boundary to panel mount logic ([#43](https://github.com/apps-in-toss-community/devtools/issues/43)) ([2b3db41](https://github.com/apps-in-toss-community/devtools/commit/2b3db41fa61acf0461f6fc4e4258be44a74b8f55))
- prompt 타임아웃 시 패널 존재 여부에 따라 메시지 분기 ([#44](https://github.com/apps-in-toss-community/devtools/issues/44)) ([c638304](https://github.com/apps-in-toss-community/devtools/commit/c638304b71e2a3d95021c66d80371f21c7530912))

## [0.0.2](https://github.com/apps-in-toss-community/devtools/compare/v0.0.1...v0.0.2) (2026-04-10)

### Features

- add device API mode system (mock/web/prompt) ([#13](https://github.com/apps-in-toss-community/devtools/issues/13)) ([2253a1f](https://github.com/apps-in-toss-community/devtools/commit/2253a1fa8f033f878886e1c37393ac8140cb3e46))
- add GitHub Pages deployment for example app ([#22](https://github.com/apps-in-toss-community/devtools/issues/22)) ([6fa1138](https://github.com/apps-in-toss-community/devtools/commit/6fa113846ead2a5624eafa722596ab477f4e82e1))
- add Vite + React example mini-app ([#3](https://github.com/apps-in-toss-community/devtools/issues/3)) ([16f51fb](https://github.com/apps-in-toss-community/devtools/commit/16f51fb7f4ed0c6f79d1afa22c6752194983d2f2))
- improve panel UX with fixed height, mobile fullscreen, and draggable button ([#27](https://github.com/apps-in-toss-community/devtools/issues/27)) ([4fb5335](https://github.com/apps-in-toss-community/devtools/commit/4fb5335f0439eb2e2b1992ff7bd637639d26650d))
- initial implementation of ait-devtools ([5f263ca](https://github.com/apps-in-toss-community/devtools/commit/5f263ca6fee25b7412d35b1c1e3e1290176b64dc))
- separate mock and panel for production devtools support ([#24](https://github.com/apps-in-toss-community/devtools/issues/24)) ([723ebea](https://github.com/apps-in-toss-community/devtools/commit/723ebea6d2cd5ad972ea27f86c6db0452cfd065b))

### Bug Fixes

- expand type compatibility checks in \_\_typecheck.ts ([#12](https://github.com/apps-in-toss-community/devtools/issues/12)) ([5379b23](https://github.com/apps-in-toss-community/devtools/commit/5379b23fa934ac871f16ec9f1366d0d0b8d1eea1))
- rename mockEnabled to panelEditable and neutralize danger disabled color ([#25](https://github.com/apps-in-toss-community/devtools/issues/25)) ([1a47dfd](https://github.com/apps-in-toss-community/devtools/commit/1a47dfd0fa1adb2e3eab96b69f31053303ea71f7))
- unify code patterns and add window.\_\_ait type declaration ([#23](https://github.com/apps-in-toss-community/devtools/issues/23)) ([59798cc](https://github.com/apps-in-toss-community/devtools/commit/59798cc3fe678fd88bce82d53d6f295e99ac4075))
