import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

// Minimal 1×1 transparent PNG — fulfilling icon/favicon routes with a valid
// image body prevents Chromium's img decode error from firing the onError
// handler (setIconVisible(false)), which would otherwise remove the img element
// before assertions run. Content correctness (src attribute) is what these
// tests check; decode success is a precondition, not the subject.
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_1X1 = Buffer.from(PNG_1X1_B64, 'base64');

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

    // Nav-bar emulation surfaced (#495): the partner bar with title + the
    // right capsule (`···` menu · `✕`). The `···` menu rehomes Rescan.
    await expect(page.getByTestId('launcher-navbar')).toBeVisible();
    await expect(page.getByTestId('launcher-navbar')).toHaveAttribute(
      'data-navbar-type',
      'partner',
    );
    await expect(page.getByTestId('launcher-navbar-more')).toBeVisible();
    await expect(page.getByTestId('launcher-navbar-close')).toBeVisible();
  });

  test('navBarType=game renders the floating capsule only (no full bar title)', async ({
    page,
  }) => {
    const tunnel = 'https://example.com/';
    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}&navBarType=game`);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    const navbar = page.getByTestId('launcher-navbar');
    await expect(navbar).toBeVisible();
    await expect(navbar).toHaveAttribute('data-navbar-type', 'game');
    // Game variant: capsule present, no title (full bar absent).
    await expect(page.getByTestId('launcher-navbar-more')).toBeVisible();
    await expect(page.getByTestId('launcher-navbar-title')).toHaveCount(0);
  });

  test('name= sets the partner bar title; absent name falls back to a generic label', async ({
    page,
  }) => {
    const tunnel = 'https://example.com/';
    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}&name=My%20Mini%20App`);
    await expect(page.getByTestId('launcher-navbar-title')).toHaveText('My Mini App');

    // No name= → a generic localized default (never the tunnel host).
    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}`);
    // Playwright default locale en-US → "Mini App".
    await expect(page.getByTestId('launcher-navbar-title')).toHaveText('Mini App');
  });

  test('icon= (https) renders the icon slot in the partner bar (#498)', async ({ page }) => {
    const tunnel = 'https://example.com/';
    const icon = 'https://example.com/icon.png';

    // Stub the icon fetch with a valid 1×1 PNG so the img onError handler never
    // fires. A real fetch to example.com fails (network unreachable / 404) on CI,
    // triggering onError → setIconVisible(false) → img removed before the
    // assertion. An empty or invalid body triggers a Chromium decode error and
    // still fires onError. The test checks src attribute assignment (rendering
    // logic), not network reachability — intercepting with a valid image body
    // is the correct isolation here.
    await page.route(icon, (route) =>
      route.fulfill({ status: 200, body: PNG_1X1, contentType: 'image/png' }),
    );

    await page.goto(
      `/launcher/?url=${encodeURIComponent(tunnel)}&icon=${encodeURIComponent(icon)}`,
    );
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    const img = page.getByTestId('launcher-navbar-icon');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('src', icon);
  });

  test('icon= absent + url= present → favicon fallback src in partner bar (#498)', async ({
    page,
  }) => {
    const tunnel = 'https://example.com/';

    // Chromium fetches favicon.ico via a special low-level channel that bypasses
    // Playwright's page.route() intercept layer. The favicon.ico request from
    // the iframe's origin therefore reaches the network and fails on CI,
    // triggering onError → setIconVisible(false) → img removed before assertion.
    //
    // Root fix: intercept img src writes via addInitScript so that the attribute
    // is set to the correct URL (which toHaveAttribute reads) while the actual
    // fetch is redirected to a valid in-memory data URI so onError stays silent.
    //
    // Implementation notes:
    // - We override both HTMLImageElement.prototype.src (property setter) and
    //   Element.prototype.setAttribute to intercept all code paths React uses.
    // - When a /favicon.ico URL is detected:
    //     1. Freeze the attribute to the original URL via our patched setAttribute
    //        that skips the actual setAttribute for favicon.ico calls.
    //     2. Set the property to a 1×1 PNG data URI so Chromium loads it
    //        synchronously without a network round-trip.
    // - All other URLs go through the original code paths unchanged.
    await page.addInitScript(`
      (function() {
        var PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        var srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
        var origSetAttribute = Element.prototype.setAttribute;

        // Intercept setAttribute so React's attribute write stores the original URL
        // without triggering a second network fetch after we redirect the property.
        Element.prototype.setAttribute = function(name, value) {
          if (
            name === "src" &&
            this instanceof HTMLImageElement &&
            typeof value === "string" &&
            value.endsWith("/favicon.ico")
          ) {
            // Store the original URL as a data attribute so toHaveAttribute("src") still
            // works by reading the real attribute via a thin bridge below.
            origSetAttribute.call(this, "data-intended-src", value);
            // Set the actual src attribute to data URI (no network fetch, no onError).
            origSetAttribute.call(this, "src", PNG);
            return;
          }
          origSetAttribute.call(this, name, value);
        };

        if (srcDesc && srcDesc.set) {
          Object.defineProperty(HTMLImageElement.prototype, "src", {
            get: srcDesc.get,
            set: function(value) {
              if (typeof value === "string" && value.endsWith("/favicon.ico")) {
                origSetAttribute.call(this, "data-intended-src", value);
                srcDesc.set.call(this, PNG);
              } else {
                srcDesc.set.call(this, value);
              }
            },
            configurable: true,
            enumerable: true,
          });
        }
      })();
    `);

    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}`);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    // Favicon fallback: origin of the framed URL + /favicon.ico.
    // We check data-intended-src (the URL the component actually set) because
    // the src attribute itself points to the data URI stub injected above.
    const img = page.getByTestId('launcher-navbar-icon');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('data-intended-src', 'https://example.com/favicon.ico');
  });

  test('game variant has no icon slot even when icon= is present (#498)', async ({ page }) => {
    const tunnel = 'https://example.com/';
    const icon = 'https://example.com/icon.png';
    await page.goto(
      `/launcher/?url=${encodeURIComponent(tunnel)}&navBarType=game&icon=${encodeURIComponent(icon)}`,
    );
    await expect(page.getByTestId('launcher-frame')).toBeVisible();
    await expect(page.getByTestId('launcher-navbar')).toHaveAttribute('data-navbar-type', 'game');
    // Game variant: no icon slot (no title either, which is the existing assertion).
    await expect(page.getByTestId('launcher-navbar-icon')).toHaveCount(0);
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

  test('viewport diagnostics is reachable from the nav-bar menu (#469, rehomed #495)', async ({
    page,
  }) => {
    // The diag control moved into the live-screen nav-bar `···` menu (#495), so
    // enter live first.
    await page.goto(`/launcher/?url=${encodeURIComponent('https://example.com/')}`);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();
    await expect(page.getByTestId('launcher-diag-panel')).toBeHidden();

    // Open the `···` menu and toggle diagnostics.
    await page.getByTestId('launcher-navbar-more').click();
    await expect(page.getByTestId('launcher-navbar-menu')).toBeVisible();
    await page.getByTestId('launcher-menu-diag').click();

    const panel = page.getByTestId('launcher-diag-panel');
    await expect(panel).toBeVisible();

    // A desktop Chromium tab is never standalone — the row must say "no"
    // (Playwright's default locale is en-US, so the en catalog renders).
    await expect(page.getByTestId('launcher-diag-standalone')).toHaveText('no');
    // The inner row reflects the live window geometry.
    const inner = await page.evaluate(() => `${window.innerWidth} × ${window.innerHeight}`);
    await expect(page.getByTestId('launcher-diag-inner')).toHaveText(inner);

    // Toggle off via the menu again.
    await page.getByTestId('launcher-navbar-more').click();
    await page.getByTestId('launcher-menu-diag').click();
    await expect(panel).toBeHidden();
  });

  test('nav-bar `✕` ends the session and returns to the scan screen (#495)', async ({ page }) => {
    await page.goto(`/launcher/?url=${encodeURIComponent('https://example.com/')}`);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    await page.getByTestId('launcher-navbar-close').click();

    await expect(page.getByTestId('launcher-setup')).toBeVisible();
    await expect(page.getByTestId('launcher-frame')).toBeHidden();
    await expect(page.getByTestId('launcher-navbar')).toBeHidden();
  });

  test('nav-bar menu Rescan returns to the scan screen (#495)', async ({ page }) => {
    await page.goto(`/launcher/?url=${encodeURIComponent('https://example.com/')}`);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    await page.getByTestId('launcher-navbar-more').click();
    await page.getByTestId('launcher-menu-rescan').click();

    await expect(page.getByTestId('launcher-setup')).toBeVisible();
    await expect(page.getByTestId('launcher-frame')).toBeHidden();
  });

  test('letterbox label stays hidden in a normal browser tab (#469)', async ({ page }) => {
    await page.goto('/launcher/');
    // Not standalone → the iOS letterbox signature can never match here.
    await expect(page.getByTestId('launcher-letterbox-label')).toBeHidden();
  });

  test('fresh open without ?url= always lands on the setup/scan screen (#459)', async ({
    page,
  }) => {
    const tunnel = 'https://example.com/';
    await page.goto(`/launcher/?url=${encodeURIComponent(tunnel)}`);
    await expect(page.getByTestId('launcher-frame')).toHaveAttribute('src', tunnel);

    // Reload without ?url= — last-URL auto-resume was removed (#459): tunnel
    // hosts change every session and TOTP at= codes expire, so a saved URL is
    // always stale. A fresh open must show setup with an empty input.
    await page.goto('/launcher/');
    await expect(page.getByTestId('launcher-setup')).toBeVisible();
    await expect(page.getByTestId('launcher-frame')).toBeHidden();
    await expect(page.getByTestId('launcher-url-input')).toHaveValue('');
  });
});

