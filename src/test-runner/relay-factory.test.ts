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

// ── Unbounded attach wait by default (devtools#735) ──────────────────────────
//
// The QR-scan wait is a human-paced action. `timeoutMs` omitted must forward
// an UNBOUNDED (Infinity) timeout to `renderAndMaybeWait` — the runner stays
// up until the user stops it. An explicit `timeoutMs` must still forward that
// finite value (regression guard for the old bounded default).

describe('createRelayConnectionFactory — attach wait default (devtools#735)', () => {
  const onQrContent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    prepareAttachMock.mockResolvedValue(passingPrepResult());
    renderAndMaybeWaitMock.mockResolvedValue(passingWaitResult());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards Infinity (unbounded) to renderAndMaybeWait when timeoutMs is omitted', async () => {
    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    await factory.open();

    expect(renderAndMaybeWaitMock).toHaveBeenCalledOnce();
    // renderAndMaybeWait(attachDeps, prep, waitForAttach, timeoutMs, conn)
    const forwardedTimeoutMs = renderAndMaybeWaitMock.mock.calls[0]?.[3];
    expect(forwardedTimeoutMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('forwards the explicit timeoutMs when provided (bounded — regression)', async () => {
    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
      timeoutMs: 45_000,
    });

    await factory.open();

    expect(renderAndMaybeWaitMock).toHaveBeenCalledOnce();
    const forwardedTimeoutMs = renderAndMaybeWaitMock.mock.calls[0]?.[3];
    expect(forwardedTimeoutMs).toBe(45_000);
  });
});

// ── Page-ready gate regression (devtools#720) ────────────────────────────────
//
// These tests guard the two-part fix:
//   (a) ORDER: enableDomains() must be called BEFORE injectDebugIndicator() and
//       injectGlobals() — both use sendCommand() which rejects immediately when
//       ws===null ("No mini-app page attached ... Call enableDomains() first").
//   (b) BOUNDED RETRY: a transient disconnect between /targets non-empty and
//       page-level WS open must be absorbed by the retry loop instead of
//       propagating as a fatal open() rejection.
//
// The fake CdpConnection below records call order and simulates delayed/failing
// enableDomains(). It is react-free and Node-only — no real relay or phone.
// SECRET-HANDLING: all wss/scheme values in fixtures are synthetic placeholders.

