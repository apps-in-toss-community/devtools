/**
 * Unit tests for the web-QR server integration in {@link createRelayConnectionFactory}
 * (devtools#708).
 *
 * `open()` now starts a loopback QR HTTP dashboard when not headless, so the QR
 * is scannable even when stdout is non-interactive (Claude Code `!` / CI). The
 * heavy relay/tunnel graph is mocked — no real phone, network, or secrets needed.
 *
 * SECRET-HANDLING: no real TOTP codes, relay wss URLs, or scheme URLs are used.
 * All fixture values are synthetic placeholders that carry no secrets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock all dynamic-import boundaries inside relay-factory.ts ──────────────

// attach-orchestrator: prepareAttach + renderAndMaybeWait + mintAttachUrl
const prepareAttachMock = vi.fn();
const renderAndMaybeWaitMock = vi.fn();
const mintAttachUrlMock = vi.fn(() => 'intoss-private://synthetic?at=placeholder');
vi.mock('../mcp/attach-orchestrator.js', () => ({
  prepareAttach: prepareAttachMock,
  renderAndMaybeWait: renderAndMaybeWaitMock,
  mintAttachUrl: mintAttachUrlMock,
}));

// cell.ts
const injectDebugIndicatorMock = vi.fn(() => Promise.resolve());
const injectGlobalsMock = vi.fn(() => Promise.resolve());
vi.mock('./cell.js', () => ({
  injectDebugIndicator: injectDebugIndicatorMock,
  injectGlobals: injectGlobalsMock,
}));

// relay-secret-store.ts
const loadRelaySecretReadOnlyMock = vi.fn(() => Promise.resolve());
vi.mock('../mcp/relay-secret-store.js', () => ({
  loadRelaySecretReadOnly: loadRelaySecretReadOnlyMock,
}));

// debug-server.ts — bootRelayFamily + buildRelayVerifyAuth
const fakeStop = vi.fn();
const fakeConnection = {
  kind: 'relay' as const,
  listTargets: () => [],
  enableDomains: vi.fn(() => Promise.resolve()),
};
const fakeTunnelStatus = { up: true, wssUrl: null }; // wssUrl intentionally null (no real wss)
const bootRelayFamilyMock = vi.fn(() =>
  Promise.resolve({
    connection: fakeConnection,
    stop: fakeStop,
    getTunnelStatus: () => fakeTunnelStatus,
  }),
);
const buildRelayVerifyAuthMock = vi.fn(() => ({}));
vi.mock('../mcp/debug-server.js', () => ({
  bootRelayFamily: bootRelayFamilyMock,
  buildRelayVerifyAuth: buildRelayVerifyAuthMock,
}));

// qr-http-server.ts — the key surface under test
const qrServerCloseMock = vi.fn(() => Promise.resolve());
const qrServerNotifyMock = vi.fn();
const fakeQrServer = {
  port: 49152, // synthetic loopback port — not a real server
  buildAttachPageUrl: (url: string) => `http://127.0.0.1:49152/?u=${encodeURIComponent(url)}`,
  inspectorStableUrl: 'http://127.0.0.1:49152/inspector',
  notifyStateChange: qrServerNotifyMock,
  close: qrServerCloseMock,
};
const startQrHttpServerMock = vi.fn(() => Promise.resolve(fakeQrServer));
vi.mock('../mcp/qr-http-server.js', () => ({
  startQrHttpServer: startQrHttpServerMock,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Synthetic scheme URL — no real deep-link host or deployment ID. */
const SYNTHETIC_SCHEME_URL = 'intoss-private://synthetic-app?_deploymentId=test-placeholder';

/** Minimal passing renderAndMaybeWait result. */
function passingWaitResult() {
  return {
    isError: false,
    content: [{ type: 'text' as const, text: 'QR rendered (synthetic)' }],
  };
}

/** Minimal passing prepareAttach result. */
function passingPrepResult() {
  return {
    ok: true as const,
    parts: {
      kind: 'scheme' as const,
      schemeUrl: SYNTHETIC_SCHEME_URL,
      wssUrl: 'wss://synthetic-placeholder',
    },
    isMatchingPage: () => true,
    buildTimeoutError: (_base: string, _sec: number) => 'timeout',
    authorityWarning: undefined,
    totpMeta: undefined,
  };
}

// Extract the attachDeps that was passed to prepareAttach.
function capturedAttachDeps(): {
  qrHttpServer?: typeof fakeQrServer;
  onAttachUrlBuilt?: (parts: unknown) => void;
  canOpenBrowser?: () => boolean;
} {
  return prepareAttachMock.mock.calls[0]?.[0] as {
    qrHttpServer?: typeof fakeQrServer;
    onAttachUrlBuilt?: (parts: unknown) => void;
    canOpenBrowser?: () => boolean;
  };
}

