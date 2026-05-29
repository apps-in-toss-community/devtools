/**
 * MCP environment detection — single source of truth for `mock` vs `relay-dev`
 * vs `relay-live`.
 *
 * RFC #277 ("MCP tool surface fidelity") asks us to decide *once* per process
 * whether the agent is operating against:
 *   - `mock`       — a local dev browser running the @ait-co/devtools mock SDK
 *                    (env 1 in the 4-environments fidelity ladder), or
 *   - `relay-dev`  — a real device WebView attached through the Chii relay +
 *                    cloudflared quick tunnel, dogfood bundle (env 3), or
 *   - `relay-live` — a live/production WebView attached through the relay
 *                    (env 4 in the ladder, read-only debugging).
 *
 * The env decides two things:
 *
 *   1. Which tools appear on `tools/list` (Tier A → mock-only, Tier B → relay-only,
 *      Tier C → both). Tier filtering happens in `tools.ts` registry and the
 *      `CallTool` handler in `debug-server.ts` / `server.ts`.
 *   2. Which code path `measure_safe_area` and other Tier C tools take when they
 *      need to attach a `source: 'mock' | 'relay-dev' | 'relay-live'` provenance
 *      label to results.
 *
 * Detection precedence (highest → lowest):
 *   1. `MCP_ENV=mock|relay-dev|relay-live|relay`  — explicit env var, always
 *      wins. `relay` is a backward-compat alias for `relay-dev`.
 *   2. CDP target URL pattern                       — when a target URL matches a
 *      known real-device WebView pattern (intoss-private:// scheme,
 *      *.trycloudflare.com host) it is `relay-dev` (conservative — LIVE
 *      requires explicit MCP_ENV=relay-live opt-in).
 *   3. caller-stated default                        — `defaultEnv` from the
 *      input. The CLI entry point passes the mode's intent: debug-mode relay
 *      target passes `'relay-dev'` so the default reflects "user just launched
 *      a relay debug session", which is the dominant case. Local debug + dev
 *      mode + tests with no input fall back to `'mock'`.
 *   4. baked-in default                             — `mock` (zero external
 *      side effect).
 *
 * The `defaultEnv` precedence step (3) resolves the M2-5 dead-lock (issue
 * #309): without it, a fresh debug-mode session with no `MCP_ENV` and no
 * attached target resolved to `mock` and Tier B `build_attach_url` was hidden
 * from `tools/list` — leaving the agent with no way to enter env 3/4. By
 * letting the CLI pass `defaultEnv: 'relay-dev'` for the relay-target debug
 * mode, the bootstrap tool surface advertises `build_attach_url` from the
 * first `tools/list` call without forcing the user to set `MCP_ENV` explicitly.
 * LIVE-side guard still requires explicit `MCP_ENV=relay-live` opt-in.
 *
 * The env decision is intentionally *sticky* per process. Switching env should
 * be a process restart, not a runtime toggle — the RFC's reasoning is that mid-
 * session env flips silently invalidate everything an agent has learned.
 *
 * LIVE side-effect guard: when env is `relay-live`, the `call_sdk` and
 * `evaluate` tools require an explicit `confirm: true` argument. Without it,
 * the tool handler returns a structured error explaining the requirement. This
 * prevents accidental side effects on real users in the live production WebView.
 *
 * Backward compatibility:
 *   - `MCP_ENV=relay` still works (resolves to `relay-dev`).
 *   - Tools that accepted `McpEnvironment` of `'relay'` now work with
 *     `isRelayEnv(env)` which returns true for both `relay-dev` and
 *     `relay-live`.
 *   - `get_diagnostics` `environment` field keeps the legacy `env` key
 *     (`'mock' | 'relay'`) alongside the new `kind` key.
 *
 * SECRET-HANDLING: this module never reads the TOTP secret, deploy key, or any
 * URL component other than the scheme/host. The pattern matching uses public
 * surface only (intoss-private://… authority, *.trycloudflare.com host suffix).
 */

import type { CdpConnection } from './cdp-connection.js';

