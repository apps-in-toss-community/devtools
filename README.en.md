# @ait-co/devtools

[한국어](./README.md) · **English**

[![npm](https://img.shields.io/npm/v/@ait-co/devtools)](https://www.npmjs.com/package/@ait-co/devtools) [![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

![@ait-co/devtools — SDK mock + DevTools panel for Apps In Toss mini-apps](./assets/og/image.png)

A mock library for the `@apps-in-toss/web-framework` SDK. Imports of `@apps-in-toss/web-bridge` and `@apps-in-toss/web-analytics` are also mocked.

Lets you develop and test Apps in Toss mini-apps in a **regular browser** — without the Toss app. All SDK features are simulated so you can move fast.

- **60+ SDK API mocks** — auth, payments, IAP, location, camera, storage, and more
- **Device API mode system** — switch between mock / web / prompt modes for device APIs
- **Device simulation** — iPhone/Galaxy presets + orientation toggle to simulate a mobile viewport in your desktop browser
- **Floating DevTools Panel** — control SDK state in real time from the browser (10 tabs, mock state preset library included)
- **All bundlers supported** — [unplugin](https://github.com/unjs/unplugin)-based Vite, Webpack, Rspack, esbuild, and Rollup integration

Live demo: <https://devtools.aitc.dev/> (the `e2e/fixture/` from this repo deployed to GitHub Pages as a self-contained demo).

## Install

```bash
npm install -D @ait-co/devtools
# or
pnpm add -D @ait-co/devtools
```

> **Supported SDK version**: `@apps-in-toss/web-framework >=2.5.0 <2.6.0` (peer, required).
>
> devtools is only verified against SDK versions within that range. Installing an out-of-range SDK version
> will cause the package manager to emit a peer warning at install time. Additionally, calling an API that
> devtools has not yet mocked will throw a runtime error — this is intentional to prevent the
> "works in devtools but fails with the real SDK" type of production incident. For missing APIs,
> please [file an issue](https://github.com/apps-in-toss-community/devtools/issues).

## Reference consumer

[`sdk-example`](https://github.com/apps-in-toss-community/sdk-example) is the reference consumer of devtools. It's a catalog app where every SDK API can be run interactively, and the web demo is live at <https://sdk-example.aitc.dev/>. When you add a new mock, confirming that it works on the sdk-example card is the first sanity check. That said, this repo's E2E suite runs against an **internal self-contained fixture (`e2e/fixture/`)** without cloning sdk-example — so a broken sdk-example won't affect devtools CI.

## Bundler setup

### Vite

```ts
// vite.config.ts (development only)
import aitDevtools from '@ait-co/devtools/unplugin';

export default {
  plugins: [aitDevtools.vite()],
};
```

> This is a development-only setup. To exclude it from production builds, see the [Production builds](#production-builds) section below.

### Webpack / Rspack

```js
// webpack.config.js (ESM, recommended for development only)
import aitDevtools from '@ait-co/devtools/unplugin';
config.plugins.push(aitDevtools.webpack());

// webpack.config.js (CommonJS)
const aitDevtools = require('@ait-co/devtools/unplugin');
config.plugins.push(aitDevtools.webpack());
```

### Next.js (Turbopack)

Turbopack does not support a plugin system, so use `resolveAlias` instead.

- You also need to alias `@apps-in-toss/web-bridge` and `@apps-in-toss/web-analytics`.
- Turbopack is generally only used with `next dev`, so no extra production guard is needed.

```js
// next.config.js (Next.js 15+)
module.exports = {
  turbo: {
    resolveAlias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
      '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
      '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
    },
  },
};
```

For Next.js 14 and below, use `experimental.turbo`:

```js
// next.config.js (Next.js 14 and below)
module.exports = {
  experimental: {
    turbo: {
      resolveAlias: {
        '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
        '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
        '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
      },
    },
  },
};
```

> **Panel injection**: Turbopack does not support unplugin, so the Panel is not auto-injected. Import it directly from your entry point:
> ```ts
> // app/layout.tsx or pages/_app.tsx
> import '@ait-co/devtools/panel';
> ```

### Next.js (Webpack)

When using Webpack mode in Next.js (`next dev` without `--turbo`, or `next build`):

```js
// next.config.js (Webpack mode)
const aitDevtools = require('@ait-co/devtools/unplugin'); // CJS entrypoint provided

module.exports = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.plugins.push(aitDevtools.webpack());
    }
    return config;
  },
};
```

### Manual alias setup

You can also configure the bundler's `resolve.alias` directly:

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
      '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
      '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
    },
  },
});
```

```js
// webpack.config.js (Webpack requires absolute paths)
module.exports = {
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': require.resolve('@ait-co/devtools/mock'),
      '@apps-in-toss/web-bridge': require.resolve('@ait-co/devtools/mock'),
      '@apps-in-toss/web-analytics': require.resolve('@ait-co/devtools/mock'),
    },
  },
};
```

> **Note**: Using manual aliases alone will not auto-inject the DevTools Panel. Add a direct import to your entry point:
> ```ts
> import '@ait-co/devtools/panel'; // add to entry point
> ```

### Plugin options

| Option | Type | Default | Description |
|---|---|---|---|
| `panel` | `boolean` | `true` | Auto-inject the DevTools Panel |
| `forceEnable` | `boolean` | `false` | Enable devtools even in production |
| `mock` | `boolean` | `true` (dev) / `false` (prod+forceEnable) | Enable mock alias |
| `tunnel` | `boolean \| { port?: number; qr?: boolean }` | `false` | Expose the Vite dev server via a Cloudflare quick tunnel for real-device preview (see [below](#run-on-a-real-phone)). **Vite dev mode only** |

```ts
aitDevtools.vite({ panel: false }); // mock only, no panel
aitDevtools.vite({ forceEnable: true }); // enable in production (mock OFF by default, panel ON)
aitDevtools.vite({ forceEnable: true, mock: true }); // enable mock in production too
aitDevtools.vite({ tunnel: true }); // expose dev server at *.trycloudflare.com
```

## Production builds

By default, the devtools plugin **automatically disables itself in production** (`NODE_ENV === 'production'` causes both the alias transform and the Panel injection to be skipped). No conditional configuration is needed to keep it safe.

To use devtools in a production build — for example in a staging environment — use the `forceEnable` option:

```ts
aitDevtools.vite({ forceEnable: true }); // panel ON, mock OFF (monitoring only)
aitDevtools.vite({ forceEnable: true, mock: true }); // panel + mock both ON
```

You can also conditionally exclude the plugin from your bundler config entirely:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import aitDevtools from '@ait-co/devtools/unplugin';

export default defineConfig(({ command }) => ({
  plugins: [
    ...(command === 'serve' ? [aitDevtools.vite()] : []),
  ],
}));
```

