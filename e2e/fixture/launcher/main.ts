// AITC DevTools Launcher — a fixed-URL PWA that frames an ephemeral Cloudflare
// quick-tunnel dev server full-screen.
//
// Why a launcher instead of opening the tunnel URL directly: quick-tunnel URLs
// change every run, so installing the dev URL itself as a PWA leaves a dead link
// next session; navigating cross-origin from a standalone PWA also drops the
// chromeless display on iOS/Android. This page is the stable same-origin shell
// (installed once, e.g. https://devtools.aitc.dev/launcher/) — it stays
// chromeless and shows the chosen dev URL in a full-viewport <iframe>.

import QrScanner from 'qr-scanner';
// Side-effect import — registers the <pwa-install> custom element. The library
// handles the cross-browser install dialog itself (Android Chrome
// `beforeinstallprompt`, iOS share-sheet illustration, Firefox/Safari manual
// fallback), which we previously approximated with a static text card.
import '@khmyznikov/pwa-install';
import { resolveLauncherEntry } from './entry.js';

const setup = document.getElementById('setup') as HTMLElement;
const scannerBox = document.getElementById('scanner') as HTMLElement;
const video = scannerBox.querySelector('video') as HTMLVideoElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const openBtn = document.getElementById('open-btn') as HTMLButtonElement;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;
const msg = document.getElementById('msg') as HTMLElement;
const frame = document.getElementById('frame') as HTMLIFrameElement;
const rescanBtn = document.getElementById('rescan') as HTMLButtonElement;
const installPrompt = document.getElementById('pwa-install') as HTMLElement & {
  showDialog: (forced?: boolean) => void;
};
const installCta = document.getElementById('install-cta') as HTMLButtonElement;
const setupTools = document.getElementById('setup-tools') as HTMLElement;
// "Open this once without installing" — only surfaced on the setup screen when a
// deep-link / saved URL arrived but the launcher isn't installed yet (#411). It
// keeps the install-first gate from being a dead end.
const openOnceBtn = document.getElementById('open-once') as HTMLButtonElement;

let scanner: QrScanner | null = null;

// Deep-link / saved URL preserved across the install-first gate so "open once"
// (and a post-install standalone re-entry) can reach the live frame.
let pendingUrl: string | null = null;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari home-screen apps expose this non-standard flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// http:// localhost / 127.0.0.1 — used by the bundled e2e fixture and local dev.
// PWA install criteria require https, so we relax gating in this context so the
// fixture remains usable in a normal browser tab.
function isLocalDev(): boolean {
  if (location.protocol === 'http:') return true;
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

// Hide the input + scanner controls until the launcher is installed. The page
// is meant to run as a chromeless PWA shell — letting a browser tab also drive
// the iframe defeats the point (no standalone display, cross-origin tunnel URL
// leaks the launcher's address bar). Local dev keeps the controls visible so
// the fixture can be exercised without installing anything.
function applyPwaGate(): void {
  const gated = !isStandalone() && !isLocalDev();
  setupTools.style.display = gated ? 'none' : '';
  // Install CTA only useful when the launcher isn't already standalone.
  installCta.style.display = isStandalone() ? 'none' : '';
}

applyPwaGate();
installCta.addEventListener('click', () => installPrompt.showDialog(true));
// "Open this once without installing" — bypass the install-first gate for the
// preserved deep-link / saved URL (#411). The install CTA remains the primary
// path; this just avoids a dead end for someone who only wants a quick look.
openOnceBtn.addEventListener('click', () => {
  if (pendingUrl) showLive(pendingUrl);
});
window.addEventListener('appinstalled', () => {
  applyPwaGate();
  // Just installed → now standalone. If a deep-link was held back by the gate,
  // enter the live frame directly so install completion lands on the dev app.
  if (pendingUrl && isStandalone()) showLive(pendingUrl);
});

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
  // Allow http: only when the launcher itself is served over http: (local dev) —
  // an http: iframe inside an https: page is mixed-content-blocked and fails
  // silently. Quick-tunnel URLs are always https:, so this never bites them.
  if (parsed.protocol === 'http:' && location.protocol === 'http:') return parsed.toString();
  return null;
}

function stopScanner(): void {
  scanner?.stop();
  scanner?.destroy();
  scanner = null;
  scannerBox.style.display = 'none';
}

// Forward the env-2 CDP debug params onto the framed dev URL. The unplugin QR /
// deep-link carries `…/launcher/?url=<tunnel>&debug=1&relay=<wss>`: `url` is the
// page to frame, while `debug`/`relay` are the in-app debug gate (Layer C) opt-in
// that must ride *on the iframe's own URL* — the gate reads
// `window.location.search` of the framed page, not the launcher shell. So we lift
// any `debug`/`relay`/`at` present on the launcher's search onto the tunnel URL.
// A standalone scanned URL (no extra params) passes through unchanged.
const CDP_FORWARD_PARAMS = ['debug', 'relay', 'at'] as const;

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
    // Don't overwrite a param the tunnel URL already carries (a fully-formed
    // deep link wins over launcher-shell forwarding).
    if (value !== null && !target.searchParams.has(key)) {
      target.searchParams.set(key, value);
    }
  }
  return target.toString();
}

