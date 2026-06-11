import { describe, expect, it } from 'vitest';
import {
  buildDeepLinkAttachUrl,
  buildLauncherAttachUrl,
  validateSchemeAuthority,
} from '../deeplink.js';

const RELAY = 'wss://abc-def.trycloudflare.com';
const RELAY_WITH_PATH = 'wss://abc-def.trycloudflare.com/relay';

describe('buildDeepLinkAttachUrl', () => {
  it('appends debug=1 and relay to a scheme URL that already has _deploymentId', () => {
    const scheme = 'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid';
    const out = buildDeepLinkAttachUrl(scheme, RELAY);
    expect(out).toBe(
      'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid' +
        `&debug=1&relay=${encodeURIComponent(RELAY)}`,
    );
  });

  it('preserves the scheme, authority, and path byte-for-byte', () => {
    const scheme = 'intoss-private://open?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY_WITH_PATH);
    expect(out.startsWith('intoss-private://open?_deploymentId=x&')).toBe(true);
    expect(out).toContain(`relay=${encodeURIComponent(RELAY_WITH_PATH)}`);
  });

  it('percent-encodes the relay URL so its : and / do not break the query', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY);
    expect(out).toContain('relay=wss%3A%2F%2F');
    expect(out).not.toContain('relay=wss://');
  });

  it('is idempotent — re-running replaces debug/relay instead of duplicating', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const once = buildDeepLinkAttachUrl(scheme, RELAY);
    const twice = buildDeepLinkAttachUrl(once, RELAY);
    expect(twice).toBe(once);
    expect(twice.match(/(^|&)debug=/g)).toHaveLength(1);
    expect(twice.match(/(^|&)relay=/g)).toHaveLength(1);
  });

  it('replaces a stale relay on re-run with a new tunnel URL', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const first = buildDeepLinkAttachUrl(scheme, RELAY);
    const second = buildDeepLinkAttachUrl(first, 'wss://new-tunnel.trycloudflare.com');
    expect(second).toContain('relay=wss%3A%2F%2Fnew-tunnel');
    expect(second).not.toContain('abc-def');
    expect(second.match(/(^|&)relay=/g)).toHaveLength(1);
  });

  it('handles a scheme URL with no query string', () => {
    const out = buildDeepLinkAttachUrl('intoss-private://miniapp', RELAY);
    expect(out).toBe(`intoss-private://miniapp?debug=1&relay=${encodeURIComponent(RELAY)}`);
  });

  it('preserves a trailing hash fragment', () => {
    const scheme = 'intoss-private://m?_deploymentId=x#/storage';
    const out = buildDeepLinkAttachUrl(scheme, RELAY);
    expect(out.endsWith('#/storage')).toBe(true);
    expect(out).toContain('_deploymentId=x');
    expect(out).toContain('debug=1');
  });

  it('preserves unrelated existing params (e.g. _deploymentId) untouched', () => {
    const scheme = 'intoss-private://m?_deploymentId=x&foo=bar';
    const out = buildDeepLinkAttachUrl(scheme, RELAY);
    expect(out).toContain('_deploymentId=x');
    expect(out).toContain('foo=bar');
  });

  it('rejects a non-wss relay URL (the gate would reject the resulting link)', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    expect(() => buildDeepLinkAttachUrl(scheme, 'ws://insecure.example.com')).toThrow(/wss:/);
    expect(() => buildDeepLinkAttachUrl(scheme, 'https://example.com')).toThrow(/wss:/);
  });

  it('rejects a malformed relay URL', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    expect(() => buildDeepLinkAttachUrl(scheme, 'not a url')).toThrow(/valid URL/);
  });

  // ---------------------------------------------------------------------------
  // TOTP `at=` parameter (third argument)
  // ---------------------------------------------------------------------------

  it('appends `at=<totpCode>` when totpCode is provided', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, '123456');
    expect(out).toContain('at=123456');
    expect(out).toContain('debug=1');
    expect(out).toContain(`relay=${encodeURIComponent(RELAY)}`);
  });

  it('does NOT append `at=` when totpCode is undefined', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, undefined);
    expect(out).not.toContain('at=');
  });

  it('does NOT append `at=` when totpCode is an empty string', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, '');
    expect(out).not.toContain('at=');
  });

  it('replaces a stale `at=` on re-run (idempotent)', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const first = buildDeepLinkAttachUrl(scheme, RELAY, '111111');
    const second = buildDeepLinkAttachUrl(first, RELAY, '222222');
    expect(second).toContain('at=222222');
    expect(second).not.toContain('at=111111');
    expect(second.match(/(^|&)at=/g)).toHaveLength(1);
  });

  it('removes a stale `at=` when totpCode is omitted on refresh', () => {
    const scheme = 'intoss-private://m?_deploymentId=x&at=oldcode';
    // Calling without a code removes the old `at=`.
    const out = buildDeepLinkAttachUrl(scheme, RELAY);
    expect(out).not.toContain('at=');
  });
});

