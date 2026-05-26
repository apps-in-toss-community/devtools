/**
 * Unit tests for `renderQr` — verifies the unicode half-block QR output:
 *   1. No ANSI escape codes (\x1b) in the output.
 *   2. Non-empty output for a known input.
 *   3. All lines have the same width (half-block QR rows are uniform).
 */
import { describe, expect, it } from 'vitest';
import { renderQr } from '../tunnel.js';

describe('renderQr — unicode half-block QR', () => {
  it('produces non-empty output for a short URL', async () => {
    const out = await renderQr('https://example.com');
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('contains no ANSI escape codes (ESC = 0x1b)', async () => {
    const out = await renderQr('https://example.com');
    // Check for ESC byte (0x1b) using charCodeAt to avoid Biome noControlCharactersInRegex
    expect(out.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });

  it('all non-empty lines have the same width (uniform QR row width)', async () => {
    const out = await renderQr('https://example.com');
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const widths = lines.map((l) => [...l].length); // spread for multi-byte chars
    const first = widths[0]!;
    for (const w of widths) {
      expect(w).toBe(first);
    }
  });

  it('contains only half-block chars, spaces, and newlines (no other printable symbols)', async () => {
    const out = await renderQr('test');
    // Allowed characters: half-block chars (█ ▀ ▄), space, newline
    const allowed = /^[█▀▄ \n]+$/u;
    expect(out).toMatch(allowed);
  });

  it('produces output for a longer deep-link style input', async () => {
    const deepLink =
      'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com';
    const out = await renderQr(deepLink);
    expect(out.trim().length).toBeGreaterThan(0);
    // No ANSI escape codes (0x1b)
    expect(out.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });
});
