import { test, expect, type Page } from '@playwright/test';

// ============================================================================
// Helpers
// ============================================================================

const SECTION_IDS = [
  'auth', 'navigation', 'environment', 'permissions', 'storage',
  'location', 'camera', 'contacts', 'clipboard', 'haptic',
  'iap', 'ads', 'game', 'analytics', 'partner', 'events',
] as const;

async function openPanel(page: Page) {
  await page.locator('button.ait-panel-toggle').click();
  await expect(page.locator('.ait-panel.open')).toBeVisible({ timeout: 3000 });
}

async function switchTab(page: Page, tabId: string) {
  await page.locator(`.ait-panel-tab[data-tab="${tabId}"]`).click();
}

/** Enable edit mode so panel buttons are clickable. */
async function enableEditMode(page: Page) {
  const badge = page.locator('.ait-mock-badge');
  if ((await badge.textContent()) !== 'EDIT') {
    await badge.click();
    await expect(badge).toHaveText('EDIT', { timeout: 2000 });
  }
}

/** Click a fixture API button and wait for its result to be non-empty. */
async function apiClick(page: Page, id: string): Promise<string> {
  await page.getByTestId(`${id}-btn`).click();
  const loc = page.getByTestId(`${id}-result`);
  await expect(loc).not.toBeEmpty({ timeout: 5000 });
  return (await loc.textContent()) ?? '';
}

// ============================================================================
// Smoke
// ============================================================================

test.describe('Smoke', () => {
  test('fixture renders all 16 sections with panel toggle button', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');

    for (const id of SECTION_IDS) {
      await expect(page.getByTestId(`section-${id}`)).toBeVisible();
    }

    await expect(page.locator('button.ait-panel-toggle')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Layer A — Domain smoke (one representative button per domain)
// ============================================================================

test.describe('Layer A: Domain smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('auth: appLogin returns a value without error', async ({ page }) => {
    const r = await apiClick(page, 'auth-login');
    expect(r).not.toMatch(/^error:/);
  });

  test('auth: getIsTossLoginIntegratedService returns a value', async ({ page }) => {
    const r = await apiClick(page, 'auth-toss-integrated');
    expect(r).not.toMatch(/^error:/);
  });

  test('navigation: getTossShareLink returns a value', async ({ page }) => {
    const r = await apiClick(page, 'nav-sharelink');
    expect(r).not.toMatch(/^error:/);
  });

  test('navigation: setScreenAwakeMode succeeds', async ({ page }) => {
    const r = await apiClick(page, 'nav-awake');
    expect(r).not.toMatch(/^error:/);
  });

  test('environment: platform value is populated on load', async ({ page }) => {
    const loc = page.getByTestId('env-platform-value');
    await expect(loc).not.toBeEmpty({ timeout: 3000 });
    const text = await loc.textContent();
    expect(text).not.toMatch(/^error:/);
  });

  test('permissions: getPermission returns a value', async ({ page }) => {
    const r = await apiClick(page, 'perm-get');
    expect(r).not.toMatch(/^error:/);
  });

  test('storage: setItem + getItem round-trip', async ({ page }) => {
    await page.getByTestId('storage-key-input').fill('e2e-k');
    await page.getByTestId('storage-value-input').fill('e2e-v');
    await apiClick(page, 'storage-set');

    await page.getByTestId('storage-key-input').fill('e2e-k');
    const r = await apiClick(page, 'storage-get');
    expect(r).toBe('e2e-v');
  });

  test('location: getCurrentLocation returns coordinates', async ({ page }) => {
    const r = await apiClick(page, 'location-current');
    expect(r).not.toMatch(/^error:/);
    // Mock returns an object with latitude/longitude
    expect(r).toMatch(/latitude|lat/i);
  });

  test('iap: getProductItemList returns data', async ({ page }) => {
    const r = await apiClick(page, 'iap-products');
    expect(r).not.toMatch(/^error:/);
  });

  test('analytics: click event logs without error', async ({ page }) => {
    const r = await apiClick(page, 'analytics-click');
    expect(r).not.toMatch(/^error:/);
  });

  test('haptic: generateHapticFeedback completes without error', async ({ page }) => {
    const r = await apiClick(page, 'haptic-tap');
    expect(r).not.toMatch(/^error:/);
  });

  test('game: grantPromotionReward returns a value', async ({ page }) => {
    const r = await apiClick(page, 'game-promo');
    expect(r).not.toMatch(/^error:/);
  });
});

// ============================================================================
// Layer B — Panel UX
// ============================================================================

test.describe('Layer B: Panel UX', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('panel opens on toggle click', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator('.ait-panel.open')).toBeVisible();
  });

  test('panel closes on second toggle click', async ({ page }) => {
    await openPanel(page);
    await page.locator('button.ait-panel-toggle').click();
    await expect(page.locator('.ait-panel.open')).toBeHidden({ timeout: 3000 });
  });

  test('panel shows at least 3 tab buttons', async ({ page }) => {
    await openPanel(page);
    const tabs = page.locator('.ait-panel-tab');
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.count()).toBeGreaterThanOrEqual(3);
  });

  test('panel tab switch changes active tab', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'storage');
    await expect(page.locator('.ait-panel-tab[data-tab="storage"]')).toHaveClass(/active/);
    await switchTab(page, 'env');
    await expect(page.locator('.ait-panel-tab[data-tab="env"]')).toHaveClass(/active/);
  });
});

// ============================================================================
// Layer C — Panel ↔ App bridge
// ============================================================================

test.describe('Layer C: Panel-App bridge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('storage tab shows key written by the fixture app', async ({ page }) => {
    // Write a key via the fixture app
    await page.getByTestId('storage-key-input').fill('bridge-k');
    await page.getByTestId('storage-value-input').fill('bridge-v');
    await apiClick(page, 'storage-set');

    // Open panel → storage tab
    await openPanel(page);
    await switchTab(page, 'storage');
    await expect(page.locator('.ait-panel.open')).toContainText('bridge-k', { timeout: 3000 });
  });

  test('environment tab shows platform value', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'env');
    const text = await page.locator('.ait-panel-body').textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('events tab: Trigger Back Event fires and fixture subscriber receives it', async ({ page }) => {
    // Subscribe to back events in the fixture app first
    await page.getByTestId('events-back-btn').click();
    await expect(page.getByTestId('events-back-empty')).toBeVisible();

    // Open panel → events tab → enable edit mode → trigger back event
    await openPanel(page);
    await switchTab(page, 'events');
    await enableEditMode(page);
    await page.locator('.ait-btn', { hasText: 'Trigger Back Event' }).click();

    // Subscriber should have received the event → empty sentinel removed
    await expect(page.getByTestId('events-back-empty')).toBeHidden({ timeout: 3000 });
  });

  test('permissions tab renders permission state', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'permissions');
    // Permissions tab should have at least some text content
    const text = await page.locator('.ait-panel-body').textContent();
    expect(text!.length).toBeGreaterThan(5);
  });
});
