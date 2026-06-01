/**
 * Unit tests for the derived environment model (issue #348).
 *
 * The 5-step precedence chain + URL sniffing was deleted: env is now derived
 * from two orthogonal signals — `connection.kind` (mock vs relay) and the
 * module-level `liveIntent` bit (relay-dev vs relay-live). These tests cover:
 *   - `deriveEnvironment(kind, liveIntent)` — the (connection.kind × liveIntent) matrix
 *   - `liveIntent` getter/setter
 *   - `isRelayEnv` / `isLiveRelayEnv` / `toLegacyEnv`
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

describe('deriveEnvironment — (connection.kind × liveIntent) matrix', () => {
  it('local kind → mock (liveIntent inert)', () => {
    expect(deriveEnvironment('local', false)).toBe('mock');
    // A stale liveIntent bit must NOT promote a local target to relay-live.
    expect(deriveEnvironment('local', true)).toBe('mock');
  });

  it('relay kind + liveIntent off → relay-dev', () => {
    expect(deriveEnvironment('relay', false)).toBe('relay-dev');
  });

  it('relay kind + liveIntent on → relay-live', () => {
    expect(deriveEnvironment('relay', true)).toBe('relay-live');
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
  it('isRelayEnv covers both relay variants', () => {
    expect(isRelayEnv('relay-dev')).toBe(true);
    expect(isRelayEnv('relay-live')).toBe(true);
    expect(isRelayEnv('mock')).toBe(false);
  });

  it('isLiveRelayEnv is true only for relay-live', () => {
    expect(isLiveRelayEnv('relay-live')).toBe(true);
    expect(isLiveRelayEnv('relay-dev')).toBe(false);
    expect(isLiveRelayEnv('mock')).toBe(false);
  });
});

describe('toLegacyEnv', () => {
  it('collapses the three-value env to mock | relay', () => {
    expect(toLegacyEnv('mock')).toBe('mock');
    expect(toLegacyEnv('relay-dev')).toBe('relay');
    expect(toLegacyEnv('relay-live')).toBe('relay');
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
