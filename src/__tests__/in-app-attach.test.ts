/**
 * Unit tests for in-app Chii target injection (attach.ts).
 *
 * Covers:
 * - deriveTargetScriptUrl: URL transformation cases
 * - maybeAttach: gate-pass → script injected; gate-block → no injection;
 *   idempotency (calling twice → only one script element)
 * - keepAwake behavior: setScreenAwakeMode called on attach, not on block,
 *   respects noKeepAwake=1 opt-out, swallows rejection, is idempotent,
 *   and restores on beforeunload.
 * - installRelayWsObserver (issue #478): relay-origin 4401 close → one
 *   auth-expired postMessage; non-relay origins untouched; post-4401 dials
 *   fail fast without hitting the native constructor.
 * - script.onerror fetch probe (issue #478): 401 → auth-expired postMessage;
 *   anything else stays silent.
 *
 * The `maybeAttach` optional `gateResult` param is used as a testability seam
 * so tests don't need to manipulate window.location.
 *
 * The module-level `attached` flag is reset between tests by re-importing the
 * module fresh via vitest's `vi.resetModules()` in beforeEach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateResult } from '../in-app/index.js';
import {
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '../shared/relay-auth-close.js';

// ---------------------------------------------------------------------------
// @apps-in-toss/web-framework mock
// vi.mock is hoisted to the top of the file by vitest. The factory is
// re-evaluated after each vi.resetModules() so the spy instance is fresh.
// We retrieve the current spy via the dynamic import of the mocked module.
// ---------------------------------------------------------------------------
vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: true })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A gate result that should trigger attachment. */
function passResult(relayUrl = 'wss://abc.trycloudflare.com/'): GateResult {
  return { attach: true, relayUrl, deploymentId: 'test-deployment-id' };
}

/** A gate result that should block attachment. */
function blockResult(
  reason: 'host' | 'entry' | 'opt-in' | 'invalid-relay' | 'auth' = 'opt-in',
): GateResult {
  return { attach: false, reason };
}

// ---------------------------------------------------------------------------
// deriveTargetScriptUrl
// ---------------------------------------------------------------------------

describe('deriveTargetScriptUrl', () => {
  // Import once — this function is pure and stateless, no need to reset.
  let deriveTargetScriptUrl: (url: string, atCode?: string | null) => string;

  beforeEach(async () => {
    vi.resetModules();
    ({ deriveTargetScriptUrl } = await import('../in-app/attach.js'));
  });

  it('maps wss: to https: and sets pathname to /target.js', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('strips path from relay URL and replaces with /target.js', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/relay')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('preserves explicit port', () => {
    expect(deriveTargetScriptUrl('wss://h.example.com:9100/')).toBe(
      'https://h.example.com:9100/target.js',
    );
  });

  it('preserves explicit port with deep path', () => {
    expect(deriveTargetScriptUrl('wss://h.example.com:9100/some/deep/path')).toBe(
      'https://h.example.com:9100/target.js',
    );
  });

  it('drops query string from relay URL', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/?session=xyz')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('handles relay URL without path segment', () => {
    expect(deriveTargetScriptUrl('wss://relay.example.com')).toBe(
      'https://relay.example.com/target.js',
    );
  });

  // -------------------------------------------------------------------------
  // TOTP path-prefix transport (issue #466)
  // -------------------------------------------------------------------------

  it('embeds the at code as an /at/<code>/ path prefix', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/', '123456')).toBe(
      'https://abc.trycloudflare.com/at/123456/target.js',
    );
  });

  it('embeds the at code with explicit port and deep relay path', () => {
    expect(deriveTargetScriptUrl('wss://h.example.com:9100/some/deep/path', '654321')).toBe(
      'https://h.example.com:9100/at/654321/target.js',
    );
  });

  it('percent-encodes unexpected characters in the at code', () => {
    // TOTP codes are always 6 digits; this pins defense-in-depth behaviour.
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/', 'a/b')).toBe(
      'https://abc.trycloudflare.com/at/a%2Fb/target.js',
    );
  });

  it('falls back to the legacy un-prefixed URL when atCode is undefined', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('falls back to the legacy un-prefixed URL when atCode is null', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/', null)).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('falls back to the legacy un-prefixed URL when atCode is empty', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/', '')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });
});

// ---------------------------------------------------------------------------
// maybeAttach
// ---------------------------------------------------------------------------

