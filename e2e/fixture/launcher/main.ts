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

const STORAGE_KEY = 'aitc-launcher:last-url';

const setup = document.getElementById('setup') as HTMLElement;
const scannerBox = document.getElementById('scanner') as HTMLElement;
const video = scannerBox.querySelector('video') as HTMLVideoElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const openBtn = document.getElementById('open-btn') as HTMLButtonElement;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;
const msg = document.getElementById('msg') as HTMLElement;
const frame = document.getElementById('frame') as HTMLIFrameElement;
const rescanBtn = document.getElementById('rescan') as HTMLButtonElement;
const installHint = document.getElementById('install-hint') as HTMLElement;
const installBtn = document.getElementById('install-btn') as HTMLButtonElement;
const setupTools = document.getElementById('setup-tools') as HTMLElement;

let scanner: QrScanner | null = null;

// `beforeinstallprompt` is Chromium-only and not in lib.dom; minimal shape.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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

// On hosts without `beforeinstallprompt` (Safari, Firefox) we never get an
// in-page install button — only the OS share-sheet flow ("Add to Home Screen").
function canShowInstallPrompt(): boolean {
  return 'BeforeInstallPromptEvent' in window || 'onbeforeinstallprompt' in window;
}

// Hide the input + scanner controls until the launcher is installed. The page
// is meant to run as a chromeless PWA shell — letting a browser tab also drive
// the iframe defeats the point (no standalone display, cross-origin tunnel URL
// leaks the launcher's address bar). Local dev keeps the controls visible so
// the fixture can be exercised without installing anything.
function applyPwaGate(): void {
  const gated = !isStandalone() && !isLocalDev();
  setupTools.style.display = gated ? 'none' : '';
  installHint.classList.toggle('show', !isStandalone());
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
applyPwaGate();
if (!isStandalone() && canShowInstallPrompt()) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    installBtn.classList.add('show');
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.classList.remove('show');
  });
}
window.addEventListener('appinstalled', () => {
  installHint.classList.remove('show');
  installBtn.classList.remove('show');
  applyPwaGate();
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

function showLive(url: string): void {
  stopScanner();
  localStorage.setItem(STORAGE_KEY, url);
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
  const last = localStorage.getItem(STORAGE_KEY);
  if (last) urlInput.value = last;
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
      const url = normalizeUrl(result.data);
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
  const url = normalizeUrl(urlInput.value);
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
// `…/launcher/?url=<tunnel>` so the PWA can open the tunnel without a manual
// scan/paste step. The query is consumed (history.replaceState) so a refresh
// inside the live view falls back to localStorage / setup, not a re-deep-link.
function consumeDeepLinkUrl(): string | null {
  const param = new URLSearchParams(location.search).get('url');
  if (!param) return null;
  const url = normalizeUrl(param);
  history.replaceState(null, '', location.pathname);
  return url;
}

const deepLinked = consumeDeepLinkUrl();
if (deepLinked) {
  showLive(deepLinked);
} else {
  const last = localStorage.getItem(STORAGE_KEY);
  if (last && normalizeUrl(last)) {
    showLive(last);
  } else {
    showSetup();
  }
}
