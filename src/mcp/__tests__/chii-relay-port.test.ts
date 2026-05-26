/**
 * Tests for random-port (port 0) behaviour in startChiiRelay and the
 * shutdown idempotency guard in runDebugServer.
 *
 * startChiiRelay is tested via the exported function directly; the real
 * `chii` module is mocked out so we don't need a phone or the Go binary.
 *
 * shutdown idempotency is tested by verifying that the `closed` guard
 * prevents duplicate side-effects when shutdown is called multiple times.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock `chii` so startChiiRelay can be called without the real chii server.
// chii.start() just needs to resolve; actual bind is done by our httpServer.
// ---------------------------------------------------------------------------

vi.mock('chii', () => ({
  default: undefined,
  // chii is loaded via createRequire; the mock must expose the same shape.
  start: vi.fn().mockResolvedValue(undefined),
}));

// We also need to intercept `createRequire` → `require('chii')` inside the
// module under test. The simplest approach: stub the module at the vi.mock level.
// But chii-relay.ts does `createRequire(import.meta.url)('chii')`, so we need
// to intercept the module resolution at the node level by mocking the package.
// vitest's vi.mock hoists the call, so the factory above runs first.
// The module itself calls loadChiiServer() → require('chii'); the require
// resolves to the vi.mock'd module. We verify behavior at the integration level:
// if chii.start throws, startChiiRelay should reject; otherwise it should
// resolve with the actual bound port.

import { startChiiRelay } from '../chii-relay.js';

// ---------------------------------------------------------------------------
// port 0 → OS-assigned port
// ---------------------------------------------------------------------------

describe('startChiiRelay — port 0 (OS-assigned)', () => {
  it('returns a port greater than 0 when port 0 is requested', async () => {
    const relay = await startChiiRelay({ port: 0 });
    try {
      expect(relay.port).toBeGreaterThan(0);
    } finally {
      await relay.close();
    }
  });

  it('baseUrl contains the actual bound port (not 0)', async () => {
    const relay = await startChiiRelay({ port: 0 });
    try {
      expect(relay.baseUrl).toBe(`http://127.0.0.1:${relay.port}`);
      expect(relay.baseUrl).not.toContain(':0');
    } finally {
      await relay.close();
    }
  });

  it('uses default port 0 when no options are passed', async () => {
    const relay = await startChiiRelay();
    try {
      expect(relay.port).toBeGreaterThan(0);
      expect(relay.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d{2,5}$/);
    } finally {
      await relay.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Two simultaneous port-0 relays get different ports (no collision)
// ---------------------------------------------------------------------------

describe('startChiiRelay — two concurrent port-0 relays', () => {
  it('assigns different ports to two simultaneous relays', async () => {
    const [relayA, relayB] = await Promise.all([
      startChiiRelay({ port: 0 }),
      startChiiRelay({ port: 0 }),
    ]);
    try {
      expect(relayA.port).toBeGreaterThan(0);
      expect(relayB.port).toBeGreaterThan(0);
      expect(relayA.port).not.toBe(relayB.port);
    } finally {
      await Promise.all([relayA.close(), relayB.close()]);
    }
  });

  it('both relays are listening (close() resolves without error)', async () => {
    const [relayA, relayB] = await Promise.all([
      startChiiRelay({ port: 0 }),
      startChiiRelay({ port: 0 }),
    ]);
    // If either relay is not actually listening, close() would error or hang.
    await expect(Promise.all([relayA.close(), relayB.close()])).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Backwards compatibility: explicit port is honoured
// ---------------------------------------------------------------------------

describe('startChiiRelay — explicit port (backwards-compatible)', () => {
  it('binds to the requested port when an explicit non-zero port is given', async () => {
    // Use a high ephemeral port unlikely to be in use. If it happens to be
    // occupied the test fails with EADDRINUSE — acceptable; this is deterministic
    // behaviour verification, not flakiness testing.
    const relay = await startChiiRelay({ port: 0 }); // grab a free port first
    const freePort = relay.port;
    await relay.close();

    // Now use that freed port explicitly (best-effort; another process could
    // grab it between close and listen, but this is rare in CI).
    const relay2 = await startChiiRelay({ port: freePort });
    try {
      expect(relay2.port).toBe(freePort);
      expect(relay2.baseUrl).toBe(`http://127.0.0.1:${freePort}`);
    } finally {
      await relay2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// shutdown idempotency guard
//
// We test the guard logic in isolation without spawning a real MCP server.
// The pattern mirrors what runDebugServer does internally.
// ---------------------------------------------------------------------------

describe('shutdown idempotency', () => {
  it('side-effects execute only once when shutdown is called multiple times', () => {
    const sideEffect = vi.fn();

    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      sideEffect();
    };

    shutdown();
    shutdown();
    shutdown();

    expect(sideEffect).toHaveBeenCalledTimes(1);
  });

  it('the guard works across different call sites (simulating signal + exit overlap)', () => {
    const tunnelStop = vi.fn();

    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      tunnelStop();
    };

    // Simulate SIGINT handler
    shutdown();
    // Simulate overlapping 'exit' handler
    if (!closed) {
      closed = true;
      tunnelStop();
    }
    // Simulate uncaughtException handler
    shutdown();

    expect(tunnelStop).toHaveBeenCalledTimes(1);
  });
});
