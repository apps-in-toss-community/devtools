/**
 * MCP environment — derived from two orthogonal axes (issue #348).
 *
 * Before #348 the environment was a single sticky decision made once per
 * process by `getEnvironment()` via a 5-step precedence chain (env var → URL
 * pattern sniffing → caller-stated default → baked-in default). That model
 * could not express a daemon that holds two live connections at once and swaps
 * the active one without a restart — the dual-connection design (#348).
 *
 * The 3-value `McpEnvironment` is now *derived* from two cheap signals rather
 * than detected:
 *
 *   1. `mock` vs `relay-*`  — free from `connection.kind` (`'local'` | `'relay'`,
 *      see `cdp-connection.ts`). Authoritative, known before any target
 *      attaches, and swappable at runtime by pointing at a different connection.
 *
 *   2. `relay-dev` vs `relay-live` — physically underivable (dogfood and
 *      production relays are byte-identical on the wire), so it is a single
 *      operator-supplied bit, `liveIntent`. It is armed only by
 *      `start_debug({ mode: 'relay-live' })` and is inert whenever the active
 *      connection is local.
 *
 * `McpEnvironment` survives as an OUTPUT-BOUNDARY type — `get_diagnostics` and
 * the envelope `meta.env` field still surface the precise three-value string —
 * but it is reconstructed from `(connection.kind, liveIntent)` via
 * {@link deriveEnvironment}, never sniffed.
 *
 * LIVE side-effect guard (relay-live, env 4): the `call_sdk` / `evaluate` tools
 * require an explicit `confirm: true`. The guard now reads to a single line in
 * `debug-server.ts`: `connection.kind === 'relay' && liveIntent && !confirm`.
 * `relay && liveIntent` together means a stale `liveIntent` bit is inert
 * against a local target (it only fires when the active connection is relay).
 *
 * Backward compatibility:
 *   - `MCP_ENV=relay-live` is a deprecated alias that seeds `liveIntent=true`
 *     at boot (see `cli.ts`). `MCP_ENV=mock|relay|relay-dev` are accepted and
 *     ignored for env derivation (kind is authoritative) — they only matter for
 *     `relay-live`'s liveIntent seed.
 *   - `isRelayEnv()` / `isLiveRelayEnv()` / `toLegacyEnv()` are unchanged.
 *
 * SECRET-HANDLING: this module never reads the TOTP secret, deploy key, or any
 * URL. It deals only in the connection kind and a single boolean.
 */

/**
 * The three environments the MCP server can surface in its output (issue #307).
 *
 *   - `mock`       — local Chromium + mock SDK (env 1) — active connection is local.
 *   - `relay-dev`  — real-device dogfood relay (env 3) — relay connection, liveIntent off.
 *   - `relay-live` — real-device live/production relay (env 4) — relay connection,
 *                    liveIntent on, read-only LIVE guard active.
 *
 * This is a derived OUTPUT string (see module docstring) — not a detected,
 * sticky decision.
 */
export type McpEnvironment = 'mock' | 'relay-dev' | 'relay-live';

/** Connection kind — the authoritative `mock` vs `relay` signal (issue #348). */
export type ConnectionKind = 'relay' | 'local';

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
 * Maps the `McpEnvironment` union to the legacy two-value union
 * (`'mock' | 'relay'`) for backward-compatible fields in diagnostics output.
 */
export function toLegacyEnv(env: McpEnvironment): 'mock' | 'relay' {
  if (env === 'mock') return 'mock';
  return 'relay';
}

/**
 * Reconstructs the three-value `McpEnvironment` output string from the two
 * orthogonal signals (issue #348):
 *
 *   - `kind === 'local'`                 → `'mock'`
 *   - `kind === 'relay'` &&  liveIntent  → `'relay-live'`
 *   - `kind === 'relay'` && !liveIntent  → `'relay-dev'`
 *
 * Pure — used at every output boundary (envelope `meta.env`, `get_diagnostics`,
 * `measure_safe_area` provenance) so the surface never sniffs a URL again.
 */
export function deriveEnvironment(kind: ConnectionKind, liveIntent: boolean): McpEnvironment {
  if (kind === 'local') return 'mock';
  return liveIntent ? 'relay-live' : 'relay-dev';
}

/* -------------------------------------------------------------------------- */
/* liveIntent — the single operator-supplied bit (relay-dev vs relay-live)    */
/* -------------------------------------------------------------------------- */

/**
 * Module-level `relay-dev` vs `relay-live` intent bit (issue #348).
 *
 * Armed by `start_debug({ mode: 'relay-live' })` (and seeded at boot by the
 * deprecated `MCP_ENV=relay-live` alias). Disarming is implicit: when the
 * active connection becomes local, the LIVE guard reads
 * `connection.kind === 'relay' && liveIntent`, so a stale `true` bit is inert.
 *
 * SECRET-HANDLING: this is a boolean — never a secret. Safe to read in logs.
 */
let liveIntent = false;

/** Returns the current `liveIntent` bit. */
export function getLiveIntent(): boolean {
  return liveIntent;
}

/**
 * Sets the `liveIntent` bit. Called by `start_debug` (true for `relay-live`,
 * false for every other mode) and once at boot by the `MCP_ENV=relay-live`
 * deprecated alias.
 */
export function setLiveIntent(value: boolean): void {
  liveIntent = value;
}

/* -------------------------------------------------------------------------- */
/* Test override hook (narrow)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Test/override hook — when non-null, callers that consult
 * {@link getEnvironmentOverride} return this value regardless of the live
 * connection kind. Production code never sets it; it exists so a unit test can
 * pin a precise `McpEnvironment` without constructing a real connection.
 *
 * This is intentionally NARROW: it no longer drives a precedence chain. The
 * authoritative production signal is `connection.kind` + `liveIntent`; this
 * override is a pure test affordance.
 */
let envOverride: McpEnvironment | null = null;

/** Sets a sticky environment override. Intended for tests only. */
export function setEnvironmentOverride(env: McpEnvironment | null): void {
  envOverride = env;
}

/** Reads the current override (test inspection). */
export function getEnvironmentOverride(): McpEnvironment | null {
  return envOverride;
}
