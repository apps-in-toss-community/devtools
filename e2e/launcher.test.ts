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
    await expect(page.getByTestId('launcher-setup')).toBeHidden();
    const frame = page.getByTestId('launcher-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', tunnel);

    // Query is consumed so a reload falls back to localStorage / setup.
    await expect(page).toHaveURL(/\/launcher\/$/);

    // Rescan button surfaced so users can pick a different URL.
    await expect(page.getByTestId('launcher-rescan-btn')).toBeVisible();
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
