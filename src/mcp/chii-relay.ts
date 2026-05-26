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
 *   When `verifyAuth` is provided, this module registers an HTTP upgrade
 *   listener on the server BEFORE calling `chii.start({server})`. Node's
 *   `http.Server` allows multiple 'upgrade' listeners; the first to call
 *   `socket.destroy()` wins. Invalid auth → 401 + destroy (chii never sees
 *   the connection). Valid auth → return without side-effect (chii handles it).
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

const require = createRequire(import.meta.url);

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
   *   Inspect `req.url` for query parameters (e.g. `at=<code>`).
   * @returns `true` if the upgrade is authorised, `false` to reject.
   */
  verifyAuth?: (req: IncomingMessage) => boolean;
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
  const { verifyAuth } = options;

  const httpServer = createServer();

  // Register our auth listener BEFORE chii.start() so it fires first.
  // Node's http.Server emits 'upgrade' to all listeners in registration order;
  // the first to destroy() the socket wins. Valid requests return without
  // side-effect so chii's own upgrade handler takes over normally.
  //
  // We only register when verifyAuth is provided so the no-auth path is
  // zero-overhead for tests and local-only dev sessions.
  if (verifyAuth) {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
      if (!verifyAuth(req)) {
        // Reject: send a minimal HTTP 401 response and close the socket.
        // We do NOT log req.url or any auth param here to avoid leaking codes.
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        // Early return — chii's handler is NOT called for this socket.
        return;
      }
      // Auth passed: no-op. Chii's upgrade listener (registered below by
      // chii.start) will handle the rest.
    });
  }

  const chii = loadChiiServer();
  // Passing an existing `server` makes chii attach its Koa handler + WS upgrade
  // to our HTTP server rather than creating its own listener.
  // Note: port/domain here are display-only inside chii — the TCP bind is ours.
  await chii.start({ server: httpServer, domain: `${host}:${requestedPort}`, port: requestedPort });

  const actualPort = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host, () => {
      httpServer.off('error', reject);
      // httpServer.address() is non-null immediately after the listen callback.
      const addr = httpServer.address() as AddressInfo;
      resolve(addr.port);
    });
  });

  return {
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      }),
  };
}
