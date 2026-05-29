/**
 * Unit tests for the environment detection SSoT (RFC #277).
 *
 * Covers the precedence chain:
 *   1. test override (setEnvironmentOverride)
 *   2. MCP_ENV env var
 *   3. CDP target URL pattern match
 *   4. caller-stated defaultEnv (CLI mode intent — issue #309)
 *   5. baked-in default mock
 *
 * Plus the URL pattern matcher (`isRelayUrl`) directly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CdpTarget } from '../cdp-connection.js';
import {
  getEnvironment,
  getEnvironmentReason,
  isRelayUrl,
  setEnvironmentOverride,
} from '../environment.js';

function fakeConnection(targets: CdpTarget[]) {
  return { listTargets: () => targets };
}

describe('isRelayUrl — real-device WebView URL detection', () => {
  it('matches intoss-private:// scheme', () => {
    expect(isRelayUrl('intoss-private://miniapp?_deploymentId=xyz')).toBe(true);
    expect(isRelayUrl('INTOSS-PRIVATE://miniapp')).toBe(true);
  });

  it('matches *.trycloudflare.com host suffix', () => {
    expect(isRelayUrl('wss://abc123.trycloudflare.com/client/1')).toBe(true);
    expect(isRelayUrl('https://foo-bar.trycloudflare.com/')).toBe(true);
    expect(isRelayUrl('wss://x.trycloudflare.com')).toBe(true);
  });

  it('does not match arbitrary URLs', () => {
    expect(isRelayUrl('http://localhost:5173/')).toBe(false);
    expect(isRelayUrl('https://example.com/')).toBe(false);
    expect(isRelayUrl('')).toBe(false);
    // Substring-only match (no host structure) should not pass.
    expect(isRelayUrl('not-a-relay-url')).toBe(false);
  });

  it('rejects URLs that contain the suffix as a non-host fragment', () => {
    // Important: the suffix must be the host, not embedded in the path/query.
    expect(isRelayUrl('https://example.com/?back=trycloudflare.com')).toBe(false);
  });
});

describe('getEnvironment — precedence chain', () => {
  // Clean shared state between cases.
  const originalEnv = process.env.MCP_ENV;
  beforeEach(() => {
    setEnvironmentOverride(null);
    delete process.env.MCP_ENV;
  });
  afterEach(() => {
    setEnvironmentOverride(null);
    if (originalEnv === undefined) delete process.env.MCP_ENV;
    else process.env.MCP_ENV = originalEnv;
  });

  it('1. test override wins over everything', () => {
    process.env.MCP_ENV = 'relay-dev';
    setEnvironmentOverride('mock');
    expect(
      getEnvironment({
        connection: fakeConnection([{ id: 't', title: '', url: 'intoss-private://x' }]),
      }),
    ).toBe('mock');
    expect(getEnvironmentReason()).toBe('env-var-mock');
  });

  it('2. MCP_ENV=relay-dev wins over URL pattern + default', () => {
    process.env.MCP_ENV = 'relay-dev';
    expect(getEnvironment()).toBe('relay-dev');
    expect(getEnvironmentReason()).toBe('env-var-relay-dev');
  });

  it('2. MCP_ENV=relay-live wins over URL pattern + default', () => {
    process.env.MCP_ENV = 'relay-live';
    expect(getEnvironment()).toBe('relay-live');
    expect(getEnvironmentReason()).toBe('env-var-relay-live');
  });

  it('2. MCP_ENV=relay (backward-compat alias) → relay-dev', () => {
    process.env.MCP_ENV = 'relay';
    expect(getEnvironment()).toBe('relay-dev');
    expect(getEnvironmentReason()).toBe('env-var-relay-compat');
  });

  it('2. MCP_ENV=mock wins over URL pattern', () => {
    process.env.MCP_ENV = 'mock';
    const conn = fakeConnection([{ id: 't', title: '', url: 'intoss-private://miniapp' }]);
    expect(getEnvironment({ connection: conn })).toBe('mock');
    expect(getEnvironmentReason({ connection: conn })).toBe('env-var-mock');
  });

  it('MCP_ENV with garbage value is ignored — falls through to next step', () => {
    process.env.MCP_ENV = 'banana';
    expect(getEnvironment()).toBe('mock');
    expect(getEnvironmentReason()).toBe('default-mock');
  });

  it('3. CDP target URL pattern → relay-dev (conservative default)', () => {
    const conn = fakeConnection([
      { id: 't1', title: '', url: 'http://localhost:5173/' },
      { id: 't2', title: '', url: 'intoss-private://miniapp?_deploymentId=z' },
    ]);
    expect(getEnvironment({ connection: conn })).toBe('relay-dev');
    expect(getEnvironmentReason({ connection: conn })).toBe('cdp-target-url-relay-pattern');
  });

  it('3. CDP targets with only mundane URLs do NOT trigger relay', () => {
    const conn = fakeConnection([{ id: 't', title: '', url: 'http://localhost:5173/' }]);
    expect(getEnvironment({ connection: conn })).toBe('mock');
    expect(getEnvironmentReason({ connection: conn })).toBe('default-mock');
  });

  it('4. no signal → default mock', () => {
    expect(getEnvironment()).toBe('mock');
    expect(getEnvironmentReason()).toBe('default-mock');
  });

  it('no connection passed → only env var + default consulted', () => {
    expect(getEnvironment()).toBe('mock');
    process.env.MCP_ENV = 'relay-dev';
    expect(getEnvironment()).toBe('relay-dev');
  });

  // ---------------------------------------------------------------------------
  // defaultEnv (caller-stated default) — precedence step 3.
  // Resolves the M2-5 dead-lock (issue #309) — debug-mode relay target needs
  // `build_attach_url` visible from the first `tools/list` even without any
  // attached target or `MCP_ENV` override.
  // ---------------------------------------------------------------------------

  it('defaultEnv=relay-dev → fresh session (no env var, no targets) resolves to relay-dev', () => {
    expect(getEnvironment({ defaultEnv: 'relay-dev' })).toBe('relay-dev');
    expect(getEnvironmentReason({ defaultEnv: 'relay-dev' })).toBe('default-relay-dev');
  });

  it('defaultEnv=mock (explicit) is identical to the historical default', () => {
    expect(getEnvironment({ defaultEnv: 'mock' })).toBe('mock');
    expect(getEnvironmentReason({ defaultEnv: 'mock' })).toBe('default-mock');
  });

  it('defaultEnv does NOT override MCP_ENV', () => {
    process.env.MCP_ENV = 'mock';
    expect(getEnvironment({ defaultEnv: 'relay-dev' })).toBe('mock');
    expect(getEnvironmentReason({ defaultEnv: 'relay-dev' })).toBe('env-var-mock');
  });

  it('defaultEnv does NOT override CDP URL pattern (relay target wins)', () => {
    // Even with defaultEnv=mock, a real-device URL forces relay-dev.
    const conn = fakeConnection([{ id: 't', title: '', url: 'intoss-private://miniapp' }]);
    expect(getEnvironment({ connection: conn, defaultEnv: 'mock' })).toBe('relay-dev');
    expect(getEnvironmentReason({ connection: conn, defaultEnv: 'mock' })).toBe(
      'cdp-target-url-relay-pattern',
    );
  });

  it('defaultEnv=relay-dev + connection with mundane targets → still relay-dev (URL pattern absent)', () => {
    // No real-device URL → fallback to caller-stated default.
    const conn = fakeConnection([{ id: 't', title: '', url: 'http://localhost:5173/' }]);
    expect(getEnvironment({ connection: conn, defaultEnv: 'relay-dev' })).toBe('relay-dev');
    expect(getEnvironmentReason({ connection: conn, defaultEnv: 'relay-dev' })).toBe(
      'default-relay-dev',
    );
  });

  it('defaultEnv=relay-dev + empty target list → relay-dev (the M2-5 first-listTools path)', () => {
    const conn = fakeConnection([]);
    expect(getEnvironment({ connection: conn, defaultEnv: 'relay-dev' })).toBe('relay-dev');
    expect(getEnvironmentReason({ connection: conn, defaultEnv: 'relay-dev' })).toBe(
      'default-relay-dev',
    );
  });
});

describe('setEnvironmentOverride — test hook', () => {
  afterEach(() => setEnvironmentOverride(null));

  it('clears with null', () => {
    setEnvironmentOverride('relay-dev');
    expect(getEnvironment()).toBe('relay-dev');
    setEnvironmentOverride(null);
    expect(getEnvironment()).toBe('mock');
  });
});
