/**
 * Scenario parity probes — 4-scenario MCP tool schema validation
 *
 * These probes verify that list_pages, measure_safe_area, and
 * call_sdk(getOperationalEnvironment) return the same JSON envelope
 * (schema parity) across all four environments (Env 1–4).
 *
 * In the mock runner they validate the mock-side shape.
 * In the relay runner they validate the relay-side shape.
 * The diff compares the two and labels intentional differences as
 * EXPECTED_MISMATCH via whitelist.json.
 *
 * Reference: docs/qa/scenarios.md, docs/mock-fidelity-catalog.md §"시나리오별 MCP tool 응답 diff snapshot"
 */

import type { Probe } from '../types.js';

// ---------------------------------------------------------------------------
// Mock-side implementations
// These run in the jsdom mock runner and return the mock-equivalent of what
// the MCP tools would return from the devtools MCP server.
// ---------------------------------------------------------------------------

/**
 * list_pages mock shape — mirrors AIT_getMockState + mock env defaults.
 * The mock runner doesn't spin up a real MCP server; it reproduces the
 * expected shape that devtools-mcp returns in local/mock mode.
 */
function buildMockListPagesShape(): unknown {
  return {
    pages: [
      {
        url: 'http://localhost:4173/',
        lastSeenAt: new Date().toISOString(),
      },
    ],
    tunnel: { up: false },
    singleAttachModel: true,
    crashDetectedAt: null,
  };
}

/**
 * measure_safe_area mock shape — source: "mock", sdkInsetsSource: "window.__ait".
 * Mirrors what devtools-mcp returns when running in local/mock mode.
 */
function buildMockMeasureSafeAreaShape(): unknown {
  return {
    source: 'mock',
    sdkInsetsSource: 'window.__ait',
    sdkInsets: { top: 54, bottom: 34, left: 0, right: 0 },
    cssEnv: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
    userAgent: 'Mozilla/5.0 (desktop) Chrome mock',
  };
}

/**
 * call_sdk(getOperationalEnvironment) mock shape.
 * Mock state default: environment = "sandbox".
 */
function buildMockCallSdkGetOpEnvShape(): unknown {
  return {
    ok: true,
    value: { environment: 'sandbox' },
  };
}

// ---------------------------------------------------------------------------
// Schema validators
// ---------------------------------------------------------------------------

function assertListPagesSchema(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error('list_pages: result must be an object');
  }
  const v = value as Record<string, unknown>;

  if (!Array.isArray(v.pages)) {
    throw new Error('list_pages: "pages" must be an array');
  }

  if (typeof v.tunnel !== 'object' || v.tunnel === null) {
    throw new Error('list_pages: "tunnel" must be an object');
  }
  const tunnel = v.tunnel as Record<string, unknown>;
  if (typeof tunnel.up !== 'boolean') {
    throw new Error('list_pages: "tunnel.up" must be a boolean');
  }
}

function assertMeasureSafeAreaSchema(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error('measure_safe_area: result must be an object');
  }
  const v = value as Record<string, unknown>;

  if (typeof v.source !== 'string') {
    throw new Error('measure_safe_area: "source" must be a string');
  }
  if (v.source !== 'mock' && v.source !== 'relay') {
    throw new Error(
      `measure_safe_area: "source" must be "mock" or "relay", got ${String(v.source)}`,
    );
  }
  if (typeof v.sdkInsetsSource !== 'string') {
    throw new Error('measure_safe_area: "sdkInsetsSource" must be a string');
  }
  if (typeof v.sdkInsets !== 'object' || v.sdkInsets === null) {
    throw new Error('measure_safe_area: "sdkInsets" must be an object');
  }
  const insets = v.sdkInsets as Record<string, unknown>;
  for (const field of ['top', 'bottom', 'left', 'right'] as const) {
    if (typeof insets[field] !== 'number') {
      throw new Error(`measure_safe_area: "sdkInsets.${field}" must be a number`);
    }
  }
  if (typeof v.userAgent !== 'string') {
    throw new Error('measure_safe_area: "userAgent" must be a string');
  }
}

function assertCallSdkGetOpEnvSchema(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error('call_sdk(getOperationalEnvironment): result must be an object');
  }
  const v = value as Record<string, unknown>;

  if (typeof v.ok !== 'boolean') {
    throw new Error('call_sdk(getOperationalEnvironment): "ok" must be a boolean');
  }
  // When ok=true, value must be present
  if (v.ok === true && (typeof v.value !== 'object' || v.value === null)) {
    throw new Error('call_sdk(getOperationalEnvironment): "value" must be an object when ok=true');
  }
  // When ok=false, error must be present
  if (v.ok === false && typeof v.error !== 'string') {
    throw new Error('call_sdk(getOperationalEnvironment): "error" must be a string when ok=false');
  }
}

// ---------------------------------------------------------------------------
// Probe definitions
// ---------------------------------------------------------------------------

export const scenarioParityProbes: Probe[] = [
  {
    id: 'scenario-parity.listPages.schema',
    domain: 'environment',
    async run() {
      const shape = buildMockListPagesShape();
      assertListPagesSchema(shape);
      // Return a normalized snapshot (omit volatile lastSeenAt)
      const s = shape as Record<string, unknown>;
      const pages = (s.pages as Array<Record<string, unknown>>).map((p) => ({
        url: typeof p.url === 'string' ? normalizeUrl(p.url) : p.url,
      }));
      return {
        pages,
        tunnel: s.tunnel,
        singleAttachModel: s.singleAttachModel,
        crashDetectedAt: s.crashDetectedAt,
      };
    },
  },
  {
    id: 'scenario-parity.measureSafeArea.schema',
    domain: 'safe-area',
    async run() {
      const shape = buildMockMeasureSafeAreaShape();
      assertMeasureSafeAreaSchema(shape);
      // Return normalized: omit volatile userAgent (whitelisted diff), keep structural fields
      const s = shape as Record<string, unknown>;
      return {
        source: s.source,
        sdkInsetsSource: s.sdkInsetsSource,
        sdkInsets: s.sdkInsets,
        // cssEnv and userAgent differ between mock and relay — return sentinel keys
        cssEnvPresent: typeof s.cssEnv === 'object' && s.cssEnv !== null,
        userAgentPresent: typeof s.userAgent === 'string' && (s.userAgent as string).length > 0,
      };
    },
  },
  {
    id: 'scenario-parity.callSdkGetOpEnv.schema',
    domain: 'environment',
    async run() {
      const shape = buildMockCallSdkGetOpEnvShape();
      assertCallSdkGetOpEnvSchema(shape);
      // Return normalized: ok + environment key (value differs by env — whitelisted)
      const s = shape as Record<string, unknown>;
      const valueObj = s.value as Record<string, unknown> | undefined;
      return {
        ok: s.ok,
        hasValue: s.ok === true && valueObj !== undefined,
        hasError: s.ok === false && typeof s.error === 'string',
        // environment value intentionally differs across envs — return type only
        environmentType: valueObj ? typeof valueObj.environment : null,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize localhost URLs to a canonical form for stable snapshot comparison */
function normalizeUrl(url: string): string {
  if (url.startsWith('http://localhost:')) return 'http://localhost:<port>/';
  if (/^https?:\/\/[^.]+\.trycloudflare\.com/.test(url)) return 'https://<hash>.trycloudflare.com/';
  if (url.startsWith('intoss-private://')) return 'intoss-private://<app>?_deploymentId=<uuid>';
  return url;
}
