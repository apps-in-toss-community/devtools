// Unit tests for the pure nav-bar emulation logic (#495/#507/#510). The
// `.vitest.ts` extension keeps Playwright (testMatch '**/*.test.ts') from
// collecting this file — see vitest.config.ts `include`.

import { describe, expect, it } from 'vitest';
// Ground truth: panel env-1 CSS constants exported from src/panel/styles.ts.
// Any drift between the launcher constants (below) and the panel CSS values
// (here) will be caught by the parity assertions in this file.
import {
  PANEL_NAVBAR_BACK_FONT_SIZE_PX,
  PANEL_NAVBAR_BACK_GLYPH,
  PANEL_NAVBAR_BACK_PADDING,
  PANEL_NAVBAR_ICON_SIZE_PX,
  PANEL_NAVBAR_TITLE_GAP_PX,
  PANEL_NAVBAR_TITLE_MARGIN_LEFT_PX,
} from '../../../src/panel/styles.js';
import {
  AIT_NAV_BAR_HEIGHT_PARTNER,
  computeNavBarBridgeInsets,
  extractLauncherSearch,
  LAUNCHER_NAVBAR_BACK_FONT_SIZE_PX,
  LAUNCHER_NAVBAR_BACK_GLYPH,
  LAUNCHER_NAVBAR_BACK_PADDING,
  LAUNCHER_NAVBAR_ICON_SIZE_PX,
  LAUNCHER_NAVBAR_TITLE_GAP_PX,
  LAUNCHER_NAVBAR_TITLE_MARGIN_LEFT_PX,
  parseNavBarType,
  resolveAppIcon,
  resolveAppTitle,
} from './navbar.js';

describe('AIT_NAV_BAR_HEIGHT_PARTNER', () => {
  it('matches the real-device measured partner nav-bar height (#190)', () => {
    // Duplicated from src/panel/viewport.ts by value (the fixture does not import
    // from src/). If this assertion fails the two constants have drifted.
    expect(AIT_NAV_BAR_HEIGHT_PARTNER).toBe(54);
  });
});

// ---------------------------------------------------------------------------
// Spacing parity guard (#510): bidirectional — both sides import real constants,
// so a change to either src/panel/styles.ts OR navbar.ts will break these tests.
// ---------------------------------------------------------------------------

