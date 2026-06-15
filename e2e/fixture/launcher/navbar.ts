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

// ---------------------------------------------------------------------------
// Navbar spacing constants — kept in sync with src/panel/styles.ts by the
// parity guard tests in navbar.vitest.ts. Any change here must be reflected
// in both files and vice versa (#510).
// ---------------------------------------------------------------------------

/** Icon size (px). Matches `.ait-navbar-icon { width: 22px; height: 22px; }`. */
export const LAUNCHER_NAVBAR_ICON_SIZE_PX = 22;
/** Title-group gap (px). Matches `.ait-navbar-title { gap: 6px; }`. */
export const LAUNCHER_NAVBAR_TITLE_GAP_PX = 6;
/** Title-group margin-left (px). Matches `.ait-navbar-title { margin-left: 4px; }`. */
export const LAUNCHER_NAVBAR_TITLE_MARGIN_LEFT_PX = 4;
/** Back button font-size (px). Matches `.ait-navbar-back { font-size: 24px; }`. */
export const LAUNCHER_NAVBAR_BACK_FONT_SIZE_PX = 24;
/** Back button padding. Matches `.ait-navbar-back { padding: 0 8px; }`. */
export const LAUNCHER_NAVBAR_BACK_PADDING = '0 8px';
/** Back glyph. Matches the `‹` character in viewport.ts / Launcher.tsx. */
export const LAUNCHER_NAVBAR_BACK_GLYPH = '‹';

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
 * Resolve the icon URL shown in the partner nav bar.
 *
 * Priority:
 *   1. `icon=` param — accepted only when it is an absolute `https://` URL.
 *      Non-https, relative paths, `javascript:`, `data:`, etc. are rejected.
 *   2. Fallback (when `icon=` is absent): `<framed-origin>/favicon.ico` derived
 *      from `url=` — the `url=` param's https origin + `/favicon.ico`. The framed
 *      origin is already loaded in the iframe, so this is not a new host exposure.
 *      If `url=` is absent, not https, or not parseable → null.
 *
 * Returns null when no safe icon can be derived (caller omits the icon slot).
 *
 * SECURITY: `<img src>` paints no text on-screen, and the framed origin of the
 * favicon fallback is already the iframe host — not a new host disclosure. The
 * tunnel host is still never rendered as visible text (that principle applies to
 * the title slot, not this img src slot).
 */
export function resolveAppIcon(search: string): string | null {
  const params = new URLSearchParams(search);

  // 1. Explicit icon= param — must be absolute https:// URL.
  const iconParam = params.get('icon');
  if (iconParam !== null) {
    let parsed: URL;
    try {
      parsed = new URL(iconParam);
    } catch {
      return null;
    }
    // Accept only absolute https:// URLs. Reject data:, javascript:, relative, etc.
    return parsed.protocol === 'https:' ? iconParam : null;
  }

  // 2. Fallback: derive favicon.ico from the framed url= origin.
  const urlParam = params.get('url');
  if (urlParam === null) return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlParam);
  } catch {
    return null;
  }
  // Only allow https: origins (same guard as normalizeUrl in Launcher.tsx).
  if (parsedUrl.protocol !== 'https:') return null;
  return `${parsedUrl.origin}/favicon.ico`;
}

/**
 * Extract the search string from a launcher-style URL for nav-bar param parsing.
 *
 * A "launcher-style URL" is a launcher deep-link or QR payload that carries a
 * `url=` query param pointing to the tunnel. Nav-bar params (`name=`, `icon=`,
 * `navBarType=`) live on the outer launcher URL, not on the tunnel URL itself.
 *
 * Returns the `search` string (e.g. `"?name=My%20App&url=https%3A%2F%2F..."`)
 * of the outer URL when the input is a valid launcher-style URL, or null when
 * the input is a direct tunnel URL (no `url=`), an unparseable string, or empty.
 *
 * Pure function — no DOM, no side-effects — so it can be unit-tested under
 * vitest without the launcher's heavy top-level imports.
 */
export function extractLauncherSearch(raw: string): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  // Only launcher-style URLs have a `url=` param. Direct tunnel URLs don't.
  return parsed.searchParams.has('url') ? parsed.search : null;
}

/**
 * Compute the safe-area insets the launcher forwards to the framed dev app
 * (`ait:safe-area-insets`), now that #495 makes the partner nav bar part of the
 * launcher chrome.
 *
 * Bridge-inset matrix (re-grounded for #495, updated for #527 correction):
 *
 *   | navBarType | letterbox | corrected | top forwarded | bottom forwarded | rationale |
 *   |------------|-----------|-----------|---------------|------------------|-----------|
 *   | partner    | false     | n/a       | 0             | raw.bottom       | bar is launcher chrome; iframe starts below it, env(top)=0. |
 *   | partner    | true      | true      | 0             | raw.bottom       | #527: frame reaches real screen bottom → restore actual bottom inset. |
 *   | partner    | true      | false     | 0             | 0                | legacy #491: frame still stops above indicator → phantom bottom zeroed. |
 *   | game       | false     | n/a       | raw.top       | raw.bottom       | full-bleed canvas; raw env passes through. |
 *   | game       | true      | true      | raw.top       | raw.bottom       | #527: correction restores real bottom. |
 *   | game       | true      | false     | raw.top       | 0                | legacy #491: phantom bottom zeroed. |
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
 * `letterboxCorrected` (default true) propagates to `computeBridgeInsets` (#527):
 * when the screen.height px correction is in effect the frame genuinely reaches
 * the home-indicator band, so the bottom inset is meaningful and must not be
 * zeroed. Pass false only on the legacy/uncorrected path.
 *
 * Pure function — no DOM reads — so it can be tested under vitest independently
 * of the React component.
 */
export function computeNavBarBridgeInsets(
  raw: SafeAreaInsets,
  letterboxDetected: boolean,
  navBarType: NavBarType,
  letterboxCorrected = true,
): SafeAreaInsets {
  const base = computeLetterboxBridgeInsets(raw, letterboxDetected, letterboxCorrected);
  // game = full-bleed 가정으로 raw top을 그대로 통과시킨다. game frame type은 SDK deprecated
  // (web-framework 2.6.1) 이므로 실기기 실측은 미추진 — 이 passthrough는 미검증 경로다 (#577).
  if (navBarType === 'game') return base;
  // Partner bar consumes the status-bar + nav-bar band as launcher chrome; the
  // iframe starts below it so its top inset is 0.
  return { ...base, top: 0 };
}
