/**
 * Unit tests for the derived environment model (issue #348, #665).
 *
 * The 5-step precedence chain + URL sniffing was deleted: env is now derived
 * from two orthogonal signals — `connection.kind` (mock vs relay) and the
 * booted family's `relayOrigin` discriminator (relay-dev vs relay-mobile,
 * issue #378). `liveIntent` / `relay-live` removed in #665.
 *
 * These tests cover:
 *   - `deriveEnvironment(kind, relayOrigin?)` — the full matrix
 *   - `isRelayEnv` / `toLegacyEnv` (incl. relay-mobile)
 *   - the narrow `setEnvironmentOverride` test hook
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveEnvironment,
  getEnvironmentOverride,
  isRelayEnv,
  setEnvironmentOverride,
  toLegacyEnv,
} from '../environment.js';

describe('deriveEnvironment — (connection.kind × relayOrigin) matrix', () => {
  it('local kind → mock (relayOrigin inert)', () => {
    expect(deriveEnvironment('local')).toBe('mock');
    // A stale relayOrigin must NOT promote a local target to a relay env.
    expect(deriveEnvironment('local', 'external-pwa')).toBe('mock');
    expect(deriveEnvironment('local', 'intoss-webview')).toBe('mock');
  });

  it('relay kind + no origin → relay-dev (intoss default)', () => {
    expect(deriveEnvironment('relay')).toBe('relay-dev');
  });

  it('relay kind + intoss-webview origin → relay-dev', () => {
    expect(deriveEnvironment('relay', 'intoss-webview')).toBe('relay-dev');
  });

  it('relay kind + external-pwa origin → relay-mobile (#378)', () => {
    expect(deriveEnvironment('relay', 'external-pwa')).toBe('relay-mobile');
  });
});

// liveIntent tests removed — relay-live (env 4) and the liveIntent bit are
// fully removed in #665.

describe('isRelayEnv', () => {
  it('covers both relay variants (relay-live removed #665)', () => {
    expect(isRelayEnv('relay-dev')).toBe(true);
    expect(isRelayEnv('relay-mobile')).toBe(true);
    expect(isRelayEnv('mock')).toBe(false);
  });
});

// isLiveRelayEnv removed — relay-live and LIVE guard removed in #665.

describe('toLegacyEnv', () => {
  it('collapses the three-value env to mock | relay', () => {
    expect(toLegacyEnv('mock')).toBe('mock');
    expect(toLegacyEnv('relay-dev')).toBe('relay');
    expect(toLegacyEnv('relay-mobile')).toBe('relay');
  });
});

describe('setEnvironmentOverride — narrow test hook', () => {
  afterEach(() => setEnvironmentOverride(null));

  it('stores and clears the override', () => {
    expect(getEnvironmentOverride()).toBeNull();
    setEnvironmentOverride('relay-dev');
    expect(getEnvironmentOverride()).toBe('relay-dev');
    setEnvironmentOverride(null);
    expect(getEnvironmentOverride()).toBeNull();
  });
});
