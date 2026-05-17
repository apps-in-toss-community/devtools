import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptConsent,
  CURRENT_POLICY_VERSION,
  deleteMyData,
  denyConsent,
  getOrCreateAnonId,
  hasSentTier0Today,
  isTier0Enabled,
  markTier0Sent,
  readConsentState,
  readRepromptAfter,
  resolveEffectiveConsent,
  setConsentViaToggle,
  setTier0Enabled,
  shouldShowToast,
} from '../state.js';

const KEY_CONSENT = '__ait_telemetry:consent';
const KEY_REPROMPT_AFTER = '__ait_telemetry:reprompt_after';
const KEY_POLICY_VERSION = '__ait_telemetry:policy_version';
const KEY_ANON_ID = '__ait_telemetry:anon_id';

function clearAll(): void {
  localStorage.removeItem(KEY_CONSENT);
  localStorage.removeItem(KEY_REPROMPT_AFTER);
  localStorage.removeItem(KEY_POLICY_VERSION);
  localStorage.removeItem(KEY_ANON_ID);
}

beforeEach(() => {
  clearAll();
});

afterEach(() => {
  clearAll();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// readConsentState
// ---------------------------------------------------------------------------
describe('readConsentState', () => {
  it('returns "undecided" when no key is stored', () => {
    expect(readConsentState()).toBe('undecided');
  });

  it('returns "granted" when stored', () => {
    localStorage.setItem(KEY_CONSENT, 'granted');
    expect(readConsentState()).toBe('granted');
  });

  it('returns "denied" when stored', () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    expect(readConsentState()).toBe('denied');
  });

  it('returns "undecided" for unexpected values', () => {
    localStorage.setItem(KEY_CONSENT, 'yes');
    expect(readConsentState()).toBe('undecided');
  });
});

// ---------------------------------------------------------------------------
// State transitions: undecided → granted
// ---------------------------------------------------------------------------
describe('acceptConsent', () => {
  it('sets consent to "granted" and records policy version', () => {
    acceptConsent();
    expect(localStorage.getItem(KEY_CONSENT)).toBe('granted');
    expect(localStorage.getItem(KEY_POLICY_VERSION)).toBe(CURRENT_POLICY_VERSION);
  });

  it('clears reprompt_after', () => {
    localStorage.setItem(KEY_REPROMPT_AFTER, '999999');
    acceptConsent();
    expect(localStorage.getItem(KEY_REPROMPT_AFTER)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State transitions: undecided → denied + reprompt window math
// ---------------------------------------------------------------------------
describe('denyConsent', () => {
  it('first denial: sets denied + reprompt_after ~30 days from now', () => {
    const before = Date.now();
    denyConsent();
    const after = Date.now();

    expect(localStorage.getItem(KEY_CONSENT)).toBe('denied');
    const repromptAfter = readRepromptAfter();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(repromptAfter).toBeGreaterThanOrEqual(before + thirtyDaysMs);
    expect(repromptAfter).toBeLessThanOrEqual(after + thirtyDaysMs + 100);
  });

  it('second denial: sets reprompt_after to MAX_SAFE_INTEGER (permanent silence)', () => {
    // Simulate first denial: set a past reprompt window
    const past = Date.now() - 1000;
    localStorage.setItem(KEY_CONSENT, 'denied');
    localStorage.setItem(KEY_REPROMPT_AFTER, String(past));

    // Second denial
    denyConsent();

    expect(readRepromptAfter()).toBe(Number.MAX_SAFE_INTEGER);
  });
});

// ---------------------------------------------------------------------------
// 30-day reprompt: denied → after reprompt_after passes → toast eligible again
// ---------------------------------------------------------------------------
describe('shouldShowToast (30-day reprompt)', () => {
  it('returns false when reprompt_after is in the future', () => {
    localStorage.setItem(KEY_REPROMPT_AFTER, String(Date.now() + 10_000));
    // Still undecided (no consent stored) + reprompt in future → no toast
    expect(shouldShowToast()).toBe(false);
  });

  it('returns true when reprompt_after is in the past and consent is not stored', () => {
    // Simulate: denied then cleared (or reprompt_after expired)
    const past = Date.now() - 1000;
    localStorage.setItem(KEY_REPROMPT_AFTER, String(past));
    // No consent key → undecided
    expect(shouldShowToast()).toBe(true);
  });

  it('returns false when consent is "granted"', () => {
    localStorage.setItem(KEY_CONSENT, 'granted');
    localStorage.setItem(KEY_POLICY_VERSION, CURRENT_POLICY_VERSION);
    expect(shouldShowToast()).toBe(false);
  });

  it('returns true when consent="denied" and reprompt_after is in the past (one re-prompt)', () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    localStorage.setItem(KEY_REPROMPT_AFTER, String(Date.now() - 1000));
    expect(shouldShowToast()).toBe(true);
  });

  it('returns false when consent="denied" and reprompt_after is in the future', () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    localStorage.setItem(KEY_REPROMPT_AFTER, String(Date.now() + 1_000_000));
    expect(shouldShowToast()).toBe(false);
  });

  it('returns false when consent="denied" and reprompt_after is MAX_SAFE_INTEGER (permanent silence)', () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    localStorage.setItem(KEY_REPROMPT_AFTER, String(Number.MAX_SAFE_INTEGER));
    expect(shouldShowToast()).toBe(false);
  });

  it('returns true when undecided and no reprompt_after stored', () => {
    expect(shouldShowToast()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Policy version bump
// ---------------------------------------------------------------------------
describe('resolveEffectiveConsent — policy version', () => {
  it('granted + current version → stays granted', () => {
    localStorage.setItem(KEY_CONSENT, 'granted');
    localStorage.setItem(KEY_POLICY_VERSION, CURRENT_POLICY_VERSION);
    expect(resolveEffectiveConsent()).toBe('granted');
  });

  it('granted + stale version → treated as undecided and state is cleared', () => {
    localStorage.setItem(KEY_CONSENT, 'granted');
    localStorage.setItem(KEY_POLICY_VERSION, '2020-01-01');
    const result = resolveEffectiveConsent();
    expect(result).toBe('undecided');
    // Consent key is removed
    expect(localStorage.getItem(KEY_CONSENT)).toBeNull();
    expect(localStorage.getItem(KEY_POLICY_VERSION)).toBeNull();
  });

  it('denied + stale version → stays denied (no re-prompt)', () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    localStorage.setItem(KEY_POLICY_VERSION, '2020-01-01');
    expect(resolveEffectiveConsent()).toBe('denied');
    // KEY_CONSENT is unchanged
    expect(localStorage.getItem(KEY_CONSENT)).toBe('denied');
  });

  it('undecided + no version → undecided', () => {
    expect(resolveEffectiveConsent()).toBe('undecided');
  });
});

// ---------------------------------------------------------------------------
// Toggle (environment tab)
// ---------------------------------------------------------------------------
describe('setConsentViaToggle', () => {
  it('turning on sets granted + current policy version', () => {
    setConsentViaToggle(true);
    expect(localStorage.getItem(KEY_CONSENT)).toBe('granted');
    expect(localStorage.getItem(KEY_POLICY_VERSION)).toBe(CURRENT_POLICY_VERSION);
  });

  it('turning off sets denied but does NOT touch reprompt_after', () => {
    const existingReprompt = String(Date.now() + 999_999);
    localStorage.setItem(KEY_REPROMPT_AFTER, existingReprompt);
    setConsentViaToggle(false);
    expect(localStorage.getItem(KEY_CONSENT)).toBe('denied');
    // reprompt_after unchanged
    expect(localStorage.getItem(KEY_REPROMPT_AFTER)).toBe(existingReprompt);
  });
});

// ---------------------------------------------------------------------------
// anon_id: generated once, persisted, never regenerated
// ---------------------------------------------------------------------------
describe('getOrCreateAnonId', () => {
  it('generates and persists a UUID on first call', () => {
    const id = getOrCreateAnonId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(localStorage.getItem(KEY_ANON_ID)).toBe(id);
  });

  it('returns the same UUID on subsequent calls', () => {
    const id1 = getOrCreateAnonId();
    const id2 = getOrCreateAnonId();
    expect(id1).toBe(id2);
  });

  it('never regenerates if a value is already stored', () => {
    const fixed = 'fixed-uuid-value';
    localStorage.setItem(KEY_ANON_ID, fixed);
    expect(getOrCreateAnonId()).toBe(fixed);
  });
});

// ---------------------------------------------------------------------------
// deleteMyData
// ---------------------------------------------------------------------------
describe('deleteMyData', () => {
  it('returns false when no anon_id is stored (nothing to delete)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await deleteMyData('https://t.example.dev')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls DELETE on <endpoint>/e?anon_id=… and rotates anon_id on success', async () => {
    localStorage.setItem(KEY_ANON_ID, 'original-id');
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    const ok = await deleteMyData('https://t.example.dev');
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://t.example.dev/e?anon_id=original-id');
    expect(call[1]).toMatchObject({ method: 'DELETE' });
    const rotated = localStorage.getItem(KEY_ANON_ID);
    expect(rotated).not.toBe('original-id');
    expect(rotated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns false and does NOT rotate anon_id on non-ok response', async () => {
    localStorage.setItem(KEY_ANON_ID, 'original-id');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    expect(await deleteMyData('https://t.example.dev')).toBe(false);
    expect(localStorage.getItem(KEY_ANON_ID)).toBe('original-id');
  });

  it('returns false and does NOT rotate anon_id on network error', async () => {
    localStorage.setItem(KEY_ANON_ID, 'original-id');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    expect(await deleteMyData('https://t.example.dev')).toBe(false);
    expect(localStorage.getItem(KEY_ANON_ID)).toBe('original-id');
  });
});

// ---------------------------------------------------------------------------
// policy_version bump — 2026-05-12 → 2026-05-18: granted users regress to undecided
// ---------------------------------------------------------------------------
describe('policy_version bump regression (2026-05-18)', () => {
  it('CURRENT_POLICY_VERSION is 2026-05-18', () => {
    expect(CURRENT_POLICY_VERSION).toBe('2026-05-18');
  });

  it('user previously granted on 2026-05-12 → undecided after bump', () => {
    localStorage.setItem(KEY_CONSENT, 'granted');
    localStorage.setItem(KEY_POLICY_VERSION, '2026-05-12'); // old version
    const result = resolveEffectiveConsent();
    expect(result).toBe('undecided');
    expect(localStorage.getItem(KEY_CONSENT)).toBeNull();
    expect(localStorage.getItem(KEY_POLICY_VERSION)).toBeNull();
  });

  it('user previously denied on 2026-05-12 → stays denied (no re-prompt)', () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    localStorage.setItem(KEY_POLICY_VERSION, '2026-05-12');
    expect(resolveEffectiveConsent()).toBe('denied');
  });

  it('user granted on current version → stays granted', () => {
    localStorage.setItem(KEY_CONSENT, 'granted');
    localStorage.setItem(KEY_POLICY_VERSION, CURRENT_POLICY_VERSION);
    expect(resolveEffectiveConsent()).toBe('granted');
  });
});

// ---------------------------------------------------------------------------
// Tier 0 helpers
// ---------------------------------------------------------------------------
describe('isTier0Enabled / setTier0Enabled', () => {
  it('is enabled by default (no marker set)', () => {
    expect(isTier0Enabled()).toBe(true);
  });

  it('returns false when t0_off=1 is set', () => {
    localStorage.setItem('__ait_telemetry:t0_off', '1');
    expect(isTier0Enabled()).toBe(false);
  });

  it('setTier0Enabled(false) sets the opt-out marker', () => {
    setTier0Enabled(false);
    expect(localStorage.getItem('__ait_telemetry:t0_off')).toBe('1');
    expect(isTier0Enabled()).toBe(false);
  });

  it('setTier0Enabled(true) removes the opt-out marker', () => {
    localStorage.setItem('__ait_telemetry:t0_off', '1');
    setTier0Enabled(true);
    expect(localStorage.getItem('__ait_telemetry:t0_off')).toBeNull();
    expect(isTier0Enabled()).toBe(true);
  });
});

describe('hasSentTier0Today / markTier0Sent', () => {
  it('returns false when no marker is stored', () => {
    expect(hasSentTier0Today()).toBe(false);
  });

  it('returns true after markTier0Sent()', () => {
    markTier0Sent();
    expect(hasSentTier0Today()).toBe(true);
  });

  it('returns false when marker is from a different date', () => {
    localStorage.setItem('__ait_telemetry:t0_last_sent', '2000-01-01');
    expect(hasSentTier0Today()).toBe(false);
  });
});
