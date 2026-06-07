import { expect, test } from '@playwright/test';

// The launcher PWA is hosted at /launcher/ in the bundled fixture. These tests
// exercise the parts that don't require a real install context: the deep-link
// auto-entry, the install-hint surface, and the local-dev escape hatch that
// keeps the setup controls usable from a normal browser tab (http://localhost
// — the install criteria require https, so we intentionally don't gate here).

test.describe('launcher PWA', () => {
  test('shows the install CTA and setup controls in a normal browser tab over http://localhost', async ({
    page,
  }) => {
    await page.goto('/launcher/');
    // Setup screen is the initial state when no deep-link / saved URL.
    await expect(page.getByTestId('launcher-setup')).toBeVisible();
    // <pwa-install> is rendered (the library decides visibility per platform).
    await expect(page.getByTestId('launcher-install-prompt')).toHaveCount(1);
    // The CTA button surfaces the install dialog for browsers without an
    // in-page prompt (iOS Safari) and is the primary entry point everywhere.
    await expect(page.getByTestId('launcher-install-cta')).toBeVisible();
    // Local-dev escape hatch: input + scan button still visible so the fixture
    // is usable without installing the PWA.
    await expect(page.getByTestId('launcher-setup-tools')).toBeVisible();
    await expect(page.getByTestId('launcher-url-input')).toBeVisible();
  });

  test('Install CTA opens the <pwa-install> dialog (forced)', async ({ page }) => {
    await page.goto('/launcher/');
    await page.getByTestId('launcher-install-cta').click();
    // The library exposes `isDialogHidden` on the custom element. After
    // showDialog(true) it must flip to false.
    const dialogVisible = await page
      .getByTestId('launcher-install-prompt')
      .evaluate(
        (el) => !((el as HTMLElement & { isDialogHidden: boolean }).isDialogHidden ?? true),
      );
    expect(dialogVisible).toBe(true);
  });

  test('auto-enters the live frame when ?url=<tunnel> is in the query string', async ({ page }) => {
    const tunnel = 'https://example.com/'; // any same-scheme URL works — iframe just needs to load.
    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}`);

    // Setup screen hidden, iframe visible, src matches the deep-linked URL.
    // Over http://localhost isLocalDev() is true, so the install-first gate
    // (#411) is open and the deep-link still enters live directly.
    await expect(page.getByTestId('launcher-setup')).toBeHidden();
    const frame = page.getByTestId('launcher-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', tunnel);

    // Query is consumed so a reload falls back to localStorage / setup.
    await expect(page).toHaveURL(/\/launcher\/$/);

    // Rescan button surfaced so users can pick a different URL.
    await expect(page.getByTestId('launcher-rescan-btn')).toBeVisible();
  });

  // The install-first gate (#411) — a deep-link / saved URL in an UNINSTALLED,
  // non-local-dev browser tab must show setup (install CTA) FIRST with the URL
  // preserved behind an "open once" button, instead of skipping straight to live
  // and permanently hiding the install opportunity — is not reachable from this
  // e2e harness. The gate only closes when isLocalDev() is false, which requires a
  // non-localhost https host; Chromium makes window.location (and its protocol /
  // hostname) non-configurable, so an init-script cannot fake that context (verified:
  // Object.defineProperty throws "Cannot redefine property"). The gate's full
  // branch matrix — including the closed-gate → setup+pendingUrl outcome and the
  // "open once" / post-install re-entry that the DOM wiring consumes — is covered by
  // the pure-logic unit tests in e2e/fixture/launcher/entry.vitest.ts. What e2e CAN
  // verify is the local-dev escape hatch (gate open → straight to live) and that the
  // "open once" button stays hidden when there is no preserved URL.

  test('"open once" button stays hidden in the normal local-dev flow (no pending URL)', async ({
    page,
  }) => {
    await page.goto('/launcher/');
    // Plain setup over http://localhost — gate is open (local-dev) and nothing was
    // preserved, so the "open once" escape hatch stays hidden.
    await expect(page.getByTestId('launcher-setup')).toBeVisible();
    await expect(page.getByTestId('launcher-open-once')).toBeHidden();
  });

  test('forwards &debug=1&relay= onto the framed URL (env-2 CDP deep-link)', async ({ page }) => {
    const tunnel = 'https://example.com/';
    const relay = 'wss://relay-abc.trycloudflare.com';
    await page.goto(
      `/launcher/?url=${encodeURIComponent(tunnel)}&debug=1&relay=${encodeURIComponent(relay)}`,
    );

    const frame = page.getByTestId('launcher-frame');
    await expect(frame).toBeVisible();
    // The launcher lifts debug/relay off its own search onto the iframe src so
    // the framed page's in-app debug gate (Layer C) is satisfied.
    const src = await frame.getAttribute('src');
    const parsed = new URL(src ?? '');
    expect(parsed.origin + parsed.pathname).toBe(tunnel);
    expect(parsed.searchParams.get('debug')).toBe('1');
    expect(parsed.searchParams.get('relay')).toBe(relay);

    // Launcher's own search is still consumed.
    await expect(page).toHaveURL(/\/launcher\/$/);
  });

  test('ignores ?url= when the value is not a valid http(s) URL', async ({ page }) => {
    await page.goto('/launcher/?url=javascript:alert(1)');
    // Falls back to the setup screen — never sources the iframe with the
    // malicious value.
    await expect(page.getByTestId('launcher-setup')).toBeVisible();
    await expect(page.getByTestId('launcher-frame')).toBeHidden();
  });

  test('remembers the last URL across reloads via localStorage', async ({ page }) => {
    const tunnel = 'https://example.com/';
    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}`);
    await expect(page.getByTestId('launcher-frame')).toHaveAttribute('src', tunnel);

    // Reload without ?url= — should auto-resume from localStorage.
    await page.goto('/launcher/');
    await expect(page.getByTestId('launcher-frame')).toHaveAttribute('src', tunnel);
  });
});
