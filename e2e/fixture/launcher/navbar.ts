// Pure nav-bar emulation logic for the launcher PWA (#495) — no DOM, no library
// imports — so it can be unit-tested under vitest (jsdom) without the launcher's
// heavy top-level imports (same pattern as entry.ts / letterbox.ts). Launcher.tsx
// reads the live query string + viewport from the DOM and feeds them in.
//
// Background: environment 2 (AITC Sandbox PWA) frames an ephemeral tunnel URL in
// a full-viewport iframe. Before #495 the framed app was full-bleed under the OS
// status bar, with no emulation of the real toss mini-app host chrome. This
// module models that host chrome so the launcher's own shell reproduces the two
// observed runtime nav-bar shapes:
//
//   - partner (non-game): a full nav bar below the status bar — title + a right
//     capsule (`···` menu · `✕`). Height 54 CSS px (real-device measured, #190).
//   - game: no full bar — only a floating right capsule (`···` | `✕`) overlaid on
//     a full-bleed canvas (viewport.ts: game nav bar is a transparent overlay
//     INSIDE the WebView).
//
// `←` (back) is intentionally omitted in v1: the framed page is cross-origin
// (*.trycloudflare.com), so the launcher has no trustworthy way to drive its
// history. Tracked as a follow-up.

import {
  computeBridgeInsets as computeLetterboxBridgeInsets,
  type SafeAreaInsets,
} from './letterbox.js';

/**
 * Apps in Toss host nav bar height (CSS px), `partner` type.
 *
 * DUPLICATE of `AIT_NAV_BAR_HEIGHT_PARTNER` in `src/panel/viewport.ts` — kept in
 * sync by value. The launcher fixture intentionally does NOT import from `src/`
 * (it is a standalone PWA bundle with its own build graph; reaching into the
 * mock package's panel internals would couple the fixture to src module layout).
 * If one changes, change both. See src/panel/viewport.ts for the real-device
 * measurement provenance (iPhone 15 Pro on-device relay, devtools#190/#275).
 */
export const AIT_NAV_BAR_HEIGHT_PARTNER = 54;

export type NavBarType = 'partner' | 'game';

/**
 * Decide which host nav-bar shape to emulate from the launcher query string.
 *
 * `navBarType=game` selects the game variant (floating capsule, full-bleed
 * iframe). Anything else — including absent — is the default partner bar.
 */
export function parseNavBarType(search: string): NavBarType {
  return new URLSearchParams(search).get('navBarType') === 'game' ? 'game' : 'partner';
}

/**
 * Resolve the title shown in the partner nav bar.
 *
 * Reads the `name=` query param (a friendly app name the dev session may pass).
 * SECURITY: never falls back to the tunnel host — a quick-tunnel hostname is
 * session-sensitive and must not be painted on-screen. When `name=` is absent or
 * blank the caller supplies a generic localized default (e.g. "Mini App").
 *
 * Returns the trimmed name, or null so the caller substitutes its i18n default.
 */
export function resolveAppTitle(search: string): string | null {
  const raw = new URLSearchParams(search).get('name');
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Compute the safe-area insets the launcher forwards to the framed dev app
 * (`ait:safe-area-insets`), now that #495 makes the partner nav bar part of the
 * launcher chrome.
 *
 * Bridge-inset matrix (re-grounded for #495):
 *
 *   | navBarType | letterbox | top forwarded | bottom forwarded | rationale            |
 *   |------------|-----------|---------------|------------------|----------------------|
 *   | partner    | false     | 0             | raw.bottom       | status bar + 54px bar are launcher chrome; iframe starts below them, so its own env(top)=0 — matches viewport.ts partner-portrait model (#190 real env top=0). |
 *   | partner    | true      | 0             | 0                | letterbox: bottom is phantom (#491) → zeroed; top still 0 (bar consumes it). |
 *   | game       | false     | raw.top       | raw.bottom       | full-bleed canvas under the status bar; floating capsule overlays — same geometry as pre-#495 (raw env passes through). |
 *   | game       | true      | raw.top       | 0                | letterbox bottom correction (#491) applies; top is the real status-bar overlap. |
 *
 * For the partner bar, top is forced to 0 because the iframe no longer sits under
 * the OS status bar — the launcher's status-bar strip + nav bar occupy that
 * region as host chrome. This mirrors `computeSafeAreaInsets` in viewport.ts,
 * which returns top=0 for partner portrait: the SDK's informational top=54 is
 * surfaced by the mock inside the framed page, not double-counted as padding.
 *
 * For the game variant, the iframe IS full-bleed under the status bar (the
 * floating capsule is a transparent overlay), so the raw status-bar inset is the
 * honest value — identical to the pre-#495 letterbox-only correction.
 *
 * Pure function — no DOM reads — so it can be tested under vitest independently
 * of the React component.
 */
export function computeNavBarBridgeInsets(
  raw: SafeAreaInsets,
  letterboxDetected: boolean,
  navBarType: NavBarType,
): SafeAreaInsets {
  const base = computeLetterboxBridgeInsets(raw, letterboxDetected);
  if (navBarType === 'game') return base;
  // Partner bar consumes the status-bar + nav-bar band as launcher chrome; the
  // iframe starts below it so its top inset is 0.
  return { ...base, top: 0 };
}
