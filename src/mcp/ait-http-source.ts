/**
 * Dev-mode `AitSource` — backed by the Vite dev server's mock-state endpoint.
 *
 * The dev server already exposes the live browser mock state at
 * `GET /api/ait-devtools/state` (registered by the unplugin with `mcp: true`).
 * Phase 3 aligns dev mode and debug mode on the same `AIT.*` tool surface, so
 * dev mode serves those tools off this one HTTP source instead of a CDP channel:
 *
 *   - `AIT.getMockState`              → the full state snapshot (verbatim).
 *   - `AIT.getOperationalEnvironment` → derived from the snapshot's
 *                                       `environment` + `appVersion` fields.
 *   - `AIT.getSdkCallHistory`         → empty (the dev endpoint does not record
 *                                       an SDK call trace — honest, not faked).
 *
 * An AI agent thus sees the same `AIT.getMockState` tool whether attached to a
 * phone (debug) or a dev browser (dev). Tests inject a fake `fetch`.
 */

import type {
  AitMethodMap,
  AitMethodName,
  AitMockState,
  AitOperationalEnvironment,
  AitSdkCallHistory,
  AitSource,
} from './ait-source.js';

/** Minimal `fetch` shape this source needs (injectable in tests). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

export interface HttpAitSourceOptions {
  /** Full URL of the mock-state endpoint, e.g. `http://localhost:5173/api/ait-devtools/state`. */
  stateEndpoint: string;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: FetchLike;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class HttpAitSource implements AitSource {
  private readonly stateEndpoint: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpAitSourceOptions) {
    this.stateEndpoint = options.stateEndpoint;
    this.fetchImpl = options.fetchImpl ?? ((url) => fetch(url));
  }

  private async fetchState(): Promise<AitMockState> {
    const res = await this.fetchImpl(this.stateEndpoint);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch mock state from ${this.stateEndpoint}: HTTP ${res.status} ${res.statusText}. ` +
          'Ensure the Vite dev server is running with the @ait-co/devtools unplugin option `mcp: true`.',
      );
    }
    const body = await res.json();
    return isObject(body) ? body : {};
  }

  async get<M extends AitMethodName>(method: M): Promise<AitMethodMap[M]> {
    switch (method) {
      case 'AIT.getMockState': {
        const state = await this.fetchState();
        return state as AitMethodMap[M];
      }
      case 'AIT.getOperationalEnvironment': {
        const state = await this.fetchState();
        const environment = typeof state.environment === 'string' ? state.environment : 'unknown';
        const sdkVersion = typeof state.appVersion === 'string' ? state.appVersion : null;
        const result: AitOperationalEnvironment = { environment, sdkVersion };
        return result as AitMethodMap[M];
      }
      case 'AIT.getSdkCallHistory': {
        // sdkCallLog slice is now part of the mock state pushed by the browser panel.
        // Read it from the state snapshot rather than returning an empty stub.
        const state = await this.fetchState();
        const raw = state.sdkCallLog;
        const calls = Array.isArray(raw) ? (raw as AitSdkCallHistory['calls']) : [];
        const result: AitSdkCallHistory = { calls };
        return result as AitMethodMap[M];
      }
      default:
        throw new Error(`Unknown AIT method: ${String(method)}`);
    }
  }
}