```js
// webpack.config.js (same applies to Rspack)
const aitDevtools = require('@ait-co/devtools/unplugin');
const plugins = [];
if (process.env.NODE_ENV !== 'production') {
  plugins.push(aitDevtools.webpack());
}
```

> For Next.js, see the [Next.js (Webpack)](#nextjs-webpack) and [Next.js (Turbopack)](#nextjs-turbopack) sections above.

## Run on a real phone

When you want to view a mini-app that runs fine in desktop Chrome on an **actual phone**. The Vite dev server is exposed via a Cloudflare quick tunnel (`*.trycloudflare.com`, **no account required**), and you add a launcher PWA with a fixed URL to your phone's home screen once, then open each session's tunnel URL inside it.

Setup has three tiers:

- **Once per project** — add the option to `vite.config`, add the pnpm setting to `package.json`, and optionally add a `dev:phone` script
- **Once per phone** — add the launcher PWA to your home screen
- **Each session** — one line: `pnpm dev:phone` (or `AIT_TUNNEL=1 pnpm dev`)

### 1. Per-project setup

(a) **Add the `tunnel` option to `vite.config.ts`** — if you're fine with cloudflared starting every time, use `tunnel: true`; if you prefer to keep it off by default and enable it explicitly, use an env gate:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import aitDevtools from '@ait-co/devtools/unplugin';

export default defineConfig({
  plugins: [
    aitDevtools.vite({
      tunnel: !!process.env.AIT_TUNNEL, // OFF by default, ON when AIT_TUNNEL=1
    }),
  ],
});
```

> `process.env.AIT_TUNNEL` is evaluated when `vite.config.ts` is loaded (i.e. when the vite process starts). The env variable must therefore be set **before** vite launches (the `dev:phone` script in step (c) handles this automatically).

(b) **Allow the pnpm 10+ build script** — pnpm blocks dependency postinstall scripts by default for security. `cloudflared` downloads its binary (~38 MB) in postinstall, so you need to explicitly allow it:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["cloudflared"]
  }
}
```

> Without this, things still work — `tunnel.ts` lazily calls `cloudflared.install()` on first start. You will just see an "Ignored build scripts" warning on every `pnpm install`, and the binary download is deferred to the first `pnpm dev`. See [`sdk-example#60`](https://github.com/apps-in-toss-community/sdk-example/pull/60).

(c) **(Optional) `dev:phone` script** — to avoid typing the env variable each time:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:phone": "AIT_TUNNEL=1 vite"
  }
}
```

### 2. Per-phone setup (required)

Open `https://devtools.aitc.dev/launcher/` on your phone and **add it to your home screen**. The launcher shows an "Install launcher to your phone" button that triggers the platform-native install flow automatically — Android Chrome gets the in-app install prompt, iOS Safari gets a Share → Add to Home Screen illustration, and Firefox / Samsung Internet get a manual instruction card. The launcher URL never changes, so this is a one-time step per phone.

