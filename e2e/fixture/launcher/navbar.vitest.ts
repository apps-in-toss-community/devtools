// Unit tests for the pure nav-bar emulation logic (#495). The `.vitest.ts`
// extension keeps Playwright (testMatch '**/*.test.ts') from collecting this
// file — see vitest.config.ts `include`.

import { describe, expect, it } from 'vitest';
import {
  AIT_NAV_BAR_HEIGHT_PARTNER,
  computeNavBarBridgeInsets,
  parseNavBarType,
  resolveAppTitle,
} from './navbar.js';

describe('AIT_NAV_BAR_HEIGHT_PARTNER', () => {
  it('matches the real-device measured partner nav-bar height (#190)', () => {
    // Duplicated from src/panel/viewport.ts by value (the fixture does not import
    // from src/). If this assertion fails the two constants have drifted.
    expect(AIT_NAV_BAR_HEIGHT_PARTNER).toBe(54);
  });
});

describe('parseNavBarType', () => {
  it('navBarType=game → game', () => {
    expect(parseNavBarType('?navBarType=game')).toBe('game');
  });

  it('navBarType=partner → partner', () => {
    expect(parseNavBarType('?navBarType=partner')).toBe('partner');
  });

  it('absent → partner (default)', () => {
    expect(parseNavBarType('')).toBe('partner');
    expect(parseNavBarType('?url=https://example.com')).toBe('partner');
  });

  it('unknown value → partner (default, not game)', () => {
    expect(parseNavBarType('?navBarType=external')).toBe('partner');
  });
});

describe('resolveAppTitle', () => {
  it('name=... → trimmed name', () => {
    expect(resolveAppTitle('?name=My%20App')).toBe('My App');
    expect(resolveAppTitle('?name=%20%20Trimmed%20%20')).toBe('Trimmed');
  });

  it('absent → null (caller uses i18n default)', () => {
    expect(resolveAppTitle('')).toBeNull();
    expect(resolveAppTitle('?url=https://example.com')).toBeNull();
  });

  it('blank/whitespace-only → null (caller uses i18n default)', () => {
    expect(resolveAppTitle('?name=')).toBeNull();
    expect(resolveAppTitle('?name=%20%20%20')).toBeNull();
  });

  it('never echoes a tunnel host even if one is passed as name (caller never does this)', () => {
    // The launcher only ever passes name= from an explicit friendly name; this
    // test documents that resolveAppTitle has no host-deriving fallback — it
    // returns exactly what name= holds, and null otherwise. The host is never
    // sourced here.
    expect(resolveAppTitle('?url=https%3A%2F%2Fabc.trycloudflare.com')).toBeNull();
  });
});

describe('computeNavBarBridgeInsets', () => {
  const raw = { top: 47, bottom: 34, left: 0, right: 0 };

  // -------------------------------------------------------------------------
  // partner: top forced to 0 (bar is launcher chrome, iframe sits below it)
  // -------------------------------------------------------------------------

  it('partner + healthy → top 0, bottom raw', () => {
    const result = computeNavBarBridgeInsets(raw, false, 'partner');
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(34);
    expect(result.left).toBe(0);
    expect(result.right).toBe(0);
  });

  it('partner + letterbox → top 0, bottom 0 (#491 bottom correction still applies)', () => {
    const result = computeNavBarBridgeInsets(raw, true, 'partner');
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(0);
  });

  it('partner: real-device today (top 47 / phantom bottom 34, letterbox) → top 0, bottom 0', () => {
    const result = computeNavBarBridgeInsets(
      { top: 47, bottom: 34, left: 0, right: 0 },
      true,
      'partner',
    );
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(0);
  });

  // -------------------------------------------------------------------------
  // game: full-bleed — raw top passes through (capsule is a transparent overlay)
  // -------------------------------------------------------------------------

  it('game + healthy → raw top and bottom pass through (full-bleed)', () => {
    const result = computeNavBarBridgeInsets(raw, false, 'game');
    expect(result.top).toBe(47);
    expect(result.bottom).toBe(34);
  });

  it('game + letterbox → raw top kept, bottom zeroed (#491)', () => {
    const result = computeNavBarBridgeInsets(raw, true, 'game');
    expect(result.top).toBe(47);
    expect(result.bottom).toBe(0);
  });

  it('left/right always pass through (landscape side insets)', () => {
    const sideInsets = { top: 0, bottom: 20, left: 59, right: 59 };
    expect(computeNavBarBridgeInsets(sideInsets, false, 'game').left).toBe(59);
    expect(computeNavBarBridgeInsets(sideInsets, false, 'partner').right).toBe(59);
  });
});