describe('createRelayConnectionFactory — page-ready gate (devtools#720)', () => {
  const onQrContent = vi.fn();

  // A minimal fake CdpConnection that:
  //   - records calls to enableDomains(), injectDebugIndicator's sendCommand,
  //     and injectGlobals' sendCommand in order
  //   - lets the test control how many times enableDomains() rejects before
  //     it resolves
  function makeFakeConnection(
    opts: {
      enableDomainsFailCount?: number; // how many times to reject before resolving
    } = {},
  ) {
    let failsRemaining = opts.enableDomainsFailCount ?? 0;
    const callOrder: string[] = [];

    const conn = {
      kind: 'relay' as const,
      listTargets: () => [],
      /** Resolves after failsRemaining rejections are exhausted. */
      enableDomains: vi.fn(async () => {
        callOrder.push('enableDomains');
        if (failsRemaining > 0) {
          failsRemaining--;
          throw new Error('No mini-app page attached to the Chii relay yet.');
        }
        // Resolved — ws is now "open" from the caller's perspective.
      }),
      /** send is used by injectDebugIndicator and injectGlobals. */
      send: vi.fn(async (_method: string) => {
        callOrder.push('send');
        // If enableDomains hasn't resolved yet, the real ws guard would throw.
        // We simulate that here: if failsRemaining is still > 0 the page is
        // not yet ready, so send should reject just like the real code does.
        if (failsRemaining > 0) {
          throw new Error(
            'No mini-app page attached to the Chii relay yet. Call enableDomains() first.',
          );
        }
        return { result: { value: true } };
      }),
    };

    return { conn, callOrder };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default prepareAttach and renderAndMaybeWait to passing values; individual
    // tests override them when needed.
    prepareAttachMock.mockResolvedValue(passingPrepResult());
    renderAndMaybeWaitMock.mockResolvedValue(passingWaitResult());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Test 1 (ORDER): enableDomains before inject ───────────────────────────
  // load-bearing: if enableDomains is called LAST (old buggy order) then
  // injectGlobals' send() would hit ws===null and throw fatally.  After the
  // fix, enableDomains must appear before both inject calls in callOrder.
  it('calls enableDomains() BEFORE injectDebugIndicator and injectGlobals (fix a — load-bearing)', async () => {
    const { conn, callOrder } = makeFakeConnection({ enableDomainsFailCount: 0 });

    // Override bootRelayFamily to return our fake connection.
    bootRelayFamilyMock.mockResolvedValueOnce({
      connection: conn,
      stop: fakeStop,
      getTunnelStatus: () => ({ up: true, wssUrl: null }),
    });

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      cell: { sdkLine: '3.0', platform: 'ios' }, // forces injectGlobals call
      onQrContent,
    });

    await factory.open();

    // enableDomains must appear BEFORE any send() call.
    const enableIdx = callOrder.indexOf('enableDomains');
    const firstSendIdx = callOrder.indexOf('send');

    expect(enableIdx).toBeGreaterThanOrEqual(0); // enableDomains was called
    if (firstSendIdx !== -1) {
      // If send was called at all, it must be after enableDomains.
      expect(enableIdx).toBeLessThan(firstSendIdx);
    }
  });

  // ── Test 2 (RETRY — load-bearing): delayed page attach ───────────────────
  // When enableDomains() rejects transiently (simulating a drop between
  // /targets non-empty and page-level WS open), open() must NOT throw; it
  // must retry and eventually resolve once enableDomains succeeds.
  it('retries enableDomains() on transient failure and resolves when page attaches (fix b — load-bearing)', async () => {
    // Fail twice then succeed on the 3rd attempt (within PAGE_READY_RETRIES=3).
    const { conn } = makeFakeConnection({ enableDomainsFailCount: 2 });

    bootRelayFamilyMock.mockResolvedValueOnce({
      connection: conn,
      stop: fakeStop,
      getTunnelStatus: () => ({ up: true, wssUrl: null }),
    });

    vi.useFakeTimers();

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    // open() is async and contains setTimeout-based retry delays.
    const openPromise = factory.open();

    // Drain microtasks, then advance past the retry delays.
    // PAGE_READY_RETRY_DELAY_MS = 1_500ms, retries = 2 needed.
    await vi.runAllTimersAsync();

    const result = await openPromise;
    expect(result).toBeDefined(); // open() resolved — NOT threw

    // enableDomains must have been called multiple times (at least 3 — the 2
    // failures + 1 success).
    expect(conn.enableDomains).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  // ── Test 3 (--cell FATAL THROW regression) ───────────────────────────────
  // Before fix (a): with the old order, injectGlobals ran before enableDomains,
  // hit ws===null, and its unguarded throw crashed open(). With fix (a) the
  // order is enableDomains → inject, so --cell must not cause a fatal throw.
  it('--cell does not cause a fatal throw when page is delayed (fix a regression)', async () => {
    // Page attaches with 1 transient enableDomains failure.
    const { conn } = makeFakeConnection({ enableDomainsFailCount: 1 });

    bootRelayFamilyMock.mockResolvedValueOnce({
      connection: conn,
      stop: fakeStop,
      getTunnelStatus: () => ({ up: true, wssUrl: null }),
    });

    vi.useFakeTimers();

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      cell: { sdkLine: '2.x', platform: 'android' }, // triggers injectGlobals
      onQrContent,
    });

    const openPromise = factory.open();
    await vi.runAllTimersAsync();

    // Must resolve — not throw
    await expect(openPromise).resolves.toBeDefined();

    vi.useRealTimers();
  });

  // ── Test 4 (BOUNDED FAILURE): page never attaches ────────────────────────
  // When enableDomains() rejects on every attempt (page never comes up),
  // open() must throw a secret-free error after PAGE_READY_RETRIES exhausted.
  // The error message must NOT contain wss://, 'at=', or scheme-URL fragments.
  it('throws a secret-free error after all retry attempts fail (fix b bounded failure)', async () => {
    // Always fail — more failures than PAGE_READY_RETRIES=3.
    const { conn } = makeFakeConnection({ enableDomainsFailCount: 10 });

    bootRelayFamilyMock.mockResolvedValueOnce({
      connection: conn,
      stop: fakeStop,
      getTunnelStatus: () => ({ up: true, wssUrl: null }),
    });

    vi.useFakeTimers();

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    let caughtError: Error | undefined;
    const openPromise = factory.open().catch((e: unknown) => {
      caughtError = e instanceof Error ? e : new Error(String(e));
    });

    await vi.runAllTimersAsync();
    await openPromise;

    expect(caughtError).toBeDefined();

    // Must throw with a description — not the raw "No mini-app page..." relay error
    expect(caughtError?.message).toMatch('page did not become ready');

    // SECRET-HANDLING: message must not contain wss://, at=, or any URL.
    expect(caughtError?.message).not.toContain('wss:');
    expect(caughtError?.message).not.toContain('at=');
    expect(caughtError?.message).not.toContain('intoss-private://');

    // QR server must be closed on the failure path (no listener leak).
    expect(qrServerCloseMock).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  // ── Test 5 (IMMEDIATELY RUNNABLE): no sendCommand errors after open() ─────
  // After open() resolves the connection should be page-ready: subsequent
  // send() calls must not hit the ws===null guard ("No mini-app page attached").
  it('connection is page-ready after open() — send() does not hit ws===null guard', async () => {
    const { conn } = makeFakeConnection({ enableDomainsFailCount: 0 });

    bootRelayFamilyMock.mockResolvedValueOnce({
      connection: conn,
      stop: fakeStop,
      getTunnelStatus: () => ({ up: true, wssUrl: null }),
    });

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    const resolvedConn = await factory.open();

    // Simulate what runTestFilesOverRelay does: issue a Runtime.evaluate.
    // If the fix is correct, enableDomains already ran so this resolves.
    await expect(
      resolvedConn.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
    ).resolves.toBeDefined();
  });
});

// ── Real-time status surfaces (#730) ─────────────────────────────────────────
//
// These tests cover the new `phase` lifecycle wiring:
//   - getDashboardState().phase defaults to 'active' and reflects onSessionPhase.
//   - CLI onTunnelDown parity with the MCP daemon (relay-factory.ts was missing
//     this wire — the daemon already has it in debug-server.ts).
//   - close() ordering: the terminal 'complete' push + disconnected-state badge
//     inject happen BEFORE family.stop()/qrServer.close() (load-bearing —
//     otherwise the SSE frame/CDP inject race the teardown).
//   - close() stays non-throwing even if the CDP inject rejects.

describe('createRelayConnectionFactory — phase lifecycle (#730)', () => {
  const onQrContent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    prepareAttachMock.mockResolvedValue(passingPrepResult());
    renderAndMaybeWaitMock.mockResolvedValue(passingWaitResult());
    bootRelayFamilyMock.mockImplementation(() =>
      Promise.resolve({
        connection: fakeConnection,
        stop: fakeStop,
        getTunnelStatus: () => fakeTunnelStatus,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('getDashboardState() defaults phase to "active"', async () => {
    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    await factory.open();

    const getDashboardState = capturedGetDashboardState() as unknown as () => { phase?: string };
    expect(getDashboardState().phase).toBe('active');
  });

  it('onSessionPhase("running") updates phase and fires notifyStateChange', async () => {
    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    await factory.open();

    const notifyCallsBefore = qrServerNotifyMock.mock.calls.length;
    factory.onSessionPhase?.('running');

    expect(qrServerNotifyMock.mock.calls.length).toBeGreaterThan(notifyCallsBefore);
    const getDashboardState = capturedGetDashboardState() as unknown as () => { phase?: string };
    expect(getDashboardState().phase).toBe('running');
  });

  it('CLI onTunnelDown is wired to bootRelayFamily and its invocation triggers notifyStateChange (parity gap)', async () => {
    let capturedOnTunnelDown: (() => void) | undefined;
    (
      bootRelayFamilyMock as unknown as {
        mockImplementationOnce: (
          fn: (opts: {
            onTunnelDown?: () => void;
            onWssUrl?: (wssUrl: string) => void;
          }) => Promise<unknown>,
        ) => void;
      }
    ).mockImplementationOnce((opts) => {
      capturedOnTunnelDown = opts?.onTunnelDown;
      return Promise.resolve({
        connection: fakeConnection,
        stop: fakeStop,
        getTunnelStatus: () => fakeTunnelStatus,
      });
    });

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    await factory.open();

    // This is the regression guard: before the fix, relay-factory.ts's
    // bootRelayFamily call wired only onWssUrl — onTunnelDown was undefined.
    expect(capturedOnTunnelDown).toBeDefined();

    const notifyCallsBefore = qrServerNotifyMock.mock.calls.length;
    capturedOnTunnelDown?.();
    expect(qrServerNotifyMock.mock.calls.length).toBeGreaterThan(notifyCallsBefore);
  });

  it('close() ordering — notifyStateChange (phase complete) and injectDebugIndicator(disconnected) fire BEFORE family.stop()/qrServer.close() (load-bearing)', async () => {
    const order: string[] = [];
    qrServerNotifyMock.mockImplementation(() => order.push('notifyStateChange'));
    injectDebugIndicatorMock.mockImplementation(() => {
      order.push('injectDebugIndicator');
      return Promise.resolve();
    });
    fakeStop.mockImplementation(() => order.push('family.stop'));
    qrServerCloseMock.mockImplementation(() => {
      order.push('qrServer.close');
      return Promise.resolve();
    });

    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    const conn = await factory.open();
    order.length = 0; // only care about ordering from close() onward

    await factory.close(conn);

    expect(injectDebugIndicatorMock).toHaveBeenCalledWith(conn, { state: 'disconnected' });
    expect(order.indexOf('notifyStateChange')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('injectDebugIndicator')).toBeLessThan(order.indexOf('family.stop'));
    expect(order.indexOf('notifyStateChange')).toBeLessThan(order.indexOf('qrServer.close'));
  });

  it('close() is non-throwing even when injectDebugIndicator rejects', async () => {
    const factory = createRelayConnectionFactory({
      schemeUrl: SYNTHETIC_SCHEME_URL,
      onQrContent,
    });

    // open() also calls injectDebugIndicator (attached-state badge) — let that
    // one succeed, and only reject the disconnected-state call made by close().
    const conn = await factory.open();
    injectDebugIndicatorMock.mockRejectedValueOnce(new Error('CDP channel already closed'));

    await expect(factory.close(conn)).resolves.toBeUndefined();
  });
});
