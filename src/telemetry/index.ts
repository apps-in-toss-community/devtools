/**
 * Telemetry client — internal to @ait-co/devtools.
 *
 * NOT exported from src/mock/index.ts — this is panel-internal only.
 *
 * Usage: import { telemetry } from './telemetry/index.js' (from panel code).
 */

import { showConsentToast } from './consent-toast.js';
import { send, sendBeaconEvent } from './send.js';
import {
  acceptConsent,
  denyConsent,
  getOrCreateAnonId,
  resolveEffectiveConsent,
  shouldShowToast,
} from './state.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Telemetry ingest endpoint.
 * Overridable at build time via define (e.g., for e2e / local dev).
 * Do NOT expose this as a public env-var surface.
 */
function readGlobalString(key: string): string | undefined {
  const val = (globalThis as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : undefined;
}

export const TELEMETRY_ENDPOINT: string =
  readGlobalString('__TELEMETRY_ENDPOINT__') ?? 'https://t.aitc.dev';

// Version is injected by tsdown define (__VERSION__) as a compile-time text
// substitution — same mechanism panel/index.ts uses for its header label.
// It is NOT a runtime global, so a globalThis lookup would always miss.
function getVersion(): string {
  return __VERSION__;
}

// ---------------------------------------------------------------------------
// Session duration tracking
// ---------------------------------------------------------------------------

let panelVisibleSince: number | null = null;
let accumulatedMs = 0;
let pagehideWired = false;

function onPanelVisible(): void {
  if (panelVisibleSince === null) {
    panelVisibleSince = Date.now();
  }
}

function onPanelHidden(): void {
  if (panelVisibleSince !== null) {
    accumulatedMs += Date.now() - panelVisibleSince;
    panelVisibleSince = null;
  }
}

function wirePagehide(): void {
  if (pagehideWired) return;
  pagehideWired = true;

  // pagehide covers bfcache (Safari) and regular navigation. Preferred over beforeunload.
  window.addEventListener('pagehide', () => {
    onPanelHidden();
    if (accumulatedMs > 0) {
      sendBeaconEvent('session_duration', getVersion(), { ms: accumulatedMs });
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type TabId = string;

/**
 * Call once after panel mounts.
 * Handles: consent check, optional toast, panel_mount event, pagehide wiring.
 */
function init(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  wirePagehide();

  const effectiveConsent = resolveEffectiveConsent();

  if (effectiveConsent === 'granted') {
    // Ensure anon_id exists before firing
    getOrCreateAnonId();
    void send('panel_mount', getVersion());
    return;
  }

  if (shouldShowToast()) {
    const showToast = () => {
      showConsentToast({
        onAccept: () => {
          acceptConsent();
          getOrCreateAnonId();
          void send('panel_mount', getVersion());
        },
        onDeny: () => {
          denyConsent();
        },
      });
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(showToast, { timeout: 3_000 });
    } else {
      setTimeout(showToast, 1_500);
    }
  }
}

/**
 * Call when the panel is opened/toggled visible.
 */
function onPanelOpen(): void {
  void send('panel_open', getVersion());
  onPanelVisible();
}

/**
 * Call when the panel is closed/hidden.
 */
function onPanelClose(): void {
  onPanelHidden();
}

/**
 * Call when the user switches tabs.
 */
function onTabView(tabId: TabId): void {
  void send('tab_view', getVersion(), { tab: tabId });
}

export const telemetry = {
  init,
  onPanelOpen,
  onPanelClose,
  onTabView,
} as const;