/**
 * The three environments the MCP server can operate in (issue #307).
 *
 *   - `mock`       — local dev browser + mock SDK (env 1).
 *   - `relay-dev`  — real-device dogfood bundle relay (env 3).
 *   - `relay-live` — real-device live/production relay, read-only guard active
 *                    (env 4).
 *
 * Backward-compat: the old `'relay'` value is no longer in the union type;
 * callers that need "any relay" should use the `isRelayEnv()` helper.
 */
export type McpEnvironment = 'mock' | 'relay-dev' | 'relay-live';

/**
 * Legacy environment union that includes the deprecated `'relay'` alias.
 * Used only for `MCP_ENV` env-var parsing and backward-compat `env` field in
 * `get_diagnostics`. New code should use `McpEnvironment`.
 */
type LegacyMcpEnvVar = McpEnvironment | 'relay';

/**
 * Returns `true` when the environment is any relay variant (`relay-dev` or
 * `relay-live`). Use this instead of `env === 'relay'` for tier checks.
 */
export function isRelayEnv(env: McpEnvironment): boolean {
  return env === 'relay-dev' || env === 'relay-live';
}

/**
 * Returns `true` when the environment is the LIVE relay (`relay-live`).
 * This is the guard condition for side-effect tool protection.
 */
export function isLiveRelayEnv(env: McpEnvironment): boolean {
  return env === 'relay-live';
}

/**
 * Maps the new `McpEnvironment` union to the legacy two-value union
 * (`'mock' | 'relay'`) for backward-compatible fields in diagnostics output.
 */
export function toLegacyEnv(env: McpEnvironment): 'mock' | 'relay' {
  if (env === 'mock') return 'mock';
  return 'relay';
}

/**
 * Why a given environment was chosen. Stable strings suitable for stderr logs
 * and the `data.reason` field on rejection errors. Does NOT include any URL,
 * secret, or other potentially-sensitive value.
 */
export type EnvironmentReason =
  | 'env-var-mock'
  | 'env-var-relay-dev'
  | 'env-var-relay-live'
  | 'env-var-relay-compat'
  | 'cdp-target-url-relay-pattern'
  | 'default-mock'
  | 'default-relay-dev'
  | 'default-relay-live';

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

/**
 * Parses the `MCP_ENV` env var into a `McpEnvironment` if valid.
 *
 * Accepted values:
 *   - `mock`        → `mock`
 *   - `relay-dev`   → `relay-dev`
 *   - `relay-live`  → `relay-live`
 *   - `relay`       → `relay-dev`  (backward-compat alias — resolves to relay-dev)
 *
 * Any other value is ignored and falls through to the next precedence step.
 */
function readEnvVar(): McpEnvironment | undefined {
  const raw = process.env.MCP_ENV as LegacyMcpEnvVar | string | undefined;
  if (raw === 'mock') return 'mock';
  if (raw === 'relay-dev') return 'relay-dev';
  if (raw === 'relay-live') return 'relay-live';
  if (raw === 'relay') return 'relay-dev'; // backward-compat alias
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
 *   3. CDP target URL pattern match → `relay-dev` (conservative — LIVE
 *      requires explicit MCP_ENV=relay-live opt-in)
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
      if (isRelayUrl(t.url)) return 'relay-dev';
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
  if (envOverride !== null) {
    if (envOverride === 'mock') return 'env-var-mock';
    if (envOverride === 'relay-live') return 'env-var-relay-live';
    return 'env-var-relay-dev';
  }
  const rawVar = process.env.MCP_ENV;
  const fromEnv = readEnvVar();
  if (fromEnv === 'mock') return 'env-var-mock';
  if (fromEnv === 'relay-live') return 'env-var-relay-live';
  if (fromEnv === 'relay-dev') {
    // Distinguish explicit `relay-dev` from backward-compat `relay` alias.
    return rawVar === 'relay' ? 'env-var-relay-compat' : 'env-var-relay-dev';
  }
  const { connection, defaultEnv } = input;
  if (connection !== undefined) {
    const targets = connection.listTargets();
    for (const t of targets) {
      if (isRelayUrl(t.url)) return 'cdp-target-url-relay-pattern';
    }
  }
  if (defaultEnv === 'relay-live') return 'default-relay-live';
  if (defaultEnv === 'relay-dev') return 'default-relay-dev';
  return 'default-mock';
}
