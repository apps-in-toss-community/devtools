import { test, expect, type Page } from '@playwright/test';

// Helper: open the AIT DevTools panel
async function openPanel(page: Page) {
  const toggle = page.locator('button.ait-panel-toggle');
  await toggle.click();
  await expect(page.locator('.ait-panel.open')).toBeVisible();
}

// Helper: close the AIT DevTools panel
async function closePanel(page: Page) {
  const toggle = page.locator('button.ait-panel-toggle');
  await toggle.click();
  await expect(page.locator('.ait-panel.open')).not.toBeVisible();
}

// Helper: switch to a specific panel tab
async function switchTab(page: Page, tabId: string) {
  await page.locator(`.ait-panel-tab[data-tab="${tabId}"]`).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-section')).toBeVisible();
});

// ====================================================================
// SMOKE TEST
// ====================================================================

test.describe('Smoke', () => {
  test('page should load without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    // Wait for all sections to be rendered
    await expect(page.getByTestId('events-section')).toBeVisible();
    await page.waitForTimeout(500);

    expect(errors).toHaveLength(0);
  });
});

// ====================================================================
// PANEL TOGGLE
// ====================================================================

test.describe('Panel Toggle', () => {
  test('should open and close the panel', async ({ page }) => {
    const toggle = page.locator('button.ait-panel-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('AIT');

    await openPanel(page);
    await expect(page.locator('.ait-panel.open')).toBeVisible();

    await closePanel(page);
    await expect(page.locator('.ait-panel.open')).not.toBeVisible();
  });
});

// ====================================================================
// AUTH
// ====================================================================

test.describe('Auth', () => {
  test('appLogin should return authorizationCode', async ({ page }) => {
    await page.getByTestId('auth-login-btn').click();
    await expect(page.getByTestId('auth-login-code')).toBeVisible();
    const code = await page.getByTestId('auth-login-code').textContent();
    expect(code!.length).toBeGreaterThan(0);
  });

  test('getIsTossLoginIntegratedService should return boolean', async ({ page }) => {
    await page.getByTestId('auth-toss-integrated-btn').click();
    await expect(page.getByTestId('auth-toss-integrated-result')).toHaveText('true');
  });

  test('getUserKeyForGame should return hash object', async ({ page }) => {
    await page.getByTestId('auth-userkey-btn').click();
    await expect(page.getByTestId('auth-userkey-result')).toContainText('HASH');
  });

  test('appsInTossSignTossCert should complete', async ({ page }) => {
    await page.getByTestId('auth-cert-btn').click();
    await expect(page.getByTestId('auth-cert-result')).toHaveText('done');
  });
});

// ====================================================================
// NAVIGATION
// ====================================================================

test.describe('Navigation', () => {
  test('getTossShareLink should return share link', async ({ page }) => {
    await page.getByTestId('nav-sharelink-btn').click();
    await expect(page.getByTestId('nav-sharelink-result')).toContainText('toss.im/share/mock');
  });

  test('setScreenAwakeMode should return enabled state', async ({ page }) => {
    await page.getByTestId('nav-awake-btn').click();
    await expect(page.getByTestId('nav-awake-result')).toContainText('enabled');
  });

  test('setSecureScreen should return enabled state', async ({ page }) => {
    await page.getByTestId('nav-secure-btn').click();
    await expect(page.getByTestId('nav-secure-result')).toContainText('enabled');
  });

  test('requestReview should complete', async ({ page }) => {
    await page.getByTestId('nav-review-btn').click();
    await expect(page.getByTestId('nav-review-result')).toHaveText('done');
  });

  test('openURL, share, swipeGesture, orientation should not throw', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.getByTestId('nav-openurl-btn').click();
    await page.getByTestId('nav-swipe-btn').click();
    await page.getByTestId('nav-orientation-btn').click();
    await page.getByTestId('nav-share-btn').click();
    await page.waitForTimeout(100);

    expect(errors).toHaveLength(0);
  });

  test('closeView should navigate back', async ({ page }) => {
    await page.evaluate(() => window.history.pushState({}, '', '/temp'));
    await page.getByTestId('nav-close-btn').click();
    await expect(page).toHaveURL('/');
  });
});

// ====================================================================
// ENVIRONMENT
// ====================================================================

