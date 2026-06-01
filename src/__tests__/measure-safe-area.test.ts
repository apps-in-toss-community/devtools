/**
 * Unit tests for `measure_safe_area` MCP tool (devtools#198).
 *
 * These tests verify the normalization / parsing layer (`normalizeSafeAreaResult`,
 * `measureSafeArea`) using a fake `CdpConnection` that returns canned
 * `Runtime.evaluate` responses. No phone, no relay, no running server needed.
 *
 * Also covers:
 * - `SafeAreaProvenance` field presence on `ViewportPreset`
 * - provenance badge rendering in the Viewport panel tab (jsdom DOM)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../mcp/cdp-connection.js';
import {
  measureSafeArea,
  normalizeSafeAreaResult,
  SAFE_AREA_PROBE_EXPRESSION,
} from '../mcp/tools.js';
import type { SafeAreaProvenance } from '../mock/types.js';
import { VIEWPORT_PRESETS } from '../panel/viewport.js';

/* -------------------------------------------------------------------------- */
/* Fake CdpConnection                                                          */
/* -------------------------------------------------------------------------- */

type CannedResults = Partial<{
  [M in CdpCommandName]: CdpCommandMap[M]['result'];
}>;

/**
 * Minimal fake `CdpConnection` that returns canned `send()` results.
 * Only the methods used by `measureSafeArea` are wired; the rest are no-ops.
 */