// ---------------------------------------------------------------------------
// buildLauncherAttachUrl — env-2 launcher PWA deep-link (#378)
// ---------------------------------------------------------------------------

const LAUNCHER_BASE = 'https://devtools.aitc.dev/launcher/';
const TUNNEL = 'https://abc-def.trycloudflare.com';
const WSS = 'wss://relay-xyz.trycloudflare.com';

describe('buildLauncherAttachUrl', () => {
  it('builds a launcher URL with url=, debug=1, and relay= params', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    const parsed = new URL(out);
    expect(parsed.origin + parsed.pathname).toBe(LAUNCHER_BASE);
    expect(parsed.searchParams.get('url')).toBe(TUNNEL);
    expect(parsed.searchParams.get('debug')).toBe('1');
    expect(parsed.searchParams.get('relay')).toBe(WSS);
    expect(parsed.searchParams.has('at')).toBe(false);
  });

  it('percent-encodes tunnelUrl and wssUrl so special chars do not break the query', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    // encodeURIComponent encodes : and / — verify the raw string contains %3A and %2F
    expect(out).toContain('relay=wss%3A%2F%2F');
    expect(out).not.toContain('relay=wss://');
    expect(out).toContain('url=https%3A%2F%2F');
    expect(out).not.toContain('url=https://');
  });

  it('appends &at=<totpCode> when totpCode is provided', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, '654321');
    const parsed = new URL(out);
    expect(parsed.searchParams.get('at')).toBe('654321');
    // Other params still present
    expect(parsed.searchParams.get('debug')).toBe('1');
    expect(parsed.searchParams.get('relay')).toBe(WSS);
  });

  it('does NOT append &at= when totpCode is undefined', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined);
    expect(new URL(out).searchParams.has('at')).toBe(false);
  });

  it('does NOT append &at= when totpCode is an empty string', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, '');
    expect(new URL(out).searchParams.has('at')).toBe(false);
  });

  it('encodes a totpCode that contains special chars (defensive)', () => {
    // TOTP codes are normally 6-digit numbers, but test encoding is correct.
    const out = buildLauncherAttachUrl(TUNNEL, WSS, '1+2=3');
    expect(out).toContain('at=1%2B2%3D3');
  });

  it('starts with the launcher base URL', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    expect(out.startsWith(LAUNCHER_BASE)).toBe(true);
  });

  it('puts url= first in the query string', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    // The query part must start with ?url=
    expect(out).toContain(`${LAUNCHER_BASE}?url=`);
  });

  it('is parseable as a valid URL', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, '123456');
    expect(() => new URL(out)).not.toThrow();
  });

  it('two calls with different tunnel URLs produce different results', () => {
    const out1 = buildLauncherAttachUrl(TUNNEL, WSS);
    const out2 = buildLauncherAttachUrl('https://other.trycloudflare.com', WSS);
    expect(out1).not.toBe(out2);
    expect(new URL(out1).searchParams.get('url')).toBe(TUNNEL);
    expect(new URL(out2).searchParams.get('url')).toBe('https://other.trycloudflare.com');
  });

  // ---------------------------------------------------------------------------
  // opts.name — app name param (#498)
  // ---------------------------------------------------------------------------

  it('opts.name is added as &name= when non-blank', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, { name: 'my-app' });
    const parsed = new URL(out);
    expect(parsed.searchParams.get('name')).toBe('my-app');
  });

  it('opts.name is percent-encoded', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, { name: 'My Mini App' });
    expect(out).toContain('name=My%20Mini%20App');
    expect(new URL(out).searchParams.get('name')).toBe('My Mini App');
  });

  it('opts.name with scope-stripped app name', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, { name: 'sdk-example' });
    const parsed = new URL(out);
    expect(parsed.searchParams.get('name')).toBe('sdk-example');
  });

  it('opts.name blank / whitespace-only → no name= added', () => {
    expect(
      new URL(buildLauncherAttachUrl(TUNNEL, WSS, undefined, { name: '' })).searchParams.has(
        'name',
      ),
    ).toBe(false);
    expect(
      new URL(buildLauncherAttachUrl(TUNNEL, WSS, undefined, { name: '   ' })).searchParams.has(
        'name',
      ),
    ).toBe(false);
  });

  it('opts undefined → no name= and no icon= added', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    const parsed = new URL(out);
    expect(parsed.searchParams.has('name')).toBe(false);
    expect(parsed.searchParams.has('icon')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // opts.icon — icon URL param (#498)
  // ---------------------------------------------------------------------------

  it('opts.icon with https URL → added as &icon=', () => {
    const icon = 'https://example.com/icon.png';
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, { icon });
    expect(new URL(out).searchParams.get('icon')).toBe(icon);
  });

  it('opts.icon with non-https URL → not added', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, {
      icon: 'http://example.com/icon.png',
    });
    expect(new URL(out).searchParams.has('icon')).toBe(false);
  });

  it('opts.icon with data: URL → not added', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, {
      icon: 'data:image/png;base64,abc',
    });
    expect(new URL(out).searchParams.has('icon')).toBe(false);
  });

  it('opts.icon with invalid URL → not added', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, undefined, { icon: 'not-a-url' });
    expect(new URL(out).searchParams.has('icon')).toBe(false);
  });

  it('name and icon can be combined with totpCode', () => {
    const icon = 'https://example.com/icon.png';
    const out = buildLauncherAttachUrl(TUNNEL, WSS, '123456', { name: 'my-app', icon });
    const parsed = new URL(out);
    expect(parsed.searchParams.get('at')).toBe('123456');
    expect(parsed.searchParams.get('name')).toBe('my-app');
    expect(parsed.searchParams.get('icon')).toBe(icon);
  });
});

