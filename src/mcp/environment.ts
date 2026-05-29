/**
 * MCP environment detection — single source of truth for `mock` vs `relay`.
 *
 * RFC #277 ("MCP tool surface fidelity") asks us to decide *once* per process
 * whether the agent is operating against:
 *   - `mock`  — a local dev browser running the @ait-co/devtools mock SDK
 *     (env 1 in the 4-environments fidelity ladder), or
 *   - `relay` — a real device WebView attached through the Chii relay + the
 *     cloudflared quick tunnel (env 2/3/4 in the ladder).
 *
 * The env decides two things:
 *
 *   1. Which tools appear on `tools/list` (Tier A → mock-only, Tier B → relay-only,
 *      Tier C → both). Tier filtering happens in `tools.ts` registry and the
 *      `CallTool` handler in `debug-server.ts` / `server.ts`.
 *   2. Which code path `measure_safe_area` and other Tier C tools take when they
 *      need to attach a `source: 'mock' | 'relay'` provenance label to results.
 *
 * Detection precedence (highest → lowest):
 *   1. `MCP_ENV=mock|relay`           — explicit env var, always wins.
 *   2. CDP target URL pattern          — when a target URL matches a known
 *                                         real-device WebView pattern (intoss-
 *                                         private:// scheme, *.trycloudflare.com
 *                                         host) it is `relay`.
 *   3. caller-stated default           — `defaultEnv` from the input. The CLI
 *                                         entry point passes the mode's intent
 *                                         here: debug-mode relay target passes
 *                                         `'relay'` so the default reflects
 *                                         "user just launched a relay debug
 *                                         session", which is the dominant case.
 *                                         Local debug + dev mode + tests with no
 *                                         input fall back to `'mock'`.
 *   4. baked-in default                — `mock` (zero external side effect).
 *
 * The `defaultEnv` precedence step (3) is what resolves the M2-5 dead-lock
 * (issue #309): without it, a fresh debug-mode session with no `MCP_ENV` and no
 * attached target resolved to `mock` and Tier B `build_attach_url` was hidden
 * from `tools/list` — leaving the agent with no way to enter env 3/4. By
 * letting the CLI pass `defaultEnv: 'relay'` for the relay-target debug mode,
 * the bootstrap tool surface advertises `build_attach_url` from the first
 * `tools/list` call without forcing the user to set `MCP_ENV=relay` explicitly.
 *
 * The env decision is intentionally *sticky* per process. Switching env should
 * be a process restart, not a runtime toggle — the RFC's reasoning is that mid-
 * session env flips silently invalidate everything an agent has learned.
 *
 * SECRET-HANDLING: this module never reads the TOTP secret, deploy key, or any
 * URL component other than the scheme/host. The pattern matching uses public
 * surface only (intoss-private://… authority, *.trycloudflare.com host suffix).
 */

import type { CdpConnection } from './cdp-connection.js';

/** The two environments the MCP server can operate in. */
export type McpEnvironment = 'mock' | 'relay';

/**
 * Why a given environment was chosen. Stable strings suitable for stderr logs
 * and the `data.reason` field on rejection errors. Does NOT include any URL,
 * secret, or other potentially-sensitive value.
 */
export type EnvironmentReason =
  | 'env-var-mock'
  | 'env-var-relay'
  | 'cdp-target-url-relay-pattern'
  | 'default-mock'
  | 'default-relay';

/**
 * URL patterns that mark a CDP target as a real-device WebView relay.
 *
 * - `intoss-private://` is the Toss in-app private scheme — only ever observed
 *   inside the real Toss app WebView.
 * - `*.trycloudflare.com` (host suffix) is the cloudflared quick tunnel used as
 *   the relay transport. A target whose URL is on that host is, by construction,
 *   reached over the relay.
 *
 * Pattern-only matches — no specific tunnel host or deploymentId is hard-coded.
 */
const RELAY_URL_PATTERNS: ReadonlyArray<RegExp> = [
  /^intoss-private:\/\//i,
  /:\/\/[a-z0-9-]+\.trycloudflare\.com(\/|$|:|\?)/i,
];

