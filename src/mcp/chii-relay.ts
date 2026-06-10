/**
 * Boots the local Chii relay server.
 *
 * Chii (liriliri/chii) is a chobitsu-based CDP relay that lets non-Chrome
 * WebViews (iOS WKWebView / Android WebView — i.e. the Toss app) expose CDP.
 * The relay accepts a `target` websocket from the phone's injected `target.js`
 * and `client` websockets from CDP frontends (our MCP connection).
 *
 * Node-only: `chii` pulls in Koa + ws. Never bundled into the browser/in-app
 * entries.
 *
 * TOTP auth (relay-side, authoritative gate):
 *   When `verifyAuth` is provided, this module gates both inbound surfaces:
 *
 *   - HTTP 'request': a listener registered BEFORE `chii.start({server})`.
 *     Node's `http.Server` calls listeners in registration order; the first
 *     to call `res.end()` wins. Invalid auth → 401 + CORS header + a tiny
 *     JSON body (`{"error":"totp-rejected"}`) so a cross-origin script
 *     `fetch()` probe can READ the status (issue #478). Valid auth → return
 *     without side-effect (chii's Koa handler serves it).
 *
 *   - WS 'upgrade': after `chii.start()` has registered chii's own upgrade
 *     listener, we take over the upgrade chain (remove chii's listeners,
 *     re-dispatch manually). Invalid auth → accept-then-close: complete the
 *     handshake via a `noServer` WebSocketServer, then immediately close
 *     with code 4401 reason 'totp-rejected' (issue #478). A raw 401 +
 *     `socket.destroy()` only ever surfaced as close code 1006 in the
 *     browser — indistinguishable from a tunnel failure, which left the
 *     env-2 phone UI silent. The explicit dispatch (not listener ordering)
 *     is what keeps chii away from rejected sockets: accept-then-close
 *     leaves the socket alive, so an order-based early-return would let
 *     chii's later listener complete a SECOND handshake on the same socket
 *     — an auth bypass. Valid auth → forward to chii's captured listeners.
 *
 * TOTP code transports (issue #466) — two equivalent ways to carry the code:
 *   1. Query param `at=<code>` — used by the daemon-side `/client` connection
 *      (`chii-connection.ts` appends it; it holds the secret).
 *   2. Path prefix `/at/<code>/…` — used by the phone-side target. Chii's
 *      stock `target.js` derives its WS endpoint from the script `src`
 *      (`scriptEl.src.replace('target.js','')`), so the only way for the
 *      phone to carry a code is to embed it in the script URL path. The
 *      in-app attach injects `https://<host>/at/<code>/target.js`; both the
 *      script fetch and the derived `wss://<host>/at/<code>/target/<id>` WS
 *      dial then carry the prefix. The listeners below rewrite the prefix
 *      into the query form (`rewriteAtPathPrefix`) and MUTATE `req.url`
 *      before chii's own handlers (registered later) parse it — chii only
 *      ever sees the stripped URL.
 *
 * Threat model: "URL leak" — someone obtains the tunnel URL (Slack paste, QR
 *   screenshot, shoulder-surfing) but does not have the shared TOTP secret.
 *   Rotating 6-digit code makes the URL stale after 30 s.
 *   A determined attacker who extracts the secret from the dogfood bundle can
 *   still compute valid codes; that is out of scope (see umbrella CLAUDE.md §4).
 *
 * SECRET-HANDLING: The secret value and computed TOTP codes MUST NOT appear
 *   in any log, error message, or process output. `verifyAuth` is a black-box
 *   predicate from the caller's perspective; this module only forwards pass/fail.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
// `ws` is a direct dependency of this package (NOT a transitive reach into
// chii's tree — same principle as the ajv incident): the reject path below
// needs `WebSocketServer.handleUpgrade` to complete a handshake we are about
// to close with a named code.
import { type WebSocket, WebSocketServer } from 'ws';
import {
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '../shared/relay-auth-close.js';

const require = createRequire(import.meta.url);

/**
 * WS keepalive ping interval (ms).
 *
 * Cloudflare proxied connections are dropped after ~100 s of no traffic.
 * 45 s comfortably fits inside that window and lets both the phone-target leg
 * and the daemon-client leg survive idle CDP sessions.
 */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 45_000;