test.describe('Environment', () => {
  test('should display all environment values', async ({ page }) => {
    await expect(page.getByTestId('env-platform')).toHaveText('ios');
    await expect(page.getByTestId('env-operational')).toHaveText('sandbox');
    await expect(page.getByTestId('env-app-version')).not.toBeEmpty();
    await expect(page.getByTestId('env-locale')).toHaveText('ko-KR');
    await expect(page.getByTestId('env-device-id')).not.toBeEmpty();
    await expect(page.getByTestId('env-group-id')).toHaveText('mock-group-id');
    await expect(page.getByTestId('env-deployment-id')).toHaveText('mock-deployment-id');
    await expect(page.getByTestId('env-brand-name')).toHaveText('Mock App');
    await expect(page.getByTestId('env-safe-area-top')).toHaveText('47');
    await expect(page.getByTestId('env-safe-area-legacy')).toHaveText('47');
    await expect(page.getByTestId('env-min-version')).toHaveText('true');
    await expect(page.getByTestId('env-scheme-uri')).not.toBeEmpty();
  });

  test('should reflect OS change from panel dropdown', async ({ page }) => {
    await expect(page.getByTestId('env-platform')).toHaveText('ios');

    await openPanel(page);
    await switchTab(page, 'env');

    const osRow = page.locator('.ait-panel .ait-row').filter({ has: page.locator('label', { hasText: /^OS$/ }) });
    await osRow.locator('select').selectOption('android');

    await expect(page.getByTestId('env-platform')).toHaveText('android', { timeout: 12000 });
  });

  test('getNetworkStatus should return valid status', async ({ page }) => {
    await expect(page.getByTestId('env-network')).toHaveText('WIFI', { timeout: 12000 });
  });

  test('getServerTime should return a number', async ({ page }) => {
    await expect(async () => {
      const value = await page.getByTestId('env-server-time').textContent();
      expect(Number(value)).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });
  });
});

// ====================================================================
// PERMISSIONS
// ====================================================================

test.describe('Permissions', () => {
  test('getPermission should return current status', async ({ page }) => {
    await page.getByTestId('perm-get-btn').click();
    await expect(page.getByTestId('perm-get-result')).toHaveText('allowed');
  });

  test('openPermissionDialog should return result', async ({ page }) => {
    await page.getByTestId('perm-dialog-btn').click();
    await expect(page.getByTestId('perm-dialog-result')).toHaveText('allowed');
  });

  test('requestPermission should return result', async ({ page }) => {
    await page.getByTestId('perm-request-btn').click();
    await expect(page.getByTestId('perm-request-result')).toHaveText('allowed');
  });

  test('denied camera permission should cause openCamera error', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'permissions');

    const cameraSelect = page.locator('.ait-panel .ait-row').filter({ hasText: 'camera' }).locator('select').first();
    await cameraSelect.selectOption('denied');
    await closePanel(page);

    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('camera-error')).toContainText('denied');
  });
});

// ====================================================================
// STORAGE
// ====================================================================

test.describe('Storage', () => {
  test('setItem + getItem should work', async ({ page }) => {
    await page.getByTestId('storage-key-input').fill('e2e-key');
    await page.getByTestId('storage-value-input').fill('e2e-value');
    await page.getByTestId('storage-set-button').click();
    await page.getByTestId('storage-get-button').click();
    await expect(page.getByTestId('storage-result')).toHaveText('e2e-value');
  });

  test('removeItem should work', async ({ page }) => {
    // Set, verify, remove, verify gone
    await page.getByTestId('storage-key-input').fill('remove-test');
    await page.getByTestId('storage-value-input').fill('temp');
    await page.getByTestId('storage-set-button').click();

    await page.getByTestId('storage-get-button').click();
    await expect(page.getByTestId('storage-result')).toHaveText('temp');

    await page.getByTestId('storage-remove-button').click();
    await expect(page.getByTestId('storage-remove-result')).toHaveText('done');

    // After removal, getItem returns null which displays as "(null)"
    await page.getByTestId('storage-get-button').click();
    await expect(page.getByTestId('storage-result')).toHaveText('(null)');
  });

  test('clearItems should work', async ({ page }) => {
    await page.getByTestId('storage-key-input').fill('clear-test');
    await page.getByTestId('storage-value-input').fill('temp');
    await page.getByTestId('storage-set-button').click();
    await page.getByTestId('storage-clear-button').click();
    await expect(page.getByTestId('storage-clear-result')).toHaveText('done');
  });

  test('should show items in panel Storage tab', async ({ page }) => {
    await page.getByTestId('storage-key-input').fill('panel-test');
    await page.getByTestId('storage-value-input').fill('panel-value');
    await page.getByTestId('storage-set-button').click();

    await openPanel(page);
    await switchTab(page, 'storage');

    await expect(page.locator('.ait-panel .ait-storage-key')).toContainText('panel-test');
    await expect(page.locator('.ait-panel .ait-storage-value')).toContainText('panel-value');
  });

  test('should use __ait_storage: prefix in localStorage', async ({ page }) => {
    await page.getByTestId('storage-key-input').fill('prefix-test');
    await page.getByTestId('storage-value-input').fill('prefix-value');
    await page.getByTestId('storage-set-button').click();

    const stored = await page.evaluate(() => localStorage.getItem('__ait_storage:prefix-test'));
    expect(stored).toBe('prefix-value');
  });
});

