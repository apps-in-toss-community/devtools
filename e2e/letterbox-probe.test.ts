import { expect, test } from '@playwright/test';

// Smoke tests for the letterbox-probe static pages.
// These pages live in e2e/fixture/public/letterbox-probe/ and are copied
// verbatim to dist/ by vite, so they are served at the paths below without
// going through any build transform.
//
// The tests only verify that:
//   1. Each variant serves a 200 page (the fixture server doesn't 404).
//   2. The live readout table is rendered with the expected row labels.
//
// Real-device WebKit standalone geometry (the actual letterbox measurements
// these probes are designed to surface) cannot be verified in a desktop
// Chromium tab — those observations require physical device QA.

const VARIANTS = [
  {
    path: '/letterbox-probe/translucent/',
    title: 'Probe BT',
    badge: 'black-translucent',
    docBand: false,
  },
  { path: '/letterbox-probe/default/', title: 'Probe DEF', badge: 'default', docBand: false },
  { path: '/letterbox-probe/hack/', title: 'Probe HACK', badge: 'min-height hack', docBand: true },
] as const;

for (const variant of VARIANTS) {
  test.describe(`letterbox-probe ${variant.badge}`, () => {
    test('page loads and renders the metrics readout', async ({ page }) => {
      await page.goto(variant.path);

      // Title must match the variant so iOS home-screen icon names are distinct.
      await expect(page).toHaveTitle(variant.title);

      // The shortfall row (screen.H − inner.H) must be present (auto-waits for render).
      const shortfallCell = page.locator('#metrics tbody tr td').filter({ hasText: 'shortfall' });
      await expect(shortfallCell).toHaveCount(1);

      // Readout table must have rows — at minimum innerW × H and shortfall.
      const rowCount = await page.locator('#metrics tbody tr').count();
      expect(rowCount).toBeGreaterThan(5);
    });

    test('position bands are rendered', async ({ page }) => {
      await page.goto(variant.path);

      const bandTop = page.locator('#band-top');
      const bandBottom = page.locator('#band-bottom');

      await expect(bandTop).toBeVisible();
      await expect(bandBottom).toBeVisible();

      // Text labels are present so the tester knows what they are looking at.
      await expect(bandTop).toContainText('RED');
      await expect(bandBottom).toContainText('GREEN');

      // The hack variant adds a document-anchored band (the discriminator for
      // whether stretched root content paints into the OS letterbox region).
      const docBand = page.locator('#band-doc-bottom');
      if (variant.docBand) {
        await expect(docBand).toBeVisible();
        await expect(docBand).toContainText('BLUE');
      } else {
        await expect(docBand).toHaveCount(0);
      }
    });

    test('variant badge identifies the status-bar-style', async ({ page }) => {
      await page.goto(variant.path);

      const badge = page.locator('.variant-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(variant.badge);
    });
  });
}