// Extract the getDashboardState closure passed to startQrHttpServer.
function capturedGetDashboardState(): () => {
  mode: string;
  tunnel: typeof fakeTunnelStatus;
  pages: null;
  attachUrl: string | null;
} {
  return (startQrHttpServerMock.mock.calls[0] as unknown[])[0] as () => {
    mode: string;
    tunnel: typeof fakeTunnelStatus;
    pages: null;
    attachUrl: string | null;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Import AFTER all vi.mock() calls.
const { createRelayConnectionFactory } = await import('./relay-factory.js');

describe('createRelayConnectionFactory — web-QR server (devtools#708)', () => {
  const onQrContent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    prepareAttachMock.mockResolvedValue(passingPrepResult());
    renderAndMaybeWaitMock.mockResolvedValue(passingWaitResult());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('not headless (default)', () => {
    it('starts startQrHttpServer and sets qrHttpServer on attachDeps', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      await factory.open();

      // startQrHttpServer must be called once with a getDashboardState closure
      expect(startQrHttpServerMock).toHaveBeenCalledOnce();
      const getDashboardState = capturedGetDashboardState();
      expect(typeof getDashboardState).toBe('function');

      // The qrHttpServer must be threaded into attachDeps (visible to prepareAttach)
      const deps = capturedAttachDeps();
      expect(deps?.qrHttpServer).toBe(fakeQrServer);
    });

    it('sets onAttachUrlBuilt so notifyStateChange fires when parts arrive', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      await factory.open();

      const deps = capturedAttachDeps();
      expect(typeof deps?.onAttachUrlBuilt).toBe('function');

      // Trigger it with synthetic parts — must call notifyStateChange
      const syntheticParts = {
        kind: 'scheme' as const,
        schemeUrl: SYNTHETIC_SCHEME_URL,
        wssUrl: 'wss://synthetic-placeholder',
      };
      deps?.onAttachUrlBuilt?.(syntheticParts);
      expect(qrServerNotifyMock).toHaveBeenCalledOnce();
    });

    it('writes the loopback dashboard URL to stderr (no secrets)', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      await factory.open();

      // Must print the loopback URL — port from fakeQrServer.port (49152)
      const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
      const urlLine = stderrCalls.find((s) => s.includes('QR dashboard'));
      expect(urlLine).toBeDefined();
      expect(urlLine).toContain('http://127.0.0.1:49152/');
      // Must NOT contain secrets — no 'at=', no 'wss:', no real scheme host
      expect(urlLine).not.toContain('at=');
      expect(urlLine).not.toContain('wss:');

      stderrSpy.mockRestore();
    });

    it('closes the QR server in factory.close()', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      const conn = await factory.open();
      await factory.close(conn);

      expect(qrServerCloseMock).toHaveBeenCalledOnce();
    });

    it('close() is idempotent — second call does not throw', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      const conn = await factory.open();
      await factory.close(conn);
      // Second close after qrServer is already cleared — must not throw
      await expect(factory.close(conn)).resolves.toBeUndefined();
    });
  });

  describe('headless: true', () => {
    it('still starts startQrHttpServer (server for manual open) but canOpenBrowser returns false', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
        headless: true,
      });

      await factory.open();

      // Server starts even in headless mode (user can open manually via stderr URL)
      expect(startQrHttpServerMock).toHaveBeenCalledOnce();

      // canOpenBrowser must return false (gates auto-open inside renderAndMaybeWait)
      const deps = capturedAttachDeps();
      expect(deps?.canOpenBrowser?.()).toBe(false);
    });

    it('closes QR server in close() even when headless', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
        headless: true,
      });

      const conn = await factory.open();
      await factory.close(conn);

      expect(qrServerCloseMock).toHaveBeenCalledOnce();
    });
  });

  describe('startQrHttpServer failure — graceful fallback', () => {
    it('does not crash when startQrHttpServer throws — falls back to text-QR path', async () => {
      startQrHttpServerMock.mockRejectedValueOnce(new Error('port already in use'));

      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      // open() must not throw even if the QR server fails
      await expect(factory.open()).resolves.toBeDefined();

      // qrHttpServer should be undefined (fallback) — attachDeps has no server
      const deps = capturedAttachDeps();
      expect(deps?.qrHttpServer).toBeUndefined();
    });

    it('close() is safe when no QR server was started', async () => {
      startQrHttpServerMock.mockRejectedValueOnce(new Error('boot failure'));

      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      const conn = await factory.open();
      // close() must not throw even with no server
      await expect(factory.close(conn)).resolves.toBeUndefined();
      expect(qrServerCloseMock).not.toHaveBeenCalled();
    });
  });

  describe('getDashboardState closure', () => {
    it('returns mode: relay-dev and tunnel from attachDeps.getTunnelStatus', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      await factory.open();

      const getDashboardState = capturedGetDashboardState();
      const state = getDashboardState();
      expect(state.mode).toBe('relay-dev');
      expect(state.tunnel).toEqual(fakeTunnelStatus);
      expect(state.pages).toBeNull();
      // Before onAttachUrlBuilt fires, attachUrl is null
      expect(state.attachUrl).toBeNull();
    });

    it('returns a minted attachUrl after onAttachUrlBuilt has been called', async () => {
      const factory = createRelayConnectionFactory({
        schemeUrl: SYNTHETIC_SCHEME_URL,
        onQrContent,
      });

      await factory.open();

      const getDashboardState = capturedGetDashboardState();
      const deps = capturedAttachDeps();

      // Fire the callback with synthetic parts
      const syntheticParts = {
        kind: 'scheme' as const,
        schemeUrl: SYNTHETIC_SCHEME_URL,
        wssUrl: 'wss://synthetic-placeholder',
      };
      deps?.onAttachUrlBuilt?.(syntheticParts);

      // mintAttachUrl must have been called; getDashboardState now returns non-null
      const state = getDashboardState();
      expect(mintAttachUrlMock).toHaveBeenCalled();
      expect(state.attachUrl).toBe('intoss-private://synthetic?at=placeholder');
    });
  });
});