// ====================================================================
// LOCATION
// ====================================================================

test.describe('Location', () => {
  test('getCurrentLocation should return coordinates', async ({ page }) => {
    await page.getByTestId('location-button').click();
    await expect(page.getByTestId('location-lat')).toContainText('37.5665');
    await expect(page.getByTestId('location-lng')).toContainText('126.978');
  });

  test('getCurrentLocation should fail when geolocation is denied', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'permissions');

    const geoSelect = page.locator('.ait-panel .ait-row').filter({ hasText: 'geolocation' }).locator('select');
    await geoSelect.selectOption('denied');
    await closePanel(page);

    await page.getByTestId('location-button').click();
    await expect(page.getByTestId('location-error')).toContainText('denied');
  });
});

// ====================================================================
// CAMERA & PHOTOS
// ====================================================================

test.describe('Camera & Photos', () => {
  test('openCamera should return photo ID in mock mode', async ({ page }) => {
    await page.getByTestId('camera-button').click();
    await expect(page.getByTestId('camera-result')).toBeVisible();
  });

  test('fetchAlbumPhotos should return photos in mock mode', async ({ page }) => {
    await page.getByTestId('photos-button').click();
    await expect(page.getByTestId('photos-result')).toBeVisible();
    const count = await page.getByTestId('photos-result').textContent();
    expect(Number(count)).toBeGreaterThan(0);
  });
});

// ====================================================================
// CONTACTS
// ====================================================================

test.describe('Contacts', () => {
  test('fetchContacts should return contact list', async ({ page }) => {
    await page.getByTestId('contacts-button').click();
    await expect(page.getByTestId('contacts-result')).toContainText('홍길동');
  });
});

// ====================================================================
// CLIPBOARD
// ====================================================================

test.describe('Clipboard', () => {
  test('set and get clipboard text in mock mode', async ({ page }) => {
    // Default clipboard mode is 'web'; switch to 'mock' for deterministic testing
    await openPanel(page);
    await switchTab(page, 'device');
    const clipboardSelect = page.locator('.ait-panel .ait-row').filter({ hasText: 'Clipboard' }).locator('select');
    await clipboardSelect.selectOption('mock');
    await closePanel(page);

    await page.getByTestId('clipboard-input').fill('hello clipboard');
    await page.getByTestId('clipboard-set-btn').click();
    await expect(page.getByTestId('clipboard-set-result')).toHaveText('done');

    await page.getByTestId('clipboard-get-btn').click();
    await expect(page.getByTestId('clipboard-get-result')).toHaveText('hello clipboard');
  });
});

// ====================================================================
// HAPTIC & FILE
// ====================================================================

test.describe('Haptic & File', () => {
  test('haptic buttons should not throw errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.getByTestId('haptic-tickWeak').click();
    await page.getByTestId('haptic-tap').click();
    await page.getByTestId('haptic-success').click();
    await page.getByTestId('haptic-error').click();
    await page.getByTestId('haptic-confetti').click();
    await page.waitForTimeout(100);

    expect(errors).toHaveLength(0);
  });

  test('saveBase64Data should complete', async ({ page }) => {
    // saveBase64Data triggers a download; just verify no crash
    await page.getByTestId('save-base64-btn').click();
    await expect(page.getByTestId('save-base64-result')).toHaveText('done');
  });
});

