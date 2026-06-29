/**
 * Configuration helper for phone-relay test runs.
 *
 * `definePhoneTestConfig` is the user-facing entry point for configuring the
 * relay test runner. It mirrors the pattern of Vitest's `defineConfig` so
 * users can write:
 *
 *   // ait-test.config.ts
 *   import { definePhoneTestConfig } from '@ait-co/devtools/test-runner';
 *   export default definePhoneTestConfig({ ... });
 *
 * The helper resolves user config and, when given a relay connection factory,
 * builds the Vitest `pool` (`createRelayPool`) so Vitest's own config
 * resolution routes matching files to the device over the relay (#645). Without
 * a connection factory it still returns the resolved config for use with the
 * lower-level `runTestFilesOverRelay` transport (#644).
 */

import type { RelayConnectionFactory } from './pool.js';
import { createRelayPool, RELAY_POOL_NAME } from './pool.js';
import {
  createRelayConnectionFactory,
  type RelayConnectionFactoryOptions,
} from './relay-factory.js';

/**
 * Resolved phone-test configuration returned by `definePhoneTestConfig`.
 */
export interface PhoneTestConfig {
  /**
   * Glob patterns (relative to cwd) for test files to run on the device.
   * Defaults to `['**\/*.ait.test.ts']`.
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
  include: ['**/*.ait.test.ts'],
  timeoutMs: 30_000,
  extraExternals: [],
};

/**
 * Define a phone-relay test configuration.
 *
 * Merges user overrides with sensible defaults and returns a resolved
 * `PhoneTestConfig`. This object can be passed to `runTestFilesOverRelay`
 * (via the CLI or custom scripts) to run tests on a real device WebView.
 */
export function definePhoneTestConfig(userConfig?: PhoneTestUserConfig): PhoneTestConfig {
  return {
    include: userConfig?.include ?? DEFAULT_CONFIG.include,
    timeoutMs: userConfig?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    extraExternals: userConfig?.extraExternals ?? DEFAULT_CONFIG.extraExternals,
  };
}

/**
 * The slice of a Vitest `test` config this helper produces — `pool`,
 * `include`, and `testTimeout`. Typed structurally (not against Vitest's
 * `InlineConfig`) so consumers can spread it into their own `defineConfig`
 * without this module taking a value dependency on `vitest`.
 */
export interface PhoneVitestTestConfig {
  /** The relay `PoolRunnerInitializer`, matched by `getFilePoolName`. */
  pool: ReturnType<typeof createRelayPool>;
  /** Glob patterns for device test files. */
  include: string[];
  /** Per-test timeout in ms (mirrors the relay per-file evaluate timeout). */
  testTimeout: number;
}

/** User config accepted by {@link definePhoneVitestConfig}. */
export interface PhoneVitestUserConfig extends PhoneTestUserConfig {
  /**
   * Opens/closes the CDP relay connection that tests run over. Required —
   * without it there is no device to dispatch files to.
   *
   * SECRET-HANDLING: the factory owns the relay wss/TOTP; this config object
   * never stores or logs those values.
   */
  connection: RelayConnectionFactory;
  /**
   * When set, the relay pool harvests `__AIT_CAPTURE__` console lines during the
   * run (forwarded as `collectCaptures` to `runTestFilesOverRelay`). The
   * directory names where a downstream consumer persists artifacts; the captures
   * themselves ride on the report the pool reports through `vitest.state`.
   * Omitted = no capture harvest (build-only, zero listener overhead).
   */
  reportDir?: string;
}

/**
 * Build the Vitest `test` config slice for running tests on a device over the
 * relay. Spread the result into your Vitest config:
 *
 * @example
 *   // vitest.config.ts
 *   import { defineConfig } from 'vitest/config';
 *   import { definePhoneVitestConfig } from '@ait-co/devtools/test-runner';
 *   export default defineConfig({
 *     test: definePhoneVitestConfig({ connection: myRelayFactory }),
 *   });
 *
 * Files matching `include` are dispatched to the relay pool (named
 * {@link RELAY_POOL_NAME}); everything else runs in Vitest's default pool.
 */
export function definePhoneVitestConfig(userConfig: PhoneVitestUserConfig): PhoneVitestTestConfig {
  const resolved = definePhoneTestConfig(userConfig);
  return {
    pool: createRelayPool({
      connection: userConfig.connection,
      run: {
        timeoutMs: resolved.timeoutMs,
        bundleOptions: { extraExternals: resolved.extraExternals },
        // Harvest captures only when a report dir is configured — keeps the
        // build-only path free of the live console listener (#696).
        collectCaptures: userConfig.reportDir !== undefined,
      },
    }),
    include: resolved.include,
    testTimeout: resolved.timeoutMs,
  };
}

export type { RelayConnectionFactory, RelayConnectionFactoryOptions };
// Re-exported so a downstream `vitest.config.ts` can build the connection
// factory straight from the `@ait-co/devtools/test-runner` barrel. relay-factory
// keeps its heavy MCP graph behind dynamic imports, so this static re-export does
// NOT drag chii/cloudflared/tools onto this Node-config entry (verified by
// scripts/check-test-runner-dist.sh).
export { createRelayConnectionFactory, createRelayPool, RELAY_POOL_NAME };