// Resolve a scanned/pasted string into a framed iframe URL. The QR may encode
// either the launcher deep-link itself (`…/launcher/?url=<tunnel>&debug=1&…`,
// what the unplugin prints) or a bare tunnel URL. For the former we lift the
// debug params off the deep link onto the embedded tunnel; for the latter we
// pass it through normalizeUrl. Returns null if no valid https(/local-http) URL
// is found.
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

function showLive(url: string): void {
  stopScanner();
  // The URL is now live — clear the held-back deep-link so a later setup screen
  // (rescan) doesn't re-surface the "open once" button for a stale URL.
  pendingUrl = null;
  openOnceBtn.style.display = 'none';
  frame.src = url;
  frame.style.display = 'block';
  rescanBtn.style.display = 'block';
  setup.style.display = 'none';
  msg.textContent = '';
}

function showSetup(): void {
  frame.style.display = 'none';
  frame.removeAttribute('src');
  rescanBtn.style.display = 'none';
  setup.style.display = 'flex';
  // Surface the "open this once without installing" escape hatch only when a
  // deep-link / saved URL was preserved (install-first gate, #411). Otherwise it
  // stays hidden — a plain setup screen has nothing to open yet.
  openOnceBtn.style.display = pendingUrl ? '' : 'none';
}

async function startScanner(): Promise<void> {
  msg.textContent = '';
  if (!(await QrScanner.hasCamera())) {
    msg.textContent = 'No camera available — paste the URL instead.';
    return;
  }
  scannerBox.style.display = 'block';
  scanner = new QrScanner(
    video,
    (result) => {
      const url = resolveScannedUrl(result.data);
      if (url) showLive(url);
    },
    { highlightScanRegion: true, highlightCodeOutline: true },
  );
  try {
    await scanner.start();
  } catch {
    msg.textContent = 'Could not access the camera — paste the URL instead.';
    stopScanner();
  }
}

openBtn.addEventListener('click', () => {
  const url = resolveScannedUrl(urlInput.value);
  if (!url) {
    msg.textContent =
      location.protocol === 'https:'
        ? 'Enter a valid https:// URL (the tunnel URL from your terminal).'
        : 'Enter a valid http(s):// URL.';
    return;
  }
  showLive(url);
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') openBtn.click();
});

scanBtn.addEventListener('click', () => {
  void startScanner();
});

rescanBtn.addEventListener('click', () => {
  showSetup();
});

// PWA: register a passthrough service worker so Android Chrome offers install.
// Failure is non-fatal (e.g. http:// localhost without a SW-eligible context).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/launcher/sw.js', { scope: '/launcher/' }).catch(() => {});
}

// Deep-link entry: QR codes that the unplugin prints embed
// `…/launcher/?url=<tunnel>[&debug=1&relay=<wss>]` so the PWA can open the tunnel
// without a manual scan/paste step. The `debug`/`relay` params (env-2 CDP gate)
// are folded onto the framed tunnel URL via decorateIframeSrc before the launcher
// search is stripped. The query is consumed (history.replaceState) so a refresh
// inside the live view falls back to localStorage / setup, not a re-deep-link.
function consumeDeepLinkUrl(): string | null {
  const launcherSearch = location.search;
  const param = new URLSearchParams(launcherSearch).get('url');
  if (!param) return null;
  const url = normalizeUrl(param);
  history.replaceState(null, '', location.pathname);
  return url ? decorateIframeSrc(url, launcherSearch) : null;
}

// Entry routing (#411, #459): a deep-link no longer skips straight to live in an
// uninstalled browser tab — that permanently hid the install CTA. When the
// install-first gate is closed (not standalone, not local-dev) we show setup
// with the URL preserved as `pendingUrl` (+ "open once" button). Installed /
// local-dev contexts keep the straight-to-live behaviour.
//
// Fresh open (no ?url=) always lands on setup (#459): saved last-URL auto-load
// is removed because quick-tunnel hosts change every session and TOTP `at=`
// codes stored in a deep-link expire in 30 seconds — the saved URL is always
// stale by the time the launcher is reopened.
const deepLinked = consumeDeepLinkUrl();

const entry = resolveLauncherEntry({
  deepLinkUrl: deepLinked,
  isStandalone: isStandalone(),
  isLocalDev: isLocalDev(),
});

if (entry.kind === 'live') {
  showLive(entry.url);
} else {
  pendingUrl = entry.pendingUrl;
  showSetup();
}
