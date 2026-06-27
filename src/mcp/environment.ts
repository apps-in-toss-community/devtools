/**
 * MCP environment — derived from two orthogonal axes (issue #348).
 *
 * Before #348 the environment was a single sticky decision made once per
 * process by `getEnvironment()` via a 5-step precedence chain (env var → URL
 * pattern sniffing → caller-stated default → baked-in default). That model
 * could not express a daemon that holds two live connections at once and swaps
 * the active one without a restart — the dual-connection design (#348).
 *
 * The 3-value `McpEnvironment` is now *derived* from cheap signals rather
 * than detected (env 4 / relay-live removed in #665):
 *
 *   1. `mock` vs `relay-*`  — free from `connection.kind` (`'local'` | `'relay'`,
 *      see `cdp-connection.ts`). Authoritative, known before any target
 *      attaches, and swappable at runtime by pointing at a different connection.
 *
 *   2. `relay-dev` vs `relay-mobile` — both are `kind: 'relay'` relays,
 *      distinguished by the booted family's `relayOrigin` discriminator
 *      (`'intoss-webview'` → relay-dev, `'external-pwa'` → relay-mobile,
 *      issue #378). NOT sniffed from the relay URL.
 *
 * `McpEnvironment` survives as an OUTPUT-BOUNDARY type — `get_debug_status` and
 * the envelope `meta.env` field still surface the precise three-value string —
 * but it is reconstructed from `(connection.kind, relayOrigin)` via
 * {@link deriveEnvironment}, never sniffed.
 *
 * Positive-allowlist kill-switch (#665): `relay-live` (env 4) is removed.
 * The debug surface is now only active on localhost/trycloudflare/private-apps
 * hosts. `relay-live`/`liveIntent`/LIVE guard are fully removed.
 *
 * SECRET-HANDLING: this module never reads the TOTP secret, deploy key, or any
 * URL. It deals only in the connection kind and optional relay origin.
 */

/**
 * The three environments the MCP server can surface in its output (issues #307,
 * #378, #665).
 *
 *   - `mock`         — local Chromium + mock SDK (env 1) — active connection is local.
 *   - `relay-dev`    — real-device dog-food relay (env 3) — relay connection,
 *                      intoss-private WebView (the relay devtools started).
 *   - `relay-mobile` — real-device PWA over an EXTERNAL relay (env 2, issue #378) —
 *                      relay connection, an external-PWA relay
 *                      (the unplugin started it; the MCP only attaches a CDP client).
 *
 * `relay-live` (env 4) has been removed (#665) — the debug surface is now gated
 * by a positive allowlist (localhost/trycloudflare/private-apps) at the in-app
 * entry and the MCP server no longer tracks a LIVE intent bit.
 *
 * This is a derived OUTPUT string (see module docstring) — not a detected,
 * sticky decision.
 */
export type McpEnvironment = 'mock' | 'relay-dev' | 'relay-mobile';

/** Connection kind — the authoritative `mock` vs `relay` signal (issue #348). */
export type ConnectionKind = 'relay' | 'local';

/**
 * Origin of a relay connection — the discriminator that distinguishes two relay
 * families that are otherwise both `kind: 'relay'` (issue #378):
 *
 *   - `'intoss-webview'` — the intoss-private dog-food / live relay (env 3/4),
 *     booted BY the MCP server (`bootRelayFamily`). Maps to `relay-dev` /
 *     `relay-live` depending on `liveIntent`.
 *   - `'external-pwa'`   — an external CDP relay the unplugin already brought up
 *     for the env-2 PWA (`bootExternalRelayFamily`). Maps to `relay-mobile`.
 *
 * Carried on the booted family (NOT sniffed from the relay URL), so the output
 * layer can tell `relay-mobile` apart from `relay-dev`.
 */
export type RelayOrigin = 'intoss-webview' | 'external-pwa';

/**
 * Returns `true` when the environment is any relay variant (`relay-dev` or
 * `relay-mobile`). Use this instead of `env === 'relay'` for tier checks —
 * every relay env surfaces the Tier B / relay-only tool set.
 *
 * Written as an exhaustive switch so a future `McpEnvironment` member that is
 * missing an arm is a TS compile error rather than a silent `false`.
 */
export function isRelayEnv(env: McpEnvironment): boolean {
  switch (env) {
    case 'relay-dev':
    case 'relay-mobile':
      return true;
    case 'mock':
      return false;
  }
}

/**
 * Maps the `McpEnvironment` union to the legacy two-value union
 * (`'mock' | 'relay'`) for backward-compatible fields in diagnostics output.
 * Every relay variant (`relay-dev`, `relay-mobile`) collapses to `'relay'`.
 * Written as an exhaustive switch so a missing arm is a TS compile error.
 */
export function toLegacyEnv(env: McpEnvironment): 'mock' | 'relay' {
  switch (env) {
    case 'mock':
      return 'mock';
    case 'relay-dev':
    case 'relay-mobile':
      return 'relay';
  }
}

/**
 * Reconstructs the three-value `McpEnvironment` output string from the
 * orthogonal signals (issues #348, #378, #665):
 *
 *   - `kind === 'local'`                                         → `'mock'`
 *   - `kind === 'relay'` && origin 'external-pwa'                → `'relay-mobile'`
 *   - `kind === 'relay'` && origin intoss/undefined              → `'relay-dev'`
 *
 * `relayOrigin` is the booted-family discriminator (NOT sniffed from the URL)
 * that distinguishes the env-2 external-PWA relay (`relay-mobile`) from the
 * intoss-private dog-food relay (`relay-dev`); both are `kind: 'relay'`.
 *
 * `relay-live` (env 4) has been removed (#665). `liveIntent` parameter is gone.
 *
 * Pure — used at every output boundary (envelope `meta.env`, `get_debug_status`,
 * `measure_safe_area` provenance) so the surface never sniffs a URL again.
 *
 * Written switch-style so a missing arm is a TS compile error (never falls
 * through to a default).
 */
export function deriveEnvironment(kind: ConnectionKind, relayOrigin?: RelayOrigin): McpEnvironment {
  switch (kind) {
    case 'local':
      return 'mock';
    case 'relay':
      return relayOrigin === 'external-pwa' ? 'relay-mobile' : 'relay-dev';
  }
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
 * authoritative production signal is `connection.kind` + `relayOrigin`; this
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
