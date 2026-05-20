/**
 * Telemetry consent state machine + localStorage I/O.
 *
 * localStorage keys are LOCKED — do not rename without updating the privacy page.
 */

export type ConsentState = 'granted' | 'denied' | 'undecided';

// Key names — locked per privacy page spec
const KEY_CONSENT = '__ait_telemetry:consent';
const KEY_REPROMPT_AFTER = '__ait_telemetry:reprompt_after';
const KEY_POLICY_VERSION = '__ait_telemetry:policy_version';
const KEY_ANON_ID = '__ait_telemetry:anon_id';

// Tier 0 keys
export const KEY_T0_LAST_SENT = '__ait_telemetry:t0_last_sent';
export const KEY_T0_OFF = '__ait_telemetry:t0_off';

// ---------------------------------------------------------------------------
// Tier 0 opt-out helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if Tier 0 ping is enabled.
 * Disabled when `localStorage.__ait_telemetry:t0_off = '1'`
 * or `process.env.AITC_TELEMETRY === 'off'`.
 */
export function isTier0Enabled(): boolean {
  if (typeof process !== 'undefined' && process.env.AITC_TELEMETRY === 'off') return false;
  try {
    return localStorage.getItem(KEY_T0_OFF) !== '1';
  } catch {
    return true;
  }
}

/**
 * Sets or clears the Tier 0 opt-out marker.
 */
export function setTier0Enabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.removeItem(KEY_T0_OFF);
    } else {
      localStorage.setItem(KEY_T0_OFF, '1');
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * Returns true if Tier 0 has already been sent today (YYYY-MM-DD).
 */
export function hasSentTier0Today(): boolean {
  try {
    const stored = localStorage.getItem(KEY_T0_LAST_SENT);
    if (!stored) return false;
    const today = new Date().toISOString().slice(0, 10);
    return stored === today;
  } catch {
    return false;
  }
}

/**
 * Records that Tier 0 was sent today.
 */
export function markTier0Sent(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(KEY_T0_LAST_SENT, today);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Current policy version. Bump this string whenever the privacy policy changes.
 * Users who previously granted on an older version will be re-prompted once.
 */
export const CURRENT_POLICY_VERSION = '2026-05-18';

/** 30 days in milliseconds */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function readConsentState(): ConsentState {
  const raw = localStorage.getItem(KEY_CONSENT);
  if (raw === 'granted' || raw === 'denied') return raw;
  return 'undecided';
}

export function readRepromptAfter(): number {
  const raw = localStorage.getItem(KEY_REPROMPT_AFTER);
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function readPolicyVersion(): string | null {
  return localStorage.getItem(KEY_POLICY_VERSION);
}

/**
 * Returns the stored anon_id, or generates + persists a new UUID v4 on first call.
 * Once generated it is never overwritten.
 */
export function getOrCreateAnonId(): string {
  const existing = localStorage.getItem(KEY_ANON_ID);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY_ANON_ID, id);
  return id;
}

// ---------------------------------------------------------------------------
// Writes / transitions
// ---------------------------------------------------------------------------

/**
 * Resolve effective consent, handling the policy-version bump rule:
 *   - If stored = "granted" but stored version ≠ CURRENT → revert to undecided
 *   - If stored = "denied" and version changed → stay denied (no re-prompt)
 *
 * Call this at init time to normalise state before checking whether to show a toast.
 * Returns the effective ConsentState after applying the version-bump rule.
 */
export function resolveEffectiveConsent(): ConsentState {
  const raw = localStorage.getItem(KEY_CONSENT);
  if (raw === 'granted') {
    const storedVersion = readPolicyVersion();
    if (storedVersion !== CURRENT_POLICY_VERSION) {
      // Policy changed — treat as undecided so user gets re-prompted once
      localStorage.removeItem(KEY_CONSENT);
      localStorage.removeItem(KEY_POLICY_VERSION);
      return 'undecided';
    }
    return 'granted';
  }
  if (raw === 'denied') return 'denied';
  return 'undecided';
}

/**
 * User clicked "Yes, send".
 * Sets consent = granted, records policy version.
 */
export function acceptConsent(): void {
  localStorage.setItem(KEY_CONSENT, 'granted');
  localStorage.setItem(KEY_POLICY_VERSION, CURRENT_POLICY_VERSION);
  // Ensure reprompt_after is cleared (shouldn't matter, but keep state clean)
  localStorage.removeItem(KEY_REPROMPT_AFTER);
}

/**
 * User clicked "No, thanks".
 * First denial: sets reprompt_after = now + 30 days.
 * Second denial (reprompt_after was already set to a past finite value that triggered
 *   re-prompt): sets reprompt_after = MAX_SAFE_INTEGER → permanent silence.
 */
export function denyConsent(): void {
  localStorage.setItem(KEY_CONSENT, 'denied');
  const existing = readRepromptAfter();
  if (existing > 0 && existing < Number.MAX_SAFE_INTEGER) {
    // This is the second denial — silence permanently
    localStorage.setItem(KEY_REPROMPT_AFTER, String(Number.MAX_SAFE_INTEGER));
  } else {
    // First denial
    localStorage.setItem(KEY_REPROMPT_AFTER, String(Date.now() + THIRTY_DAYS_MS));
  }
}

/**
 * Environment-tab toggle: free transition between granted/denied.
 * Does NOT touch reprompt_after.
 */
export function setConsentViaToggle(granted: boolean): void {
  if (granted) {
    localStorage.setItem(KEY_CONSENT, 'granted');
    localStorage.setItem(KEY_POLICY_VERSION, CURRENT_POLICY_VERSION);
  } else {
    localStorage.setItem(KEY_CONSENT, 'denied');
  }
}

/**
 * Returns true if the toast should be shown now.
 * Conditions:
 *   - undecided (no prior choice or policy bumped to a newer version)
 *   - denied + reprompt_after set + reprompt_after < now (one re-prompt after
 *     the configured silence window; `denyConsent` flips to permanent silence
 *     on the second denial by setting reprompt_after to MAX_SAFE_INTEGER).
 */
export function shouldShowToast(): boolean {
  const state = resolveEffectiveConsent();
  if (state === 'undecided') {
    const repromptAfter = readRepromptAfter();
    if (repromptAfter === 0) return true;
    return Date.now() > repromptAfter;
  }
  if (state === 'denied') {
    const repromptAfter = readRepromptAfter();
    if (repromptAfter === 0 || repromptAfter >= Number.MAX_SAFE_INTEGER) return false;
    return Date.now() > repromptAfter;
  }
  return false;
}

/**
 * Sends the DELETE request to remove the user's data from the server, and
 * rotates the local anon_id on success so any subsequent events are unlinkable
 * from the deleted history.
 */
export async function deleteMyData(endpoint: string): Promise<boolean> {
  const anonId = localStorage.getItem(KEY_ANON_ID);
  if (!anonId) return false;
  try {
    const res = await fetch(`${endpoint}/e?anon_id=${encodeURIComponent(anonId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return false;
    localStorage.setItem(KEY_ANON_ID, crypto.randomUUID());
    return true;
  } catch {
    return false;
  }
}
