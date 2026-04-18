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

/** Switch panel to the given tab. Requires the panel to be open first (openPanel). */
async function switchTab(page: Page, tabId: string) {
  // Playwright's click() auto-waits for actionability (visible + stable)
  await page.locator(`.ait-panel-tab[data-tab="${tabId}"]`).click();
}

/** Enable edit mode so panel buttons are clickable. */
async function enableEditMode(page: Page) {
  const badge = page.locator('.ait-mock-badge');
  await expect(badge).toBeVisible(); // ensure DOM is fully rendered before reading text
  if ((await badge.textContent()) !== 'EDIT') {
    await badge.click();
    await expect(badge).toHaveText('EDIT', { timeout: 2000 });
  }
}

/**
 * Click a fixture API button and wait for its result to be non-empty.
 * Safe because each test starts with a fresh page (page.goto('/') in beforeEach),
 * so result elements start empty and the not.toBeEmpty() guard is unambiguous.
 * Do NOT call twice for the same button within one test: the result element is not
 * cleared between calls, so not.toBeEmpty() would resolve immediately with the
 * first call's stale value on the second invocation.
 */
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
    // Register listener before goto so early page errors are captured
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
// Coverage: auth, navigation, environment, permissions, storage, location,
// iap, analytics, haptic, game (10 domains, 12 tests including 2 auth variants).
// Excluded domains (camera, contacts, clipboard, ads, partner) have buttons in
// the fixture but are omitted here because their mocks are adequately covered
// by the jsdom unit test suite (src/__tests__/). Layer A focuses on domains
// whose mock return values are most likely to break across SDK updates.

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
    const setResult = await apiClick(page, 'storage-set');
    expect(setResult).not.toMatch(/^error:/); // precondition: setItem must succeed

    // key input still holds 'e2e-k' from the fill above; withInputs reads it at click time.
    // These two apiClick calls target different ids (storage-set-result vs storage-get-result),
    // so there is no stale-result risk despite calling apiClick twice in one test.
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
// Tests: open/close toggle, tab count, tab active-class switching.
// Intentionally excluded from this layer (may be added in follow-up PRs):
//   - Drag repositioning: requires mouse drag simulation; layout-sensitive and
//     flaky on CI headless environments.
//   - Mobile fullscreen (375×667): viewport resize + CSS media query; adds
//     complexity without covering mock API contract.
//   - Position persistence across reload: low-risk feature covered by unit
//     tests on the localStorage serialisation path.

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
// Tests bidirectional flow between the fixture app and the DevTools panel.
// Coverage:
//   - App → Panel: fixture app writes storage; panel storage tab reflects it.
//   - App → Panel: fixture app reads env platform; panel env tab shows same value.
//   - Panel → App: panel triggers backEvent; fixture subscriber receives it.
//   - Panel → App: permissions tab renders the camera entry (state sync check).
//
// Intentionally omitted (may be added in follow-up PRs):
//   - Panel OS dropdown → android → env-platform-value changes: requires panel
//     to be in EDIT mode and a select interaction; deferred because aitState
//     mutation through the panel UI is already tested by the events bridge test.
//   - Camera denied → openCamera error: requires permission state manipulation
//     via the panel which is complex to automate reliably without flakiness.

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

  test('environment tab shows platform value matching the fixture app', async ({ page }) => {
    // Wait for refreshEnv() to populate env-platform-value before reading it
    const loc = page.getByTestId('env-platform-value');
    await expect(loc).not.toBeEmpty({ timeout: 3000 });
    const appPlatform = (await loc.textContent()) ?? ''; // not.toBeEmpty above guarantees non-null

    await openPanel(page);
    await switchTab(page, 'env');
    // Panel env tab must display the same platform value (e.g. 'ios')
    await expect(page.locator('.ait-panel-body')).toContainText(appPlatform, { timeout: 3000 });
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

  test('permissions tab renders camera permission state', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'permissions');
    // The fixture app calls getPermission({ name: 'camera', ... }), so the
    // permissions tab must show the camera permission entry
    await expect(page.locator('.ait-panel-body')).toContainText('camera', { timeout: 3000 });
  });
});