/**
 * Returns true when the URL string looks like a real-device WebView attached
 * over the Chii relay. Used for `getEnvironment()` precedence step 2.
 */
export function isRelayUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  return RELAY_URL_PATTERNS.some((p) => p.test(url));
}

/**
 * Test/override hook — when non-null, `getEnvironment()` returns this value
 * regardless of env vars or connection state. Cleared with `null`.
 */
let envOverride: McpEnvironment | null = null;

/**
 * Sets a sticky environment override. Intended for tests; production code paths
 * should leave the override `null` and let the precedence rules decide.
 */
export function setEnvironmentOverride(env: McpEnvironment | null): void {
  envOverride = env;
}

/** Reads the current override (test inspection). */
export function getEnvironmentOverride(): McpEnvironment | null {
  return envOverride;
}

/** Parses the `MCP_ENV` env var into a `McpEnvironment` if valid. */
function readEnvVar(): McpEnvironment | undefined {
  const raw = process.env.MCP_ENV;
  if (raw === 'mock' || raw === 'relay') return raw;
  return undefined;
}

/**
 * Decision input for `getEnvironment` / `getEnvironmentReason`. The connection
 * is optional — when omitted, only the env var and default are consulted.
 *
 * Production callers pass the live `CdpConnection` so the URL-pattern step
 * (precedence 2) can fire. Tests can omit it to exercise pure precedence.
 */
export interface EnvironmentInput {
  /**
   * Live CDP connection — when its `listTargets()` includes a URL matching the
   * real-device pattern, the env resolves to `relay`. Optional.
   */
  connection?: Pick<CdpConnection, 'listTargets'>;
  /**
   * Caller-stated default when no env var is set and no URL pattern matches.
   * The CLI entry point uses this to encode each mode's *intent* (debug-mode
   * relay target = `'relay'`, local/dev = `'mock'`) without baking the mode
   * into this module. Defaults to `'mock'` (backwards-compatible — tests and
   * legacy callers see the original behaviour).
   *
   * This is precedence step 3 (caller-stated default) — it only kicks in after
   * `MCP_ENV` and the URL pattern have been consulted, so an explicit env var
   * or a real-device URL still wins.
   */
  defaultEnv?: McpEnvironment;
}

/**
 * Returns the current MCP environment, applying the precedence rules:
 *   1. test override (if set)
 *   2. `MCP_ENV` env var
 *   3. CDP target URL pattern match
 *   4. caller-stated `defaultEnv` (intent hint from the CLI mode)
 *   5. baked-in default `mock`
 */
export function getEnvironment(input: EnvironmentInput = {}): McpEnvironment {
  if (envOverride !== null) return envOverride;
  const fromEnv = readEnvVar();
  if (fromEnv !== undefined) return fromEnv;
  const { connection, defaultEnv } = input;
  if (connection !== undefined) {
    const targets = connection.listTargets();
    for (const t of targets) {
      if (isRelayUrl(t.url)) return 'relay';
    }
  }
  return defaultEnv ?? 'mock';
}

/**
 * Returns the `EnvironmentReason` that drove the current `getEnvironment()`
 * result. Used by stderr logs and the rejection-reason payload on Tier A/B
 * mismatch errors. SECRET-HANDLING: only stable enum strings — no URL or
 * secret value is ever returned.
 */
export function getEnvironmentReason(input: EnvironmentInput = {}): EnvironmentReason {
  if (envOverride !== null) return envOverride === 'mock' ? 'env-var-mock' : 'env-var-relay';
  const fromEnv = readEnvVar();
  if (fromEnv === 'mock') return 'env-var-mock';
  if (fromEnv === 'relay') return 'env-var-relay';
  const { connection, defaultEnv } = input;
  if (connection !== undefined) {
    const targets = connection.listTargets();
    for (const t of targets) {
      if (isRelayUrl(t.url)) return 'cdp-target-url-relay-pattern';
    }
  }
  return defaultEnv === 'relay' ? 'default-relay' : 'default-mock';
}
