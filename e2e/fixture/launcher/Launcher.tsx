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
import { useT } from '../../../src/i18n/react.js';
import { resolveLauncherEntry } from './entry.js';

const STORAGE_KEY = 'aitc-launcher:last-url';
const CDP_FORWARD_PARAMS = ['debug', 'relay', 'at'] as const;

// Minimal type for the <pwa-install> custom element surface we actually use.
type PwaInstallElement = HTMLElement & {
  showDialog: (forced?: boolean) => void;
  isDialogHidden?: boolean;
};

// ---------------------------------------------------------------------------
// Pure helpers (same logic as the original main.ts)
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Screen = 'setup' | 'live';

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
  const [openOnceVisible, setOpenOnceVisible] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pwaInstallRef = useRef<PwaInstallElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  // ---------------------------------------------------------------------------
  // Gate helpers
  // ---------------------------------------------------------------------------

  const applyPwaGate = useCallback((pending: string | null) => {
    const gated = !isStandalone() && !isLocalDev();
    setSetupToolsVisible(!gated);
    setInstallCtaVisible(!isStandalone());
    setOpenOnceVisible(!!pending);
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
      setOpenOnceVisible(false);
      localStorage.setItem(STORAGE_KEY, url);
      setLiveUrl(url);
      setScreen('live');
      setMsg('');
    },
    [stopScanner],
  );

  const showSetup = useCallback(
    (pending: string | null) => {
      stopScanner();
      setLiveUrl(null);
      setScreen('setup');
      setOpenOnceVisible(!!pending);
      const last = localStorage.getItem(STORAGE_KEY);
      if (last) setUrlValue(last);
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
    const savedRaw = localStorage.getItem(STORAGE_KEY);
    const savedUrl = savedRaw && normalizeUrl(savedRaw) ? savedRaw : null;

    const entry = resolveLauncherEntry({
      deepLinkUrl: deepLinked,
      lastUrl: savedUrl,
      isStandalone: isStandalone(),
      isLocalDev: isLocalDev(),
    });

    if (entry.kind === 'live') {
      localStorage.setItem(STORAGE_KEY, entry.url);
      setLiveUrl(entry.url);
      setScreen('live');
    } else {
      const pending = entry.pendingUrl;
      setPendingUrl(pending);
      const last = localStorage.getItem(STORAGE_KEY);
      if (last) setUrlValue(last);
      applyPwaGate(pending);
    }

    const onInstalled = () => {
      applyPwaGate(null);
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [applyPwaGate]);

  // Re-apply gate whenever pendingUrl changes on the setup screen.
  useEffect(() => {
    if (screen === 'setup') {
      applyPwaGate(pendingUrl);
    }
  }, [pendingUrl, screen, applyPwaGate]);

  // If installed (appinstalled fired) and pendingUrl exists, enter live.
  // This is wired via a separate effect that watches pendingUrl so the
  // appinstalled handler above stays simple.
  useEffect(() => {
    const onInstalled = () => {
      if (pendingUrl && isStandalone()) {
        showLive(pendingUrl);
      }
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [pendingUrl, showLive]);

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

  const handleOpenOnce = useCallback(() => {
    if (pendingUrl) showLive(pendingUrl);
  }, [pendingUrl, showLive]);

  const handleRescan = useCallback(() => {
    setPendingUrl(null);
    showSetup(null);
  }, [showSetup]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
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
        }}
      >
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

        <pwa-install
          ref={(el: PwaInstallElement | null) => {
            pwaInstallRef.current = el;
          }}
          id="pwa-install"
          data-testid="launcher-install-prompt"
          manifest-url="/launcher/manifest.webmanifest"
          name={t('launcher.title')}
          description={t('launcher.description')}
          disable-install-description="true"
          manual-chrome="true"
        />

        <button
          type="button"
          id="open-once"
          className="secondary"
          data-testid="launcher-open-once"
          style={{ display: openOnceVisible ? '' : 'none' }}
          onClick={handleOpenOnce}
        >
          {t('launcher.openOnce')}
        </button>

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
                fontSize: '15px',
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
        id="frame"
        title="Dev app preview"
        data-testid="launcher-frame"
        allow="camera; microphone; geolocation; clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
        src={liveUrl ?? undefined}
        style={{
          position: 'fixed',
          inset: 0,
          border: 0,
          width: '100%',
          height: '100dvh',
          background: '#fff',
          display: screen === 'live' ? 'block' : 'none',
        }}
      />

      <button
        type="button"
        id="rescan"
        data-testid="launcher-rescan-btn"
        onClick={handleRescan}
        style={{
          position: 'fixed',
          right: 'max(12px, env(safe-area-inset-right))',
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          zIndex: 10,
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
    </>
  );
}
