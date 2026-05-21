/**
 * Unit tests for in-app Chii target injection (attach.ts).
 *
 * Covers:
 * - deriveTargetScriptUrl: URL transformation cases
 * - maybeAttach: gate-pass → script injected; gate-block → no injection;
 *   idempotency (calling twice → only one script element)
 *
 * The `maybeAttach` optional `gateResult` param is used as a testability seam
 * so tests don't need to manipulate window.location.
 *
 * The module-level `attached` flag is reset between tests by re-importing the
 * module fresh via vitest's `vi.resetModules()` in beforeEach.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateResult } from '../in-app/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A gate result that should trigger attachment. */
function passResult(relayUrl = 'wss://abc.trycloudflare.com/'): GateResult {
  return { attach: true, relayUrl, deploymentId: 'test-deployment-id' };
}

/** A gate result that should block attachment. */
function blockResult(reason: 'entry' | 'opt-in' | 'invalid-relay' = 'opt-in'): GateResult {
  return { attach: false, reason };
}

// ---------------------------------------------------------------------------
// deriveTargetScriptUrl
// ---------------------------------------------------------------------------

describe('deriveTargetScriptUrl', () => {
  // Import once — this function is pure and stateless, no need to reset.
  let deriveTargetScriptUrl: (url: string) => string;

  beforeEach(async () => {
    vi.resetModules();
    ({ deriveTargetScriptUrl } = await import('../in-app/attach.js'));
  });

  it('maps wss: to https: and sets pathname to /target.js', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('strips path from relay URL and replaces with /target.js', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/relay')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('preserves explicit port', () => {
    expect(deriveTargetScriptUrl('wss://h.example.com:9100/')).toBe(
      'https://h.example.com:9100/target.js',
    );
  });

  it('preserves explicit port with deep path', () => {
    expect(deriveTargetScriptUrl('wss://h.example.com:9100/some/deep/path')).toBe(
      'https://h.example.com:9100/target.js',
    );
  });

  it('drops query string from relay URL', () => {
    expect(deriveTargetScriptUrl('wss://abc.trycloudflare.com/?session=xyz')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('handles relay URL without path segment', () => {
    expect(deriveTargetScriptUrl('wss://relay.example.com')).toBe(
      'https://relay.example.com/target.js',
    );
  });
});

// ---------------------------------------------------------------------------
// maybeAttach
// ---------------------------------------------------------------------------

describe('maybeAttach', () => {
  let maybeAttach: (gate?: GateResult) => void;

  // Reset the module between every test so the `attached` flag starts false.
  beforeEach(async () => {
    vi.resetModules();
    // Reset DOM
    document.head.innerHTML = '';
    ({ maybeAttach } = await import('../in-app/attach.js'));
  });

  it('appends a <script> element when gate passes', () => {
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    const scripts = document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe('https://abc.trycloudflare.com/target.js');
  });

  it('sets async on the injected script', () => {
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    const script = document.head.querySelector('script');
    expect(script?.async).toBe(true);
  });

  it('does NOT append a script when gate blocks (opt-in)', () => {
    maybeAttach(blockResult('opt-in'));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('does NOT append a script when gate blocks (entry)', () => {
    maybeAttach(blockResult('entry'));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('does NOT append a script when gate blocks (invalid-relay)', () => {
    maybeAttach(blockResult('invalid-relay'));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('is idempotent — calling twice appends only one script', () => {
    const gate = passResult('wss://abc.trycloudflare.com/');
    maybeAttach(gate);
    maybeAttach(gate);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('is idempotent even when called with different gate result objects', () => {
    // Same relay URL → same src → should still be idempotent
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('does not inject a second script if one with the same src is already in DOM', async () => {
    // Pre-insert a script manually, then import a fresh module (attached=false)
    // and call maybeAttach — it should detect the existing script and skip.
    const src = 'https://abc.trycloudflare.com/target.js';
    const existing = document.createElement('script');
    existing.src = src;
    document.head.appendChild(existing);

    vi.resetModules();
    ({ maybeAttach } = await import('../in-app/attach.js'));
    maybeAttach(passResult('wss://abc.trycloudflare.com/'));

    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('injects target.js derived from the relay URL in the gate result', () => {
    maybeAttach(passResult('wss://relay.example.com:9100/ws'));
    const script = document.head.querySelector('script');
    expect(script?.src).toBe('https://relay.example.com:9100/target.js');
  });
});