describe('maybeAttach', () => {
  let maybeAttach: (gate?: GateResult) => void;

  // Reset the module between every test so the `attached` flag starts false.
  beforeEach(async () => {
    vi.resetModules();
    // Reset DOM
    document.head.innerHTML = '';
    ({ maybeAttach } = await import('../in-app/attach.js'));
  });

  it('appends a <script> element when gate passes', () => {
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    const scripts = document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe('https://abc.trycloudflare.com/target.js');
  });

  it('sets async on the injected script', () => {
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    const script = document.head.querySelector('script');
    expect(script?.async).toBe(true);
  });

  it('does NOT append a script when gate blocks (opt-in)', () => {
    maybeAttach(blockResult('opt-in'));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('does NOT append a script when gate blocks (entry)', () => {
    maybeAttach(blockResult('entry'));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('does NOT append a script when gate blocks (invalid-relay)', () => {
    maybeAttach(blockResult('invalid-relay'));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('is idempotent — calling twice appends only one script', () => {
    const gate = passResult('wss://abc.trycloudflare.com/');
    maybeAttach(gate);
    maybeAttach(gate);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('is idempotent even when called with different gate result objects', () => {
    // Same relay URL → same src → should still be idempotent
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('does not inject a second script if one with the same src is already in DOM', async () => {
    // Pre-insert a script manually, then import a fresh module (attached=false)
    // and call maybeAttach — it should detect the existing script and skip.
    const src = 'https://abc.trycloudflare.com/target.js';
    const existing = document.createElement('script');
    existing.src = src;
    document.head.appendChild(existing);

    vi.resetModules();
    ({ maybeAttach } = await import('../in-app/attach.js'));
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));

    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('injects target.js derived from the relay URL in the gate result', () => {
    maybeAttach(passResult('wss://relay.example.com:9100/ws'));
    const script = document.head.querySelector('script');
    expect(script?.src).toBe('https://relay.example.com:9100/target.js');
  });

  // ---------------------------------------------------------------------------
  // TOTP path-prefix transport — page URL `at` param → script src (issue #466)
  // ---------------------------------------------------------------------------

  it('forwards the page URL at param into the script src as /at/<code>/ prefix', () => {
    history.replaceState(null, '', '/?at=123456&debug=1');
    try {
      maybeAttach(passResult('wss://abc.trycloudflare.com/'));
      const script = document.head.querySelector('script');
      expect(script?.src).toBe('https://abc.trycloudflare.com/at/123456/target.js');
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('injects the legacy un-prefixed target.js when the page URL has no at param', () => {
    history.replaceState(null, '', '/?debug=1');
    try {
      maybeAttach(passResult('wss://abc.trycloudflare.com/'));
      const script = document.head.querySelector('script');
      expect(script?.src).toBe('https://abc.trycloudflare.com/target.js');
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  // ---------------------------------------------------------------------------
  // Defect 2: auth-block postMessage signal
  // ---------------------------------------------------------------------------

  it('auth block with framed window — postMessage called once with exact envelope', () => {
    // Stub window.parent to a distinct object (simulates a real parent frame).
    const postMessageSpy = vi.fn();
    const fakeParent = { postMessage: postMessageSpy };
    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      writable: true,
      configurable: true,
    });

    maybeAttach(blockResult('auth'));

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    // Deep-equal the full 2-key object — no extra keys must leak.
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'ait:debug-attach-blocked', reason: 'auth' },
      '*',
    );

    // Restore
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  it('opt-in block — postMessage NOT called (false-positive guard)', () => {
    const postMessageSpy = vi.fn();
    const fakeParent = { postMessage: postMessageSpy };
    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      writable: true,
      configurable: true,
    });

    maybeAttach(blockResult('opt-in'));

    expect(postMessageSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  it('invalid-relay block — postMessage NOT called (false-positive guard)', () => {
    const postMessageSpy = vi.fn();
    const fakeParent = { postMessage: postMessageSpy };
    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      writable: true,
      configurable: true,
    });

    maybeAttach(blockResult('invalid-relay'));

    expect(postMessageSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  it('host block — postMessage NOT called (false-positive guard)', () => {
    const postMessageSpy = vi.fn();
    const fakeParent = { postMessage: postMessageSpy };
    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      writable: true,
      configurable: true,
    });

    maybeAttach(blockResult('host'));

    expect(postMessageSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  it('entry block — postMessage NOT called (false-positive guard)', () => {
    const postMessageSpy = vi.fn();
    const fakeParent = { postMessage: postMessageSpy };
    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      writable: true,
      configurable: true,
    });

    maybeAttach(blockResult('entry'));

    expect(postMessageSpy).not.toHaveBeenCalled();

    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  it('auth block at top-level (window.parent === window) — postMessage NOT called', () => {
    // Default jsdom environment already has window.parent === window, but
    // be explicit to document the intent.
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
    const postMessageSpy = vi.spyOn(window, 'postMessage');

    maybeAttach(blockResult('auth'));

    expect(postMessageSpy).not.toHaveBeenCalled();

    postMessageSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// keepAwake behavior
// ---------------------------------------------------------------------------

describe('keepAwake behavior', () => {
  let maybeAttach: (gate?: GateResult) => void;
  let setScreenAwakeMode: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    document.head.innerHTML = '';
    // Re-import both the mocked framework and attach after resetting modules
    // so the fresh spy instance is captured.
    const framework = await import('@apps-in-toss/web-framework');
    setScreenAwakeMode = framework.setScreenAwakeMode as ReturnType<typeof vi.fn>;
    setScreenAwakeMode.mockClear();
    setScreenAwakeMode.mockResolvedValue({ enabled: true });
    ({ maybeAttach } = await import('../in-app/attach.js'));
  });

  it('calls setScreenAwakeMode({ enabled: true }) when gate passes', async () => {
    maybeAttach(passResult());
    await vi.waitFor(() => expect(setScreenAwakeMode).toHaveBeenCalledWith({ enabled: true }));
  });

  it('does NOT call setScreenAwakeMode when gate blocks', async () => {
    maybeAttach(blockResult('opt-in'));
    // Flush microtasks — should stay uncalled
    await Promise.resolve();
    expect(setScreenAwakeMode).not.toHaveBeenCalled();
  });

  it('does NOT call setScreenAwakeMode when noKeepAwake=1 is in search params', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?noKeepAwake=1' },
      writable: true,
      configurable: true,
    });
    maybeAttach(passResult());
    await Promise.resolve();
    expect(setScreenAwakeMode).not.toHaveBeenCalled();
    // Restore
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '' },
      writable: true,
      configurable: true,
    });
  });

  it('swallows rejection — no unhandled rejection and maybeAttach does not throw', async () => {
    setScreenAwakeMode.mockRejectedValue(new Error('platform unsupported'));
    expect(() => maybeAttach(passResult())).not.toThrow();
    // Flush promise chain — rejection must be swallowed
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('is idempotent — setScreenAwakeMode called only once even if maybeAttach called twice', async () => {
    const gate = passResult();
    maybeAttach(gate);
    maybeAttach(gate);
    await vi.waitFor(() => expect(setScreenAwakeMode).toHaveBeenCalledTimes(1));
  });

  it('calls setScreenAwakeMode({ enabled: false }) when beforeunload fires after successful attach', async () => {
    maybeAttach(passResult());
    // Wait for the enabled:true call and the beforeunload registration
    await vi.waitFor(() => expect(setScreenAwakeMode).toHaveBeenCalledWith({ enabled: true }));
    // Dispatch beforeunload — the handler must call setScreenAwakeMode({ enabled: false })
    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => expect(setScreenAwakeMode).toHaveBeenCalledWith({ enabled: false }));
  });
});

// ---------------------------------------------------------------------------
// installRelayWsObserver (issue #478)
// ---------------------------------------------------------------------------

/**
 * Recording WebSocket stand-in. The observer wraps whatever window.WebSocket
 * is at install time, so installing this first lets tests see exactly which
 * dials reach the "native" constructor.
 */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  onclose: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }
  close(): void {}
  send(): void {}
}

/** Builds a close event carrying `code` (CloseEvent with an Event fallback). */
function closeEventWithCode(code: number): Event {
  try {
    return new CloseEvent('close', { code });
  } catch {
    return Object.assign(new Event('close'), { code });
  }
}

describe('installRelayWsObserver', () => {
  const RELAY_URL = 'wss://relay.example.com/';
  let installRelayWsObserver: (relayUrl: string) => void;
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let originalWebSocket: typeof WebSocket | undefined;

  beforeEach(async () => {
    vi.resetModules();
    FakeWebSocket.instances.length = 0;
    // The observer PATCHES window.WebSocket and a module reset does not undo
    // that — save/restore around every test so wrappers never leak across.
    originalWebSocket = window.WebSocket;
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    // Framed page: postMessage requires window.parent !== window.
    postMessageSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      writable: true,
      configurable: true,
    });
    ({ installRelayWsObserver } = await import('../in-app/attach.js'));
  });

  afterEach(() => {
    window.WebSocket = originalWebSocket as typeof WebSocket;
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  it('posts auth-expired ONCE (exact envelope) when a relay-origin socket closes 4401', () => {
    installRelayWsObserver(RELAY_URL);
    const ws = new window.WebSocket('wss://relay.example.com/at/123456/target/abc');

    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));
    // Dedupe: a second 4401 must not produce a second message.
    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'ait:debug-attach-blocked', reason: 'auth-expired' },
      '*',
    );
  });

  it('matches the relay origin across the wss:/https: scheme pair (script-src derived dials)', () => {
    // target.js derives its dial from the https:// script src — the observer
    // must treat both schemes as the same origin key.
    installRelayWsObserver(RELAY_URL);
    const ws = new window.WebSocket('https://relay.example.com/at/123456/target/abc');

    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves non-relay-origin sockets untouched (app traffic is never observed)', () => {
    installRelayWsObserver(RELAY_URL);
    const ws = new window.WebSocket('wss://api.app.example.com/live');

    expect(ws).toBeInstanceOf(FakeWebSocket);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Even a 4401-coded close on foreign traffic must not trigger the signal.
    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('ignores non-4401 relay closes (tunnel drop stays silent, dials stay native)', () => {
    installRelayWsObserver(RELAY_URL);
    const ws = new window.WebSocket('wss://relay.example.com/target/abc');

    ws.dispatchEvent(closeEventWithCode(1006));

    expect(postMessageSpy).not.toHaveBeenCalled();
    // The expired flag must not have flipped — the next dial is still native.
    const next = new window.WebSocket('wss://relay.example.com/target/abc');
    expect(next).toBeInstanceOf(FakeWebSocket);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('fail-fasts relay-origin dials after a 4401 (retry-storm cutoff)', async () => {
    installRelayWsObserver(RELAY_URL);
    const first = new window.WebSocket('wss://relay.example.com/at/111111/target/abc');
    first.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));

    const retry = new window.WebSocket('wss://relay.example.com/at/111111/target/abc');

    // The dummy never touches the native constructor and is born CLOSED.
    expect(retry).not.toBeInstanceOf(FakeWebSocket);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(retry.readyState).toBe(3);

    // It still completes the close contract asynchronously so reconnect
    // schedulers (property handler or listener) observe a terminal 4401.
    const closes: Array<{ code: number; reason: string }> = [];
    retry.addEventListener('close', (ev) => {
      const close = ev as CloseEvent;
      closes.push({ code: close.code, reason: close.reason });
    });
    await vi.waitFor(() =>
      expect(closes).toEqual([
        { code: RELAY_AUTH_REJECT_CLOSE_CODE, reason: RELAY_AUTH_REJECT_REASON },
      ]),
    );

    // Non-relay origins keep constructing natively even in the expired state.
    const foreign = new window.WebSocket('wss://api.app.example.com/live');
    expect(foreign).toBeInstanceOf(FakeWebSocket);
  });

  it('is idempotent — a second install keeps the same wrapper', () => {
    installRelayWsObserver(RELAY_URL);
    const wrapped = window.WebSocket;
    installRelayWsObserver(RELAY_URL);
    expect(window.WebSocket).toBe(wrapped);
  });
});

// ---------------------------------------------------------------------------
// script.onerror fetch probe (issue #478)
// ---------------------------------------------------------------------------

describe('script.onerror fetch probe', () => {
  let maybeAttach: (gate?: GateResult) => void;
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalWebSocket: typeof WebSocket | undefined;

  beforeEach(async () => {
    vi.resetModules();
    document.head.innerHTML = '';
    // maybeAttach also installs the WS observer — save/restore the patch.
    originalWebSocket = window.WebSocket;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    postMessageSpy = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      writable: true,
      configurable: true,
    });
    ({ maybeAttach } = await import('../in-app/attach.js'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.WebSocket = originalWebSocket as typeof WebSocket;
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  });

  /** Injects the script via maybeAttach and fires its error event. */
  function injectAndFailScript(): HTMLScriptElement {
    maybeAttach(passResult('wss://relay.example.com/'));
    const script = document.head.querySelector('script');
    if (script === null) throw new Error('script was not injected');
    script.dispatchEvent(new Event('error'));
    return script;
  }

  it('posts auth-expired when the probe of the script URL returns 401', async () => {
    fetchMock.mockResolvedValue({ status: 401 });

    const script = injectAndFailScript();

    await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalledTimes(1));
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'ait:debug-attach-blocked', reason: 'auth-expired' },
      '*',
    );
    // The probe re-fetches exactly the injected script URL.
    expect(fetchMock).toHaveBeenCalledWith(script.src);
  });

  it('stays silent when the probe returns a non-401 status (tunnel error page)', async () => {
    fetchMock.mockResolvedValue({ status: 502 });

    injectAndFailScript();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('stays silent when the probe itself fails (network down — pre-#478 behaviour)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));

    injectAndFailScript();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