// Debug-auth banner (#438/#478): the framed tunnel page reports a TOTP block
// via `ait:debug-attach-blocked` postMessage. Posting on window from the test
// page itself exercises the exact listener (it guards on message SHAPE, not
// origin — the only effect is a localized banner). Playwright's default locale
// is en-US, so the en catalog renders.
test.describe('launcher debug-auth banner (#438/#478)', () => {
  const LIVE_URL = `/launcher/?url=${encodeURIComponent('https://example.com/')}`;
  const post = (reason: string) => ({ type: 'ait:debug-attach-blocked', reason });

  test('reason auth-expired shows the banner with the expired-session hint', async ({ page }) => {
    await page.goto(LIVE_URL);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();
    await expect(page.getByTestId('launcher-auth-error')).toBeHidden();

    await page.evaluate((msg) => window.postMessage(msg, '*'), post('auth-expired'));

    await expect(page.getByTestId('launcher-auth-error')).toBeVisible();
    await expect(page.getByTestId('launcher-auth-error-hint')).toHaveText(
      'The debug session has expired. Scan a fresh QR from the attach page on your Mac.',
    );
  });

  test('reason auth keeps the generic wrong-code hint (#438 path unchanged)', async ({ page }) => {
    await page.goto(LIVE_URL);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    await page.evaluate((msg) => window.postMessage(msg, '*'), post('auth'));

    await expect(page.getByTestId('launcher-auth-error')).toBeVisible();
    await expect(page.getByTestId('launcher-auth-error-hint')).toHaveText(
      'The QR code may have expired. Scan a fresh QR code.',
    );
  });

  test('unknown reasons are ignored (strict enum allow-list)', async ({ page }) => {
    await page.goto(LIVE_URL);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    await page.evaluate((msg) => window.postMessage(msg, '*'), post('something-else'));

    // Give the (would-be) message a beat, then assert the banner never showed.
    await page.waitForTimeout(100);
    await expect(page.getByTestId('launcher-auth-error')).toBeHidden();
  });

  test('rescan CTA clears the banner and returns to setup', async ({ page }) => {
    await page.goto(LIVE_URL);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    await page.evaluate((msg) => window.postMessage(msg, '*'), post('auth-expired'));
    await expect(page.getByTestId('launcher-auth-error')).toBeVisible();

    await page.getByTestId('launcher-auth-error-rescan').click();

    await expect(page.getByTestId('launcher-auth-error')).toBeHidden();
    await expect(page.getByTestId('launcher-setup')).toBeVisible();
  });
});

