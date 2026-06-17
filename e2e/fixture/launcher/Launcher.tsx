// AITC DevTools Launcher — client-side React component.
//
// This file holds the full UI of the launcher PWA. The stable shell
// (devtools.aitc.dev/launcher/) is installed once; it keeps the chromeless
// standalone display while framing an ephemeral Cloudflare quick-tunnel URL in
// a full-viewport iframe every dev session.
//
// Pure routing logic lives in entry.ts (plain TS, no JSX) — this component
// calls resolveLauncherEntry() and acts on its decision.

import QrScanner from 'qr-scanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../../../src/i18n/index.js';
import { setLocale } from '../../../src/i18n/index.js';
import { useLocale, useT } from '../../../src/i18n/react.js';
import { resolveLauncherEntry } from './entry.js';
import {
  detectLetterbox,
  detectLetterboxWithReason,
  isLetterboxResolved,
  letterboxEpochKey,
  type SafeAreaInsets,
  scheduleSafeAreaTopPolls,
  type VerdictGateReason,
  type ViewportMetrics,
  verifyLetterboxCorrection,
} from './letterbox.js';
import {
  AIT_NAV_BAR_HEIGHT_PARTNER,
  computeNavBarBridgeInsets,
  extractLauncherSearch,
  LAUNCHER_NAVBAR_BACK_FONT_SIZE_PX,
  LAUNCHER_NAVBAR_BACK_GLYPH,
  LAUNCHER_NAVBAR_BACK_PADDING,
  LAUNCHER_NAVBAR_ICON_SIZE_PX,
  LAUNCHER_NAVBAR_TITLE_GAP_PX,
  LAUNCHER_NAVBAR_TITLE_MARGIN_LEFT_PX,
  type NavBarType,
  parseNavBarTheme,
  parseNavBarTransparent,
  parseNavBarType,
  resolveAppIcon,
  resolveAppTitle,
} from './navbar.js';
import {
  injectSelfTarget,
  maybeAttachSelf,
  maybeStripCdpForSelfDebug,
  parseSelfDebugParams,
} from './selfdebug.js';

const CDP_FORWARD_PARAMS = ['debug', 'relay', 'at'] as const;

/**
 * Removes CDP debug params (debug/relay/at) from a tunnel URL.
 *
 * Used in selfdebug mode (issue #535) to prevent the mini-app iframe from also
 * attempting to attach to the relay — the launcher self-target is the sole
 * debug client in that mode (single-attach model, option a).
 */