// ====================================================================
// IAP & PAYMENT
// ====================================================================

test.describe('IAP & Payment', () => {
  test('getProductItemList should return products', async ({ page }) => {
    await page.getByTestId('iap-fetch-button').click();
    await expect(page.getByTestId('iap-products')).toContainText('mock-gem-100');
  });

  test('one-time purchase should succeed with default settings', async ({ page }) => {
    await page.getByTestId('iap-purchase-button').click();
    await expect(page.getByTestId('iap-purchase-result')).toContainText('success:', { timeout: 3000 });
  });

  test('subscription purchase should succeed', async ({ page }) => {
    await page.getByTestId('iap-sub-button').click();
    await expect(page.getByTestId('iap-sub-result')).toContainText('success:', { timeout: 3000 });
  });

  test('purchase should fail when nextResult is USER_CANCELED', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'iap');

    const nextResultSelect = page.locator('.ait-panel .ait-row').filter({ hasText: 'Next Purchase Result' }).locator('select');
    await nextResultSelect.selectOption('USER_CANCELED');
    await closePanel(page);

    await page.getByTestId('iap-purchase-button').click();
    await expect(page.getByTestId('iap-purchase-result')).toContainText('error:USER_CANCELED', { timeout: 3000 });
  });

  test('getPendingOrders should return orders array', async ({ page }) => {
    await page.getByTestId('iap-pending-btn').click();
    await expect(page.getByTestId('iap-pending-result')).toBeVisible();
  });

  test('getCompletedOrRefundedOrders should return after purchase', async ({ page }) => {
    // Do a purchase first
    await page.getByTestId('iap-purchase-button').click();
    await expect(page.getByTestId('iap-purchase-result')).toContainText('success:', { timeout: 3000 });

    await page.getByTestId('iap-completed-btn').click();
    await expect(page.getByTestId('iap-completed-result')).toContainText('COMPLETED');
  });

  test('getSubscriptionInfo should return subscription data', async ({ page }) => {
    await page.getByTestId('iap-subinfo-btn').click();
    await expect(page.getByTestId('iap-subinfo-result')).toContainText('ACTIVE');
  });

  test('checkoutPayment should succeed with default settings', async ({ page }) => {
    await page.getByTestId('iap-checkout-btn').click();
    await expect(page.getByTestId('iap-checkout-result')).toHaveText('success', { timeout: 3000 });
  });

  test('checkoutPayment should fail when set to fail', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'iap');

    const paymentSelect = page.locator('.ait-panel .ait-row').filter({ hasText: 'Next Payment Result' }).locator('select');
    await paymentSelect.selectOption('fail');
    await closePanel(page);

    await page.getByTestId('iap-checkout-btn').click();
    await expect(page.getByTestId('iap-checkout-result')).toContainText('fail:', { timeout: 3000 });
  });
});

// ====================================================================
// ADS
// ====================================================================

