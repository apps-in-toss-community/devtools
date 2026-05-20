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
 */

import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';

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
  /** Base URL for the relay HTTP/WS server, e.g. `http://127.0.0.1:9100`. */
  baseUrl: string;
  close(): Promise<void>;
}

export interface StartChiiRelayOptions {
  /** Local port for the relay. Default 9100. */
  port?: number;
  /** Bind host. Default 127.0.0.1 (tunnel reaches it locally). */
  host?: string;
}

/** Starts the Chii relay on the given port and resolves once listening. */
export async function startChiiRelay(options: StartChiiRelayOptions = {}): Promise<ChiiRelay> {
  const port = options.port ?? 9100;
  const host = options.host ?? '127.0.0.1';

  const httpServer = createServer();
  const chii = loadChiiServer();
  // Passing an existing `server` makes chii attach its Koa handler + WS upgrade
  // to our HTTP server rather than creating its own listener.
  await chii.start({ server: httpServer, domain: `${host}:${port}`, port });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return {
    port,
    baseUrl: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      }),
  };
}