// ── Regression guard: devtools#714 — boot-race QR fix ────────────────────────
//
// These three assertions form the regression guard for the boot-race bug where
// `open()` called `prepareAttach` before the cloudflared tunnel was up, causing
// `getDashboardState().attachUrl` to stay null and `/qr.png` to 500.
//
// The existing mock (bootRelayFamilyMock) returns `getTunnelStatus: () => ({
// up: true, wssUrl: null })` which always passes the tunnel-down guard — it
// cannot exercise the race. The tests below override the mock to simulate the
// real race: tunnel starts as down, then flips up only after the `onWssUrl`
// callback fires.

describe('createRelayConnectionFactory — boot-race regression (devtools#714)', () => {
  const onQrContent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    prepareAttachMock.mockResolvedValue(passingPrepResult());
    renderAndMaybeWaitMock.mockResolvedValue(passingWaitResult());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Assertion A (load-bearing): open() must NOT throw when the tunnel starts
  // down and only becomes up after onWssUrl fires. Before the fix, open() called
  // prepareAttach immediately while tunnel.up === false → tunnel-down guard →
  // `{ok: false}` → throw "attach preparation failed". After the fix, open()
  // awaits tunnel-ready before calling prepareAttach → tunnel.up === true →
  // prepareAttach succeeds → getDashboardState().attachUrl is non-null.
  it('Assertion A — open() resolves and attachUrl is non-null after late onWssUrl (load-bearing)', async () => {
    // Simulate the real race: tunnel is DOWN at boot time and flips UP only
    // when onWssUrl is called (mimics cloudflared coming up a few seconds later).
    let tunnelUp = false;
    // Capture the onWssUrl callback inside the mock implementation itself so we
    // don't have to race against the number of microtasks needed for open() to
    // reach the bootRelayFamily call. Using the outer closure avoids the TS2345
    // error from passing a parameterised fn to mockImplementationOnce (vi.fn()
    // infers a zero-arg return type). The cast is intentional to stay type-safe.
    let capturedOnWssUrl: ((wssUrl: string) => void) | undefined;

    (
      bootRelayFamilyMock as unknown as {
        mockImplementationOnce: (
          fn: (opts: { onWssUrl?: (wssUrl: string) => void }) => Promise<unknown>,
        ) => void;
      }
    ).mockImplementationOnce((opts) => {
      capturedOnWssUrl = opts?.onWssUrl;
      return Promise.resolve({
        connection: fakeConnection,
        stop: fakeStop,
        // Initially DOWN — tunnel not yet up.
        getTunnelStatus: () =>
          ({
            up: tunnelUp,
            wssUrl: tunnelUp ? 'wss://example.test/relay' : null,
          }) as { up: boolean; wssUrl: null },
      });
    });

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    // Fire onWssUrl asynchronously (after bootRelayFamily resolves) to simulate
    // cloudflared coming up in the background.
    const openPromise = factory.open();

    // Drain all pending microtasks until bootRelayFamily has been called and
    // capturedOnWssUrl has been set. open() queues several awaits before
    // bootRelayFamily (dynamic imports + loadRelaySecretReadOnly); we pump the
    // microtask queue with setImmediate to let those resolve first.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(capturedOnWssUrl).toBeDefined();
    tunnelUp = true;
    // Trigger the callback — this resolves the tunnelReady promise inside open().
    // SECRET-HANDLING: use a fake wss URL (no real relay host).
    capturedOnWssUrl?.('wss://example.test/relay');

    // open() must resolve (not throw "attach preparation failed").
    await expect(openPromise).resolves.toBeDefined();

    // After open() resolves, onAttachUrlBuilt should have been wired and fired
    // (prepareAttach → renderAndMaybeWait → onAttachUrlBuilt via attachDeps).
    // getDashboardState should return a non-null attachUrl via mintAttachUrl.
    const getDashboardState = capturedGetDashboardState();
    const deps = capturedAttachDeps();

    // Manually trigger onAttachUrlBuilt (simulating renderAndMaybeWait doing so)
    deps?.onAttachUrlBuilt?.({
      kind: 'scheme' as const,
      schemeUrl: SYNTHETIC_SCHEME_URL,
      wssUrl: 'wss://example.test/relay',
    });

    const state = getDashboardState();
    expect(state.attachUrl).not.toBeNull();
  });

  // Assertion B (missing wire): bootRelayFamily must be called with an onWssUrl
  // callback (not undefined). When that callback fires, notifyStateChange must
  // be called on the QR server — this is the "missing wire" the fix adds.
  it('Assertion B — bootRelayFamily receives onWssUrl and its invocation triggers notifyStateChange', async () => {
    // Capture onWssUrl inside the mock implementation (same approach as Assertion A).
    let capturedOnWssUrl: ((wssUrl: string) => void) | undefined;

    (
      bootRelayFamilyMock as unknown as {
        mockImplementationOnce: (
          fn: (opts: { onWssUrl?: (wssUrl: string) => void }) => Promise<unknown>,
        ) => void;
      }
    ).mockImplementationOnce((opts) => {
      capturedOnWssUrl = opts?.onWssUrl;
      return Promise.resolve({
        connection: fakeConnection,
        stop: fakeStop,
        getTunnelStatus: () => ({ up: true, wssUrl: null }),
      });
    });

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    await factory.open();

    // bootRelayFamily must have received a non-undefined onWssUrl.
    expect(capturedOnWssUrl).toBeDefined();

    // Firing the callback AFTER qrServer is up must trigger notifyStateChange.
    // SECRET-HANDLING: fake wss URL only.
    const notifyCallsBefore = qrServerNotifyMock.mock.calls.length;
    capturedOnWssUrl?.('wss://example.test/relay');
    expect(qrServerNotifyMock.mock.calls.length).toBeGreaterThan(notifyCallsBefore);
  });

  // Assertion C (leak): when prepareAttach fails (tunnel never comes up within
  // the timeout), qrServer.close() must be called so the loopback port listener
  // does not leak. Before the fix, only booted.stop() was called on the failure
  // path — qrServer was left open.
  it('Assertion C — qrServer.close() is called on prepareAttach failure (no listener leak)', async () => {
    // Simulate tunnel never coming up: getTunnelStatus always returns down,
    // tunnelReady promise resolves via the 15 s timeout (we use a fake timer).
    bootRelayFamilyMock.mockImplementationOnce(() =>
      Promise.resolve({
        connection: fakeConnection,
        stop: fakeStop,
        getTunnelStatus: () => ({ up: false, wssUrl: null }),
      }),
    );

    // prepareAttach returns failure (tunnel-down guard in real code; we mock it).
    prepareAttachMock.mockResolvedValueOnce({ ok: false, error: { content: [] } });

    vi.useFakeTimers();

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    // Attach a .catch() immediately so Node does not treat this as an unhandled
    // rejection while the fake timers are being advanced. The caught value is
    // verified with expect() after the timers fire.
    let caughtError: Error | undefined;
    const openPromise = factory.open().catch((e: unknown) => {
      caughtError = e instanceof Error ? e : new Error(String(e));
    });

    // Advance past the TUNNEL_BOOT_TIMEOUT_MS (15 000 ms) so the race resolves.
    await vi.advanceTimersByTimeAsync(16_000);
    await openPromise;

    // open() should have thrown with the attach preparation message.
    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch('attach preparation failed');

    // qrServer.close() must have been called — no listener leak.
    expect(qrServerCloseMock).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});