/**
 * Minimal shape of chii's internal WebSocketServer instance.
 *
 * `chii/server/lib/WebSocketServer` holds the real `ws.Server` in `_wss`.
 * `_wss.clients` is the standard `Set<WebSocket>` tracking all live sockets.
 * We access this to ping every connected socket — no chii internals beyond
 * this single field are touched.
 */
interface ChiiInternalWss {
  _wss: { clients: Set<WebSocket> };
  start(server: import('node:http').Server): void;
}

/**
 * Loads chii's internal WebSocketServer class and returns it together with a
 * flag indicating whether the real class was found.
 *
 * Returns `null` if the internal path is not resolvable (future chii release
 * changes the layout) — callers skip keepalive gracefully.
 */
function tryLoadChiiWssClass(): (new () => ChiiInternalWss) | null {
  try {
    const mod: unknown = require('chii/server/lib/WebSocketServer');
    if (typeof mod === 'function') {
      return mod as new () => ChiiInternalWss;
    }
  } catch {
    // Module not found or shape changed — keepalive will be skipped.
  }
  return null;
}

/**
 * Calls `chii.start()` and returns the chii `WebSocketServer` instance that
 * was constructed during the call.
 *
 * How: `chii/server/index.js`'s `start()` creates `new WebSocketServer()`
 * where `WebSocketServer` is captured from `require('./lib/WebSocketServer')`
 * at module load time. The class reference is stable, so we can temporarily
 * patch `ChiiWssClass.prototype.start` — which runs *on the instance* —
 * to record `this` before the original `start` runs.
 *
 * The patch is installed before `chii.start()` and removed (via `finally`)
 * immediately after, so concurrent `startChiiRelay` calls nest correctly: each
 * call's patch overrides the previous in the prototype chain for the duration
 * of its own `chii.start()` call, restoring the prior descriptor on exit.
 *
 * If `ChiiWssClass` is null (internal path changed in a future chii release),
 * `chii.start()` runs unpatched and the function returns null — callers skip
 * keepalive gracefully without affecting relay correctness.
 */
async function startChiiWithCapture(
  chii: ChiiServerModule,
  startOptions: Parameters<ChiiServerModule['start']>[0],
  ChiiWssClass: (new () => ChiiInternalWss) | null,
): Promise<ChiiInternalWss | null> {
  if (ChiiWssClass === null) {
    await chii.start(startOptions);
    return null;
  }

  let captured: ChiiInternalWss | null = null;
  const proto = ChiiWssClass.prototype as ChiiInternalWss;
  const originalStart = proto.start;

  proto.start = function (this: ChiiInternalWss, server) {
    captured = this;
    return originalStart.call(this, server);
  };

  try {
    await chii.start(startOptions);
  } finally {
    // Always restore — even if chii.start() throws.
    proto.start = originalStart;
  }

  return captured;
}

/** `chii/server` is CommonJS and shipped without TypeScript types. */
interface ChiiServerModule {
  start(options: {
    port?: number;
    host?: string;
    domain?: string;
    server?: Server;
    basePath?: string;
  }): Promise<void>;
}

function loadChiiServer(): ChiiServerModule {
  // `chii`'s package `main` is `./server/index.js`, exposing `{ start }`.
  const mod: unknown = require('chii');
  if (
    typeof mod === 'object' &&
    mod !== null &&
    'start' in mod &&
    typeof (mod as { start: unknown }).start === 'function'
  ) {
    return mod as ChiiServerModule;
  }
  throw new Error('chii server module did not expose start()');
}