function stripCdpParams(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of CDP_FORWARD_PARAMS) {
    parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

// Extend the minimal type for <pwa-install> to include attributes and events
// we interact with after removing disable-install-description and manual-chrome.
type PwaInstallElement = HTMLElement & {
  showDialog: (forced?: boolean) => void;
  hideDialog: () => void;
  isDialogHidden?: boolean;
  isInstallAvailable?: boolean;
  isUnderStandaloneMode?: boolean;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isLocalDev(): boolean {
  if (location.protocol === 'http:') return true;
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:') return parsed.toString();
  if (parsed.protocol === 'http:' && location.protocol === 'http:') return parsed.toString();
  return null;
}

function decorateIframeSrc(tunnelUrl: string, launcherSearch: string): string {
  const source = new URLSearchParams(launcherSearch);
  let target: URL;
  try {
    target = new URL(tunnelUrl);
  } catch {
    return tunnelUrl;
  }
  for (const key of CDP_FORWARD_PARAMS) {
    const value = source.get(key);
    if (value !== null && !target.searchParams.has(key)) {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
}

function resolveScannedUrl(raw: string): string | null {
  const direct = normalizeUrl(raw);
  if (!direct) return null;
  let parsed: URL;
  try {
    parsed = new URL(direct);
  } catch {
    return direct;
  }
  const embedded = parsed.searchParams.get('url');
  if (embedded) {
    const tunnel = normalizeUrl(embedded);
    return tunnel ? decorateIframeSrc(tunnel, parsed.search) : null;
  }
  return direct;
}

function consumeDeepLinkUrl(): string | null {
  // Capture the full search string BEFORE replaceState wipes it so that
  // selfdebug detection (issue #552) and decorateIframeSrc can both inspect it.
  const launcherSearch = location.search;
  const param = new URLSearchParams(launcherSearch).get('url');
  if (!param) return null;
  const url = normalizeUrl(param);
  history.replaceState(null, '', location.pathname);
  if (!url) return null;
  const decorated = decorateIframeSrc(url, launcherSearch);
  // Selfdebug deep-link path (issue #552): when `selfdebug=1` + a valid
  // `relay=wss:` are present, the launcher document is the sole debug client
  // (single-attach model, option a — same as showLive's in-app scan path).
  // Strip debug/relay/at from the iframe URL so the mini-app does NOT also
  // attempt to attach to the relay. `parseSelfDebugParams` is evaluated here,
  // before replaceState has removed the query, so the detection is accurate.
  // The actual injectSelfTarget call happens in the mount effect via
  // `maybeAttachSelf()`, which also reads location.search before replaceState —
  // both reads are safe because maybeAttachSelf() runs first in the effect body.
  return maybeStripCdpForSelfDebug(decorated, launcherSearch);
}

// Read env(safe-area-inset-*) by measuring a throwaway element — CSS env() is
// not readable from JS directly. Returns 0 for every side where env() is
// unsupported (desktop, jsdom: getComputedStyle yields ''/'0px' → 0).
function measureSafeAreaInsets(): SafeAreaInsets {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingTop = 'env(safe-area-inset-top)';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
  probe.style.paddingLeft = 'env(safe-area-inset-left)';
  probe.style.paddingRight = 'env(safe-area-inset-right)';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe);
  const top = Number.parseFloat(computed.paddingTop) || 0;
  const bottom = Number.parseFloat(computed.paddingBottom) || 0;
  const left = Number.parseFloat(computed.paddingLeft) || 0;
  const right = Number.parseFloat(computed.paddingRight) || 0;
  probe.remove();
  return { top, bottom, left, right };
}

// The postMessage envelope the framed dev app's devtools mock listens for
// (#484, slice 2). The launcher is the top-level document, so its env() reading
// is the real device geometry; the framed page's mock would otherwise report a
// synthetic preset value and double-pad it.
const SAFE_AREA_INSETS_MESSAGE_TYPE = 'ait:safe-area-insets';

function postSafeAreaInsetsTo(
  target: Window | null,
  letterboxDetected: boolean,
  navBarType: NavBarType,
  letterboxCorrected = true,
  navBarTransparent = false,
): void {
  if (!target) return;
  const raw = measureSafeAreaInsets();
  // #495: the partner nav bar is now launcher chrome and the iframe starts below
  // it, so the forwarded top is 0 (matches viewport.ts partner-portrait model).
  // The game variant stays full-bleed, so the raw status-bar inset passes through.
  //
  // #527: letterboxCorrected=true (default) when the screen.height px correction
  // is in effect — the frame genuinely reaches the home-indicator area, so the
  // real bottom inset (34) is restored instead of being zeroed (#491 original).
  //
  // #587: partner+transparent — unverified hypothesis that the bar is an overlay
  // and the iframe is full-bleed (raw top passes through like game). See
  // computeNavBarBridgeInsets JSDoc for the caveat.
  const insets = computeNavBarBridgeInsets(
    raw,
    letterboxDetected,
    navBarType,
    letterboxCorrected,
    navBarTransparent,
  );
  // targetOrigin '*': the framed tunnel page is cross-origin
  // (*.trycloudflare.com) and the insets are non-sensitive geometry. The
  // receiver (src/mock/safe-area-bridge.ts) validates shape + range.
  target.postMessage({ type: SAFE_AREA_INSETS_MESSAGE_TYPE, insets }, '*');
}

// Snapshot the viewport geometry the letterbox detection (#469) needs. The
// verdict itself is pure (letterbox.ts) — this is the DOM-reading half.
function readViewportMetrics(): ViewportMetrics {
  const safeArea = measureSafeAreaInsets();
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    visualViewportHeight: window.visualViewport?.height ?? null,
    safeAreaTop: safeArea.top,
    safeAreaBottom: safeArea.bottom,
    standalone: isStandalone(),
  };
}

// v11-confirmed force (/tmp/v11-iframe-propagation.md): forcing html + body
// height to screen.height recalcs the WebKit top-level viewport (797→844) AND
// propagates into the cross-origin child iframe. A fixed-div height (the
// reverted #527 approach) does NOT — see letterbox.ts header. The launcher
// shell OWNS documentElement/body height; no other effect writes them.
function applyDocumentFlowForce(): void {
  const h = `${window.screen.height}px`;
  document.documentElement.style.height = h;
  document.body.style.height = h;
}
function clearDocumentFlowForce(): void {
  document.documentElement.style.height = '';
  document.body.style.height = '';
}

// ---------------------------------------------------------------------------
// LanguageSwitcher
// ---------------------------------------------------------------------------

function LanguageSwitcher(): React.JSX.Element {
  const t = useT();
  const locale = useLocale();

  return (
    <div
      style={{
        position: 'absolute',
        top: 'max(12px, env(safe-area-inset-top))',
        right: '16px',
        display: 'flex',
        gap: '6px',
        fontSize: '12px',
      }}
    >
      <span style={{ color: '#9aa0a6', alignSelf: 'center' }}>{t('env.language.row')}:</span>
      <button
        type="button"
        onClick={() => setLocale('ko' as Locale)}
        style={{
          background: 'none',
          border: 'none',
          padding: '2px 6px',
          cursor: 'pointer',
          color: locale === 'ko' ? '#e8eaed' : '#9aa0a6',
          fontWeight: locale === 'ko' ? 600 : 400,
          fontSize: '12px',
          borderRadius: '4px',
          textDecoration: locale === 'ko' ? 'underline' : 'none',
        }}
      >
        {t('env.language.ko')}
      </button>
      <button
        type="button"
        onClick={() => setLocale('en' as Locale)}
        style={{
          background: 'none',
          border: 'none',
          padding: '2px 6px',
          cursor: 'pointer',
          color: locale === 'en' ? '#e8eaed' : '#9aa0a6',
          fontWeight: locale === 'en' ? 600 : 400,
          fontSize: '12px',
          borderRadius: '4px',
          textDecoration: locale === 'en' ? 'underline' : 'none',
        }}
      >
        {t('env.language.en')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NavBar — toss mini-app host chrome emulation (#495)
// ---------------------------------------------------------------------------

// The right-side capsule: `···` (more menu) · thin divider · `✕`. Shared between
// the partner full bar and the game floating overlay so the game variant is
// cheap. The visual structure follows the real-device reference (dark capsule,
// rounded ends, the two buttons split by a hairline divider).
function NavBarCapsule({
  onToggleMenu,
  onClose,
  menuOpen,
}: {
  onToggleMenu: () => void;
  onClose: () => void;
  menuOpen: boolean;
}): React.JSX.Element {
  const t = useT();
  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#e8eaed',
    cursor: 'pointer',
    padding: '6px 12px',
    fontSize: '16px',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  return (
    <div
      data-testid="launcher-navbar-capsule"
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(40,43,48,.9)',
        borderRadius: '999px',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        data-testid="launcher-navbar-more"
        aria-label={t('launcher.navbar.menu')}
        aria-expanded={menuOpen}
        title={t('launcher.navbar.menu')}
        onClick={onToggleMenu}
        style={btnStyle}
      >
        ⋯
      </button>
      <span
        style={{ width: '1px', alignSelf: 'stretch', margin: '8px 0', background: '#4a4e54' }}
      />
      <button
        type="button"
        data-testid="launcher-navbar-close"
        aria-label={t('launcher.navbar.close')}
        title={t('launcher.navbar.close')}
        onClick={onClose}
        style={btnStyle}
      >
        ✕
      </button>
    </div>
  );
}

// The navigate-back postMessage type the framed dev app's mock bridge (#510) listens for.
const NAVIGATE_BACK_MESSAGE_TYPE = 'ait:navigate-back';

// The webViewType self-report postMessage type (#580). The framed mini-app
// posts `{ type: 'ait:web-view-type', value: 'partner' | 'game' }` to its parent
// (the in-app self-report in src/in-app/attach.ts) so the launcher auto-enters
// game mode without a manual `?navBarType=game` URL edit. Canonical definition +
// the receive-side parser live in src/mock/safe-area-bridge.ts
// (WEB_VIEW_TYPE_MESSAGE_TYPE / parseWebViewTypeMessage); the value is mirrored
// here (kept in sync by value) so the launcher stays decoupled from the mock
// package internals — the same pattern the other launcher message types follow.
const WEB_VIEW_TYPE_MESSAGE_TYPE = 'ait:web-view-type';

// The `···` dropdown: diagnostics toggle, Rescan, and the language row. These
// rehome the controls that used to float at the bottom of the screen (#495).
function MoreMenu({
  diagOpen,
  onToggleDiag,
  onRescan,
}: {
  diagOpen: boolean;
  onToggleDiag: () => void;
  onRescan: () => void;
}): React.JSX.Element {
  const t = useT();
  const locale = useLocale();
  const itemStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#e8eaed',
    cursor: 'pointer',
    padding: '10px 14px',
    fontSize: '13px',
    textAlign: 'left',
    width: '100%',
    display: 'block',
  };
  return (
    <div
      role="menu"
      data-testid="launcher-navbar-menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        minWidth: '180px',
        background: 'rgba(20,22,26,.97)',
        border: '1px solid #2a2e33',
        borderRadius: '12px',
        backdropFilter: 'blur(4px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="launcher-menu-rescan"
        onClick={onRescan}
        style={itemStyle}
      >
        {t('launcher.navbar.menuRescan')}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={diagOpen}
        data-testid="launcher-menu-diag"
        onClick={onToggleDiag}
        style={itemStyle}
      >
        {t('launcher.navbar.menuDiag')}
        {diagOpen ? ' ✓' : ''}
      </button>
      <div
        style={{
          borderTop: '1px solid #2a2e33',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ color: '#9aa0a6', fontSize: '12px' }}>
          {t('launcher.navbar.menuLanguage')}
        </span>
        <button
          type="button"
          data-testid="launcher-menu-lang-ko"
          onClick={() => setLocale('ko' as Locale)}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 6px',
            cursor: 'pointer',
            color: locale === 'ko' ? '#e8eaed' : '#9aa0a6',
            fontWeight: locale === 'ko' ? 600 : 400,
            fontSize: '12px',
            textDecoration: locale === 'ko' ? 'underline' : 'none',
          }}
        >
          {t('env.language.ko')}
        </button>
        <button
          type="button"
          data-testid="launcher-menu-lang-en"
          onClick={() => setLocale('en' as Locale)}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 6px',
            cursor: 'pointer',
            color: locale === 'en' ? '#e8eaed' : '#9aa0a6',
            fontWeight: locale === 'en' ? 600 : 400,
            fontSize: '12px',
            textDecoration: locale === 'en' ? 'underline' : 'none',
          }}
        >
          {t('env.language.en')}
        </button>
      </div>
    </div>
  );
}

// The live-screen host chrome. Partner: a 54px dark bar below the launcher's own
// status-bar inset, with the back button (left), app icon + title (centre-left),
// and the right capsule. Game: no full bar, only the floating capsule top-right
// over the full-bleed iframe. The `···` menu (rehomed diagnostics/rescan/language)
// hangs off the capsule in both variants.
//
// Back button (#510): the framed page is cross-origin (*.trycloudflare.com) so
// the launcher cannot directly call history.back() on it. Instead the `←` click
// posts `{ type: 'ait:navigate-back' }` to the framed window; the mock's
// installNavigateBackBridge() listener calls history.back() there. The game
// variant has no back button (full-bleed canvas, same as the real toss host).
function NavBar({
  navBarType,
  navBarTransparent,
  navBarTheme,
  title,
  iconSrc,
  iconVisible,
  onIconError,
  menuOpen,
  diagOpen,
  onToggleMenu,
  onToggleDiag,
  onRescan,
  onClose,
  frameRef,
}: {
  navBarType: NavBarType;
  /**
   * Whether the partner bar renders with a transparent background (#587).
   * `transparentBackground: true` in granite.config `navigationBar`.
   * When true the bar bg is transparent (content shows through) and the
   * bar is an overlay over the full-bleed iframe.
   */
  navBarTransparent: boolean;
  /**
   * Partner bar foreground colour theme (#587).
   * `theme: 'light'|'dark'` in granite.config `navigationBar`.
   * `'dark'` = light text/icons on dark bg (current default).
   * `'light'` = dark text/icons on light/transparent bg.
   */
  navBarTheme: 'light' | 'dark';
  title: string;
  /** Resolved icon URL (https: only). null = no icon slot. */
  iconSrc: string | null;
  /** false when onError fired — collapses the icon slot. */
  iconVisible: boolean;
  onIconError: () => void;
  menuOpen: boolean;
  diagOpen: boolean;
  onToggleMenu: () => void;
  onToggleDiag: () => void;
  onRescan: () => void;
  onClose: () => void;
  /** Ref to the framed <iframe> — used to post ait:navigate-back (#510). */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
}): React.JSX.Element {
  const t = useT();
  const capsule = (
    <div style={{ position: 'relative' }}>
      <NavBarCapsule onToggleMenu={onToggleMenu} onClose={onClose} menuOpen={menuOpen} />
      {menuOpen && <MoreMenu diagOpen={diagOpen} onToggleDiag={onToggleDiag} onRescan={onRescan} />}
    </div>
  );

  if (navBarType === 'game') {
    // Game: no full bar — only the floating capsule top-right, overlaying the
    // full-bleed iframe (the real toss game host renders the capsule as a
    // transparent overlay inside the WebView). No back button (game variant).
    return (
      <div
        data-testid="launcher-navbar"
        data-navbar-type="game"
        style={{
          position: 'fixed',
          top: 'max(12px, env(safe-area-inset-top))',
          right: 'max(12px, env(safe-area-inset-right))',
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        {capsule}
      </div>
    );
  }

  // Partner: a full bar pinned below the launcher's own status-bar inset.
  // height is AIT_NAV_BAR_HEIGHT_PARTNER; the status-bar strip above it is the
  // env(safe-area-inset-top) padding so the bar clears the OS status bar.
  //
  // #587: navBarTransparent → background becomes transparent (content shows
  // through, bar is an overlay over the full-bleed iframe). navBarTheme controls
  // foreground/text colour — 'dark' = light text (current default), 'light' =
  // dark text for use over bright content.
  //
  // Back button (#510): clicking `←` posts ait:navigate-back to the framed
  // window via the cross-origin postMessage bridge. The framed app's mock
  // installNavigateBackBridge() listener calls history.back() there.
  //
  // data-navbar-transparent / data-navbar-theme: exposed for test inspection and
  // debugging (same pattern as data-navbar-type).
  const fgColor = navBarTheme === 'light' ? '#14161a' : '#e8eaed';
  const barBg = navBarTransparent ? 'transparent' : '#14161a';
  return (
    <div
      data-testid="launcher-navbar"
      data-navbar-type="partner"
      data-navbar-transparent={navBarTransparent ? 'true' : 'false'}
      data-navbar-theme={navBarTheme}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 25,
        paddingTop: 'env(safe-area-inset-top)',
        background: barBg,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          height: `${AIT_NAV_BAR_HEIGHT_PARTNER}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          gap: '8px',
        }}
      >
        {/* Left side: back button + icon (optional) + title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            flex: 1,
          }}
        >
          {/* Back button: posts ait:navigate-back to the cross-origin iframe (#510).
              Real partner bar always shows this button on the left. */}
          <button
            type="button"
            data-testid="launcher-navbar-back"
            aria-label={t('launcher.navbar.back')}
            title={t('launcher.navbar.back')}
            onClick={() => {
              frameRef.current?.contentWindow?.postMessage(
                { type: NAVIGATE_BACK_MESSAGE_TYPE },
                '*',
              );
            }}
            style={{
              background: 'none',
              border: 'none',
              color: fgColor,
              cursor: 'pointer',
              // Match panel env1 back-btn metrics: LAUNCHER_NAVBAR_BACK_PADDING / FONT_SIZE_PX
              // (src/panel/styles.ts .ait-navbar-back — parity guard: navbar.vitest.ts).
              padding: LAUNCHER_NAVBAR_BACK_PADDING,
              fontSize: `${LAUNCHER_NAVBAR_BACK_FONT_SIZE_PX}px`,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {LAUNCHER_NAVBAR_BACK_GLYPH}
          </button>
          {/* Icon + title group: gap/margin align with panel env1 measurements
              (src/panel/styles.ts .ait-navbar-title — parity guard: navbar.vitest.ts). */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              // gap/marginLeft driven by LAUNCHER_NAVBAR_TITLE_* constants
              // (parity-guarded against panel styles.ts in navbar.vitest.ts).
              gap: `${LAUNCHER_NAVBAR_TITLE_GAP_PX}px`,
              marginLeft: `${LAUNCHER_NAVBAR_TITLE_MARGIN_LEFT_PX}px`,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {iconSrc !== null && iconVisible && (
              <img
                data-testid="launcher-navbar-icon"
                src={iconSrc}
                alt=""
                onError={onIconError}
                style={{
                  // LAUNCHER_NAVBAR_ICON_SIZE_PX matches .ait-navbar-icon in panel styles.ts
                  // (parity-guarded in navbar.vitest.ts).
                  width: `${LAUNCHER_NAVBAR_ICON_SIZE_PX}px`,
                  height: `${LAUNCHER_NAVBAR_ICON_SIZE_PX}px`,
                  borderRadius: '6px',
                  flexShrink: 0,
                  objectFit: 'cover',
                }}
              />
            )}
            <span
              data-testid="launcher-navbar-title"
              style={{
                color: fgColor,
                fontSize: '15px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </span>
          </div>
        </div>
        {capsule}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Screen = 'setup' | 'live';

// Reasons the framed page may report via the `ait:debug-attach-blocked`
// postMessage. 'auth' = gate Layer C rejected a present-but-wrong code at
// load (#438); 'auth-expired' = the relay rejected a stale code with close
// 4401 — first load with an expired QR or a post-attach reconnect (#478).
type AuthBlockReason = 'auth' | 'auth-expired';

export function Launcher(): React.JSX.Element {
  const t = useT();

  const [screen, setScreen] = useState<Screen>('setup');
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const [urlValue, setUrlValue] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [scannerVisible, setScannerVisible] = useState(false);

  const [setupToolsVisible, setSetupToolsVisible] = useState(false);
  const [installCtaVisible, setInstallCtaVisible] = useState(false);
  const [authBlockReason, setAuthBlockReason] = useState<AuthBlockReason | null>(null);

  const [diagOpen, setDiagOpen] = useState(false);
  const [metrics, setMetrics] = useState<ViewportMetrics | null>(null);
  const [chromeDeltaPx, setChromeDeltaPx] = useState<number | null>(null);
  // #536: tracks the latest safeAreaTop readings from the multi-timeout poll
  // so the diag panel can show the measurement trace (cold-start stale 0 → settled value).
  const [safeAreaTopTrace, setSafeAreaTopTrace] = useState<number[]>([]);

  // #561/#566 lifecycle machine (geometry-epoch latch). The reverted #563 force
  // was a React-state-derived effect, so the resize it induced (797→844) flipped
  // the raw letterbox verdict to "not detected", which tore the force down,
  // which restored 797, which re-detected — a violent infinite oscillation. The
  // fix is a latch keyed on the GENUINE geometry epoch (letterboxEpochKey, which
  // excludes the height the force moves): once letterbox is detected in an epoch
  // the html/body force is held and never released by its own shortfall→0 side
  // effect — only a real rotation / screen-dimension change (new epoch) or a
  // settled 'clipped' sentinel verdict releases it.
  //
  //   idle    — no correction; the RAW detector arms the transition to applying.
  //   applying— v11 force applied (one-shot); the bottom sentinel is verifying.
  //   held    — sentinel confirmed the band paints; force stays latched.
  //   clipped — sentinel (or IO-absent fallback) reported the band clips; force
  //             dropped, honest calc()/100% layout.
  type CorrectionPhase = 'idle' | 'applying' | 'held' | 'clipped';
  const [correctionPhase, setCorrectionPhase] = useState<CorrectionPhase>('idle');
  const armedEpochRef = useRef<string | null>(null);

  // Nav-bar emulation (#495/#507/#587). navBarType + title + appearance are read
  // from the launcher query ONCE at mount — consumeDeepLinkUrl() strips the query
  // via replaceState, so the initializer captures them before they are gone.
  // Setters are kept so the scan/manual-input paths (#507) can update the bar
  // when a launcher-style QR URL carries name=/icon=/navBarType= params.
  // menuOpen drives the `···` dropdown that rehomes diagnostics/rescan/language.
  const [menuOpen, setMenuOpen] = useState(false);
  const [navBarType, setNavBarType] = useState<NavBarType>(() => parseNavBarType(location.search));
  // #587: navigationBar appearance (SDK 2.8.0 transparentBackground / theme).
  // Read from the deep-link query at mount; updated via applyNavBarParams on scan.
  const [navBarTransparent, setNavBarTransparent] = useState<boolean>(() =>
    parseNavBarTransparent(location.search),
  );
  const [navBarTheme, setNavBarTheme] = useState<'light' | 'dark'>(() =>
    parseNavBarTheme(location.search),
  );
  const [appTitle, setAppTitle] = useState<string | null>(() => resolveAppTitle(location.search));
  // Icon slot (#498/#507): resolved at mount from the query string; also updated
  // by showLive when a scanned/entered launcher-style URL carries icon= params.
  // iconVisible tracks onError dismissal — a 404 favicon collapses the slot
  // without layout jank. Reset to true when a new icon src is applied (#507).
  const [appIconSrc, setAppIconSrc] = useState<string | null>(() =>
    resolveAppIcon(location.search),
  );
  const [iconVisible, setIconVisible] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pwaInstallRef = useRef<PwaInstallElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const bottomChromeRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // #561: the px-corrected root container — the verification sentinel is mounted
  // at its bottom edge to test whether the correction actually paints.
  const rootRef = useRef<HTMLDivElement | null>(null);

  // SECURITY: never derive the title from the tunnel host. When name= is absent
  // resolveAppTitle returns null and we fall back to a generic localized label.
  const navBarTitle = appTitle ?? t('launcher.navbar.defaultTitle');

  // Keep a stable ref to pendingUrl so event handlers can read the latest
  // value without becoming stale closures.
  const pendingUrlRef = useRef<string | null>(null);
  pendingUrlRef.current = pendingUrl;

  // ---------------------------------------------------------------------------
  // Gate helpers
  // ---------------------------------------------------------------------------

  const applyPwaGate = useCallback(() => {
    const gated = !isStandalone() && !isLocalDev();
    setSetupToolsVisible(!gated);
    setInstallCtaVisible(!isStandalone());
  }, []);

  // ---------------------------------------------------------------------------
  // Scanner management
  // ---------------------------------------------------------------------------

  const stopScanner = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setScannerVisible(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Screen transitions
  // ---------------------------------------------------------------------------

  // Apply nav-bar params from a launcher search string (#507, #587).
  // Called both from showLive (scan/manual-input) and implicitly by mount-time
  // useState initializers (deep-link path). When search is null (direct tunnel
  // URL, no `url=` param), we reset to defaults so a new RESCAN doesn't carry
  // stale values from the previous session.
  const applyNavBarParams = useCallback((search: string | null) => {
    const s = search ?? '';
    setNavBarType(parseNavBarType(s));
    // #587: reset appearance fields from the new search string (or to defaults).
    setNavBarTransparent(parseNavBarTransparent(s));
    setNavBarTheme(parseNavBarTheme(s));
    setAppTitle(resolveAppTitle(s));
    const newIcon = resolveAppIcon(s);
    setAppIconSrc(newIcon);
    // Reset iconVisible so a previously-collapsed slot becomes visible again
    // when a fresh icon src arrives (#507). If newIcon is null the slot will
    // render null/hidden anyway, so resetting here is always safe.
    setIconVisible(true);
  }, []);

  // launcherSearch is tri-state: a string applies the scanned launcher URL's
  // nav-bar params; null explicitly resets to defaults (direct tunnel URL —
  // no stale carry-over across RESCAN); undefined (pendingUrl paths) leaves
  // the mount-time captured values untouched — the deep-link query that fed
  // them was already stripped by consumeDeepLinkUrl, so a reset would lose
  // the name=/icon= the user arrived with (#507).
  const showLive = useCallback(
    (url: string, launcherSearch?: string | null) => {
      stopScanner();
      if (launcherSearch !== undefined) applyNavBarParams(launcherSearch);
      setPendingUrl(null);

      // Selfdebug via in-app QR scan (issue #535): when the scanned launcher
      // URL carries `selfdebug=1` + a valid `relay=wss:` param, register the
      // launcher document itself as a Chii CDP target.
      //
      // Option (a) — launcher-diagnostics mode: strip CDP params from the
      // iframe URL so the mini-app does NOT also attempt to attach to the
      // relay. The selfAttached guard in selfdebug.ts prevents double injection
      // when the user scans another selfdebug QR while one is already active.
      //
      // When launcherSearch is a non-null string we have a scanned launcher URL
      // — extract self-debug params from the *raw scanned payload*, which is
      // not directly available here. We re-derive it from launcherSearch alone
      // because parseSelfDebugParams accepts a search string directly.
      let iframeUrl = url;
      if (launcherSearch != null) {
        const selfResult = parseSelfDebugParams(launcherSearch);
        if (selfResult.enabled) {
          injectSelfTarget(selfResult.params);
          // Strip debug/relay/at from the iframe URL to prevent the mini-app
          // from attaching to the same relay (single-attach model).
          iframeUrl = stripCdpParams(url);
        }
      }

      setLiveUrl(iframeUrl);
      setScreen('live');
      setMsg('');
      setAuthBlockReason(null);
    },
    [stopScanner, applyNavBarParams],
  );

  const showSetup = useCallback(
    (_pending: string | null) => {
      stopScanner();
      setLiveUrl(null);
      setScreen('setup');
    },
    [stopScanner],
  );

  // ---------------------------------------------------------------------------
  // Mount: entry routing + service worker + appinstalled listener
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Self-debug opt-in (issue #531): when `selfdebug=1` is present in the
    // launcher URL together with a valid `relay=` param, register the launcher
    // document itself as a Chii CDP target so an agent can directly observe
    // launcher geometry, styles, and state without requiring human eyes.
    //
    // Single-attach model: once the self-target connects, the relay evicts any
    // previously-connected mini-app target (last-attach-wins). This is
    // intentional — self-debug is "launcher diagnostics mode", not simultaneous
    // dual-attach. Without `selfdebug=1` this call is a cheap no-op.
    maybeAttachSelf();

    // Service worker registration (non-fatal)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/launcher/sw.js', { scope: '/launcher/' }).catch(() => {});
    }

    const deepLinked = consumeDeepLinkUrl();

    const entry = resolveLauncherEntry({
      deepLinkUrl: deepLinked,
      isStandalone: isStandalone(),
      isLocalDev: isLocalDev(),
    });

    if (entry.kind === 'live') {
      setLiveUrl(entry.url);
      setScreen('live');
    } else {
      const pending = entry.pendingUrl;
      setPendingUrl(pending);
      applyPwaGate();
    }

    const onInstalled = () => {
      applyPwaGate();
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [applyPwaGate]);

  // Re-apply gate whenever screen returns to setup.
  useEffect(() => {
    if (screen === 'setup') {
      applyPwaGate();
    }
  }, [screen, applyPwaGate]);

  // If installed (appinstalled fired) and pendingUrl exists, enter live.
  useEffect(() => {
    const onInstalled = () => {
      const pending = pendingUrlRef.current;
      if (pending && isStandalone()) {
        showLive(pending);
      }
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [showLive]);

  // Wire up the pwa-install dialog dismiss event (#433 defect 2 replacement).
  //
  // @khmyznikov/pwa-install fires `pwa-user-choice-result-event` with
  // detail="dismissed" when the user closes the dialog on ALL platforms
  // (including iOS Safari — the dismiss is triggered by `_hideDialogUser`
  // which always calls `eventUserChoiceResult(this, "dismissed")`).
  //
  // When the user dismisses the dialog but there is a pendingUrl preserved
  // from the deep-link/entry gate, we enter live immediately so the user
  // is never left in a dead end. This replaces the previous open-once button
  // (#411 intent preserved: the URL is never lost).
  useEffect(() => {
    const el = pwaInstallRef.current;
    if (!el) return;

    const onUserChoice = (e: Event) => {
      const result = (e as CustomEvent<string>).detail;
      if (result === 'dismissed') {
        const pending = pendingUrlRef.current;
        if (pending) {
          showLive(pending);
        }
      }
    };

    el.addEventListener('pwa-user-choice-result-event', onUserChoice);
    return () => el.removeEventListener('pwa-user-choice-result-event', onUserChoice);
    // Re-register after pwaInstallRef.current becomes available (mount cycle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLive]);

  // Defect 2 (#438) + expired-TOTP surfacing (#478): listen for the framed
  // tunnel page's debug-attach-blocked signal. Cross-origin: the child posts
  // from *.trycloudflare.com with targetOrigin '*'. We do NOT trust arbitrary
  // origins for anything privileged — the only effect is picking a localized
  // banner variant. Strict shape guard; reason is an enum allow-list.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as unknown;
      if (typeof data !== 'object' || data === null) return;
      const type = (data as { type?: unknown }).type;

      // webViewType self-report (#580): the framed mini-app posts its own type
      // once so the launcher auto-enters game mode. Cross-origin origin is NOT
      // trusted — navBarType is a visual-mode switch only (no permission, same
      // safety class as the debug-attach-blocked handling below). The strict
      // enum allow-list below is the safety boundary: only the two values the
      // launcher emulates flip the bar; anything else is ignored.
      if (type === WEB_VIEW_TYPE_MESSAGE_TYPE) {
        const value = (data as { value?: unknown }).value;
        if (value === 'partner' || value === 'game') setNavBarType(value);
        return;
      }

      // Defect 2 (#438) + expired-TOTP surfacing (#478): pick a localized
      // banner variant from the framed page's debug-attach-blocked signal.
      if (type !== 'ait:debug-attach-blocked') return;
      const reason = (data as { reason?: unknown }).reason;
      if (reason === 'auth' || reason === 'auth-expired') {
        setAuthBlockReason(reason);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Viewport diagnostics (#469, #536): keep a live geometry snapshot so the
  // letterbox verdict and the diag panel stay current across rotation / resize.
  //
  // #536 cold-start env() stale-0 workaround: iOS standalone WebKit returns 0
  // for env(safe-area-inset-top) immediately after cold start (WebKit #274773).
  // A single 600ms settle was insufficient — if env() is still 0 at 600ms the
  // safeAreaTop>0 gate blocks detection for the entire session (until rotation).
  //
  // Fix: schedule multi-timeout polls (100/300/600/1000 ms) that re-read env()
  // and update the snapshot as soon as a non-zero value arrives. The resize/
  // orientationchange listeners remain for rotation-induced geometry changes.
  useEffect(() => {
    const measure = () => setMetrics(readViewportMetrics());
    measure(); // immediate snapshot (safeAreaTop may be stale 0 at this point)

    // Poll env(safe-area-inset-top) at multiple checkpoints. The first non-zero
    // reading triggers a full snapshot re-measure and cancels remaining timers.
    // On a healthy window (env() already settled) the 100ms poll fires and
    // immediately cancels the rest — negligible overhead.
    //
    // Each reading is appended to safeAreaTopTrace so the diag panel can show
    // the measurement history (helps identify the cold-start stale-0 case).
    const cancelPolls = scheduleSafeAreaTopPolls(
      () => {
        const probe = document.createElement('div');
        probe.style.cssText =
          'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)';
        document.body.appendChild(probe);
        const v = Number.parseFloat(getComputedStyle(probe).paddingTop) || 0;
        probe.remove();
        return v;
      },
      (value) => {
        // Append the settled value to the trace and re-measure the full snapshot.
        setSafeAreaTopTrace((prev) => [...prev, value]);
        measure();
      },
      [100, 300, 600, 1000] as const,
      {
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      },
    );

    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      cancelPolls();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  const epochKey = metrics ? letterboxEpochKey(metrics) : null;
  const correctionActive = correctionPhase === 'applying' || correctionPhase === 'held';
  const letterbox = metrics ? detectLetterbox(metrics) : null;
  const letterboxShortfallPx = letterbox?.shortfallPx ?? 0;
  // Correction-aware: stays detected while the force HOLDS (shortfall→0 absorbed)
  // so the verdict the layout reads never flip-flops on the force's own resize.
  const letterboxDetected = metrics ? isLetterboxResolved(metrics, correctionActive) : false;
  // #536: verdict reason for diag panel — identifies which gate blocked detection.
  // 'safeAreaTopZero' during a cold-start stale env() window is the key signal.
  const letterboxVerdictReason: VerdictGateReason = metrics
    ? detectLetterboxWithReason(metrics).reason
    : 'notStandalone';
  // The force is the LATCH, not a live shortfall derivation.
  const applyPxCorrection = correctionActive;
  const letterboxCorrected = correctionPhase === 'held';

  // EPOCH-RESET EFFECT — the ONLY reset path. Keyed on epochKey (which excludes
  // the height the force moves), so the force's own induced resize cannot trip
  // it; only a genuine rotation / screen-dimension change advances the epoch.
  // On a real epoch change it clears any prior force and re-arms detection.
  // (armedEpochRef + setCorrectionPhase are stable, so [epochKey] is complete.)
  useEffect(() => {
    if (epochKey === null) return; // degenerate metrics: hold current state
    if (armedEpochRef.current !== epochKey) {
      armedEpochRef.current = epochKey;
      clearDocumentFlowForce(); // drop force held from the previous epoch
      setCorrectionPhase('idle'); // re-arm detection for the new epoch
    }
  }, [epochKey]);

  // DECISION EFFECT (idle→applying). Consults the RAW honest detector (no
  // correction active yet, so the shortfall is honest). Re-evaluates on metrics
  // WHILE idle so a cold-start late-settle / rotation-transient that letterboxes
  // within the SAME epoch is still caught. Applies the v11 html/body force as a
  // one-shot at the transition — the resize it fires is absorbed (epoch
  // unchanged, so the reset effect does not fire). [correctionPhase, metrics]
  // gates re-eval while idle so a late-settle within the same epoch is caught.
  useEffect(() => {
    if (correctionPhase !== 'idle' || metrics === null) return;
    if (detectLetterbox(metrics).detected) {
      applyDocumentFlowForce(); // v11 one-shot
      setCorrectionPhase('applying');
    }
  }, [correctionPhase, metrics]);

  // VERIFY EFFECT — arms only while 'applying'. Deps are [screen, correctionPhase]
  // ONLY (epochKey is NOT a dep), so an unrelated geometry blip cannot tear down
  // the in-flight 1s sentinel mid-flight. On a real epoch change the reset effect
  // sets phase→idle, which re-runs this cleanly. IO-absent (old WebKit / jsdom)
  // ⇒ honest 'clipped' fallback (drop the force), NEVER optimistic.
  useEffect(() => {
    if (screen !== 'live' || correctionPhase !== 'applying') return;
    const root = rootRef.current;
    if (root === null || typeof IntersectionObserver === 'undefined') {
      clearDocumentFlowForce();
      setCorrectionPhase('clipped');
      return;
    }

    const cancel = verifyLetterboxCorrection(
      (onResult) => {
        const sentinel = document.createElement('div');
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.dataset.testid = 'launcher-letterbox-sentinel';
        sentinel.style.cssText =
          'position:absolute;left:0;bottom:0;width:1px;height:1px;pointer-events:none';
        root.appendChild(sentinel);
        const observer = new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            if (entry) onResult(entry.isIntersecting);
          },
          { root: null, threshold: [0] },
        );
        observer.observe(sentinel);
        return () => {
          observer.disconnect();
          sentinel.remove();
        };
      },
      (result) => {
        if (result === 'visible') {
          setCorrectionPhase('held');
        } else {
          clearDocumentFlowForce(); // band genuinely clips → honest layout
          setCorrectionPhase('clipped');
        }
      },
      {
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      },
    );
    // Cancel runs only on real teardown (phase leaves 'applying' / unmount),
    // never mid-flight from a shortfall flip — epochKey is deliberately not a dep.
    return cancel;
  }, [screen, correctionPhase]);

  // Forward the launcher's real env() insets to the framed dev app (#484,
  // slice 2). The launcher is the top-level document so its env() reading is the
  // ground truth; the framed page's mock would otherwise report a synthetic
  // preset and double-pad it. Re-post on resize/orientationchange so a rotation
  // propagates. The iframe `onLoad` handler covers the initial post (the frame
  // may not be ready when this effect first runs). No-op outside live mode.
  //
  // letterboxDetected is passed so computeBridgeInsets() can zero the phantom
  // bottom inset when the window is letterboxed (#491): the window stops above
  // the home indicator so the app must not pad for an inset it cannot reach.
  //
  // #561/#566: letterboxCorrected (=correctionPhase 'held') is forwarded only
  // after the sentinel confirms the band paints. While applying/clipped it is
  // false, so computeNavBarBridgeInsets keeps the honest bottom-0 path. When the
  // phase settles (applying→held|clipped) this effect re-runs and post()
  // delivers the final insets.
  useEffect(() => {
    if (screen !== 'live') return;
    const post = () =>
      postSafeAreaInsetsTo(
        frameRef.current?.contentWindow ?? null,
        letterboxDetected,
        navBarType,
        letterboxCorrected,
        navBarTransparent,
      );
    window.addEventListener('resize', post);
    window.addEventListener('orientationchange', post);
    window.visualViewport?.addEventListener('resize', post);
    // Post once per (re-)run: the resize event that flips the letterbox verdict
    // runs the OLD closure (stale letterboxDetected) — when the verdict change
    // re-runs this effect, this post delivers the corrected insets. No-op
    // before the frame loads; the receiving bridge dedupes identical values.
    post();
    return () => {
      window.removeEventListener('resize', post);
      window.removeEventListener('orientationchange', post);
      window.visualViewport?.removeEventListener('resize', post);
    };
  }, [screen, letterboxDetected, letterboxCorrected, navBarType, navBarTransparent]);

  // On-device ICB discriminator (#475): Δ between window.innerHeight and the
  // bottom chrome's resolved bottom edge. A healthy fixed anchor yields
  // Δ ≈ 12 (+ inset when applied); a dropped `bottom` declaration or a
  // mis-resolved ICB shows up here without a tethered debugger.
  useEffect(() => {
    if (!diagOpen || !metrics) return;
    const el = bottomChromeRef.current;
    if (!el) return;
    setChromeDeltaPx(Math.round(window.innerHeight - el.getBoundingClientRect().bottom));
  }, [diagOpen, metrics]);

  // ---------------------------------------------------------------------------
  // Scanner start
  // ---------------------------------------------------------------------------

  const startScanner = useCallback(async () => {
    setMsg('');
    if (!(await QrScanner.hasCamera())) {
      setMsg(t('launcher.noCamera'));
      return;
    }
    setScannerVisible(true);
    // Allow the video element to mount before passing it to QrScanner.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const video = videoRef.current;
    if (!video) return;
    const qrScanner = new QrScanner(
      video,
      (result) => {
        const url = resolveScannedUrl(result.data);
        // Extract launcher-style search (name=/icon=/navBarType=) from the raw
        // QR payload (#507). extractLauncherSearch returns null for direct
        // tunnel URLs — applyNavBarParams resets to defaults in that case.
        if (url) showLive(url, extractLauncherSearch(result.data));
      },
      { highlightScanRegion: true, highlightCodeOutline: true },
    );
    scannerRef.current = qrScanner;
    try {
      await qrScanner.start();
    } catch {
      setMsg(t('launcher.cameraError'));
      stopScanner();
    }
  }, [t, showLive, stopScanner]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleOpen = useCallback(() => {
    const url = resolveScannedUrl(urlValue);
    if (!url) {
      setMsg(
        location.protocol === 'https:' ? t('launcher.invalidUrlHttps') : t('launcher.invalidUrl'),
      );
      return;
    }
    // Extract launcher-style search (name=/icon=/navBarType=) from the entered
    // URL (#507). extractLauncherSearch returns null for direct tunnel URLs.
    showLive(url, extractLauncherSearch(urlValue));
  }, [urlValue, t, showLive]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleOpen();
    },
    [handleOpen],
  );

  const handleInstallCta = useCallback(() => {
    pwaInstallRef.current?.showDialog(true);
  }, []);

  const handleRescan = useCallback(() => {
    setPendingUrl(null);
    setAuthBlockReason(null);
    setMenuOpen(false);
    showSetup(null);
  }, [showSetup]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // #561/#566 letterbox correction (geometry-epoch latch): when letterbox is
  // detected the WebKit top-level viewport is mis-sized to screen.height −
  // statusBar (e.g. 797 vs 844). The fix is the v11 html/body height force
  // (applyDocumentFlowForce) latched per geometry epoch — NOT a fixed-div height
  // (the reverted #527 approach, a no-op that never edits the viewport). With the
  // force held the ICB itself becomes screen.height, so the iframe's 100%/calc()
  // resolve correctly. `letterboxDetected` / `letterboxShortfallPx` /
  // `applyPxCorrection` (=correctionActive) / `letterboxCorrected` (=held) are
  // computed once near the verdict (above) and reused here. The root container no
  // longer carries an inline height — the force lives on html/body.
  return (
    <div
      ref={rootRef}
      style={{
        // Sizing comes from inset alone (#469): an explicit width/height
        // over-constrains the box (width/height beat right/bottom), so a
        // mis-resolved dvh/dvw on iOS standalone cold start would mis-size the
        // box. inset:0 tracks the real ICB on both axes. maxWidth keeps the
        // #444 WebKit clamp for the case where the ICB resolves wider than the
        // visual viewport.
        //
        // #561/#566 letterbox correction: the height force lives on html/body
        // (applyDocumentFlowForce), not on this container — the reverted fixed-div
        // height was a no-op that never edited the WebKit viewport. With the force
        // held the ICB is screen.height, so inset:0 alone tracks the full box and
        // the honest iframe formula below loses no mini-app content.
        position: 'fixed',
        inset: 0,
        maxWidth: '100dvw',
        overflowX: 'hidden',
        overflowY: 'auto',
      }}
    >
      <main
        id="setup"
        data-testid="launcher-setup"
        style={{
          display: screen === 'setup' ? 'flex' : 'none',
          minHeight: '100dvh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding:
            'max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))',
          position: 'relative',
        }}
      >
        <LanguageSwitcher />

        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{t('launcher.title')}</h1>
        <p
          style={{
            fontSize: '13px',
            color: '#9aa0a6',
            margin: 0,
            maxWidth: '30rem',
            textAlign: 'center',
            lineHeight: '1.5',
          }}
        >
          {t('launcher.description')}
        </p>

        <button
          type="button"
          id="install-cta"
          data-testid="launcher-install-cta"
          style={{ display: installCtaVisible ? '' : 'none' }}
          onClick={handleInstallCta}
        >
          {t('launcher.installCta')}
        </button>

        {/*
          manual-apple=true: on iOS Safari, _checkInstallAvailable calls hideDialog() to
          suppress the auto-popup, then _triggerAppleDialog sets isInstallAvailable=true.
          showDialog(true) (called from the install CTA) opens the iOS how-to guide.

          manual-chrome=true: on Chrome/Android, BeforeInstallPromptEvent is captured but
          hideDialog() is called immediately, so no auto-popup. showDialog(true) from
          the CTA opens the native Chrome install dialog.

          Both manual-* flags leave control entirely in our hands (CTA click → showDialog),
          which is the UX we want. disable-install-description was previously masking the
          iOS how-to illustration — removing it restores the library's native iOS guidance.
        */}
        <pwa-install
          ref={(el: PwaInstallElement | null) => {
            pwaInstallRef.current = el;
          }}
          id="pwa-install"
          data-testid="launcher-install-prompt"
          manifest-url="/launcher/manifest.webmanifest"
          name={t('launcher.title')}
          description={t('launcher.description')}
          manual-apple="true"
          manual-chrome="true"
        />

        <div
          id="setup-tools"
          data-testid="launcher-setup-tools"
          style={{
            display: setupToolsVisible ? 'flex' : 'none',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            width: '100%',
          }}
        >
          <div
            id="scanner"
            data-testid="launcher-scanner"
            style={{
              width: 'min(80vw, 320px)',
              aspectRatio: '1',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#16191d',
              display: scannerVisible ? 'block' : 'none',
            }}
          >
            <video
              ref={videoRef}
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            >
              <track kind="captions" />
            </video>
          </div>

          <div className="row" style={{ display: 'flex', gap: '8px', width: 'min(92vw, 420px)' }}>
            <input
              type="url"
              id="url-input"
              data-testid="launcher-url-input"
              placeholder={t('launcher.urlPlaceholder')}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '10px 12px',
                // iOS Safari auto-zooms when focused input font-size < 16px.
                // 16px is the minimum to prevent auto-zoom (Fix #451).
                // Manual e2e verification on real device required — desktop
                // Chromium cannot reproduce the iOS zoom behaviour.
                fontSize: '16px',
                borderRadius: '8px',
                border: '1px solid #2a2e33',
                background: '#16191d',
                color: '#e8eaed',
              }}
            />
            <button
              type="button"
              id="open-btn"
              data-testid="launcher-open-btn"
              onClick={handleOpen}
            >
              {t('launcher.openBtn')}
            </button>
          </div>

          <button
            type="button"
            id="scan-btn"
            className="secondary"
            data-testid="launcher-scan-btn"
            onClick={() => {
              void startScanner();
            }}
          >
            {t('launcher.scanBtn')}
          </button>

          <div
            id="msg"
            data-testid="launcher-msg"
            style={{
              fontSize: '12px',
              color: '#f28b82',
              minHeight: '16px',
              textAlign: 'center',
            }}
          >
            {msg}
          </div>
        </div>
      </main>

      {screen === 'live' && (
        <NavBar
          navBarType={navBarType}
          navBarTransparent={navBarTransparent}
          navBarTheme={navBarTheme}
          title={navBarTitle}
          iconSrc={appIconSrc}
          iconVisible={iconVisible}
          onIconError={() => setIconVisible(false)}
          menuOpen={menuOpen}
          diagOpen={diagOpen}
          onToggleMenu={() => setMenuOpen((open) => !open)}
          onToggleDiag={() => {
            setDiagOpen((open) => !open);
            setMenuOpen(false);
          }}
          onRescan={handleRescan}
          onClose={handleRescan}
          frameRef={frameRef}
        />
      )}

      <iframe
        ref={frameRef}
        id="frame"
        title="Dev app preview"
        data-testid="launcher-frame"
        allow="camera; microphone; geolocation; clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
        src={liveUrl ?? undefined}
        // Initial inset forward (#484, slice 2): post once the framed page is
        // loaded and its mock message listener is installed. resize/orientation
        // re-posts are wired in the effect above. Pass the current letterbox
        // verdict so the bottom inset is zeroed when the window is letterboxed
        // (#491 bridge bottom correction), letterboxCorrected so the bottom is
        // restored ONLY after the sentinel confirms the band paints (#561), and
        // the navBarType so the partner top inset is zeroed (the bar is launcher
        // chrome; iframe starts below it).
        onLoad={(e) =>
          postSafeAreaInsetsTo(
            e.currentTarget.contentWindow,
            letterboxDetected,
            navBarType,
            letterboxCorrected,
            navBarTransparent,
          )
        }
        style={{
          // dvh/dvw-free sizing (#469): 100% of a fixed element resolves
          // against the real ICB (window box), unlike 100dvh which can
          // mis-resolve on iOS standalone cold start. inset:0 alone is NOT
          // enough here — iframe is a replaced element, so auto width/height
          // falls back to the intrinsic 300×150 instead of stretching.
          // maxWidth keeps the #444 WebKit clamp for the case where the ICB
          // resolves wider than the visual viewport.
          //
          // #495: the partner nav bar is launcher chrome, so the iframe starts
          // BELOW it — top = status-bar inset + 54px bar. The framed app's own
          // env(safe-area-inset-top) then reads 0, matching the real partner
          // WebView coordinate system (#190). The game variant stays full-bleed
          // (top: 0) — its floating capsule overlays the canvas.
          // #587: partner+transparent → bar is a transparent overlay, so the
          // iframe is full-bleed like game (UNVERIFIED HYPOTHESIS — see navbar.ts).
          position: 'fixed',
          top:
            navBarType === 'partner' && !navBarTransparent
              ? `calc(env(safe-area-inset-top) + ${AIT_NAV_BAR_HEIGHT_PARTNER}px)`
              : 0,
          left: 0,
          right: 0,
          bottom: 0,
          border: 0,
          width: '100%',
          maxWidth: '100dvw',
          // iframe is a replaced element — explicit insets don't stretch its
          // height, so it would fall back to the intrinsic 150px. Size the
          // height explicitly: full window minus the partner bar offset (0 for
          // game). 100% resolves against the fixed-positioning ICB (#469 — not
          // 100dvh, which mis-resolves on iOS standalone cold start).
          //
          // #561/#566: with the html/body force held the ICB itself IS
          // screen.height (the v11 force recalcs the WebKit viewport, unlike the
          // reverted fixed-div), so 100%/calc() resolve correctly with no magic
          // px branch (matches the v11 iframe{height:100%} experiment). When the
          // band genuinely clips the force is dropped and the same formula then
          // resolves against the real ≈797 ICB — no mini-app content is clipped.
          // #587: partner+transparent → full-bleed height (same as game).
          height:
            navBarType === 'partner' && !navBarTransparent
              ? `calc(100% - env(safe-area-inset-top) - ${AIT_NAV_BAR_HEIGHT_PARTNER}px)`
              : '100%',
          background: '#fff',
          display: screen === 'live' ? 'block' : 'none',
        }}
      />

      {screen === 'live' && authBlockReason !== null && (
        <div
          role="alert"
          data-testid="launcher-auth-error"
          style={{
            position: 'fixed',
            top: 'max(16px, env(safe-area-inset-top))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            background: 'rgba(20,22,26,.95)',
            border: '1px solid #f28b82',
            borderRadius: '12px',
            padding: '16px 20px',
            maxWidth: 'min(92vw, 360px)',
            width: 'max-content',
            textAlign: 'center',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#f28b82',
            }}
          >
            {t('launcher.debugAuthFailed')}
          </span>
          <span
            data-testid="launcher-auth-error-hint"
            style={{
              fontSize: '12px',
              color: '#9aa0a6',
              lineHeight: '1.5',
            }}
          >
            {t(
              authBlockReason === 'auth-expired'
                ? 'launcher.debugAuthExpiredHint'
                : 'launcher.debugAuthFailedHint',
            )}
          </span>
          <button
            type="button"
            data-testid="launcher-auth-error-rescan"
            onClick={handleRescan}
            style={{
              marginTop: '4px',
              padding: '8px 16px',
              fontSize: '13px',
              borderRadius: '999px',
              background: '#f28b82',
              color: '#14161a',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {t('launcher.debugAuthRescanCta')}
          </button>
        </div>
      )}

      {/*
        Bottom chrome (#475, #495): the floating diag FAB + Rescan pill were
        rehomed into the nav-bar `···` menu (#495). What remains in this fixed
        container is the letterbox label and the diag panel itself (toggled from
        the menu now). They still live in ONE fixed flex container so vertical
        spacing comes from flex flow, not per-element calc() bottom offsets —
        the pieces can never overlap regardless of how the engine resolves any
        single declaration (real-device WebKit was observed dropping the calc()
        anchors). pointerEvents none/auto keeps the full-width strip from
        stealing touches meant for the iframe underneath. Rendered only in the
        live screen so the chrome-Δ discriminator measures the live geometry.
      */}
      {screen === 'live' && (
        <div
          ref={bottomChromeRef}
          style={{
            position: 'fixed',
            left: 'max(12px, env(safe-area-inset-left))',
            right: 'max(12px, env(safe-area-inset-right))',
            // #561/#566: while the correction is held (applyPxCorrection ===
            // correctionActive) the html/body force makes the container reach the
            // real screen bottom — keep a conservative flat 12px. Once the force
            // is dropped (clipped/timeout) the container is back to the real ICB,
            // so pad the real home indicator like a healthy edge-to-edge window.
            bottom: applyPxCorrection ? '12px' : 'max(12px, env(safe-area-inset-bottom))',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: '10px',
            pointerEvents: 'none',
          }}
        >
          {/*
          Letterbox diagnosis label (#469, re-grounded #561/#566): when the
          runtime geometry matches the iOS standalone letterbox signature
          (standalone + height shortfall — see letterbox.ts), name the condition
          in-page. The label reflects the correction phase: while applying/held it
          reports the v11 html/body force is correcting the band; once the
          sentinel proves the band is clipped (correctionPhase 'clipped') it states
          the limit honestly and points to the known manual recovery (rotate
          landscape → portrait).
        */}
          {letterboxDetected && (correctionPhase === 'clipped' || letterboxShortfallPx > 0) && (
            <div
              role="status"
              data-testid="launcher-letterbox-label"
              data-letterbox-verified={letterboxCorrected ? 'visible' : 'clipped'}
              style={{
                alignSelf: 'center',
                pointerEvents: 'auto',
                maxWidth: 'min(92vw, 420px)',
                padding: '8px 12px',
                fontSize: '12px',
                lineHeight: 1.5,
                textAlign: 'center',
                borderRadius: '10px',
                background: 'rgba(20,22,26,.92)',
                border: '1px solid #9aa0a6',
                color: '#9aa0a6',
                backdropFilter: 'blur(4px)',
              }}
            >
              {correctionPhase === 'clipped'
                ? t('launcher.letterboxClipped', { pt: letterboxShortfallPx })
                : t('launcher.letterboxDetected', { pt: letterboxShortfallPx })}
            </div>
          )}

          {diagOpen && metrics && (
            <div
              data-testid="launcher-diag-panel"
              style={{
                alignSelf: 'flex-start',
                pointerEvents: 'auto',
                minWidth: '220px',
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'rgba(20,22,26,.95)',
                border: '1px solid #2a2e33',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '11px',
                color: '#e8eaed',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '12px' }}>{t('launcher.diagTitle')}</div>
              {(
                [
                  ['inner', 'window.inner', `${metrics.innerWidth} × ${metrics.innerHeight}`],
                  ['screen', 'screen', `${metrics.screenWidth} × ${metrics.screenHeight}`],
                  [
                    'vvh',
                    'visualViewport.h',
                    metrics.visualViewportHeight === null
                      ? '–'
                      : String(Math.round(metrics.visualViewportHeight)),
                  ],
                  [
                    'safearea',
                    'safe-area t/b',
                    `${metrics.safeAreaTop} / ${metrics.safeAreaBottom}`,
                  ],
                  [
                    'standalone',
                    'standalone',
                    metrics.standalone ? t('launcher.diagYes') : t('launcher.diagNo'),
                  ],
                  ['shortfall', 'shortfall', `${letterbox?.shortfallPx ?? 0}px`],
                  ['chromedelta', 'chrome Δ', chromeDeltaPx === null ? '–' : `${chromeDeltaPx}px`],
                  // #536: verdict reason — surfaces the cold-start stale-env() case.
                  // Static key map avoids dynamic StringKey construction.
                  [
                    'verdict',
                    t('launcher.diagVerdictLabel'),
                    {
                      detected: t('launcher.diagVerdict.detected'),
                      notStandalone: t('launcher.diagVerdict.notStandalone'),
                      landscape: t('launcher.diagVerdict.landscape'),
                      shortfallTooSmall: t('launcher.diagVerdict.shortfallTooSmall'),
                      safeAreaTopZero: t('launcher.diagVerdict.safeAreaTopZero'),
                    }[letterboxVerdictReason],
                  ],
                  // #536: safeAreaTop poll trace — shows 0→47 settlement during cold-start
                  [
                    'satrace',
                    t('launcher.diagSafeAreaTrace'),
                    safeAreaTopTrace.length > 0 ? safeAreaTopTrace.join('→') : '–',
                  ],
                ] as const
              ).map(([id, label, value]) => (
                <div
                  key={id}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}
                >
                  <span style={{ color: '#9aa0a6' }}>{label}</span>
                  <span data-testid={`launcher-diag-${id}`}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