describe('launcher nav-bar spacing parity with panel styles.ts (#510)', () => {
  it('icon size: launcher constant matches panel .ait-navbar-icon (width/height)', () => {
    expect(LAUNCHER_NAVBAR_ICON_SIZE_PX).toBe(PANEL_NAVBAR_ICON_SIZE_PX);
  });

  it('title-group gap: launcher constant matches panel .ait-navbar-title gap', () => {
    expect(LAUNCHER_NAVBAR_TITLE_GAP_PX).toBe(PANEL_NAVBAR_TITLE_GAP_PX);
  });

  it('title-group marginLeft: launcher constant matches panel .ait-navbar-title margin-left', () => {
    expect(LAUNCHER_NAVBAR_TITLE_MARGIN_LEFT_PX).toBe(PANEL_NAVBAR_TITLE_MARGIN_LEFT_PX);
  });

  it('back-button font-size: launcher constant matches panel .ait-navbar-back font-size', () => {
    expect(LAUNCHER_NAVBAR_BACK_FONT_SIZE_PX).toBe(PANEL_NAVBAR_BACK_FONT_SIZE_PX);
  });

  it('back-button padding: launcher constant matches panel .ait-navbar-back padding', () => {
    expect(LAUNCHER_NAVBAR_BACK_PADDING).toBe(PANEL_NAVBAR_BACK_PADDING);
  });

  it('back glyph: launcher constant matches panel viewport.ts glyph', () => {
    expect(LAUNCHER_NAVBAR_BACK_GLYPH).toBe(PANEL_NAVBAR_BACK_GLYPH);
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

describe('resolveAppIcon', () => {
  // -------------------------------------------------------------------------
  // icon= param — explicit icon URL
  // -------------------------------------------------------------------------

  it('icon= with absolute https:// URL → returns it as-is', () => {
    expect(resolveAppIcon('?icon=https%3A%2F%2Fexample.com%2Ficon.png')).toBe(
      'https://example.com/icon.png',
    );
  });

  it('icon= with http:// URL → null (rejected)', () => {
    expect(resolveAppIcon('?icon=http%3A%2F%2Fexample.com%2Ficon.png')).toBeNull();
  });

  it('icon= with javascript: → null (rejected)', () => {
    expect(resolveAppIcon('?icon=javascript%3Aalert(1)')).toBeNull();
  });

  it('icon= with data: URL → null (rejected)', () => {
    expect(resolveAppIcon('?icon=data%3Aimage%2Fpng%3Bbase64%2Cabc')).toBeNull();
  });

  it('icon= with a relative path → null (not a valid URL)', () => {
    expect(resolveAppIcon('?icon=%2Ficon.png')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Fallback: url= origin + /favicon.ico
  // -------------------------------------------------------------------------

  it('icon= absent + url= https → derives <origin>/favicon.ico', () => {
    expect(resolveAppIcon('?url=https%3A%2F%2Fexample.trycloudflare.com%2Fsome%2Fpath')).toBe(
      'https://example.trycloudflare.com/favicon.ico',
    );
  });

  it('icon= absent + url= https with port → preserves port in origin', () => {
    expect(resolveAppIcon('?url=https%3A%2F%2Fexample.com%3A8443%2F')).toBe(
      'https://example.com:8443/favicon.ico',
    );
  });

  it('icon= absent + url= http → null (http framed origins not allowed in prod)', () => {
    expect(resolveAppIcon('?url=http%3A%2F%2Fexample.com%2F')).toBeNull();
  });

  it('icon= absent + no url= → null', () => {
    expect(resolveAppIcon('')).toBeNull();
    expect(resolveAppIcon('?name=My%20App')).toBeNull();
  });

  it('icon= absent + url= that is not a valid URL → null', () => {
    expect(resolveAppIcon('?url=not-a-url')).toBeNull();
  });
});

describe('extractLauncherSearch (#507)', () => {
  // Launcher-style URLs carry a `url=` param pointing at the tunnel.
  // Nav-bar params (name=/icon=/navBarType=) live on the outer launcher URL.

  it('launcher URL with name + icon + navBarType → returns its search string', () => {
    const launcherUrl =
      'https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Fexample.com%2F&name=My%20App&icon=https%3A%2F%2Fexample.com%2Ficon.png&navBarType=game';
    const result = extractLauncherSearch(launcherUrl);
    expect(result).not.toBeNull();
    const params = new URLSearchParams(result ?? '');
    expect(params.get('name')).toBe('My App');
    expect(params.get('icon')).toBe('https://example.com/icon.png');
    expect(params.get('navBarType')).toBe('game');
    expect(params.get('url')).toBe('https://example.com/');
  });

  it('launcher URL with url= but no name/icon → returns search (resolveAppTitle will return null)', () => {
    const launcherUrl = 'https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Fexample.com%2F';
    const result = extractLauncherSearch(launcherUrl);
    expect(result).not.toBeNull();
    // The returned search can be fed to resolveAppTitle — should yield null (no name=).
    expect(resolveAppTitle(result ?? '')).toBeNull();
  });

  it('direct tunnel URL (no url= param) → null', () => {
    expect(extractLauncherSearch('https://example.trycloudflare.com/')).toBeNull();
    expect(
      extractLauncherSearch(
        'https://example.trycloudflare.com/?debug=1&relay=wss%3A%2F%2Fexample.com',
      ),
    ).toBeNull();
  });

  it('non-URL string → null', () => {
    expect(extractLauncherSearch('not-a-url')).toBeNull();
    expect(extractLauncherSearch('hello world')).toBeNull();
  });

  it('empty string → null', () => {
    expect(extractLauncherSearch('')).toBeNull();
  });

  it('launcher URL with url= and name= → resolveAppTitle returns the name', () => {
    const launcherUrl =
      'https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Fexample.com%2F&name=SDK%20Example';
    const search = extractLauncherSearch(launcherUrl);
    expect(search).not.toBeNull();
    expect(resolveAppTitle(search ?? '')).toBe('SDK Example');
  });

  it('launcher URL search can be re-parsed by parseNavBarType and resolveAppIcon', () => {
    const launcherUrl =
      'https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Fexample.com%2F&navBarType=game&icon=https%3A%2F%2Fexample.com%2Flogo.png';
    const search = extractLauncherSearch(launcherUrl);
    expect(search).not.toBeNull();
    expect(parseNavBarType(search ?? '')).toBe('game');
    expect(resolveAppIcon(search ?? '')).toBe('https://example.com/logo.png');
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

  it('partner + letterbox + corrected (default) → top 0, bottom RESTORED 34 (#527)', () => {
    // screen.height px correction: frame reaches real bottom → restore bottom inset.
    const result = computeNavBarBridgeInsets(raw, true, 'partner');
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(34);
  });

  it('partner + letterbox + NOT corrected (legacy) → top 0, bottom 0 (#491)', () => {
    const result = computeNavBarBridgeInsets(raw, true, 'partner', false);
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(0);
  });

  it('partner: real-device (top 47 / phantom bottom 34, letterbox) + corrected → top 0, bottom 34 (#527)', () => {
    const result = computeNavBarBridgeInsets(
      { top: 47, bottom: 34, left: 0, right: 0 },
      true,
      'partner',
    );
    expect(result.top).toBe(0);
    expect(result.bottom).toBe(34);
  });

  it('partner: real-device (top 47 / phantom bottom 34, letterbox) + NOT corrected → top 0, bottom 0 (#491)', () => {
    const result = computeNavBarBridgeInsets(
      { top: 47, bottom: 34, left: 0, right: 0 },
      true,
      'partner',
      false,
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

  it('game + letterbox + corrected (default) → raw top kept, bottom RESTORED 34 (#527)', () => {
    // screen.height px correction: frame reaches real bottom → restore bottom inset.
    const result = computeNavBarBridgeInsets(raw, true, 'game');
    expect(result.top).toBe(47);
    expect(result.bottom).toBe(34);
  });

  it('game + letterbox + NOT corrected (legacy) → raw top kept, bottom zeroed (#491)', () => {
    const result = computeNavBarBridgeInsets(raw, true, 'game', false);
    expect(result.top).toBe(47);
    expect(result.bottom).toBe(0);
  });

  it('left/right always pass through (landscape side insets)', () => {
    const sideInsets = { top: 0, bottom: 20, left: 59, right: 59 };
    expect(computeNavBarBridgeInsets(sideInsets, false, 'game').left).toBe(59);
    expect(computeNavBarBridgeInsets(sideInsets, false, 'partner').right).toBe(59);
  });
});
