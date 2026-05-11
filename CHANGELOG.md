# Changelog

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
