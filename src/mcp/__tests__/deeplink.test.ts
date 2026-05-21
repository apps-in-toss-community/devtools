import { describe, expect, it } from 'vitest';
import { buildDeepLinkAttachUrl } from '../deeplink.js';

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
});
