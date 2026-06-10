// Pure launcher entry-routing logic — no DOM, no library imports — so it can be
// unit-tested under vitest (jsdom) without pulling `qr-scanner` /
// `@khmyznikov/pwa-install` (which Launcher.tsx / main.tsx import and which
// don't run in jsdom). Launcher.tsx feeds the observed environment in and acts
// on the decision.

/** What the launcher should show on first load. */
export type LauncherEntry =
  | { kind: 'live'; url: string }
  // setup + a pending deep-link the user can open without installing first.
  | { kind: 'setup'; pendingUrl: string | null };

export interface LauncherEntryInput {
  /** Resolved (validated) deep-link iframe URL, or null if none/invalid. */
  deepLinkUrl: string | null;
  /** Is the launcher running as an installed standalone PWA? */
  isStandalone: boolean;
  /** Is this a local-dev (http) context where install gating is relaxed? */
  isLocalDev: boolean;
}

/**
 * Decide the launcher's first screen (#411 defect 2, #459).
 *
 * The launcher is meant to be installed once and re-entered via QR deep-links.
 * Before #411, ANY `?url=` deep-link skipped straight to the live iframe — so a
 * first-time user in a normal browser tab never met the install step; the
 * deep-link permanently hid the install CTA.
 *
 * Fix (#411): when a deep-link arrives but the launcher is NOT yet installed AND
 * this isn't local-dev, show the setup screen (install CTA) FIRST, preserving
 * the URL as `pendingUrl` so the user never loses their deep-link.
 *
 * Fix (#459): localStorage last-URL auto-load is removed. Quick-tunnel hosts
 * change every session (dead link) and TOTP `at=` codes stored in the URL expire
 * in 30 seconds — a saved debug deep-link is always stale. Opening the launcher
 * fresh (no `?url=` query) now always shows the setup/scan screen so the user
 * scans a fresh QR for the new session.
 *
 * Dead-end avoidance (#433): previously a separate "open this once without
 * installing" button consumed pendingUrl. That button is now replaced by the
 * pwa-install library's dismiss event (`pwa-user-choice-result-event` with
 * detail="dismissed") — when the user closes the install dialog, Launcher.tsx
 * picks up pendingUrl and calls showLive(pendingUrl). Installed (standalone) or
 * local-dev contexts keep the existing straight-to-live behaviour.
 */
export function resolveLauncherEntry(input: LauncherEntryInput): LauncherEntry {
  const { deepLinkUrl, isStandalone, isLocalDev } = input;
  // The install gate mirrors applyPwaGate(): a normal (non-standalone) browser
  // tab over https is the only context where we withhold auto-live entry.
  const installGateClosed = !isStandalone && !isLocalDev;

  // Without a deep-link (fresh open, no ?url=) always show setup so the user
  // scans a QR for the current session.
  if (!deepLinkUrl) return { kind: 'setup', pendingUrl: null };

  if (installGateClosed) {
    // Don't auto-enter live; surface setup with the URL preserved so the user
    // can install OR open this once.
    return { kind: 'setup', pendingUrl: deepLinkUrl };
  }
  return { kind: 'live', url: deepLinkUrl };
}