// Regression for the #475 real-device pile-up: the bottom chrome (now just the
// diag panel + letterbox label after #495 rehomed the RESCAN/diag FAB into the
// nav-bar menu) is one fixed flex stack anchored at bottom:12px (no safe-area
// inset in a desktop tab). The chrome-Δ discriminator must read 12px so the ICB
// is correctly resolved. The letterbox label needs a standalone display mode a
// browser tab can't fake — its geometry is covered by letterbox.vitest.ts.
test.describe('launcher bottom chrome stack (#475, rehomed #495)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('diag panel anchors at the ICB-correct bottom offset at 390×844', async ({ page }) => {
    await page.goto(`/launcher/?url=${encodeURIComponent('https://example.com/')}`);
    await expect(page.getByTestId('launcher-frame')).toBeVisible();

    // Open the diag panel from the nav-bar `···` menu.
    await page.getByTestId('launcher-navbar-more').click();
    await page.getByTestId('launcher-menu-diag').click();
    await expect(page.getByTestId('launcher-diag-panel')).toBeVisible();

    // The on-device ICB discriminator row: with no safe-area inset the stack
    // anchors at bottom: 12px, so the container's bottom edge sits 12px above
    // window.innerHeight.
    await expect(page.getByTestId('launcher-diag-chromedelta')).toHaveText('12px');
  });
});
