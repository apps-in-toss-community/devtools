/**
 * Unified response envelope for all MCP debug tools.
 *
 * Every tool result is wrapped in a `ToolEnvelope<T>` so agents can use a
 * single parser regardless of which tool they called. Before this, tool shapes
 * diverged:  raw array returns, `{exceptions}`, `{value,type}`, `{ok,value|error}` …
 *
 * ## Schema
 *
 * ```ts
 * {
 *   ok: boolean,
 *   data?: T,           // tool payload (absent when ok:false)
 *   error?: { code, message, nextRecommendedAction? },
 *   meta: {
 *     tool: string,
 *     env: 'mock' | 'relay-dev' | 'relay-live',
 *     attached: boolean,
 *     contentType: 'json' | 'image',
 *   }
 * }
 * ```
 *
 * ## Compat mode
 *
 * Set `AIT_MCP_COMPAT=chrome-devtools` to bypass envelope wrapping and return
 * the raw payload. This restores 0.1.x behaviour for consumers that already
 * parse the old shapes (e.g. chrome-devtools-mcp integrations).
 */

import type { McpEnvironment } from './environment.js';

/** Allowed values for `meta.env`. */
export type EnvelopeEnv = 'mock' | 'relay-dev' | 'relay-live';

/** The unified envelope returned by every debug MCP tool (when compat mode is off). */
export interface ToolEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    nextRecommendedAction?: {
      tool: string;
      reason: string;
    };
  };
  meta: {
    tool: string;
    env: EnvelopeEnv;
    attached: boolean;
    contentType: 'json' | 'image';
  };
}

/**
 * Returns `true` when `AIT_MCP_COMPAT=chrome-devtools` is set, which bypasses
 * envelope wrapping and returns raw payloads (0.1.x back-compat).
 */
export function isCompatMode(): boolean {
  return process.env.AIT_MCP_COMPAT === 'chrome-devtools';
}

/**
 * Maps `McpEnvironment` to `EnvelopeEnv`. After #307 these are the same
 * union (`mock | relay-dev | relay-live`), so this is identity — kept as a
 * named export for surface stability if envelope env diverges in the future.
 */
export function toEnvelopeEnv(env: McpEnvironment): EnvelopeEnv {
  return env;
}

/**
 * Context passed to `wrapEnvelope` that carries the per-request metadata.
 */
export interface EnvelopeContext {
  tool: string;
  env: McpEnvironment;
  attached: boolean;
  contentType?: 'json' | 'image';
}

/**
 * Wraps `data` in a `ToolEnvelope<T>` **unless** compat mode is active, in
 * which case `data` is returned as-is.
 *
 * Use this at every tool call-site in `debug-server.ts` and `server.ts`.
 *
 * @example
 * ```ts
 * return jsonResult(wrapEnvelope(listPages(connection, tunnel), {
 *   tool: 'list_pages',
 *   env: resolveEnvironment(),
 *   attached: connection.listTargets().length > 0,
 * }));
 * ```
 */
export function wrapEnvelope<T>(data: T, ctx: EnvelopeContext): ToolEnvelope<T> | T {
  if (isCompatMode()) return data;
  return {
    ok: true,
    data,
    meta: {
      tool: ctx.tool,
      env: toEnvelopeEnv(ctx.env),
      attached: ctx.attached,
      contentType: ctx.contentType ?? 'json',
    },
  };
}