test.describe('Ads', () => {
  test('loadAdMob should fire loaded event', async ({ page }) => {
    await page.getByTestId('ads-admob-load-btn').click();
    await expect(page.getByTestId('ads-admob-load-result')).toHaveText('loaded', { timeout: 3000 });
  });

  test('showAdMob should fire events after load', async ({ page }) => {
    // Load first
    await page.getByTestId('ads-admob-load-btn').click();
    await expect(page.getByTestId('ads-admob-load-result')).toHaveText('loaded', { timeout: 3000 });

    // Show
    await page.getByTestId('ads-admob-show-btn').click();
    // Should eventually fire 'dismissed' as the last event
    await expect(page.getByTestId('ads-admob-show-result')).toHaveText('dismissed', { timeout: 5000 });
  });

  test('isAdMobLoaded should return false before load and true after load', async ({ page }) => {
    await page.getByTestId('ads-admob-isloaded-btn').click();
    await expect(page.getByTestId('ads-admob-isloaded-result')).toHaveText('false');

    // Load ad, then verify isLoaded becomes true
    await page.getByTestId('ads-admob-load-btn').click();
    await expect(page.getByTestId('ads-admob-load-result')).toHaveText('loaded', { timeout: 3000 });

    await page.getByTestId('ads-admob-isloaded-btn').click();
    await expect(page.getByTestId('ads-admob-isloaded-result')).toHaveText('true');
  });

  test('loadFullScreenAd should fire loaded event', async ({ page }) => {
    await page.getByTestId('ads-fullscreen-load-btn').click();
    await expect(page.getByTestId('ads-fullscreen-load-result')).toHaveText('loaded', { timeout: 3000 });
  });

  test('showFullScreenAd should fire dismissed after load', async ({ page }) => {
    // Load first
    await page.getByTestId('ads-fullscreen-load-btn').click();
    await expect(page.getByTestId('ads-fullscreen-load-result')).toHaveText('loaded', { timeout: 3000 });

    await page.getByTestId('ads-fullscreen-show-btn').click();
    await expect(page.getByTestId('ads-fullscreen-show-result')).toHaveText('dismissed', { timeout: 5000 });
  });

  test('TossAds.initialize should complete', async ({ page }) => {
    await page.getByTestId('ads-tossads-init-btn').click();
    await expect(page.getByTestId('ads-tossads-init-result')).toHaveText('done');
  });

  test('TossAds.destroyAll should not throw', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.getByTestId('ads-tossads-destroy-btn').click();
    await page.waitForTimeout(100);
    expect(errors).toHaveLength(0);
  });
});

// ====================================================================
// GAME
// ====================================================================

test.describe('Game', () => {
  test('grantPromotionReward should return key', async ({ page }) => {
    await page.getByTestId('game-promo-btn').click();
    await expect(page.getByTestId('game-promo-result')).toContainText('key');
  });

  test('grantPromotionRewardForGame should return key', async ({ page }) => {
    await page.getByTestId('game-promo-game-btn').click();
    await expect(page.getByTestId('game-promo-game-result')).toContainText('key');
  });

  test('submitGameCenterLeaderBoardScore should return SUCCESS', async ({ page }) => {
    await page.getByTestId('game-score-btn').click();
    await expect(page.getByTestId('game-score-result')).toContainText('SUCCESS');
  });

  test('getGameCenterGameProfile should return profile', async ({ page }) => {
    await page.getByTestId('game-profile-btn').click();
    await expect(page.getByTestId('game-profile-result')).toContainText('MockPlayer');
  });

  test('openGameCenterLeaderboard should complete', async ({ page }) => {
    await page.getByTestId('game-leaderboard-btn').click();
    await expect(page.getByTestId('game-leaderboard-result')).toHaveText('done');
  });

  test('contactsViral should fire close event', async ({ page }) => {
    await page.getByTestId('game-viral-btn').click();
    await expect(page.getByTestId('game-viral-result')).toContainText('close', { timeout: 3000 });
  });
});

// ====================================================================
// ANALYTICS
// ====================================================================

test.describe('Analytics', () => {
  test('Analytics.click should log event', async ({ page }) => {
    await page.getByTestId('analytics-click-btn').click();
    await expect(page.getByTestId('analytics-click-result')).toBeVisible();
  });

  test('Analytics.screen should log event', async ({ page }) => {
    await page.getByTestId('analytics-screen-btn').click();
    await expect(page.getByTestId('analytics-screen-result')).toBeVisible();
  });

  test('Analytics.impression should log event', async ({ page }) => {
    await page.getByTestId('analytics-impression-btn').click();
    await expect(page.getByTestId('analytics-impression-result')).toBeVisible();
  });

  test('eventLog should log event', async ({ page }) => {
    await page.getByTestId('analytics-eventlog-btn').click();
    await expect(page.getByTestId('analytics-eventlog-result')).toBeVisible();
  });

  test('all analytics types should appear in panel Analytics tab', async ({ page }) => {
    await page.getByTestId('analytics-click-btn').click();
    await page.getByTestId('analytics-screen-btn').click();
    await page.getByTestId('analytics-impression-btn').click();
    await page.getByTestId('analytics-eventlog-btn').click();

    await openPanel(page);
    await switchTab(page, 'analytics');

    const logEntries = page.locator('.ait-panel .ait-log-entry');
    // haptic events from the test also log analytics, so just check our types exist
    await expect(logEntries.filter({ hasText: 'click' }).first()).toBeVisible();
    await expect(logEntries.filter({ hasText: 'screen' }).first()).toBeVisible();
    await expect(logEntries.filter({ hasText: 'impression' }).first()).toBeVisible();
    await expect(logEntries.filter({ hasText: 'event' }).first()).toBeVisible();
  });
});

