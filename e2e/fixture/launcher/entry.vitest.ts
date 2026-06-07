// Pure unit tests for the launcher entry-routing decision (#411 defect 2).
//
// Collected by vitest via the `*.vitest.ts` include in vitest.config.ts — the
// distinct extension keeps Playwright (testMatch '**/*.test.ts') from also
// running these. Globals are imported explicitly so the e2e tsconfig (types: [])
// still typechecks the file.
import { describe, expect, it } from 'vitest';
import { resolveLauncherEntry } from './entry.js';

const TUNNEL = 'https://abc-def.trycloudflare.com/';
const SAVED = 'https://saved-host.trycloudflare.com/';

describe('resolveLauncherEntry (#411 install-first gate)', () => {
  it('no URL at all → setup, no pending', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: null,
        lastUrl: null,
        isStandalone: false,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: null });
  });

  it('deep-link in an uninstalled browser tab → setup FIRST, URL preserved as pending', () => {
    // The core fix: a first-time user must meet the install CTA, not be skipped
    // straight to live.
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        lastUrl: null,
        isStandalone: false,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: TUNNEL });
  });

  it('deep-link when installed (standalone) → straight to live (unchanged)', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        lastUrl: null,
        isStandalone: true,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'live', url: TUNNEL });
  });

  it('deep-link in local-dev (http) → straight to live (escape hatch preserved)', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        lastUrl: null,
        isStandalone: false,
        isLocalDev: true,
      }),
    ).toEqual({ kind: 'live', url: TUNNEL });
  });

  it('saved last URL follows the SAME gate — no silent auto-live in an uninstalled tab', () => {
    // localStorage auto-load is the same problem as a deep-link: gate it too.
    expect(
      resolveLauncherEntry({
        deepLinkUrl: null,
        lastUrl: SAVED,
        isStandalone: false,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: SAVED });
  });

  it('saved last URL when installed → straight to live', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: null,
        lastUrl: SAVED,
        isStandalone: true,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'live', url: SAVED });
  });

  it('deep-link wins over saved URL when both present', () => {
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        lastUrl: SAVED,
        isStandalone: true,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'live', url: TUNNEL });
    // …and the pending URL preserved at the gate is the deep-link, not the saved one.
    expect(
      resolveLauncherEntry({
        deepLinkUrl: TUNNEL,
        lastUrl: SAVED,
        isStandalone: false,
        isLocalDev: false,
      }),
    ).toEqual({ kind: 'setup', pendingUrl: TUNNEL });
  });
});
