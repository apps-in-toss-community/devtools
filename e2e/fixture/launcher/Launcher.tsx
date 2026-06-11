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
  computeBridgeInsets,
  detectLetterbox,
  type SafeAreaInsets,
  type ViewportMetrics,
} from './letterbox.js';

const CDP_FORWARD_PARAMS = ['debug', 'relay', 'at'] as const;

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
  const launcherSearch = location.search;
  const param = new URLSearchParams(launcherSearch).get('url');
  if (!param) return null;
  const url = normalizeUrl(param);
  history.replaceState(null, '', location.pathname);
  return url ? decorateIframeSrc(url, launcherSearch) : null;
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

function postSafeAreaInsetsTo(target: Window | null, letterboxDetected: boolean): void {
  if (!target) return;
  const raw = measureSafeAreaInsets();
  const insets = computeBridgeInsets(raw, letterboxDetected);
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pwaInstallRef = useRef<PwaInstallElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const bottomChromeRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

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

  const showLive = useCallback(
    (url: string) => {
      stopScanner();
      setPendingUrl(null);
      setLiveUrl(url);
      setScreen('live');
      setMsg('');
      setAuthBlockReason(null);
    },
    [stopScanner],
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
      if (
        typeof data !== 'object' ||
        data === null ||
        (data as { type?: unknown }).type !== 'ait:debug-attach-blocked'
      ) {
        return;
      }
      const reason = (data as { reason?: unknown }).reason;
      if (reason === 'auth' || reason === 'auth-expired') {
        setAuthBlockReason(reason);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Viewport diagnostics (#469): keep a live geometry snapshot so the letterbox
  // verdict and the diag panel stay current across rotation / resize. iOS
  // standalone cold start can settle the final window geometry late, so one
  // delayed re-measure runs even when no resize event ever fires.
  useEffect(() => {
    const measure = () => setMetrics(readViewportMetrics());
    measure();
    const settle = window.setTimeout(measure, 600);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  const letterbox = metrics ? detectLetterbox(metrics) : null;

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
  useEffect(() => {
    if (screen !== 'live') return;
    const letterboxDetected = letterbox?.detected ?? false;
    const post = () =>
      postSafeAreaInsetsTo(frameRef.current?.contentWindow ?? null, letterboxDetected);
    window.addEventListener('resize', post);
    window.addEventListener('orientationchange', post);
    window.visualViewport?.addEventListener('resize', post);
    return () => {
      window.removeEventListener('resize', post);
      window.removeEventListener('orientationchange', post);
      window.visualViewport?.removeEventListener('resize', post);
    };
  }, [screen, letterbox?.detected]);

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
        if (url) showLive(url);
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
    showLive(url);
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
    showSetup(null);
  }, [showSetup]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        // Sizing comes from inset alone (#469): an explicit width/height
        // over-constrains the box (width/height beat right/bottom), so a
        // mis-resolved dvh/dvw on iOS standalone cold start would mis-size the
        // box. inset:0 tracks the real ICB on both axes. maxWidth keeps the
        // #444 WebKit clamp for the case where the ICB resolves wider than the
        // visual viewport.
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
        // (#491 bridge bottom correction).
        onLoad={(e) =>
          postSafeAreaInsetsTo(e.currentTarget.contentWindow, letterbox?.detected ?? false)
        }
        style={{
          // dvh/dvw-free sizing (#469): 100% of a fixed element resolves
          // against the real ICB (window box), unlike 100dvh which can
          // mis-resolve on iOS standalone cold start. inset:0 alone is NOT
          // enough here — iframe is a replaced element, so auto width/height
          // falls back to the intrinsic 300×150 instead of stretching.
          // maxWidth keeps the #444 WebKit clamp for the case where the ICB
          // resolves wider than the visual viewport.
          position: 'fixed',
          inset: 0,
          border: 0,
          width: '100%',
          maxWidth: '100dvw',
          height: '100%',
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
        Bottom chrome (#475): RESCAN, diag FAB, diag panel and the letterbox
        label live in ONE fixed container — vertical spacing comes from flex
        flow, not per-element calc() bottom offsets, so the pieces can never
        overlap regardless of how the engine resolves any single declaration
        (real-device WebKit was observed dropping the calc() anchors).
        pointerEvents none/auto keeps the full-width strip from stealing
        touches meant for the iframe underneath.
      */}
      <div
        ref={bottomChromeRef}
        style={{
          position: 'fixed',
          left: 'max(12px, env(safe-area-inset-left))',
          right: 'max(12px, env(safe-area-inset-right))',
          // Letterboxed window never reaches the home indicator — use a flat
          // 12px so the chrome sits just inside the mis-sized window (#491:
          // bottom inset is phantom in letterbox state and must not be used).
          // Healthy edge-to-edge windows pad the real home indicator.
          bottom: letterbox?.detected ? '12px' : 'max(12px, env(safe-area-inset-bottom))',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '10px',
          pointerEvents: 'none',
        }}
      >
        {/*
          Letterbox diagnosis label (#469): when the runtime geometry matches
          the iOS standalone letterbox signature (standalone + height shortfall
          — see letterbox.ts), name the strip in-page. The band itself is
          OUTSIDE the window (OS-painted manifest background_color) so this
          label is the only way the page can explain it.
        */}
        {letterbox?.detected && (
          <div
            role="status"
            data-testid="launcher-letterbox-label"
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
              border: '1px solid #fdd663',
              color: '#fdd663',
              backdropFilter: 'blur(4px)',
            }}
          >
            {t('launcher.letterboxDetected', { pt: letterbox.shortfallPx })}
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
                ['safearea', 'safe-area t/b', `${metrics.safeAreaTop} / ${metrics.safeAreaBottom}`],
                [
                  'standalone',
                  'standalone',
                  metrics.standalone ? t('launcher.diagYes') : t('launcher.diagNo'),
                ],
                ['shortfall', 'shortfall', `${letterbox?.shortfallPx ?? 0}px`],
                ['chromedelta', 'chrome Δ', chromeDeltaPx === null ? '–' : `${chromeDeltaPx}px`],
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

        {/* Viewport diagnostics FAB (#469) — always available so the measured
            values can be read on-device without a tethered debugger. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <button
            type="button"
            id="diag-toggle"
            data-testid="launcher-diag-fab"
            aria-expanded={diagOpen}
            title={t('launcher.diagTitle')}
            onClick={() => setDiagOpen((open) => !open)}
            style={{
              pointerEvents: 'auto',
              padding: '8px 12px',
              fontSize: '12px',
              borderRadius: '999px',
              background: 'rgba(20,22,26,.85)',
              color: '#9aa0a6',
              border: '1px solid #2a2e33',
              backdropFilter: 'blur(4px)',
            }}
          >
            {t('launcher.diagFab')}
          </button>
          <button
            type="button"
            id="rescan"
            data-testid="launcher-rescan-btn"
            onClick={handleRescan}
            style={{
              pointerEvents: 'auto',
              padding: '8px 12px',
              fontSize: '12px',
              borderRadius: '999px',
              background: 'rgba(20,22,26,.85)',
              color: '#e8eaed',
              border: '1px solid #2a2e33',
              display: screen === 'live' ? 'block' : 'none',
              backdropFilter: 'blur(4px)',
            }}
          >
            {t('launcher.rescanBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
