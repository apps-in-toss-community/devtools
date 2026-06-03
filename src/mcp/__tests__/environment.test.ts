/**
 * Unit tests for the derived environment model (issue #348).
 *
 * The 5-step precedence chain + URL sniffing was deleted: env is now derived
 * from three orthogonal signals — `connection.kind` (mock vs relay), the
 * module-level `liveIntent` bit (relay-dev vs relay-live), and the booted
 * family's `relayOrigin` discriminator (relay-dev vs relay-mobile, issue #378).
 * These tests cover:
 *   - `deriveEnvironment(kind, liveIntent, relayOrigin?)` — the full matrix
 *   - `liveIntent` getter/setter
 *   - `isRelayEnv` / `isLiveRelayEnv` / `toLegacyEnv` (incl. relay-mobile)
 *   - the narrow `setEnvironmentOverride` test hook
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveEnvironment,
  getEnvironmentOverride,
  getLiveIntent,
  isLiveRelayEnv,
  isRelayEnv,
  setEnvironmentOverride,
  setLiveIntent,
  toLegacyEnv,
} from '../environment.js';

describe('deriveEnvironment — (connection.kind × liveIntent × relayOrigin) matrix', () => {
  it('local kind → mock (liveIntent + relayOrigin inert)', () => {
    expect(deriveEnvironment('local', false)).toBe('mock');
    // A stale liveIntent bit must NOT promote a local target to relay-live.
    expect(deriveEnvironment('local', true)).toBe('mock');
    // A stale relayOrigin must NOT promote a local target to a relay env.
    expect(deriveEnvironment('local', false, 'external-pwa')).toBe('mock');
    expect(deriveEnvironment('local', false, 'intoss-webview')).toBe('mock');
  });

  it('relay kind + liveIntent off + no origin → relay-dev (intoss default)', () => {
    expect(deriveEnvironment('relay', false)).toBe('relay-dev');
  });

  it('relay kind + liveIntent off + intoss-webview origin → relay-dev', () => {
    expect(deriveEnvironment('relay', false, 'intoss-webview')).toBe('relay-dev');
  });

  it('relay kind + liveIntent off + external-pwa origin → relay-mobile (#378)', () => {
    expect(deriveEnvironment('relay', false, 'external-pwa')).toBe('relay-mobile');
  });

  it('relay kind + liveIntent on → relay-live (origin ignored — live wins)', () => {
    expect(deriveEnvironment('relay', true)).toBe('relay-live');
    // liveIntent takes precedence over an external-pwa origin: an external relay
    // never derives to relay-live in practice (mobile is dev-intent), but the
    // pure function still resolves live-first when both signals are present.
    expect(deriveEnvironment('relay', true, 'external-pwa')).toBe('relay-live');
    expect(deriveEnvironment('relay', true, 'intoss-webview')).toBe('relay-live');
  });
});

describe('liveIntent — module-level bit', () => {
  afterEach(() => setLiveIntent(false));

  it('defaults to false', () => {
    // (Reset by afterEach of any prior test; assert the cleared state.)
    setLiveIntent(false);
    expect(getLiveIntent()).toBe(false);
  });

  it('set/get round-trips', () => {
    setLiveIntent(true);
    expect(getLiveIntent()).toBe(true);
    setLiveIntent(false);
    expect(getLiveIntent()).toBe(false);
  });

  it('feeds deriveEnvironment for a relay connection', () => {
    setLiveIntent(true);
    expect(deriveEnvironment('relay', getLiveIntent())).toBe('relay-live');
    setLiveIntent(false);
    expect(deriveEnvironment('relay', getLiveIntent())).toBe('relay-dev');
  });
});

describe('isRelayEnv / isLiveRelayEnv', () => {
  it('isRelayEnv covers all three relay variants', () => {
    expect(isRelayEnv('relay-dev')).toBe(true);
    expect(isRelayEnv('relay-live')).toBe(true);
    expect(isRelayEnv('relay-mobile')).toBe(true);
    expect(isRelayEnv('mock')).toBe(false);
  });

  it('isLiveRelayEnv is true only for relay-live (relay-mobile is NOT live)', () => {
    expect(isLiveRelayEnv('relay-live')).toBe(true);
    expect(isLiveRelayEnv('relay-dev')).toBe(false);
    expect(isLiveRelayEnv('relay-mobile')).toBe(false);
    expect(isLiveRelayEnv('mock')).toBe(false);
  });
});

describe('toLegacyEnv', () => {
  it('collapses the four-value env to mock | relay', () => {
    expect(toLegacyEnv('mock')).toBe('mock');
    expect(toLegacyEnv('relay-dev')).toBe('relay');
    expect(toLegacyEnv('relay-live')).toBe('relay');
    expect(toLegacyEnv('relay-mobile')).toBe('relay');
  });
});

describe('setEnvironmentOverride — narrow test hook', () => {
  afterEach(() => setEnvironmentOverride(null));

  it('stores and clears the override', () => {
    expect(getEnvironmentOverride()).toBeNull();
    setEnvironmentOverride('relay-live');
    expect(getEnvironmentOverride()).toBe('relay-live');
    setEnvironmentOverride(null);
    expect(getEnvironmentOverride()).toBeNull();
  });
});
