import { expect, type Page, test } from '@playwright/test';

// ============================================================================
// Helpers
// ============================================================================

const SECTION_IDS = [
  'auth',
  'navigation',
  'environment',
  'permissions',
  'storage',
  'location',
  'camera',
  'contacts',
  'clipboard',
  'haptic',
  'iap',
  'ads',
  'game',
  'analytics',
  'partner',
  'events',
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
 * first call's stale value on the second invocation. The pre-click empty assertion
 * below surfaces this mistake loudly instead of letting it pass with stale data.
 */
async function apiClick(page: Page, id: string): Promise<string> {
  const loc = page.getByTestId(`${id}-result`);
  // Defensive: require result element to be empty before click. Fails fast if
  // apiClick is accidentally called twice for the same id in one test.
  await expect(
    loc,
    `apiClick(${id}): result must be empty before click — did you call apiClick twice for this id?`,
  ).toBeEmpty();
  await page.getByTestId(`${id}-btn`).click();
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
    // Wait for the page to settle so async microtasks (refreshEnv, etc.)
    // get a chance to throw before we assert zero errors.
    await page.waitForLoadState('networkidle');
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
//
// Shape-verification scope:
//   - storage-set / storage-remove / storage-clear resolve to 'done' (from
//     apiButton's undefined->'done' fallback), so a regression where the write
//     silently becomes a no-op would still pass. Write-correctness is validated
//     indirectly by the setItem+getItem round-trip test and by the jsdom unit
//     tests in src/__tests__/storage.test.ts.
//   - iap-products asserts the returned payload contains 'sku'.
//   - location-current asserts the returned payload contains latitude.
//   - Other domains (auth, game, navigation, analytics, haptic) rely on the
//     'not.toMatch(/^error:/)' check — deep shape verification is deferred to
//     the jsdom unit tests which are faster and more granular.

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
    // Mock returns { products: [{ sku, type, ... }] }. Verify the shape has a
    // non-empty product with an sku to catch regressions where the mock goes
    // silent (e.g. returns { products: [] } or a bare empty object).
    expect(r).toContain('sku');
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
    // The OS <select> contains both 'ios' and 'android' as <option>s, so a
    // descendant-text check would pass regardless of selection. Instead assert
    // the select's current value matches the fixture app's platform value.
    // Scope by the row's label text ('OS') rather than .first(), so reordering
    // of sections in environment.ts cannot silently match a different select
    // (e.g. Environment dropdown or Network status).
    const osSelect = page
      .locator('.ait-row', { has: page.locator('label', { hasText: /^OS$/ }) })
      .locator('select.ait-select');
    await expect(osSelect).toHaveValue(appPlatform, { timeout: 3000 });
  });

  test('events tab: Trigger Back Event fires and fixture subscriber receives it', async ({
    page,
  }) => {
    // Subscribe to back events in the fixture app first
    await page.getByTestId('events-back-btn').click();
    // Confirm subscription ran: button disables itself after the first click (once: true listener)
    await expect(page.getByTestId('events-back-btn')).toBeDisabled({ timeout: 2000 });

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
    // Smoke check only: the permissions tab hard-codes the permission list in
    // src/panel/tabs/permissions.ts, so this confirms the tab renders but does
    // NOT prove a bridge effect from the fixture app's getPermission() call.
    // A true bridge test (panel mutation → fixture observes new return value)
    // is below ("preset Apply changes mock state observed by fixture").
    await expect(page.locator('.ait-panel-body')).toContainText('camera', { timeout: 3000 });
  });

  // Regression guard for dual-singleton bug: tsdown builds mock and panel as
  // self-contained entries. Without a runtime singleton guard, each entry
  // bundles its own AitStateManager, so panel toggles never reach the mock SDK
  // that fixture imports. Smoke at the bundle level: there must be exactly one
  // shared aitState instance reachable from window.__ait, and it must have
  // panel subscribers attached.
  test('aitState is a single shared instance (not duplicated per entry)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as { __ait?: { _listeners?: { size?: number } } };
      const g = globalThis as unknown as { __aitDevtoolsStateSingleton__?: object };
      return {
        hasGlobalSingleton: !!g.__aitDevtoolsStateSingleton__,
        sameRef: w.__ait === g.__aitDevtoolsStateSingleton__,
        listenerCount: w.__ait?._listeners?.size ?? 0,
      };
    });
    expect(result.hasGlobalSingleton).toBe(true);
    expect(result.sameRef).toBe(true);
    // Panel subscribes from at least one place (index.ts re-render). If the
    // panel and mock entries had separate instances, window.__ait would be the
    // mock entry's instance with 0 subscribers.
    expect(result.listenerCount).toBeGreaterThan(0);
  });

  test('preset Apply changes mock state observed by fixture SDK', async ({ page }) => {
    // Capture iap-purchase result with default (success) preset.
    await apiClick(page, 'iap-purchase');
    const successText = (await page.getByTestId('iap-purchase-result').textContent()) ?? '';
    expect(successText).toMatch(/^success:/);

    // Apply Offline preset from the panel.
    await openPanel(page);
    await switchTab(page, 'presets');
    await enableEditMode(page);
    await page
      .locator('.ait-preset-row', { hasText: 'Offline' })
      .locator('.ait-btn', { hasText: /^(Apply|Re-apply)$/ })
      .click();

    // Close panel and trigger iap-purchase again — must now hit error branch.
    await page.locator('button.ait-panel-toggle').click();
    await expect(page.locator('.ait-panel.open')).toBeHidden({ timeout: 3000 });

    // Result element starts non-empty from the previous click; wait for it to
    // change rather than waiting for non-empty.
    await page.getByTestId('iap-purchase-btn').click();
    await expect(page.getByTestId('iap-purchase-result')).not.toHaveText(successText, {
      timeout: 3000,
    });
    const offlineText = (await page.getByTestId('iap-purchase-result').textContent()) ?? '';
    expect(offlineText).toMatch(/^error:/);
  });
});
