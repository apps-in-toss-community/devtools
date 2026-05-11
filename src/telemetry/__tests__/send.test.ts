import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { send } from '../send.js';

const KEY_CONSENT = '__ait_telemetry:consent';
const KEY_ANON_ID = '__ait_telemetry:anon_id';
const KEY_POLICY_VERSION = '__ait_telemetry:policy_version';

function clearAll(): void {
  localStorage.removeItem(KEY_CONSENT);
  localStorage.removeItem(KEY_ANON_ID);
  localStorage.removeItem(KEY_POLICY_VERSION);
}

function grantConsent(): void {
  localStorage.setItem(KEY_CONSENT, 'granted');
  localStorage.setItem(KEY_POLICY_VERSION, '2026-05-12');
  localStorage.setItem(KEY_ANON_ID, 'test-anon-id');
}

beforeEach(() => {
  clearAll();
  vi.useFakeTimers();
});

afterEach(() => {
  clearAll();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Drop when consent is not "granted"
// ---------------------------------------------------------------------------
describe('send: drops when consent is not granted', () => {
  it('drops silently when undecided', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    await send('panel_mount', '0.1.0');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops silently when denied', async () => {
    localStorage.setItem(KEY_CONSENT, 'denied');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    await send('panel_open', '0.1.0');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Success: does NOT retry
// ---------------------------------------------------------------------------
describe('send: success path', () => {
  it('does not retry on success', async () => {
    grantConsent();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const promise = send('panel_mount', '0.1.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Retry: once on failure, then drop
// ---------------------------------------------------------------------------
describe('send: retry once on failure', () => {
  it('retries once on non-2xx and then drops', async () => {
    grantConsent();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }));

    const promise = send('tab_view', '0.1.0', { tab: 'env' });

    // First attempt fires immediately; advance past the 5s timeout and 2s retry delay
    await vi.runAllTimersAsync();
    await promise;

    // Should have been called exactly twice (1 initial + 1 retry)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries once on network error (fetch throws)', async () => {
    grantConsent();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const promise = send('panel_open', '0.1.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a third time after two failures', async () => {
    grantConsent();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));

    const promise = send('panel_mount', '0.1.0');
    await vi.runAllTimersAsync();
    await promise;

    // Exactly 2 calls — initial + 1 retry
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------
describe('send: payload shape', () => {
  it('sends correct payload fields', async () => {
    grantConsent();
    let capturedBody: unknown;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(null, { status: 200 });
    });

    const promise = send('tab_view', '0.1.14', { tab: 'env' });
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedBody).toMatchObject({
      source: 'devtools',
      event: 'tab_view',
      anon_id: 'test-anon-id',
      version: '0.1.14',
      meta: { tab: 'env' },
    });
    const payload = capturedBody as { ts: number };
    expect(typeof payload.ts).toBe('number');
  });

  it('drops meta exceeding 256 bytes', async () => {
    grantConsent();
    let capturedBody: unknown;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(null, { status: 200 });
    });

    const oversizedMeta: Record<string, string> = { x: 'a'.repeat(300) };
    const promise = send('panel_mount', '0.1.0', oversizedMeta);
    await vi.runAllTimersAsync();
    await promise;

    const payload = capturedBody as { meta?: unknown };
    expect(payload.meta).toBeUndefined();
  });
});