// ====================================================================
// PARTNER
// ====================================================================

test.describe('Partner', () => {
  test('addAccessoryButton should complete', async ({ page }) => {
    await page.getByTestId('partner-add-btn').click();
    await expect(page.getByTestId('partner-add-result')).toHaveText('done');
  });

  test('removeAccessoryButton should complete', async ({ page }) => {
    await page.getByTestId('partner-remove-btn').click();
    await expect(page.getByTestId('partner-remove-result')).toHaveText('done');
  });
});

// ====================================================================
// EVENTS
// ====================================================================

test.describe('Events', () => {
  test('trigger back event from panel should show in app', async ({ page }) => {
    await expect(page.getByTestId('events-empty')).toBeVisible();

    await openPanel(page);
    await switchTab(page, 'events');
    await page.locator('.ait-panel button').filter({ hasText: 'Trigger Back Event' }).click();
    await closePanel(page);

    await expect(page.getByTestId('events-log')).toBeVisible();
    await expect(page.getByTestId('events-log')).toContainText('backEvent');
  });

  test('trigger home event from panel should show in app', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'events');
    await page.locator('.ait-panel button').filter({ hasText: 'Trigger Home Event' }).click();
    await closePanel(page);

    await expect(page.getByTestId('events-log')).toContainText('homeEvent');
  });

  test('tdsEvent listener should register', async ({ page }) => {
    await page.getByTestId('events-tds-btn').click();
    await expect(page.getByTestId('events-tds-result')).toHaveText('listening');
  });

  test('onVisibilityChanged listener should register', async ({ page }) => {
    await page.getByTestId('events-visibility-btn').click();
    await expect(page.getByTestId('events-visibility-result')).toHaveText('listening');
  });
});

// ====================================================================
// LOCATION TAB (Panel)
// ====================================================================

test.describe('Location Tab', () => {
  test('should display location inputs in panel', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'location');

    const latRow = page.locator('.ait-panel .ait-row').filter({ hasText: 'Latitude' });
    await expect(latRow.locator('input')).toBeVisible();

    const lngRow = page.locator('.ait-panel .ait-row').filter({ hasText: 'Longitude' });
    await expect(lngRow.locator('input')).toBeVisible();
  });
});

// ====================================================================
// DEVICE TAB (Panel)
// ====================================================================

test.describe('Device Tab', () => {
  test('should switch device API modes', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'device');

    const cameraModeSelect = page.locator('.ait-panel .ait-row').filter({ hasText: 'Camera' }).locator('select');
    await expect(cameraModeSelect).toHaveValue('mock');

    await cameraModeSelect.selectOption('web');
    await expect(cameraModeSelect).toHaveValue('web');

    await cameraModeSelect.selectOption('prompt');
    await expect(cameraModeSelect).toHaveValue('prompt');

    await cameraModeSelect.selectOption('mock');
    await expect(cameraModeSelect).toHaveValue('mock');
  });

  test('should display all device mode selectors', async ({ page }) => {
    await openPanel(page);
    await switchTab(page, 'device');

    for (const label of ['Camera', 'Photos', 'Location', 'Network', 'Clipboard']) {
      const row = page.locator('.ait-panel .ait-row').filter({ hasText: label });
      await expect(row.locator('select')).toBeVisible();
    }
  });
});

// ====================================================================
// DRAGGABLE TOGGLE BUTTON
// ====================================================================