// ---------------------------------------------------------------------------
// validateSchemeAuthority — scheme host (authority) validation
// ---------------------------------------------------------------------------

describe('validateSchemeAuthority', () => {
  it('returns null for a well-formed URL with a meaningful app-name authority', () => {
    expect(
      validateSchemeAuthority('intoss-private://aitc-sdk-example?_deploymentId=uuid'),
    ).toBeNull();
    expect(validateSchemeAuthority('intoss-private://my-miniapp?_deploymentId=x')).toBeNull();
    expect(validateSchemeAuthority('intoss-private://com.example.app?_deploymentId=x')).toBeNull();
  });

  it('returns a warning when authority is empty', () => {
    const msg = validateSchemeAuthority('intoss-private://?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/authority/i);
    expect(msg).toMatch(/app name/i);
  });

  it('returns a warning when authority is "web" (generic placeholder)', () => {
    const msg = validateSchemeAuthority('intoss-private://web?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
    expect(msg).toMatch(/aitc-sdk-example/);
  });

  it('returns a warning when authority is "localhost"', () => {
    const msg = validateSchemeAuthority('intoss-private://localhost?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
  });

  it('returns a warning when authority is "app" (generic)', () => {
    const msg = validateSchemeAuthority('intoss-private://app?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
  });

  it('returns an error when the string is not a scheme URL at all', () => {
    const msg = validateSchemeAuthority('not-a-url');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/scheme URL/i);
  });

  it('treats authority check case-insensitively (WEB → warning)', () => {
    const msg = validateSchemeAuthority('intoss-private://WEB?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
  });

  it('returns null for authority "127.0.0.2" (not in the suspicious list)', () => {
    // Only 127.0.0.1 is in the list, not arbitrary IPs.
    expect(validateSchemeAuthority('intoss-private://127.0.0.2?_deploymentId=x')).toBeNull();
  });
});
