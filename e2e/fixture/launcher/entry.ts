// Pure launcher entry-routing logic — no DOM, no library imports — so it can be
// unit-tested under vitest (jsdom) without pulling `qr-scanner` /
// `@khmyznikov/pwa-install` (which top-level main.ts imports and which don't run
// in jsdom). main.ts feeds the observed environment in and acts on the decision.

/** What the launcher should show on first load. */
export type LauncherEntry =
  | { kind: 'live'; url: string }
  // setup + a pending deep-link the user can open without installing first.
  | { kind: 'setup'; pendingUrl: string | null };

export interface LauncherEntryInput {
  /** Resolved (validated) deep-link iframe URL, or null if none/invalid. */
  deepLinkUrl: string | null;
  /** Resolved (validated) localStorage last URL, or null if none/invalid. */
  lastUrl: string | null;
  /** Is the launcher running as an installed standalone PWA? */
  isStandalone: boolean;
  /** Is this a local-dev (http) context where install gating is relaxed? */
  isLocalDev: boolean;
}

/**
 * Decide the launcher's first screen (#411 defect 2).
 *
 * The launcher is meant to be installed once and re-entered via QR deep-links.
 * Before #411, ANY `?url=` deep-link skipped straight to the live iframe — so a
 * first-time user in a normal browser tab never met the install step; the
 * deep-link permanently hid the install CTA.
 *
 * Fix: when a deep-link (or saved last URL) arrives but the launcher is NOT yet
 * installed AND this isn't local-dev, show the setup screen (install CTA) FIRST,
 * preserving the URL as `pendingUrl` so an "open this once without installing"
 * button keeps the path from being a dead end. Installed (standalone) or
 * local-dev contexts keep the existing straight-to-live behaviour.
 */
export function resolveLauncherEntry(input: LauncherEntryInput): LauncherEntry {
  const { deepLinkUrl, lastUrl, isStandalone, isLocalDev } = input;
  // The install gate mirrors applyPwaGate(): a normal (non-standalone) browser
  // tab over https is the only context where we withhold auto-live entry.
  const installGateClosed = !isStandalone && !isLocalDev;

  const url = deepLinkUrl ?? lastUrl;
  if (!url) return { kind: 'setup', pendingUrl: null };

  if (installGateClosed) {
    // Don't auto-enter live; surface setup with the URL preserved so the user
    // can install OR open this once.
    return { kind: 'setup', pendingUrl: url };
  }
  return { kind: 'live', url };
}