The launcher **only works when launched as an installed PWA from the home screen**. Opening it in a regular browser tab shows only the install hint — the URL input and scanner are hidden. The chrome-less standalone display is the whole point of the launcher shell, and a regular tab can't provide that.

### 3. Each session

1. Run `pnpm dev:phone` on your desktop (or `AIT_TUNNEL=1 pnpm dev` if you skipped step 1-(c)). The terminal will print a `https://*.trycloudflare.com` URL along with an ASCII QR code.
2. Scan the QR code with your phone's camera (or with the "Scan QR" button inside the launcher). The QR encodes a `https://devtools.aitc.dev/launcher/?url=<tunnel>` deep-link, so the launcher PWA opens and auto-enters the day's dev app full-screen — no paste step required.
3. Next session, just scan the new QR. The launcher remembers the last URL and you can swap it any time with the "Rescan" button.

> Whether the OS camera routes the QR straight into the installed launcher PWA (instead of a regular browser tab) is most reliable on Android Chrome; iOS Safari versions may fall back to a normal tab. In that case, open the launcher from its home-screen icon and use its in-page "Scan QR" button.

### Background

> **Why go through a launcher?** The quick tunnel URL changes on every run, so installing that URL directly as a PWA gives you a dead link next session. Navigating cross-origin breaks the standalone (chrome-less) mode on both iOS and Android. → The solution is to install a launcher with a fixed URL once, and use an `<iframe>` inside it to show the day's dev app full-bleed.
>
> Quick tunnels have **no authentication**, the **URL changes on every run**, and they are **not for production use**. (If you have an account and domain, a named tunnel with a fixed hostname is possible via a future `tunnel: { hostname }` option.)
>
> The `tunnel` option only works in Vite dev mode — no tunnel is started for production builds, even with `forceEnable`. It is silently ignored for other bundlers (Webpack/Rspack, etc.). When the option is enabled, `cloudflared` and `qrcode-terminal` are loaded via dynamic import only, so they do not appear in the bundle graph when the option is off.

### One-line setup (planned)

