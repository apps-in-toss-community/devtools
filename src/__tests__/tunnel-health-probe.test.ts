/**
 * Unit tests for TunnelHealthProbe (src/mcp/tunnel.ts).
 *
 * All tests use fake timers and stub out `probeTunnel` + `startQuickTunnel` so
 * no real HTTP requests or cloudflared processes are spawned.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REISSUE_ATTEMPTS,
  makeTunnelStatus,
  type QuickTunnel,
  startTunnelHealthProbe,
} from '../mcp/tunnel.js';

function makeFakeTunnel(url: string): QuickTunnel {
  return {
    url,
    wssUrl: url.replace(/^https/, 'wss'),
    // FIX 1: onUnexpectedExit is required by the updated QuickTunnel interface.
    // In these tests we don't trigger it via child-exit events, so a no-op stub
    // satisfies the contract without altering existing test behaviour.
    onUnexpectedExit: vi.fn(),
    stop: vi.fn(),
  };
}

describe('startTunnelHealthProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing when the tunnel is consistently healthy', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const initialTunnel = makeFakeTunnel('https://healthy.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      onReissue,
      onPermanentDrop,
      probe,
    });

    // Advance 5 probe intervals.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(probe).toHaveBeenCalledTimes(5);
    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).not.toHaveBeenCalled();

    stop();
  });

  it('tolerates one failure without triggering reissue (failuresBeforeReissue=2)', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    // First failure, then healthy.
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const initialTunnel = makeFakeTunnel('https://flaky.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue,
      onPermanentDrop,
      probe,
    });

    await vi.advanceTimersByTimeAsync(100); // first probe — fails (count=1, below threshold)
    await vi.advanceTimersByTimeAsync(100); // second probe — succeeds

    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).not.toHaveBeenCalled();

    stop();
  });

  it('triggers reissue after consecutive failures reach threshold', async () => {
    const newTunnel = makeFakeTunnel('https://new-tunnel.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(false); // always failing
    const spawnTunnel = vi.fn().mockResolvedValue(newTunnel);
    const initialTunnel = makeFakeTunnel('https://dropped.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
    });

    await vi.advanceTimersByTimeAsync(100); // failure 1 (count < threshold)
    await vi.advanceTimersByTimeAsync(100); // failure 2 — threshold reached, reissue attempt 1

    expect(spawnTunnel).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledWith(newTunnel);
    expect(onPermanentDrop).not.toHaveBeenCalled();

    stop();
  });

  it('stops the old tunnel process on successful reissue', async () => {
    const stopOld = vi.fn();
    const initialTunnel = makeFakeTunnel('https://old.trycloudflare.com');
    (initialTunnel.stop as ReturnType<typeof vi.fn>) = stopOld;

    const newTunnel = makeFakeTunnel('https://new.trycloudflare.com');
    const probe = vi.fn().mockResolvedValue(false);
    const spawnTunnel = vi.fn().mockResolvedValue(newTunnel);

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue: vi.fn(),
      onPermanentDrop: vi.fn(),
      probe,
      spawnTunnel,
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100); // reissue triggered

    expect(stopOld).toHaveBeenCalledTimes(1);

    stop();
  });

  it('calls onPermanentDrop after MAX_REISSUE_ATTEMPTS consecutive reissue failures', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(false);
    const spawnTunnel = vi.fn().mockRejectedValue(new Error('cloudflared offline'));
    const initialTunnel = makeFakeTunnel('https://dead.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
    });

    // Each pair of intervals: first failure hits count=1, second failure hits threshold
    // and triggers a reissue attempt. We need MAX_REISSUE_ATTEMPTS reissue attempts to
    // exhaust. But after the threshold is first reached on interval 2, subsequent
    // intervals also try to reissue (each new failure increments consecutiveFailures
    // past threshold again). Advance enough intervals so all attempts fire.
    // Attempt 1 fires at interval 2 (failures 1+2).
    // After attempt 1 fails, consecutiveFailures is still >= threshold on the next
    // interval, so attempt 2 fires at interval 3.
    // Attempt 3 fires at interval 4 → onPermanentDrop.
    for (let i = 0; i < MAX_REISSUE_ATTEMPTS + 2; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(spawnTunnel).toHaveBeenCalledTimes(MAX_REISSUE_ATTEMPTS);
    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).toHaveBeenCalledTimes(1);
    // droppedAt is an ISO timestamp string.
    expect(typeof onPermanentDrop.mock.calls[0][0]).toBe('string');

    stop();
  });

  it('stops probing after permanent drop (no more callbacks)', async () => {
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(false);
    const spawnTunnel = vi.fn().mockRejectedValue(new Error('offline'));
    const initialTunnel = makeFakeTunnel('https://gone.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue: vi.fn(),
      onPermanentDrop,
      probe,
      spawnTunnel,
    });

    // Exhaust all attempts.
    for (let i = 0; i < MAX_REISSUE_ATTEMPTS + 2; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(onPermanentDrop).toHaveBeenCalledTimes(1);

    const callsBefore = spawnTunnel.mock.calls.length;
    // Advance further — probe should have self-stopped.
    await vi.advanceTimersByTimeAsync(500);
    expect(spawnTunnel.mock.calls.length).toBe(callsBefore);

    stop();
  });

  it('resets failure counter after a successful reissue', async () => {
    const newTunnel = makeFakeTunnel('https://new-after-recovery.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();

    let callCount = 0;
    // Fails twice (trigger reissue), then succeeds forever.
    const probe = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount > 2;
    });
    const spawnTunnel = vi.fn().mockResolvedValue(newTunnel);
    const initialTunnel = makeFakeTunnel('https://temporary-drop.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
    });

    await vi.advanceTimersByTimeAsync(100); // failure 1
    await vi.advanceTimersByTimeAsync(100); // failure 2 → reissue attempt 1 succeeds
    await vi.advanceTimersByTimeAsync(100); // success
    await vi.advanceTimersByTimeAsync(100); // success

    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onPermanentDrop).not.toHaveBeenCalled();
    expect(spawnTunnel).toHaveBeenCalledTimes(1);

    stop();
  });
});

describe('makeTunnelStatus', () => {
  it('returns a status with up=true and no droppedAt when healthy', () => {
    const status = makeTunnelStatus(true, 'wss://foo.trycloudflare.com');
    expect(status.up).toBe(true);
    expect(status.wssUrl).toBe('wss://foo.trycloudflare.com');
    expect(status.droppedAt).toBeNull();
    expect(status.reissueAttempts).toBe(0);
  });

  it('returns a status with up=false and droppedAt when permanently dropped', () => {
    const ts = new Date().toISOString();
    const status = makeTunnelStatus(false, null, ts, 3);
    expect(status.up).toBe(false);
    expect(status.wssUrl).toBeNull();
    expect(status.droppedAt).toBe(ts);
    expect(status.reissueAttempts).toBe(3);
  });
});