export interface ChiiRelay {
  port: number;
  /** Base URL for the relay HTTP/WS server, e.g. `http://127.0.0.1:54321`. */
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Secret-free metadata about a single auth rejection (issue #467).
 *
 * SECRET-HANDLING: this event carries ONLY the surface kind. It must never
 * grow fields for `req.url`, query strings, codes, or secrets — observers
 * (diagnostics counters, console hints) only need "a rejection happened".
 */
export interface RelayAuthRejectEvent {
  /** Which inbound surface was rejected. */
  kind: 'ws-upgrade' | 'http-request';
}

/**
 * Rewrites a `/at/<code>/…` path-prefixed request URL into the equivalent
 * query-based form, e.g.:
 *
 *   `/at/123456/target.js`        → `/target.js?at=123456`
 *   `/at/123456/target/x?url=u`   → `/target/x?url=u&at=123456`
 *   `/at/123456/`                 → `/?at=123456`
 *
 * Returns `null` when the URL does not carry the prefix (including an empty
 * code segment) — callers fall back to the unmodified URL and the existing
 * query-based auth path.
 *
 * Pure string surgery — this function knows nothing about secrets or code
 * validity; verification stays inside the caller-provided `verifyAuth`
 * predicate (which parses the query). The raw path segment is appended
 * verbatim to the query: both path segments and query values are
 * percent-decoded exactly once by their consumers, so no re-encoding is
 * needed (TOTP codes are 6 digits and never percent-encoded in practice).
 */
export function rewriteAtPathPrefix(rawUrl: string): string | null {
  const match = /^\/at\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(rawUrl);
  if (match === null) return null;
  const code = match[1];
  const path = match[2] === undefined || match[2] === '' ? '/' : match[2];
  const query = match[3] ?? '';
  const separator = query === '' ? '?' : '&';
  return `${path}${query}${separator}at=${code}`;
}

export interface StartChiiRelayOptions {
  /**
   * Local port for the relay. Default 0 (OS-assigned ephemeral port).
   *
   * Using 0 means the OS picks a free port — this is the safe default because
   * a stale cloudflared child process (PPID 1, orphaned after SIGKILL) may still
   * be holding a fixed port. A fixed port causes EADDRINUSE on the next startup,
   * which makes the MCP handshake fail with -32000. With port 0 the new relay
   * always gets a fresh port, making any orphaned process harmless.
   *
   * Pass an explicit number to restore fixed-port behaviour (backwards-compatible).
   */
  port?: number;
  /** Bind host. Default 127.0.0.1 (tunnel reaches it locally). */
  host?: string;
  /**
   * Optional auth predicate for WebSocket upgrade requests.
   *
   * When provided, every inbound WebSocket upgrade is checked by calling
   * `verifyAuth(req)` before Chii processes it. Return `true` to allow the
   * upgrade; return `false` to reject with HTTP 401 and destroy the socket.
   *
   * The predicate MUST NOT log the secret or any TOTP code — it is a black-box
   * from this module's perspective.
   *
   * @param req - The raw HTTP `IncomingMessage` from the upgrade handshake.
   *   Inspect `req.url` for query parameters (e.g. `at=<code>`). Path-prefixed
   *   URLs (`/at/<code>/…`, the phone-target transport — issue #466) are
   *   rewritten into the query form BEFORE this predicate runs, so a
   *   query-only predicate covers both transports.
   * @returns `true` if the upgrade is authorised, `false` to reject.
   */
  verifyAuth?: (req: IncomingMessage) => boolean;
  /**
   * Secret-free observability callback fired on every auth rejection
   * (issue #467). Only meaningful together with `verifyAuth`.
   *
   * SECRET-HANDLING: the event carries ONLY the rejection kind — never
   * `req.url`, query strings, TOTP codes, or the secret. Implementations must
   * keep it that way (e.g. increment a counter + timestamp). Exceptions thrown
   * by the callback are swallowed so observability can never break the gate.
   */
  onAuthReject?: (event: RelayAuthRejectEvent) => void;
  /**
   * WS protocol ping interval in milliseconds (issue #483).
   *
   * The relay sends a ping frame to every connected WebSocket at this interval
   * so that Cloudflare's proxied-connection idle timer (~100 s) is reset for
   * both the phone-target leg and the daemon-client leg. The peer responds with
   * a pong automatically (browser / ws library behaviour) — no application
   * code change is needed on either end.
   *
   * Default: 45 000 ms (45 s). Set to 0 to disable keepalive entirely.
   *
   * Pass a small value in tests to avoid real-time waits — pair with fake
   * timers (`vi.useFakeTimers()`) or a short sleep.
   */
  keepaliveIntervalMs?: number;
}

/**
 * Starts the Chii relay and resolves once listening.
 *
 * Default port is 0 (OS-assigned). With port 0 the OS picks a free ephemeral
 * port on every start, so a stale cloudflared orphan holding any particular
 * port cannot cause EADDRINUSE. The resolved `ChiiRelay.port` and `baseUrl`
 * always reflect the actual bound port.
 *
 * chii.start() is called with `server` (our pre-created httpServer) BEFORE
 * httpServer.listen(). This is intentional: chii attaches its Koa handler and
 * WS upgrade listener to the server object, but the actual TCP bind is
 * performed by our httpServer.listen() call below. The `port`/`domain` values
 * passed to chii.start() are used for display/banner purposes inside chii and
 * do not affect which port the server binds. The connection path (clients
 * connecting to `relay.baseUrl`) always uses the post-listen confirmed port.
 */
export async function startChiiRelay(options: StartChiiRelayOptions = {}): Promise<ChiiRelay> {
  const requestedPort = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';
  const { verifyAuth, onAuthReject } = options;
  const keepaliveIntervalMs =
    options.keepaliveIntervalMs !== undefined
      ? options.keepaliveIntervalMs
      : DEFAULT_KEEPALIVE_INTERVAL_MS;

  const httpServer = createServer();

  // Secret-free observability hook (issue #467). Swallow callback exceptions —
  // a broken observer must never turn into an open gate or a crashed relay.
  const notifyAuthReject = (kind: RelayAuthRejectEvent['kind']): void => {
    if (onAuthReject === undefined) return;
    try {
      onAuthReject({ kind });
    } catch {
      // Ignore — observability is best-effort.
    }
  };

  // Register the HTTP-request auth listener BEFORE chii.start() so it fires
  // first. Node's http.Server emits 'request' to all listeners in registration
  // order; the first to end() the response wins. Valid requests return without
  // side-effect so chii's own handler takes over normally — and because
  // listeners run synchronously in order, mutating `req.url` here (path-prefix
  // strip, issue #466) means chii's later-registered handler only ever sees
  // the stripped URL.
  //
  // We only register when verifyAuth is provided so the no-auth path is
  // zero-overhead for tests and local-only dev sessions. (The phone-side
  // `/at/<code>/` prefix only ever appears when TOTP is armed — the launcher
  // QR carries the `at` code — so the no-auth path never needs the strip.)
  if (verifyAuth) {
    // Plain HTTP requests: only the path-prefixed form is ours — the phone
    // fetches `target.js` via `https://<host>/at/<code>/target.js` (issue
    // #466), which must be verified + stripped so chii's Koa static handler
    // serves `/target.js`. Non-prefixed requests keep today's behaviour
    // (ungated pass-through to chii).
    httpServer.on('request', (req, res) => {
      const rewritten = rewriteAtPathPrefix(req.url ?? '');
      if (rewritten === null) return;
      req.url = rewritten;
      if (!verifyAuth(req)) {
        // We do NOT log req.url or any auth param here to avoid leaking codes.
        // CORS header + tiny JSON body (issue #478): the script URL is
        // cross-origin from the phone page (tunnel origin ≠ relay origin), so
        // without ACAO a fetch() probe sees an opaque error and cannot tell
        // auth rejection from a network failure. The header rides ONLY on
        // this error response — no relay asset is exposed through it.
        res.statusCode = 401;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: RELAY_AUTH_REJECT_REASON }));
        notifyAuthReject('http-request');
      }
      // Auth passed: no-op — chii's Koa 'request' listener (registered below
      // by chii.start) serves the rewritten URL. (Koa skips writing when an
      // earlier listener already ended the response, so the 401 path is safe
      // even though Koa still runs.)
    });
  }

  // WS keepalive (issue #483): capture chii's WebSocketServer instance so we
  // can read `_wss.clients` and send periodic ping frames.
  //
  // `chii/server/index.js`'s start() creates `new WebSocketServer()` but
  // doesn't expose the instance. We capture it by temporarily patching
  // `ChiiWssClass.prototype.start` — that method runs on the instance, so
  // `this` gives us the reference we need.
  //
  // The patch is installed for the duration of one `chii.start()` call and
  // removed in a `finally` block, so concurrent relays nest correctly. If the
  // internal path changes in a future chii release (tryLoadChiiWssClass returns
  // null), chii.start() runs unpatched and the keepalive loop is silently
  // skipped — relay correctness is unaffected.
  const chiiWssClass = keepaliveIntervalMs > 0 ? tryLoadChiiWssClass() : null;
  const capturedChiiWss = await startChiiWithCapture(
    loadChiiServer(),
    { server: httpServer, domain: `${host}:${requestedPort}`, port: requestedPort },
    chiiWssClass,
  );

  // WS upgrade gate (issue #478, accept-then-close): take over the upgrade
  // chain AFTER chii.start() has registered chii's own upgrade listener.
  // Listener ordering alone protected chii when rejection meant
  // socket.destroy(); accept-then-close keeps the socket ALIVE, so chii's
  // listener (which always runs on every 'upgrade' emit) would complete a
  // second handshake on the rejected socket — frames after our close frame
  // would reach chii's server-side WebSocket, i.e. an auth bypass. Capturing
  // chii's listeners and re-dispatching only on auth pass closes that hole.
  if (verifyAuth) {
    const chiiUpgradeListeners = httpServer.listeners('upgrade') as Array<
      (req: IncomingMessage, socket: Duplex, head: Buffer) => void
    >;
    httpServer.removeAllListeners('upgrade');
    // noServer: handshake-only — never binds a port; used purely to send a
    // spec-compliant close frame with a code the browser can read.
    const rejectWss = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      // Phone-target transport (issue #466): normalise a `/at/<code>/…` path
      // prefix into the query form before verification, and strip it from the
      // URL chii will see. No-prefix URLs pass through untouched (daemon
      // client query transport — back-compat).
      const rewritten = rewriteAtPathPrefix(req.url ?? '');
      if (rewritten !== null) {
        req.url = rewritten;
      }
      if (!verifyAuth(req)) {
        // Reject: complete the handshake, then close with a NAMED code so the
        // browser-side observer (in-app attach.ts) can distinguish "stale
        // TOTP code" (4401) from "tunnel down" (1006). Raw-401-destroy only
        // ever produced 1006 client-side — the env-2 silence gap (#478).
        // We do NOT log req.url or any auth param here to avoid leaking codes;
        // the close reason is a fixed enum string.
        rejectWss.handleUpgrade(req, socket, head, (ws) => {
          ws.close(RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
        });
        notifyAuthReject('ws-upgrade');
        // Early return — chii's captured listeners are NOT called.
        return;
      }
      // Auth passed: hand the upgrade to chii's own listeners (it sees the
      // stripped URL — same observable behaviour as the pre-#478 ordering).
      for (const listener of chiiUpgradeListeners) {
        listener(req, socket, head);
      }
    });
  }

  const actualPort = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host, () => {
      httpServer.off('error', reject);
      // httpServer.address() is non-null immediately after the listen callback.
      const addr = httpServer.address() as AddressInfo;
      resolve(addr.port);
    });
  });

  // WS keepalive interval (issue #483): send a ping frame to every connected
  // socket on each tick. Both the phone-target leg and the daemon-client leg
  // terminate as WebSocket connections on this relay, so pinging chii's
  // `_wss.clients` covers both.
  //
  // Per-ping log output is intentionally absent — pings happen every 45 s and
  // logging each one would flood the MCP console without adding signal.
  //
  // `ws` clients respond to ping frames with pong automatically (RFC 6455 §5.5)
  // — no application code is needed on either end.
  let keepaliveHandle: ReturnType<typeof setInterval> | null = null;
  if (keepaliveIntervalMs > 0 && capturedChiiWss !== null) {
    const chiiWss = capturedChiiWss;
    keepaliveHandle = setInterval(() => {
      for (const client of chiiWss._wss.clients) {
        // readyState 1 = OPEN (ws library constant). Only ping live sockets.
        if (client.readyState === 1) {
          client.ping();
        }
      }
    }, keepaliveIntervalMs);
  }

  return {
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve) => {
        if (keepaliveHandle !== null) {
          clearInterval(keepaliveHandle);
          keepaliveHandle = null;
        }
        httpServer.close(() => resolve());
      }),
  };
}
