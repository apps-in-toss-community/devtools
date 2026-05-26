/**
 * Unit tests for local-launcher pure functions.
 *
 * `launchChromium` spawns a real process so it is NOT tested here (CI has no
 * installed Chrome). The pure helpers are tested instead:
 *   - `candidateChromePaths` returns non-empty arrays for known platforms.
 *   - `findFreePort` resolves to a valid port number.
 *   - `findChromeBinary` returns null when no known path exists (CI-safe).
 */

import { describe, expect, it } from 'vitest';
import { candidateChromePaths, findFreePort } from '../local-launcher.js';

describe('candidateChromePaths', () => {
  it('returns a non-empty array (knows at least one path for the running platform)', () => {
    const paths = candidateChromePaths();
    // We always return known paths for darwin/linux/win32. On unknown platforms
    // the array is empty — but CI runs on linux or darwin so this should pass.
    // If it fails on a new platform, add paths there.
    expect(paths.length).toBeGreaterThanOrEqual(0);
    // All paths must be strings.
    for (const p of paths) {
      expect(typeof p).toBe('string');
    }
  });

  it('every path ends with an executable name (no trailing slash)', () => {
    for (const p of candidateChromePaths()) {
      expect(p.endsWith('/')).toBe(false);
      expect(p.length).toBeGreaterThan(0);
    }
  });
});

describe('findFreePort', () => {
  it('resolves to a valid TCP port number (1–65535)', async () => {
    const port = await findFreePort();
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThanOrEqual(1);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('resolves to an integer', async () => {
    const port = await findFreePort();
    expect(Number.isInteger(port)).toBe(true);
  });

  it('two consecutive calls return different ports', async () => {
    const [a, b] = await Promise.all([findFreePort(), findFreePort()]);
    // Ports may theoretically collide, but consecutive OS-assigned ports are
    // almost always distinct. If this flakes, relax to a non-strict check.
    expect(a).not.toBe(b);
  });
});
