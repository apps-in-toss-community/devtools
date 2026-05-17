import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTier0Ping } from '../tier0.js';

const KEY_T0_LAST_SENT = '__ait_telemetry:t0_last_sent';
const KEY_T0_OFF = '__ait_telemetry:t0_off';

function clearAll(): void {
  localStorage.removeItem(KEY_T0_LAST_SENT);
  localStorage.removeItem(KEY_T0_OFF);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
// sendTier0Ping: sends on first panel mount of the day
// ---------------------------------------------------------------------------
describe('sendTier0Ping', () => {
  it('sends a POST on first call with correct payload shape', async () => {
    let capturedBody: unknown;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(null, { status: 200 });
    });

    const result = await sendTier0Ping('0.1.19');

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedBody).toMatchObject({
      tier: 0,
      source: 'devtools',
      version: '0.1.19',
    });
    const body = capturedBody as { ts: number };
    expect(typeof body.ts).toBe('number');
    // anon_id must NOT appear in Tier 0 payload
    expect((capturedBody as Record<string, unknown>).anon_id).toBeUndefined();
  });

  it('marks today in localStorage after successful send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    await sendTier0Ping('0.1.19');

    expect(localStorage.getItem(KEY_T0_LAST_SENT)).toBe(todayISO());
  });

  it('does NOT send again when called a second time the same day', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    // First call — should send
    await sendTier0Ping('0.1.19');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call same day — should skip
    const secondResult = await sendTier0Ping('0.1.19');
    expect(secondResult).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1
  });

  it('does NOT send when t0_off=1 is set (opt-out)', async () => {
    localStorage.setItem(KEY_T0_OFF, '1');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const result = await sendTier0Ping('0.1.19');

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does NOT mark as sent and returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network error'));

    const result = await sendTier0Ping('0.1.19');

    expect(result).toBe(false);
    // Should NOT mark as sent — allow retry tomorrow
    expect(localStorage.getItem(KEY_T0_LAST_SENT)).toBeNull();
  });

  it('marks as sent even on non-2xx server response (avoids re-spam)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 400 }));

    const result = await sendTier0Ping('0.1.19');

    expect(result).toBe(true);
    expect(localStorage.getItem(KEY_T0_LAST_SENT)).toBe(todayISO());
  });
});