The per-project steps above (vite.config patch + `onlyBuiltDependencies` + `dev:phone` script) are planned to be absorbed into a single command like `/ait setup phone` in the future [`agent-plugin`](https://github.com/apps-in-toss-community/agent-plugin) (command name is tentative). Since this README serves as the spec for that automation, the manual steps will remain documented here even after automation is available.

## Device API mode system

Device-related APIs (camera, location, clipboard, etc.) operate in three modes:

| Mode | Behavior | Use case |
|---|---|---|
| **mock** | Returns dummy data stored in `aitState` | Automated tests, fixed scenarios |
| **web** | Uses browser-native APIs (Geolocation, File API, etc.) | Testing with real device capabilities |
| **prompt** | DevTools Panel opens automatically and waits for user input (30-second timeout) | Manual QA, entering specific values |

### API support by mode

| API | mock | web | prompt |
|---|---|---|---|
| `openCamera` | ✅ | ✅ | ✅ |
| `fetchAlbumPhotos` | ✅ | ✅ | ✅ |
| `getCurrentLocation` | ✅ | ✅ | ✅ |
| `startUpdateLocation` | ✅ | ✅ | ✅ |
| `getNetworkStatus` | ✅ | ✅ | — |
| `getClipboardText` / `setClipboardText` | ✅ | ✅ | — |

### Setting the mode

```js
// Change individual API modes from the console
__ait.patch('deviceModes', { camera: 'web', location: 'prompt' });

// Or use the dropdown in the Device tab of the DevTools Panel
```

### Managing dummy images

Camera and album APIs return dummy images in mock mode.

- **Default placeholders**: 3 auto-generated 320×240 images in blue, green, and orange
- **Custom images**: Add or remove files from the Device tab in the DevTools Panel
- **Set from console**: `__ait.patch('mockData', { images: ['data:image/png;base64,...'] })`

## Floating DevTools Panel

When using the plugin, the panel is auto-injected into your entry point file. Click the **'AIT' button** in the bottom-right corner of the screen to toggle it.

### 10 tabs

| Tab | Description |
|---|---|
| **Environment** | Platform OS (ios/android), app version, environment (toss/sandbox), locale, network status, Safe Area Insets |
| **Presets** | Apply/remove common QA scenarios (permission denied, offline, logged out, etc.) with one click. Save and delete user presets |
| **Viewport** | Simulate a mobile viewport using device presets (iPhone/Galaxy) + orientation toggle |
| **Permissions** | Control camera, photos, geolocation, clipboard, contacts, and microphone permission states (allowed/denied/notDetermined) |
| **Location** | Set latitude, longitude, and accuracy |
| **Device** | Switch API modes (mock/web/prompt), manage dummy images (add/remove/reset to defaults) |
| **IAP** | Choose the next purchase result (success/cancel/error, etc.), TossPay payment result, completed order history (last 5) |
| **Events** | Trigger Back/Home navigation events, toggle login state |
| **Analytics** | Real-time log viewer for recorded analytics events (last 30 entries, with timestamp/type/parameters) |
| **Storage** | View and clear items stored via the `Storage` API |

> **Prompt mode auto-open**: When an API set to prompt mode is called, the Panel automatically opens the Device tab and shows the input UI.

### Mock state preset library (Presets tab)

When a scenario requires multiple mock keys to be in a specific state simultaneously (e.g. "IAP `NETWORK_ERROR` + payment fail when offline"), instead of setting them manually each time you can apply the whole set with one click. Applied presets show a ✓ indicator; if any key defined by the preset changes, the indicator automatically clears (keys not defined by the preset are not compared).

Built-in presets:

| ID | Meaning |
|---|---|
| `all-allowed` | All permissions allowed, WIFI, logged in, IAP success — return to baseline scenario |
| `permission-denied` | camera / photos / geolocation / contacts denied |
| `offline` | `getNetworkStatus` → OFFLINE, IAP `NETWORK_ERROR`, payment fail |
| `logged-out` | `auth.isLoggedIn=false`. Validates the login flow |
| `iap-pending` | IAP `nextResult` → `PAYMENT_PENDING` |
| `ads-no-fill` | Triggers the ad fill failure branch |

Any state you've toggled together can be saved as a preset via the "Save current as preset" button (persisted in `localStorage` with the `__ait_preset:<id>` prefix). Saved presets survive page reload and tab re-entry. Preset scope is limited to the `networkStatus / permissions / auth / iap / ads / payment` slices — unrelated state like viewport and brand is not affected.

Presets are also exported from the package:

```ts
import { applyPreset, builtInPresets, saveUserPreset } from '@ait-co/devtools';

// Apply a built-in preset
const offline = builtInPresets.find((p) => p.id === 'offline')!;
applyPreset(offline.state);

// Save a custom preset
saveUserPreset('My QA scenario', {
  networkStatus: 'OFFLINE',
  permissions: { camera: 'denied' },
  auth: { isLoggedIn: false },
});
```

### Panel mount / dispose

Importing `@ait-co/devtools/panel` mounts the panel automatically when the DOM is ready. Mounting is idempotent — even if the same page imports it multiple times or calls `mount()` again, only one toggle button will be shown.

If you need to explicitly remove the panel in HMR or SPA routing scenarios, use `disposePanel()`:

```ts
import { disposePanel, mount } from '@ait-co/devtools/panel';

disposePanel();  // Removes the toggle, panel, injected <style>, and all listeners.
                  // Safe to call before mounting or to call twice.
mount();          // Re-mount from a clean state. No duplicate <style> or listeners.
```

`disposeViewport()` is called internally as well, so any active viewport simulation is also reverted.

## Device simulation (Viewport tab)

When developing mobile mini-apps in a desktop browser, you can validate layout against the actual device resolution, safe area, notch, home indicator, and Apps in Toss nav bar.

### Presets (2026)

| Category | Devices |
|---|---|
| Apple | iPhone SE (3rd gen), iPhone 16e, iPhone 17, iPhone Air, iPhone 17 Pro, iPhone 17 Pro Max |
| Samsung | Galaxy S26, S26+, S26 Ultra, Z Flip7, Z Fold7 (folded / unfolded) |
| Other | Custom (enter width/height manually), None (default) |

> **Galaxy S26 series** (released 2026-03-11): CSS viewport values use measurements from [phone-simulator.com](https://www.phone-simulator.com/). Safe area insets temporarily use S25 values pending real measurements in the Toss host environment — for pixel-accurate QA, verify on a real device.
>
> iPhone 17 series was released in September 2025 and is based on actual spec.

Each preset includes:
- **CSS viewport** (portrait `width × height`)
- **DPR** (devicePixelRatio: 2, 3, 3.5, etc.)
- **Notch** type (`none` / `notch` / `dynamic-island` / `punch-hole-center`)
- **OS-level safe area insets** (status bar / home indicator / left/right insets based on notch rotation)

### Orientation

- **auto** (default) — The Panel does not force any orientation. Calls to `setDeviceOrientation` from your app are recorded in a separate field (`appOrientation`) and used to determine the effective orientation. Repeated calls from the same app are always reflected correctly.
- **portrait / landscape** — The Panel overrides orientation. Calls to `setDeviceOrientation` from your app are ignored and logged with `console.warn`.

When switching to landscape:
- CSS viewport width and height are swapped.
- For iPhone (notch/Dynamic Island) presets, the safe area top becomes 0 and an inset appears on only one side depending on the **Notch side** toggle (left/right, default left) — matching real device behavior.
- For Android (punch-hole) presets, the status bar stays at the top.

### Frame + notch + home indicator + Apps in Toss nav bar

When **Show frame** is toggled on:
- Border-radius + box-shadow to mimic the device bezel
- Notch / Dynamic Island / punch-hole overlay (absolutely positioned at the top of body)
- Home indicator pill (only on devices with `safeAreaBottom > 0`, positioned at the bottom of body)
- App name uses `aitState.brand.displayName` (editable in the Environment tab, auto-updates)
- The back button triggers `__ait:backEvent` and the X button calls `closeView()` — you can verify actual SDK event plumbing directly from the panel

When **Show Apps in Toss nav bar** is toggled on (default on):
- A 48px nav bar overlay simulating the Toss host's top nav bar (back / app icon+name / ⋯ / ×)
- Positioned just below the status bar, after the safe area top
- **Important**: these 48px are **not included** in `env(safe-area-inset-top)` or `SafeAreaInsets.get().top` (this matches the SDK behavior). Toss-side examples compensate using the pattern `insets.top + 48`.

### Console manipulation

```js
// iPhone 17 Pro portrait + frame on
__ait.patch('viewport', { preset: 'iphone-17-pro', orientation: 'auto', frame: true });

// Force landscape (app's setDeviceOrientation calls are ignored)
__ait.patch('viewport', { orientation: 'landscape' });

// Notch side in landscape (iOS default 'left')
__ait.patch('viewport', { landscapeSide: 'right' });

// Custom size (automatically clamped to 1–4096)
__ait.patch('viewport', { preset: 'custom', customWidth: 360, customHeight: 740 });

// Hide the Apps in Toss nav bar (to inspect the pure viewport)
__ait.patch('viewport', { aitNavBar: false });

// Toggle nav bar variant ('partner' = white background + icon/name, 'game' = transparent + ⋯/× only)
__ait.patch('viewport', { aitNavBarType: 'game' });

// Reset
__ait.patch('viewport', { preset: 'none' });
```

### Status panel

The bottom of the Viewport tab shows the currently applied values in real time:
- **CSS / physical**: `402×874@3x | 1206×2622 portrait (auto)`
- **Safe area**: `T59 R0 B34 L0`
- **AIT nav bar**: `48px (excl. SafeArea)`

### Persistence + technical details

- State is saved to sessionStorage (`__ait_viewport`) and restored on page reload.
- Selecting a preset also updates `aitState.safeAreaInsets` → the SDK's `SafeAreaInsets.get()` / `.subscribe()` follow along.
- The viewport is applied to `document.body` via `max-width`/`max-height` + `margin:auto`. No iframe is used, so the app's JS/CSS runs as-is and DevTools remains fully accessible.
- `isolation: isolate` is applied to body so the z-index of the notch/nav bar/home indicator overlay doesn't leak outside the stacking context (the DevTools panel floats above).
- If you need to remove the viewport simulation programmatically, `disposeViewport()` is available as an export.
- User-Agent spoofing / touch event emulation / network throttling are not done (Chrome DevTools already provides these).

### Known limitations

- **Body becomes the scroll container** — while the viewport is active, scrolling happens on `document.body` rather than `window`. `window.addEventListener('scroll', ...)` or `IntersectionObserver` attached to the root may behave differently from a real device. If your mini-app handles scrolling, verify it against `body` as well.
- **Estimated presets** — iPhone Air is labeled `(est)` (not yet released) and will be updated when it ships. Galaxy S26 series is based on published spec (phone-simulator.com measurements), but safe area values are temporarily from S25 — pixel-accurate QA should be verified on a real device.

## `window.__ait` console API

You can control mock state directly from the browser console via `window.__ait` (or just `__ait`):

```js
// Read current state
__ait.state                    // full state object
__ait.state.platform           // 'ios' or 'android'
__ait.state.auth.isLoggedIn    // login state
__ait.state.deviceModes        // current mode for each API

// Update state (shallow merge)
__ait.update({ platform: 'android', locale: 'en-US' });
__ait.update({ networkStatus: 'OFFLINE' });

// Update nested state
__ait.patch('permissions', { camera: 'denied' });
__ait.patch('deviceModes', { location: 'web' });
__ait.patch('iap', { nextResult: 'USER_CANCELED' });

// Trigger events
__ait.trigger('backEvent');
__ait.trigger('homeEvent');

// Log an analytics event manually
__ait.logAnalytics({ type: 'click', params: { button: 'purchase' } });

// Reset state (deviceId is preserved)
__ait.reset();

// Subscribe to state changes
const unsubscribe = __ait.subscribe(() => {
  console.log('state changed:', __ait.state);
});
unsubscribe(); // unsubscribe
```

## Mock API reference

### Auth / login

| API | Mock behavior |
|---|---|
| `appLogin` | Returns `{ authorizationCode, referrer }` |
| `getIsTossLoginIntegratedService` | Returns state's `isTossLoginIntegrated` |
| `getUserKeyForGame` | Returns `{ hash, type: 'HASH' }` (or `undefined` when not logged in) |
| `appsInTossSignTossCert` | Console log only (no-op) |

### Screen / navigation

| API | Mock behavior |
|---|---|
| `closeView` | Calls `window.history.back()` |
| `openURL` | Opens in a new tab via `window.open()` |
| `share` | Uses `navigator.share()` (falls back to console log if unsupported) |
| `getTossShareLink` | Returns `https://toss.im/share/mock{path}` |
| `setIosSwipeGestureEnabled` | Console log (no-op) |
| `setDeviceOrientation` | Console log (no-op) |
| `setScreenAwakeMode` | Returns `{ enabled }` |
| `setSecureScreen` | Returns `{ enabled }` |
| `requestReview` | No-op (includes `.isSupported()` method) |

### Environment info

| API | Mock behavior |
|---|---|
| `getPlatformOS` | Returns state's platform (default: `'ios'`) |
| `getOperationalEnvironment` | Returns state's environment (default: `'sandbox'`) |
| `getTossAppVersion` | Returns state's appVersion (default: `'5.240.0'`) |
| `isMinVersionSupported` | Performs a semantic version comparison |
| `getSchemeUri` | Returns state's schemeUri or `window.location.pathname` |
| `getLocale` | Returns state's locale (default: `'ko-KR'`) |
| `getDeviceId` | Returns a persistent unique UUID stored in localStorage |
| `getGroupId` | Returns state's groupId |
| `getNetworkStatus` | Uses state or browser API depending on mode |
| `getServerTime` | Returns `Date.now()` |
| `env.getDeploymentId` | Returns state's deploymentId |
| `getAppsInTossGlobals` | Returns `{ deploymentId, brandDisplayName, brandIcon, brandPrimaryColor }` |

### Safe Area

| API | Mock behavior |
|---|---|
| `SafeAreaInsets.get` | Returns `{ top, bottom, left: 0, right: 0 }` |
| `SafeAreaInsets.subscribe` | Calls callback on state change, returns unsubscribe function |
| `getSafeAreaInsets` | Returns the top inset value (deprecated) |

### Device features

| API | Mock behavior |
|---|---|
| `Storage.getItem/setItem/removeItem/clearItems` | Stored in localStorage with `__ait_storage:` prefix |
| `getCurrentLocation` | Per mode: mock (state coordinates), web (Geolocation API), prompt (Panel input) |
| `startUpdateLocation` | mock (random coordinate variation), web (watchPosition), prompt (repeated input) |
| `openCamera` | mock (dummy image), web (file picker), prompt (Panel file input) |
| `fetchAlbumPhotos` | mock (dummy image array), web (multi-file select), prompt (Panel file input) |
| `fetchContacts` | Returns paginated mock contacts, supports `query.contains` search |
| `getClipboardText` / `setClipboardText` | mock (state storage) or web (Clipboard API) |
| `generateHapticFeedback` | Console log + analytics record |
| `saveBase64Data` | File download via anchor element |

### IAP / payments

| API | Mock behavior |
|---|---|
| `IAP.createOneTimePurchaseOrder` | Simulates success/failure after a 300ms delay based on state's `nextResult` |
| `IAP.createSubscriptionPurchaseOrder` | Same flow as above |
| `IAP.getProductItemList` | Returns state's product list |
| `IAP.getPendingOrders` | Returns pending order list |
| `IAP.getCompletedOrRefundedOrders` | Returns completed/refunded order list |
| `IAP.completeProductGrant` | Moves order from pending to completed |
| `IAP.getSubscriptionInfo` | Returns active subscription mock (30-day expiry, auto-renew) |
| `checkoutPayment` | Returns state's payment result after 300ms delay (TossPay) |

**IAP purchase simulation flow:**

1. `IAP.createOneTimePurchaseOrder()` called
2. 300ms delay (simulates payment UI)
3. Check `state.iap.nextResult` → if not `'success'`, call `onError`
4. On success, run the `processProductGrant` callback → on failure, return `'PRODUCT_NOT_GRANTED_BY_PARTNER'` error
5. On full success, record in `completedOrders` and deliver order result via `onEvent`

### Ads

| API | Mock behavior |
|---|---|
| `GoogleAdMob.loadAppsInTossAdMob` | Emits a `loaded` event after 200ms |
| `GoogleAdMob.showAppsInTossAdMob` | Sequentially emits requested→show→impression→reward→dismissed events over 50ms–1.5s |
| `GoogleAdMob.isAppsInTossAdMobLoaded` | Returns boolean loaded state |
| `TossAds.initialize/attach/attachBanner` | Renders a gray placeholder div |
| `TossAds.destroy/destroyAll` | No-op |
| `loadFullScreenAd` / `showFullScreenAd` | Similar flow to GoogleAdMob |

### Events

| API | Mock behavior |
|---|---|
| `graniteEvent.addEventListener` | Listens for `__ait:backEvent` and `__ait:homeEvent` custom events |
| `appsInTossEvent.addEventListener` | No-op |
| `tdsEvent.addEventListener` | Listens for `__ait:navigationAccessoryEvent` |
| `onVisibilityChangedByTransparentServiceWeb` | Delegates to `document.visibilitychange` event |

### Analytics

| API | Mock behavior |
|---|---|
| `Analytics.screen/impression/click` | Records by type in analyticsLog, viewable in the Panel in real time |
| `eventLog` | Records custom events by `log_name`, `log_type`, and `params` |

### Game / promotions

| API | Mock behavior |
|---|---|
| `grantPromotionReward` | Returns a timestamp-based mock key |
| `grantPromotionRewardForGame` | Same as above |
| `submitGameCenterLeaderBoardScore` | Appends score to state, returns `{ statusCode: 'SUCCESS' }` |
| `getGameCenterGameProfile` | Returns mock profile (or `PROFILE_NOT_FOUND` if absent) |
| `openGameCenterLeaderboard` | Console log (no-op) |
| `contactsViral` | Emits a close event after 500ms |

### Permissions

| API | Mock behavior |
|---|---|
| `getPermission` | Returns state's permission status (allowed/denied/notDetermined) |
| `openPermissionDialog` | Changes status to `allowed` |
| `requestPermission` | Delegates to `openPermissionDialog` |

> Functions that require permissions (openCamera, getCurrentLocation, etc.) are wrapped with `withPermission()`, which automatically attaches `.getPermission()` and `.openPermissionDialog()` methods.

### Partner

| API | Mock behavior |
|---|---|
| `partner.addAccessoryButton` | Console log (no-op) |
| `partner.removeAccessoryButton` | Console log (no-op) |

## Using in tests

You can import the mock library directly in vitest/jest.

> The mock functions use browser APIs such as `window`, `document`, and `localStorage`, so a **jsdom environment** is required.
>
> ```ts
> // vitest.config.ts
> import { defineConfig } from 'vitest/config';
> export default defineConfig({ test: { environment: 'jsdom' } });
> ```

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appLogin, Storage, getCurrentLocation, getNetworkStatus, openCamera, IAP } from '@ait-co/devtools/mock';
import { aitState } from '@ait-co/devtools/mock';

beforeEach(() => {
  aitState.reset(); // reset state before each test
});

// Auth test
it('appLogin returns an authorizationCode', async () => {
  const result = await appLogin();
  expect(result.authorizationCode).toBeDefined();
});

// Set state then call function
it('network status query when offline', async () => {
  aitState.update({ networkStatus: 'OFFLINE' });
  const status = await getNetworkStatus();
  expect(status).toBe('OFFLINE');
});

// Permission denied scenario
it('throws when camera permission is denied', async () => {
  aitState.patch('permissions', { camera: 'denied' });
  await expect(openCamera()).rejects.toThrow();
});

// IAP failure scenario (requires fake timers)
it('calls onError when purchase is canceled', async () => {
  vi.useFakeTimers();
  aitState.patch('iap', { nextResult: 'USER_CANCELED' });
  const onError = vi.fn();
  IAP.createOneTimePurchaseOrder({
    options: { sku: 'item_01', processProductGrant: async () => true },
    onEvent: vi.fn(),
    onError,
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(onError).toHaveBeenCalledWith({ code: 'USER_CANCELED' });
  vi.useRealTimers();
});

// Storage test
it('can write and read from Storage', async () => {
  await Storage.setItem('key1', 'value1');
  const result = await Storage.getItem('key1');
  expect(result).toBe('value1');
});
```

## SDK update tracking

devtools tracks [`@apps-in-toss/web-framework`](https://www.npmjs.com/package/@apps-in-toss/web-framework), and [`sdk-example`](https://github.com/apps-in-toss-community/sdk-example) tracks both the original SDK and devtools. When a new SDK version is released, the flow is: (1) devtools catches up on mock/type signatures → (2) sdk-example incorporates both new versions together. If a devtools-only PR breaks sdk-example, both are addressed together.

Three mechanisms keep the SDK changes safely tracked:

### 1. Compile-time type verification (`__typecheck.ts`)

`src/__typecheck.ts` verifies that the major exports from the mock are type-compatible with the original SDK. If the SDK signature changes, `pnpm typecheck` will immediately produce an error.

```ts
type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
// 40+ type compatibility assertions
```

### 2. Proxy tripwire (runtime blocking)

`createMockProxy()` immediately throws an `Error` when an unimplemented API is accessed. This is intentional — to prevent "works in devtools but fails with the real SDK" production incidents caused by APIs that exist in the real SDK but haven't been mocked yet. Please [file an issue](https://github.com/apps-in-toss-community/devtools/issues) or add the mock yourself.

```
[@ait-co/devtools] IAP.newMethod is not mocked. This API may exist in
@apps-in-toss/web-framework, but devtools' mock does not cover it yet.
Please file an issue: https://github.com/apps-in-toss-community/devtools/issues
```

### 3. Weekly GitHub Actions CI

`.github/workflows/check-sdk-update.yml` automatically runs **every Monday**:

1. Checks for a new version of `@apps-in-toss/web-framework`
2. Updates to the latest version and runs the type check
3. On detecting a new version, automatically opens a GitHub Issue (including whether there are type errors)

## Contributing

### Adding a new API mock

1. Implement the function in the appropriate category directory (e.g. `src/mock/device/`)
2. Add the export to `src/mock/index.ts`
3. Add a type compatibility assertion to `src/__typecheck.ts`
4. Run `pnpm typecheck` to verify compatibility with the original
5. Write tests in `src/__tests__/`

```bash
pnpm build       # build with tsup
pnpm typecheck   # verify type compatibility
pnpm test        # run all tests
```

### Pre-commit hook (optional)

Optional but recommended. After cloning, activate the standard pre-commit hook with the command below. It runs `biome check` automatically on staged files.

```sh
git config core.hooksPath .githooks
```

This hook is a developer convenience for catching lint issues before push. The actual enforcement layer is the CI `pnpm lint` job, so contributors who don't activate the hook will still see lint failures in their PR.

## Troubleshooting

### `[@ait-co/devtools] XXX.method is not mocked` error

The SDK API you're calling has not been implemented in the mock yet. devtools throws on unimplemented API access to prevent "works fine" deployments. [File an issue](https://github.com/apps-in-toss-community/devtools/issues) or add the mock yourself and try again.

### DevTools Panel not appearing

- Check that you haven't set `panel: false` in your plugin options
- If you're using manual alias setup, add a direct import to your entry point:
  ```ts
  import '@ait-co/devtools/panel';
  ```
- The plugin auto-injects only into entry points whose filename is `main`, `index`, `entry`, or `app` (case-insensitive). If your filename doesn't match that pattern, add `import '@ait-co/devtools/panel'` manually.

### Subpath imports are not mocked

Subpath imports of the form `@apps-in-toss/web-framework/some-subpath` are not aliased. Only the main entry (`@apps-in-toss/web-framework`) is mocked. If you need a specific subpath mocked as well, add it manually to your bundler's `resolve.alias`.

### Setting up with Next.js Turbopack

Since Turbopack doesn't support unplugin, use `resolveAlias` in `next.config.js` (see the [Next.js (Turbopack)](#nextjs-turbopack) section above). Import the Panel directly from your entry point:

```ts
// app/layout.tsx or pages/_app.tsx
import '@ait-co/devtools/panel';
```

## Package export structure

| Import path | Purpose |
|---|---|
| `@ait-co/devtools` or `@ait-co/devtools/mock` | All mock exports (bundler alias target) |
| `@ait-co/devtools/panel` | Floating DevTools Panel (auto-mounts on import) |
| `@ait-co/devtools/unplugin` | Bundler plugin (.vite, .webpack, .rspack, .esbuild, .rollup) |

## Telemetry

devtools uses a two-tier telemetry model.

### Tier 0 — anonymous usage signal (ON by default, opt-out)

Sends a one-time anonymous ping per calendar day when the panel is opened.

Collected fields: `source`, `version`, `ts` — no PII, no `anon_id`. The server generates an IP+UA daily hash but never stores it.

How to opt out:
- Panel Environment tab → "Anonymous usage signal (Tier 0)" toggle OFF
- `localStorage.setItem('__ait_telemetry:t0_off', '1')` (from the browser console)
- Environment variable: `AITC_TELEMETRY=off`

### Tier 1 — extended telemetry (OFF by default, opt-in)

A consent toast appears on first panel use. Data is only collected if you accept.

Collected fields: `panel_open`, `tab_view`, `session_duration` events + an anonymous UUID (`anon_id`).

How to opt out:
- Panel Environment tab → "Extended telemetry (Tier 1)" toggle OFF
- Delete collected data: Panel Environment tab → "Delete my data"

Privacy policy: <https://docs.aitc.dev/privacy>

## License

BSD 3-Clause

---

Community open-source project.