function makeFakeConnection(canned: CannedResults = {}): CdpConnection {
  return {
    kind: 'relay' as const,
    enableDomains: () => Promise.resolve(),
    listTargets: (): CdpTarget[] => [],
    getBufferedEvents: <E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> => [],
    on:
      <E extends CdpEventName>(
        _event: E,
        _listener: (payload: CdpEventMap[E]) => void,
      ): (() => void) =>
      () => {},
    send: <M extends CdpCommandName>(
      method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> => {
      if (method in canned) {
        return Promise.resolve(canned[method] as CdpCommandMap[M]['result']);
      }
      return Promise.reject(new Error(`FakeCdpConnection: no canned result for ${method}`));
    },
  };
}

/** Builds a canned `Runtime.evaluate` result wrapping a JSON probe payload. */
function cannedEvalResult(
  payload: Record<string, unknown>,
): CdpCommandMap['Runtime.evaluate']['result'] {
  return {
    result: {
      type: 'string',
      value: JSON.stringify(payload),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* normalizeSafeAreaResult — unit tests for the pure parsing layer            */
/* -------------------------------------------------------------------------- */

describe('normalizeSafeAreaResult', () => {
  it('parses a complete probe payload', () => {
    const payload = {
      cssEnv: { top: 0, right: 0, bottom: 0, left: 0 },
      sdkInsets: { top: 54, right: 0, bottom: 34, left: 0 },
      navBarHeight: 54,
      innerWidth: 393,
      innerHeight: 852,
      devicePixelRatio: 3,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    };
    const result = normalizeSafeAreaResult(JSON.stringify(payload), 'mock');
    expect(result.cssEnv).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(result.sdkInsets).toEqual({ top: 54, right: 0, bottom: 34, left: 0 });
    expect(result.navBarHeight).toBe(54);
    expect(result.innerWidth).toBe(393);
    expect(result.innerHeight).toBe(852);
    expect(result.devicePixelRatio).toBe(3);
    expect(result.userAgent).toContain('iPhone');
  });

  it('handles null sdkInsets (non-Toss WebView)', () => {
    const payload = {
      cssEnv: { top: 44, right: 0, bottom: 34, left: 0 },
      sdkInsets: null,
      navBarHeight: null,
      innerWidth: 390,
      innerHeight: 844,
      devicePixelRatio: 3,
      userAgent: 'Chrome/120',
    };
    const result = normalizeSafeAreaResult(JSON.stringify(payload), 'mock');
    expect(result.sdkInsets).toBeNull();
    expect(result.navBarHeight).toBeNull();
  });

  it('falls back to 0 for missing numeric fields', () => {
    // Minimal payload — missing most fields
    const result = normalizeSafeAreaResult(JSON.stringify({}), 'mock');
    expect(result.cssEnv).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(result.sdkInsets).toBeNull();
    expect(result.innerWidth).toBe(0);
    expect(result.innerHeight).toBe(0);
    expect(result.devicePixelRatio).toBe(1);
    expect(result.userAgent).toBe('');
  });

  it('throws on non-string input', () => {
    expect(() => normalizeSafeAreaResult(42, 'mock')).toThrow('unexpected type');
    expect(() => normalizeSafeAreaResult(null, 'mock')).toThrow('unexpected type');
    expect(() => normalizeSafeAreaResult(undefined, 'mock')).toThrow('unexpected type');
  });

  it('throws on non-JSON string', () => {
    expect(() => normalizeSafeAreaResult('not json', 'mock')).toThrow('non-JSON string');
  });

  it('throws on JSON that is not an object', () => {
    expect(() => normalizeSafeAreaResult(JSON.stringify([1, 2, 3]), 'mock')).toThrow(
      'not an object',
    );
  });

  it('handles cssEnv with partial fields gracefully', () => {
    const payload = {
      cssEnv: { top: 10 },
      innerWidth: 375,
      innerHeight: 667,
      devicePixelRatio: 2,
    };
    const result = normalizeSafeAreaResult(JSON.stringify(payload), 'mock');
    expect(result.cssEnv.top).toBe(10);
    expect(result.cssEnv.right).toBe(0);
    expect(result.cssEnv.bottom).toBe(0);
    expect(result.cssEnv.left).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* measureSafeArea — integration with fake CdpConnection                      */
/* -------------------------------------------------------------------------- */

describe('measureSafeArea', () => {
  it('sends Runtime.evaluate and returns a normalized measurement', async () => {
    const payload = {
      cssEnv: { top: 0, right: 0, bottom: 0, left: 0 },
      sdkInsets: { top: 54, right: 0, bottom: 34, left: 0 },
      navBarHeight: 54,
      innerWidth: 393,
      innerHeight: 852,
      devicePixelRatio: 3,
      userAgent: 'AppsInToss TossApp/5.261.0',
    };
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalResult(payload),
    });
    const result = await measureSafeArea(conn, 'relay-dev');
    expect(result.source).toBe('relay-dev');
    expect(result.sdkInsets?.top).toBe(54);
    expect(result.sdkInsets?.bottom).toBe(34);
    expect(result.innerWidth).toBe(393);
    expect(result.devicePixelRatio).toBe(3);
    // UA is returned as-is for device identification — no secrets present
    expect(result.userAgent).toBe('AppsInToss TossApp/5.261.0');
  });

  it('throws when the probe throws a CDP exception', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': {
        result: { type: 'undefined' },
        exceptionDetails: {
          text: 'ReferenceError: SafeAreaInsets is not defined',
          exception: {
            type: 'object',
            description: 'ReferenceError: SafeAreaInsets is not defined',
          },
        },
      },
    });
    await expect(measureSafeArea(conn, 'mock')).rejects.toThrow('probe threw');
  });

  it('throws when the probe returns a non-string value', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': {
        result: { type: 'number', value: 42 },
      },
    });
    await expect(measureSafeArea(conn, 'mock')).rejects.toThrow('unexpected type');
  });

  it('rejects when Runtime.evaluate is not in canned results', async () => {
    const conn = makeFakeConnection({});
    await expect(measureSafeArea(conn, 'mock')).rejects.toThrow(
      'no canned result for Runtime.evaluate',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SAFE_AREA_PROBE_EXPRESSION — sanity check                                  */
/* -------------------------------------------------------------------------- */

describe('SAFE_AREA_PROBE_EXPRESSION', () => {
  it('is a non-empty string', () => {
    expect(typeof SAFE_AREA_PROBE_EXPRESSION).toBe('string');
    expect(SAFE_AREA_PROBE_EXPRESSION.length).toBeGreaterThan(0);
  });

  it('does not contain any secret or token patterns', () => {
    // Confirm the probe expression does not inadvertently reference auth tokens
    expect(SAFE_AREA_PROBE_EXPRESSION).not.toContain('secret');
    expect(SAFE_AREA_PROBE_EXPRESSION).not.toContain('token');
    expect(SAFE_AREA_PROBE_EXPRESSION).not.toContain('TOTP');
    expect(SAFE_AREA_PROBE_EXPRESSION).not.toContain('password');
  });

  it('contains the expected CSS env var reads', () => {
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('safe-area-inset-top');
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('safe-area-inset-right');
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('safe-area-inset-bottom');
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('safe-area-inset-left');
  });

  it('reads navigator.userAgent', () => {
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('navigator.userAgent');
  });

  it('reads innerWidth, innerHeight, devicePixelRatio', () => {
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('innerWidth');
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('innerHeight');
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('devicePixelRatio');
  });
});

/* -------------------------------------------------------------------------- */
/* ViewportPreset safeAreaProvenance field                                     */
/* -------------------------------------------------------------------------- */

describe('ViewportPreset.safeAreaProvenance', () => {
  it('iphone-15-pro has provenance source=measured with device and date', () => {
    const preset = VIEWPORT_PRESETS.find((p) => p.id === 'iphone-15-pro');
    expect(preset).toBeDefined();
    expect(preset?.safeAreaProvenance?.source).toBe('measured');
    expect(preset?.safeAreaProvenance?.device).toContain('iPhone 15 Pro');
    expect(preset?.safeAreaProvenance?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('all iOS presets except iphone-15-pro have provenance source=extrapolated', () => {
    const iosIds = [
      'iphone-se-3',
      'iphone-16e',
      'iphone-17',
      'iphone-air',
      'iphone-17-pro',
      'iphone-17-pro-max',
    ] as const;
    for (const id of iosIds) {
      const preset = VIEWPORT_PRESETS.find((p) => p.id === id);
      expect(preset, `preset ${id} should exist`).toBeDefined();
      expect(preset?.safeAreaProvenance?.source, `${id} should be extrapolated`).toBe(
        'extrapolated',
      );
    }
  });

  it('all Samsung/Galaxy presets have provenance source=placeholder', () => {
    const galaxyIds = [
      'galaxy-s26',
      'galaxy-s26-plus',
      'galaxy-s26-ultra',
      'galaxy-z-flip7',
      'galaxy-z-fold7-folded',
      'galaxy-z-fold7-unfolded',
    ] as const;
    for (const id of galaxyIds) {
      const preset = VIEWPORT_PRESETS.find((p) => p.id === id);
      expect(preset, `preset ${id} should exist`).toBeDefined();
      expect(preset?.safeAreaProvenance?.source, `${id} should be placeholder`).toBe('placeholder');
    }
  });

  it('none and custom presets have no safeAreaProvenance', () => {
    const nonePreset = VIEWPORT_PRESETS.find((p) => p.id === 'none');
    const customPreset = VIEWPORT_PRESETS.find((p) => p.id === 'custom');
    expect(nonePreset?.safeAreaProvenance).toBeUndefined();
    expect(customPreset?.safeAreaProvenance).toBeUndefined();
  });

  it('SafeAreaProvenance type accepts all three source values', () => {
    // Type-level check via runtime value construction
    const measured: SafeAreaProvenance = { source: 'measured', device: 'test', date: '2026-01-01' };
    const extrapolated: SafeAreaProvenance = { source: 'extrapolated' };
    const placeholder: SafeAreaProvenance = { source: 'placeholder' };
    expect(measured.source).toBe('measured');
    expect(extrapolated.source).toBe('extrapolated');
    expect(placeholder.source).toBe('placeholder');
  });
});

/* -------------------------------------------------------------------------- */
/* Provenance badge DOM rendering                                              */
/* -------------------------------------------------------------------------- */

describe('provenanceBadge (Viewport tab DOM)', () => {
  // We test the badge via the rendered Viewport tab DOM.
  // This requires aitState to be set up with a preset that has a provenance.
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = '';
  });

  it('renders a "(추정치)" badge for an extrapolated preset', async () => {
    const { aitState } = await import('../mock/state.js');
    const { renderViewportTab } = await import('../panel/tabs/viewport.js');
    const { initViewport, _resetViewportInit, disposeViewport } = await import(
      '../panel/viewport.js'
    );

    _resetViewportInit();
    aitState.reset();
    aitState.patch('viewport', {
      preset: 'iphone-17-pro',
      aitNavBar: true,
      aitNavBarType: 'partner',
    });
    cleanup = initViewport();

    const container = renderViewportTab();
    document.body.appendChild(container);

    const badge = document.querySelector('.ait-provenance-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('(추정치)');

    _resetViewportInit();
    disposeViewport();
  });

  it('renders a "(미측정)" badge for a placeholder preset', async () => {
    const { aitState } = await import('../mock/state.js');
    const { renderViewportTab } = await import('../panel/tabs/viewport.js');
    const { initViewport, _resetViewportInit, disposeViewport } = await import(
      '../panel/viewport.js'
    );

    _resetViewportInit();
    aitState.reset();
    aitState.patch('viewport', { preset: 'galaxy-s26', aitNavBar: true, aitNavBarType: 'partner' });
    cleanup = initViewport();

    const container = renderViewportTab();
    document.body.appendChild(container);

    const badge = document.querySelector('.ait-provenance-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('(미측정)');

    _resetViewportInit();
    disposeViewport();
  });

  it('renders no badge for the measured iphone-15-pro preset', async () => {
    const { aitState } = await import('../mock/state.js');
    const { renderViewportTab } = await import('../panel/tabs/viewport.js');
    const { initViewport, _resetViewportInit, disposeViewport } = await import(
      '../panel/viewport.js'
    );

    _resetViewportInit();
    aitState.reset();
    aitState.patch('viewport', {
      preset: 'iphone-15-pro',
      aitNavBar: true,
      aitNavBarType: 'partner',
    });
    cleanup = initViewport();

    const container = renderViewportTab();
    document.body.appendChild(container);

    const badge = document.querySelector('.ait-provenance-badge');
    expect(badge).toBeNull();

    _resetViewportInit();
    disposeViewport();
  });

  it('renders no badge when preset=none', async () => {
    const { aitState } = await import('../mock/state.js');
    const { renderViewportTab } = await import('../panel/tabs/viewport.js');
    const { _resetViewportInit, disposeViewport } = await import('../panel/viewport.js');

    _resetViewportInit();
    aitState.reset();
    // preset=none is the default

    const container = renderViewportTab();
    document.body.appendChild(container);

    const badge = document.querySelector('.ait-provenance-badge');
    expect(badge).toBeNull();

    _resetViewportInit();
    disposeViewport();
  });
});
