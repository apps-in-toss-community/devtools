/**
 * Unit tests for src/mcp/tunnel.ts:
 *   - renderQr: unicode half-block QR output
 *   - startTunnelHealthProbe child-exit detection (FIX 1, issue #571)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REISSUE_ATTEMPTS,
  type QuickTunnel,
  renderQr,
  startTunnelHealthProbe,
} from '../tunnel.js';

// ---------------------------------------------------------------------------
// Helper: fake QuickTunnel with controllable onUnexpectedExit
// ---------------------------------------------------------------------------

function makeFakeTunnel(url: string): QuickTunnel & {
  _triggerUnexpectedExit: (code: number | null) => void;
} {
  let exitCb: ((code: number | null) => void) | null = null;
  return {
    url,
    wssUrl: url.replace(/^https/, 'wss'),
    onUnexpectedExit(cb) {
      exitCb = cb;
    },
    stop: vi.fn(),
    _triggerUnexpectedExit(code) {
      exitCb?.(code);
    },
  };
}

describe('renderQr — unicode half-block QR', () => {
  it('produces non-empty output for a short URL', async () => {
    const out = await renderQr('https://example.com');
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('contains no ANSI escape codes (ESC = 0x1b)', async () => {
    const out = await renderQr('https://example.com');
    // Check for ESC byte (0x1b) using charCodeAt to avoid Biome noControlCharactersInRegex
    expect(out.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });

  it('all non-empty lines have the same width (uniform QR row width)', async () => {
    const out = await renderQr('https://example.com');
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const widths = lines.map((l) => [...l].length); // spread for multi-byte chars
    const first = widths[0]!;
    for (const w of widths) {
      expect(w).toBe(first);
    }
  });

  it('contains only half-block chars, spaces, and newlines (no other printable symbols)', async () => {
    const out = await renderQr('test');
    // Allowed characters: half-block chars (█ ▀ ▄), space, newline
    const allowed = /^[█▀▄ \n]+$/u;
    expect(out).toMatch(allowed);
  });

  it('produces output for a longer deep-link style input', async () => {
    const deepLink =
      'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com';
    const out = await renderQr(deepLink);
    expect(out.trim().length).toBeGreaterThan(0);
    // No ANSI escape codes (0x1b)
    expect(out.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIX 1 (issue #571): child-exit immediate reissue in startTunnelHealthProbe
// ---------------------------------------------------------------------------

describe('startTunnelHealthProbe — FIX 1: child-exit immediate reissue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers reissue immediately on unexpected child exit without waiting for probe interval', async () => {
    const newTunnel = makeFakeTunnel('https://new.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    // probe always says alive — so the interval would NOT trigger reissue
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockResolvedValue(newTunnel);
    const initialTunnel = makeFakeTunnel('https://old.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000, // very long — would never fire in this test
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Simulate unexpected child death (not via stop()).
    initialTunnel._triggerUnexpectedExit(1);

    // Give the async doReissueOrDrop a tick to run.
    // We flush microtasks (Promise.resolve) and advance timers just enough
    // for the async chain to settle — but not so far that the long-interval
    // probe fires (probeIntervalMs=60_000 >> 100 ms advance here).
    await vi.advanceTimersByTimeAsync(100);

    expect(spawnTunnel).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledWith(newTunnel);
    expect(onPermanentDrop).not.toHaveBeenCalled();
    // Probe interval never fired.
    expect(probe).not.toHaveBeenCalled();

    stop();
  });

  it('does NOT trigger reissue when the probe interval fires but probe says alive', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn();
    const initialTunnel = makeFakeTunnel('https://healthy.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Advance 5 probe intervals without any child exit.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).not.toHaveBeenCalled();
    expect(spawnTunnel).not.toHaveBeenCalled();

    stop();
  });

  it('arms onUnexpectedExit on the reissued tunnel so subsequent child death also triggers reissue', async () => {
    const newTunnel1 = makeFakeTunnel('https://new1.trycloudflare.com');
    const newTunnel2 = makeFakeTunnel('https://new2.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockResolvedValueOnce(newTunnel1).mockResolvedValueOnce(newTunnel2);
    const initialTunnel = makeFakeTunnel('https://initial.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Initial tunnel dies.
    initialTunnel._triggerUnexpectedExit(0);
    // Flush microtasks so the async doReissueOrDrop chain resolves.
    // probeIntervalMs=60_000 so advancing 100 ms is safe.
    await vi.advanceTimersByTimeAsync(100);

    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenLastCalledWith(newTunnel1);

    // The reissued tunnel (newTunnel1) also dies.
    newTunnel1._triggerUnexpectedExit(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(onReissue).toHaveBeenCalledTimes(2);
    expect(onReissue).toHaveBeenLastCalledWith(newTunnel2);

    stop();
  });

  it('reaches permanent drop after MAX_REISSUE_ATTEMPTS child exits', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockRejectedValue(new Error('spawn failed'));
    const initialTunnel = makeFakeTunnel('https://dead.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Trigger MAX_REISSUE_ATTEMPTS child exits. Each one calls doReissueOrDrop,
    // which fails (spawnTunnel rejects). The last one hits the permanent-drop path.
    // probeIntervalMs=60_000 so advancing 100 ms is safe (probe interval won't fire).
    for (let i = 0; i < MAX_REISSUE_ATTEMPTS; i++) {
      initialTunnel._triggerUnexpectedExit(1);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(spawnTunnel).toHaveBeenCalledTimes(MAX_REISSUE_ATTEMPTS);
    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).toHaveBeenCalledTimes(1);

    stop();
  });
});
