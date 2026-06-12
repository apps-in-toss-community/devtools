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
  CURRENT_POLICY_VERSION,
  denyConsent,
  getOrCreateAnonId,
  resolveEffectiveConsent,
  setConsentViaToggle,
  shouldShowToast,
} from './state.js';
import { sendTier0Ping } from './tier0.js';

// ---------------------------------------------------------------------------
// Machine-level consent overlay — dev server endpoint (#542)
// ---------------------------------------------------------------------------

/**
 * The dev server consent endpoint path. Must match the path registered in
 * the unplugin (`TELEMETRY_CONSENT_PATH`).
 */
const MACHINE_CONSENT_ENDPOINT = '/api/ait-devtools/telemetry-consent';

/**
 * Whether we have already attempted to sync with the machine-level state.
 * We sync once at init time to avoid repeated network calls.
 */
let machineSyncDone = false;

/**
 * Reads the machine-level consent state from the dev server endpoint.
 * Returns `null` when not in a dev-server context (fetch fails, 503, non-JSON).
 *
 * BROWSER-ONLY. Runs inside the panel (browser context).
 */
async function fetchMachineConsent(): Promise<{
  consent: 'granted' | 'denied' | 'undecided';
  anon_id: string | null;
  policy_version: string;
} | null> {
  try {
    const res = await fetch(MACHINE_CONSENT_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      consent?: unknown;
      anon_id?: unknown;
      policy_version?: unknown;
    };
    if (data.consent !== 'granted' && data.consent !== 'denied' && data.consent !== 'undecided') {
      return null;
    }
    return {
      consent: data.consent,
      anon_id: typeof data.anon_id === 'string' ? data.anon_id : null,
      policy_version: typeof data.policy_version === 'string' ? data.policy_version : '',
    };
  } catch {
    // fetch fails in non-dev-server contexts (GitHub Pages, static deployment)
    return null;
  }
}

/**
 * Posts a consent decision to the dev server so it is persisted to the
 * machine-level file. Fire-and-forget — failures are silently ignored.
 */
function postMachineConsent(
  consent: 'granted' | 'denied' | 'undecided',
  policyVersion: string,
): void {
  fetch(MACHINE_CONSENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent, policy_version: policyVersion }),
  }).catch(() => {
    /* silently ignore — dev server may not be running */
  });
}

/**
 * Applies the machine-level consent to the browser localStorage so all
 * subsequent reads from `state.ts` (which are locked to localStorage) reflect
 * the machine decision.
 *
 * Only writes when the machine state is a definitive decision (granted/denied)
 * and the policy version is current — avoids clobbering a more recent local
 * decision with a stale machine file.
 */
function applyMachineConsentToLocalStorage(machineState: {
  consent: 'granted' | 'denied' | 'undecided';
  anon_id: string | null;
  policy_version: string;
}): void {
  if (machineState.consent === 'undecided') return;
  if (machineState.policy_version !== CURRENT_POLICY_VERSION) return;

  // Mirror to localStorage so `state.ts` reads are consistent.
  setConsentViaToggle(machineState.consent === 'granted');

  // Mirror anon_id to localStorage if machine has one and local doesn't yet.
  if (machineState.anon_id) {
    try {
      const existing = localStorage.getItem('__ait_telemetry:anon_id');
      if (!existing) {
        localStorage.setItem('__ait_telemetry:anon_id', machineState.anon_id);
      }
    } catch {
      /* localStorage unavailable */
    }
  }
}

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
 * Handles: Tier 0 ping, consent check (machine overlay first, localStorage
 * fallback), optional toast, panel_mount event, pagehide wiring.
 *
 * Machine-level overlay (#542): when the dev server is running, we fetch the
 * machine-level consent once and apply it to localStorage. This prevents the
 * toast from re-appearing when the origin rotates (quick-tunnel host or port
 * changes). On non-dev-server surfaces (GitHub Pages, static fixture) the
 * fetch fails silently and we fall through to the existing localStorage path.
 */
function init(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  wirePagehide();

  // Tier 0: fire-and-forget daily ping (opt-out, no consent needed).
  void sendTier0Ping(getVersion());

  if (!machineSyncDone) {
    machineSyncDone = true;

    // Try to sync with the dev-server machine consent overlay.
    void fetchMachineConsent().then((machineState) => {
      if (machineState) {
        applyMachineConsentToLocalStorage(machineState);
      }
      // Proceed with the (now possibly updated) localStorage state.
      runConsentFlow();
    });
  } else {
    runConsentFlow();
  }
}

/**
 * Core consent flow — reads localStorage (which may have already been
 * patched by `applyMachineConsentToLocalStorage`) and shows the toast or
 * fires `panel_mount` accordingly.
 */
function runConsentFlow(): void {
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
          // Persist to machine-level file via dev server (fire-and-forget).
          postMachineConsent('granted', CURRENT_POLICY_VERSION);
          void send('panel_mount', getVersion());
        },
        onDeny: () => {
          denyConsent();
          // Persist to machine-level file via dev server (fire-and-forget).
          postMachineConsent('denied', CURRENT_POLICY_VERSION);
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
