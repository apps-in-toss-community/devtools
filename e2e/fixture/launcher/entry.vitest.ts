// Pure unit tests for the launcher entry-routing decision (#411 defect 2, #459).
//
// Collected by vitest via the `*.vitest.ts` include in vitest.config.ts — the
// distinct extension keeps Playwright (testMatch '**/*.test.ts') from also
// running these. Globals are imported explicitly so the e2e tsconfig (types: [])
// still typechecks the file.
import { describe, expect, it } from 'vitest';
import { resolveLauncherEntry } from './entry.js';

const TUNNEL = 'https://abc-def.trycloudflare.com/';

describe('resolveLauncherEntry (#411 install-first gate, #459 scan-first)', () => {
  it('no URL at all → setup, no pending', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: null,
        isStandalone: false,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: null });
  });

  it('fresh open (no deep-link) when installed (standalone) → still setup, no pending (#459)', () => {
    // Even a standalone launcher opens setup when there is no ?url= query — the
    // user should scan a fresh QR, not auto-resume a stale tunnel.
    expect(
      resolveLauncherEntry({
        deepLinkUrl: null,
        isStandalone: true,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: null });
  });

  it('fresh open in local-dev (no deep-link) → setup, no pending (#459)', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: null,
        isStandalone: false,
        isLocalDev: true,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: null });
  });

  it('deep-link in an uninstalled browser tab → setup FIRST, URL preserved as pending', () => {
    // The core fix: a first-time user must meet the install CTA, not be skipped
    // straight to live.
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        isStandalone: false,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: TUNNEL });
  });

  it('deep-link when installed (standalone) → straight to live (unchanged)', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        isStandalone: true,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'live', url: TUNNEL });
  });

  it('deep-link in local-dev (http) → straight to live (escape hatch preserved)', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        isStandalone: false,
        isLocalDev: true,
      }),
    ).toEqual({ kind: 'live', url: TUNNEL });
  });
});