test.describe('Draggable Toggle Button', () => {
  test('dragging should change button Y position', async ({ page }) => {
    const toggle = page.locator('button.ait-panel-toggle');
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    // Drag the button 100px to the left and 80px up
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY - 80, { steps: 10 });
    await page.mouse.up();

    const newBox = await toggle.boundingBox();
    expect(newBox).not.toBeNull();
    // Y position should have changed after 80px vertical drag
    // (X snaps to left/right edge via snapToEdge, tested separately)
    expect(Math.abs(newBox!.y - box!.y)).toBeGreaterThan(10);
  });

  test('short click (<= 3px per axis) should toggle panel instead of dragging', async ({ page }) => {
    const toggle = page.locator('button.ait-panel-toggle');
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Move only 2px — should be treated as a click, not a drag
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 2, cy + 1, { steps: 2 });
    await page.mouse.up();

    // Panel should open (toggle behavior)
    await expect(page.locator('.ait-panel.open')).toBeVisible();
  });

  test('dragging should snap to nearest left/right edge', async ({ page }) => {
    const toggle = page.locator('button.ait-panel-toggle');
    const vw = await page.evaluate(() => window.innerWidth);

    // Drag to the left side of the screen
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(100, startY, { steps: 10 });
    await page.mouse.up();

    const leftBox = await toggle.boundingBox();
    expect(leftBox).not.toBeNull();
    // Should snap to left edge (margin = 16px, see snapToEdge in panel/index.ts)
    expect(leftBox!.x).toBe(16);

    // Now drag to the right side
    const lx = leftBox!.x + leftBox!.width / 2;
    const ly = leftBox!.y + leftBox!.height / 2;

    await page.mouse.move(lx, ly);
    await page.mouse.down();
    await page.mouse.move(vw - 50, ly, { steps: 10 });
    await page.mouse.up();

    const rightBox = await toggle.boundingBox();
    expect(rightBox).not.toBeNull();
    // Should snap to right edge (right: 16px → left = vw - 16 - width).
    // Uses tolerance < 1px because right-edge position is computed from style.right,
    // which can produce sub-pixel rounding vs the left-edge's direct style.left = '16px'.
    expect(Math.abs(rightBox!.x - (vw - 16 - rightBox!.width))).toBeLessThan(1);
  });
});

// ====================================================================
// MOBILE FULLSCREEN
// ====================================================================

test.describe('Mobile Fullscreen', () => {
  // Viewport ≤ 480px triggers fullscreen via @media query in panel/styles.ts
  test.use({ viewport: { width: 375, height: 667 } });

  test('panel should open in fullscreen on small viewport', async ({ page }) => {
    await openPanel(page);

    const panel = page.locator('.ait-panel.open');
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBe(0);
    expect(box!.y).toBe(0);
    expect(box!.width).toBe(viewport.width);
    expect(box!.height).toBe(viewport.height);
  });

  test('close button should be visible in fullscreen mode', async ({ page }) => {
    await openPanel(page);

    const closeBtn = page.locator('.ait-panel-close');
    await expect(closeBtn).toBeVisible();

    // Clicking close should hide the panel
    await closeBtn.click();
    await expect(page.locator('.ait-panel.open')).not.toBeVisible();
  });
});

// ====================================================================
// PANEL POSITION PERSISTENCE
// ====================================================================

test.describe('Panel Position Persistence', () => {
  test('toggle button position should persist after page reload', async ({ page }) => {
    const toggle = page.locator('button.ait-panel-toggle');
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    // Drag the button to the left side, somewhere in the middle vertically
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(80, 300, { steps: 10 });
    await page.mouse.up();

    // Capture post-drag position for Y comparison after reload
    const draggedBox = await toggle.boundingBox();
    expect(draggedBox).not.toBeNull();

    // Verify position was saved to localStorage
    const saved = await page.evaluate(() => localStorage.getItem('__ait_btn_pos'));
    expect(saved).not.toBeNull();
    const pos = JSON.parse(saved!);
    expect(pos.left).toBe('16px'); // snapped to left edge

    // Reload the page
    await page.reload();
    await expect(page.getByTestId('auth-section')).toBeVisible();

    // Toggle button should be restored near the saved position
    const restored = page.locator('button.ait-panel-toggle');
    await expect(restored).toBeVisible();
    const restoredBox = await restored.boundingBox();
    expect(restoredBox).not.toBeNull();
    // Should be on the left side (x = 16) and Y approximately preserved
    expect(restoredBox!.x).toBe(16);
    expect(Math.abs(restoredBox!.y - draggedBox!.y)).toBeLessThan(5);
  });
});
