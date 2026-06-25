/**
 * Configuration helper for phone-relay test runs.
 *
 * `definePhoneTestConfig` is the user-facing entry point for configuring the
 * relay test runner. It mirrors the pattern of Vitest's `defineConfig` so
 * users can write:
 *
 *   // phone-test.config.ts
 *   import { definePhoneTestConfig } from '@ait-co/devtools/test-runner';
 *   export default definePhoneTestConfig({ ... });
 *
 * MVP: the helper is a type-safe pass-through that captures user config and
 * returns a resolved `PhoneTestConfig`. The actual pool integration
 * (injecting this as a Vitest `pool` entry) is tracked in issue #645.
 *
 * TODO (#645): wire `pool: 'custom'` + `poolOptions.relay` so that Vitest's
 * own config resolution picks up this object and routes to
 * `runTestFilesOverRelay` via the Vitest pool interface.
 */

/**
 * Resolved phone-test configuration returned by `definePhoneTestConfig`.
 */
export interface PhoneTestConfig {
  /**
   * Glob patterns (relative to cwd) for test files to run on the device.
   * Defaults to `['**\/*.phone.test.ts']`.
   */
  include: string[];
  /**
   * Per-file evaluate timeout in milliseconds. Defaults to 30 000.
   */
  timeoutMs: number;
  /**
   * Additional esbuild `external` patterns for bundling.
   * The SDK package is always external; add more here if needed.
   */
  extraExternals: string[];
}

/** User-facing config shape accepted by `definePhoneTestConfig`. */
export interface PhoneTestUserConfig {
  include?: string[];
  timeoutMs?: number;
  extraExternals?: string[];
}

const DEFAULT_CONFIG: PhoneTestConfig = {
  include: ['**/*.phone.test.ts'],
  timeoutMs: 30_000,
  extraExternals: [],
};

/**
 * Define a phone-relay test configuration.
 *
 * Merges user overrides with sensible defaults and returns a resolved
 * `PhoneTestConfig`. This object can be passed to `runTestFilesOverRelay`
 * (via the CLI or custom scripts) to run tests on a real device WebView.
 *
 * Full Vitest `pool` wiring is tracked in issue #645.
 */
export function definePhoneTestConfig(userConfig?: PhoneTestUserConfig): PhoneTestConfig {
  return {
    include: userConfig?.include ?? DEFAULT_CONFIG.include,
    timeoutMs: userConfig?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    extraExternals: userConfig?.extraExternals ?? DEFAULT_CONFIG.extraExternals,
  };
}
