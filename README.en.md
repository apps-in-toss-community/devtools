# @ait-co/devtools

[한국어](./README.md) · **English**

[![npm](https://img.shields.io/npm/v/@ait-co/devtools)](https://www.npmjs.com/package/@ait-co/devtools) [![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

![@ait-co/devtools — SDK mock + DevTools panel for Apps In Toss mini-apps](./assets/og/image.png)

A mock library for the `@apps-in-toss/web-framework` SDK. Imports of `@apps-in-toss/webview-bridge` are intercepted by the unplugin too (only the high-level SDK functions are exposed — bridge primitives are not). (2.x packages `@apps-in-toss/web-bridge` and `@apps-in-toss/web-analytics` are supported for back-compat.)

Lets you develop and test Apps in Toss mini-apps in a **regular browser** — without the Toss app. All SDK features are simulated so you can move fast.

- **60+ SDK API mocks** — auth, payments, IAP, location, camera, storage, and more
- **Device API mode system** — switch between mock / web / prompt modes for device APIs
- **Device simulation** — iPhone/Galaxy presets + orientation toggle to simulate a mobile viewport in your desktop browser
- **Floating DevTools Panel** — control SDK state in real time from the browser (12 tabs, mock state preset library included)
- **All bundlers supported** — [unplugin](https://github.com/unjs/unplugin)-based Vite, Webpack, Rspack, esbuild, and Rollup integration

Live demo: <https://devtools.aitc.dev/> (the `e2e/fixture/` from this repo deployed to GitHub Pages as a self-contained demo).

## 15-second quickstart — pick your environment

There are four runtime environments. Pick the card that fits your situation and follow the link to the detailed scenario doc.

---

**Environment 1 — Local browser** (fastest, HMR on)

Develop with the mock SDK + DevTools panel in desktop Chrome. No Toss app or phone needed.

```bash
pnpm add -D @ait-co/devtools
# add the unplugin to vite.config.ts → pnpm dev
```

DevTools panel: click the **AIT** button in the bottom-right corner. Details: [`docs/scenarios/env-1.md`](./docs/scenarios/env-1.md)

---

**Environment 2 — Real-device PWA** (real WebKit engine, HMR on, no Toss review required)

Preview your mini-app on a real phone using Safari/WebKit. Install the launcher PWA once, then scan a QR code each session.

```bash
# add the tunnel option to vite.config.ts, then:
pnpm dev:phone          # same as AIT_TUNNEL=1 pnpm dev
# QR appears in the terminal → scan with your phone camera → opens in the launcher PWA
```

With `tunnel: { cdp: true }`, a single QR scan opens both the screen preview and on-device CDP — inspect the real WebKit DOM, console, and exceptions from your MCP host (`call_sdk` still hits the mock on environment 2; the real SDK lives on environments 3·4).

One-time prerequisite: add `https://devtools.aitc.dev/launcher/` to your phone's home screen. Details: [`docs/scenarios/env-2.md`](./docs/scenarios/env-2.md)

---

**Environment 3 — intoss-private** (Toss WebView, HMR off, debug only)

Load a dogfood bundle in the real Toss app WebView and debug it via the MCP relay.

```bash
devtools-mcp              # start MCP server → QR printed in terminal
# ait build && ait deploy --scheme-only
# call build_attach_url → scan QR → Toss app loads bundle + relay attaches
```

No HMR (Toss WebView cold-load only). Details: [`docs/scenarios/env-3.md`](./docs/scenarios/env-3.md)

---

**Environment 4 — Live deployed app** (passed review, HMR off, read-only debug)

Attach a relay to a live OPENED app to observe runtime behavior.

```bash
devtools-mcp   # start MCP server
# In Claude Code: start_debug({mode: 'relay-live', confirm: true})  ← arms LIVE guard
# call build_attach_url → scan QR → live app loads + relay attaches
# call_sdk / evaluate: confirm: true required (LIVE guard — real users affected)
```

`start_debug({mode: 'relay-live', confirm: true})` arms the LIVE guard in-session. Details: [`docs/scenarios/env-4.md`](./docs/scenarios/env-4.md)

---

## On-device debugging in one line

To enable on-device CDP debugging in environments 2, 3, and 4, add **one line** to your mini-app entry (`main.tsx` or equivalent):

```ts
// main.tsx (or the top of your mini-app entry)
import '@ait-co/devtools/in-app/auto';
```

What this single line does:

- **Self-gate**: if neither `?debug=1` nor `?relay=` is in the URL, and it is not a DEV build, the entry does nothing. The chunk stays dormant and has no impact on a normal production load.
- **Attach**: when the gate passes, calls `maybeAttach()` to inject the Chii `target.js` script (Layer B/C gate semantics are fully preserved).
- **SDK bridge**: installs `window.__sdk` / `window.__sdkCall` so an agent can drive any SDK API directly over the CDP relay via `Runtime.evaluate`. Silently skipped if `@apps-in-toss/web-framework` is not available.
- **Types**: provides `Window.__sdk` / `__sdkCall` global type declarations automatically — no separate `globals.d.ts` needed in your project.

For environments 3 and 4 (intoss-private relay), the relay QR deep-link carries `?debug=1&relay=<wss>` query params, so this one line is all the wiring you need. Environment 2 (PWA, `tunnel: { cdp: true }`) works the same way.

> For dogfood builds with TOTP authentication, inject `__DEBUG_TOTP_SECRET__` via your build define and use `@ait-co/devtools/in-app` directly with `evaluateDebugGate({ verifyTotpCode })` + `maybeAttach()`. `in-app/auto` does not inject a TOTP verifier, so Layer C3 is disabled.

## Five common problems

**"QR window doesn't open"**

Either `build_attach_url` wasn't called first, or `open_in_browser` failed silently in a headless environment. The terminal output includes a path to a saved PNG — open that file directly, or scan the text QR printed in the terminal. (Related: [#288](https://github.com/apps-in-toss-community/devtools/issues/288))

**"Page not attached" — list_pages returns an empty array**

No page has joined the relay yet. Re-enter via `build_attach_url` → QR scan on your phone. When the MCP error message reads "page not attached — run build_attach_url then scan QR", this is the case.

**"Tunnel down" — no response or timeout**

A cloudflared quick tunnel can drop after a few hours. Restart the `devtools-mcp` process to get a new tunnel URL, then scan the new QR. (Related: [#290](https://github.com/apps-in-toss-community/devtools/issues/290))

**"Page crash" — list_pages shows a non-null crashDetectedAt**

The page on the phone died (OOM, JS exception, or native bridge crash). Relaunch the app, then re-attach via `build_attach_url` → QR scan. (Related: [#265](https://github.com/apps-in-toss-community/devtools/issues/265))

**"SDK not available" — window.__sdkCall not injected**

When `call_sdk` returns `ok: false, error: "window.__sdkCall is not available"`, the SDK bridge has not been installed. Check that `import '@ait-co/devtools/in-app/auto'` is present at the top of your mini-app entry — see the "On-device debugging in one line" section above. This error is the expected result in environment 2 (PWA). (Related: [#285](https://github.com/apps-in-toss-community/devtools/issues/285))

**"QR scanned but auth rejected" — TOTP code expired**

When `AIT_DEBUG_TOTP_SECRET` is set, `build_attach_url` automatically splices the current one-time TOTP code (`at=`) into the returned `attachUrl`. Each code covers a 30-second step, and the relay accepts ±6 steps (~3 min) of backwards skew. Scanning more than ~3 minutes after `totp.expiresAt` causes the relay to reject the request. Fix: call `build_attach_url` again to get a fresh URL and QR.

---

## Install

```bash
npm install -D @ait-co/devtools
# or
pnpm add -D @ait-co/devtools
```

### Two channels — stable and beta

devtools runs two npm dist-tags off the same code at once. Pick the channel that matches your web-framework version.

| Channel | Install | web-framework peer |
|---|---|---|
| **stable** (`latest`, default) | `pnpm add -D @ait-co/devtools` | `>=2.6.0 <2.7.0` (2.x) |
| **beta** | `pnpm add -D @ait-co/devtools@beta` | `>=3.0.0-beta <4.0.0` (3.0 line) |

- On web-framework **2.x**, the default install (stable) is all you need.
- On the web-framework **3.0.0-beta** pre-release, install the `@beta` channel. It is a snapshot auto-published on every main push (`0.0.0-beta-<datetime>-<sha>`), so the versions are hard to pin — install with the `@beta` tag.
- Both channels keep the web-framework peer `optional`, so MCP-only debugging users are never forced to pull the SDK.

When 3.0 ships GA, the stable `latest` peer moves up to the 3.0 line and the beta channel is retired. Calling an API that devtools has not yet mocked will throw a runtime error — please [file an issue](https://github.com/apps-in-toss-community/devtools/issues) for missing APIs.

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

- Aliasing `@apps-in-toss/web-framework` alone is enough. Every SDK call goes through this package, so replacing it with the mock drops the whole web-framework module from the graph, and its internal `@apps-in-toss/webview-bridge` imports disappear with it.
- Turbopack is generally only used with `next dev`, so no extra production guard is needed.

```js
// next.config.js (Next.js 15+, web-framework 3.0+)
module.exports = {
  turbo: {
    resolveAlias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
    },
  },
};
```

For Next.js 14 and below, use `experimental.turbo`:

```js
// next.config.js (Next.js 14 and below, web-framework 3.0+)
module.exports = {
  experimental: {
    turbo: {
      resolveAlias: {
        '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
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
// vite.config.ts (web-framework 3.0+)
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
    },
  },
});
```

```js
// webpack.config.js (Webpack requires absolute paths, web-framework 3.0+)
module.exports = {
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': require.resolve('@ait-co/devtools/mock'),
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
| `mcp` | `boolean` | `false` | Add an MCP state endpoint to the Vite dev server (Vite only — see [MCP Server](#mcp-server)) |
| `tunnel` | `boolean \| { port?: number; qr?: boolean; cdp?: boolean }` | `false` | Expose the Vite dev server via a Cloudflare quick tunnel for real-device preview (see [below](#run-on-a-real-phone)). `cdp: true` also wires on-device CDP debugging for environment 2 (PWA). **Vite dev mode only** |

```ts
aitDevtools.vite({ panel: false }); // mock only, no panel
aitDevtools.vite({ forceEnable: true }); // enable in production (mock OFF by default, panel ON)
aitDevtools.vite({ forceEnable: true, mock: true }); // enable mock in production too
aitDevtools.vite({ mcp: true }); // enable MCP endpoint for AI agents
aitDevtools.vite({ tunnel: true }); // expose dev server at *.trycloudflare.com
aitDevtools.vite({ tunnel: { cdp: true } }); // real-device preview + on-device CDP debugging
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

> To also enable on-device CDP debugging, pass the object form: `tunnel: process.env.AIT_TUNNEL ? { cdp: true } : false`. A Chii relay then starts alongside the HTTP tunnel, so a single QR scan opens both the screen preview and a CDP attach. Connect your AI host MCP to that relay to inspect the real WebKit DOM, console, exceptions, and `measure_safe_area` (`call_sdk` still hits the mock on environment 2).

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

### 12 tabs

| Tab | Description |
|---|---|
| **Environment** | Platform OS (ios/android), app version, environment (toss/sandbox), locale, network status, Safe Area Insets |
| **Presets** | Apply/remove common QA scenarios (permission denied, offline, logged out, etc.) with one click. Save and delete user presets |
| **Viewport** | Simulate a mobile viewport using device presets (iPhone/Galaxy) + orientation toggle |
| **Permissions** | Control camera, photos, geolocation, clipboard, contacts, and microphone permission states (allowed/denied/notDetermined) |
| **Notifications** | Choose the next result of the notification-consent flow (new agreement / already agreed / rejected) |
| **Location** | Set latitude, longitude, and accuracy |
| **Device** | Switch API modes (mock/web/prompt), manage dummy images (add/remove/reset to defaults) |
| **IAP** | Choose the next purchase result (success/cancel/error, etc.), TossPay payment result, completed order history (last 5) |
| **Ads** | Trigger full-screen ad load/show and view the last ad event log |
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
- **Notch inset** — the OS notch / Dynamic Island offset. Device-specific. In portrait this does *not* reach the mini-app's top inset (it's only used for the landscape side inset and to position the visual notch overlay).
- **Nav bar height** — the Toss host's top nav bar. Device-independent (`54px` for a `partner` WebView). For a `partner` app this height *is* `SafeAreaInsets.get().top`.
- **Home-indicator inset** — the bottom safe-area inset (home indicator), device-specific.

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
- Notch / Dynamic Island / punch-hole overlay — drawn in the status-bar area *above* the WebView (body), because on a real device the OS notch sits outside the WebView viewport (that's why `env(safe-area-inset-top)` is 0).
- Home indicator pill (only on devices with `safeAreaBottom > 0`, positioned at the bottom of body)
- App name uses `aitState.brand.displayName` (editable in the Environment tab, auto-updates)
- The back button triggers `__ait:backEvent` and the X button calls `closeView()` — you can verify actual SDK event plumbing directly from the panel

When **Show Apps in Toss nav bar** is toggled on (default on):
- A 54px nav bar overlay simulating the Toss host's top nav bar. Its shape depends on `Nav bar type`:
  - `partner` (default for non-games): white background + back / app icon+name / ⋯ / ×. Pushes content down by the nav bar height.
  - `game`: transparent background, ⋯ / × only. Floats over the game canvas without pushing content — an in-game screen is full-screen per the [launch checklist](https://developers-apps-in-toss.toss.im/checklist/app-game.html).
- The nav bar sits at the **top (0)** of the WebView (body) coordinate space. On a real device the OS notch is outside the WebView (in the status bar above), so `env(safe-area-inset-top)` is 0 and content starts right below the nav bar (= `SafeAreaInsets.get().top`) — the simulator reproduces this stack (notch status bar → nav bar → content).
- For a `partner` WebView this nav bar height **is** `SafeAreaInsets.get().top`. Relay measurement of an iPhone 15 Pro (sandbox, portrait) showed `env(safe-area-inset-top)` = 0 (the OS notch stays outside the WebView viewport) and `SafeAreaInsets.get().top` = 54 px — i.e. the SDK top inset reports the host nav bar, not the notch. So a `partner` app lays out using `insets.top` alone. A `game` WebView is a transparent overlay that does not push content (top 0). Measured on iOS `partner`; Android values are provisional and `external` is not simulated.

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
- **Safe area**: `T54 R0 B34 L0` (portrait `partner` — top is the nav bar height, not the notch)
- **AIT nav bar**: `54px → SafeArea top · partner`

### Persistence + technical details

- State is saved to sessionStorage (`__ait_viewport`) and restored on page reload.
- Selecting a preset also updates `aitState.safeAreaInsets` → the SDK's `SafeAreaInsets.get()` / `.subscribe()` follow along.
- The viewport is applied to `document.body` via `max-width`/`max-height` + `margin:auto`. No iframe is used, so the app's JS/CSS runs as-is and DevTools remains fully accessible.
- `isolation: isolate` is applied to body so the z-index of the notch/nav bar/home indicator overlay doesn't leak outside the stacking context (the DevTools panel floats above).
- If you need to remove the viewport simulation programmatically, `disposeViewport()` is available as an export.
- User-Agent spoofing / touch event emulation / network throttling are not done (Chrome DevTools already provides these).

### Known limitations

- **Body becomes the scroll container** — while the viewport is active, scrolling happens on `document.body` rather than `window`. `window.addEventListener('scroll', ...)` or `IntersectionObserver` attached to the root may behave differently from a real device. If your mini-app handles scrolling, verify it against `body` as well.
- **Estimated safe area** — Galaxy S26 series is based on published spec (phone-simulator.com measurements), but safe area values are temporarily from S25 — pixel-accurate QA should be verified on a real device.

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

## Fidelity QA

`scripts/fidelity-qa/` automatically measures SDK API fidelity between the mock and a real-device relay session.

```bash
pnpm qa:fidelity --runner=mock           # mock-only (CI default, regression detection)
pnpm qa:fidelity --runner=relay          # requires attached device (devtools MCP)
pnpm qa:fidelity --runner=both --diff    # run both + print diff
pnpm qa:fidelity --include-writes        # include Storage write cycle (off by default)
pnpm qa:fidelity --output=results.json  # write JSON results to file
```

CI runs `pnpm qa:fidelity --runner=mock` automatically (exits 0 on a clean state).

**Diff labels**:

- `MATCH` — mock and relay values are equal
- `EXPECTED_MISMATCH` — known difference registered in `scripts/fidelity-qa/whitelist.json` (e.g. jsdom UA vs real WebView UA)
- `UNEXPECTED` — mismatch not in whitelist → exits 1 (potential regression)

**Updating the whitelist**: when an intentional difference is found during a relay session, add `{ "id": "<probe-id>", "reason": "<explanation>" }` to `scripts/fidelity-qa/whitelist.json`.

The relay runner is currently a stub (CDP Runtime.evaluate implementation is a follow-up in devtools#261).

## Contributing

### Adding a new API mock

1. Implement the function in the appropriate category directory (e.g. `src/mock/device/`)
2. Add the export to `src/mock/index.ts`
3. Add a type compatibility assertion to `src/__typecheck.ts`
4. Run `pnpm typecheck` to verify compatibility with the original
5. Write tests in `src/__tests__/`

```bash
pnpm build       # build with tsdown
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

## MCP Server

AI coding agents (Claude Code, Cursor, etc.) can observe a running mini-app directly via [MCP (Model Context Protocol)](https://modelcontextprotocol.io/). A single `devtools-mcp` binary provides two modes.

A local browser (env 1) and a phone Toss WebView (env 2/3) both speak CDP, so every tool works identically in both environments — the only difference is the attach strategy (`--target=relay` vs `--target=local`).

| Mode + target | Invocation | Env vars | Target | Tools |
|---|---|---|---|---|
| `--target=mobile` (env 2) | `devtools-mcp` → `start_debug({mode:'relay-sandbox'})` | `AIT_RELAY_BASE_URL`, `AIT_TUNNEL_BASE_URL` | Real-device Safari/WebKit PWA (external Chii relay + cloudflared tunnel, env 2) | console/network/page + DOM/snapshot/screenshot |
| `--mode=debug --target=relay` (default, env 3) | `devtools-mcp` → `start_debug({mode: 'relay-staging'})` | — | Dogfood bundle on a phone (CDP/Chii relay + cloudflared tunnel, env 3) | same + `AIT.*` |
| `--mode=debug --target=relay` LIVE (env 4) | `devtools-mcp` → `start_debug({mode: 'relay-live', confirm: true})` | — (env 4 LIVE guard) | Live deployed app (env 4) — `call_sdk`/`evaluate` require `confirm: true` | same |
| `--mode=debug --target=local` (env 1) | `devtools-mcp --target=local` | `MCP_ENV=mock` (auto) | Local Chromium launched by the MCP server (CDP direct-attach, no relay needed, env 1) | same |
| `--mode=dev` | `devtools-mcp --mode=dev` | `MCP_ENV=mock` (auto) | Mock state from a running Vite dev server (AIT.* only, no CDP) | `AIT.*` (+ `devtools_get_mock_state` alias) |

`--target=local` opens `AIT_DEVTOOLS_URL` (default `http://localhost:5173`) and attaches directly to a local Chromium — no relay or tunnel required. `--mode=dev` reads the mock-state HTTP endpoint of the Vite dev server and does not provide CDP tools. Switch environments in-session with `start_debug(mode)`: `relay-sandbox` (env 2 PWA), `relay-staging` (env 3 dogfood), `relay-live` (env 4, arms LIVE guard — `confirm: true` required), `local-browser` (env 1).

#### Environment 2 (real-device PWA CDP) — `--target=mobile`

Debug on a real phone using Safari/WebKit without Toss review. The Vite dev server with [`tunnel:{cdp:true}`](#tunnel-option) brings up both an app HTTP tunnel and a Chii relay tunnel. The MCP server attaches to that relay and provides `build_attach_url` → launcher QR.

**Setup procedure:**

1. Start the Vite dev server in CDP tunnel mode:
   ```bash
   AIT_TUNNEL_CDP=1 pnpm exec vite --config e2e/fixture/vite.config.ts
   ```
   The terminal banner prints two URLs:
   - **App HTTP tunnel** `https://<A>.trycloudflare.com` → set as `AIT_TUNNEL_BASE_URL`
   - **Relay wss tunnel** `wss://<B>.trycloudflare.com` → set `AIT_RELAY_BASE_URL` to its `https://` form

2. Start the MCP server in mobile mode (separate terminal):
   ```json
   {
     "mcpServers": {
       "ait-debug": {
         "command": "npx",
         "args": ["-y", "@ait-co/devtools", "devtools-mcp"],
         "env": {
           "AIT_RELAY_BASE_URL": "https://<B>.trycloudflare.com",
           "AIT_TUNNEL_BASE_URL": "https://<A>.trycloudflare.com"
         }
       }
     }
   }
   ```

3. In a Claude Code session:
   ```
   start_debug({mode: 'relay-sandbox'})
   build_attach_url()
   ```
   Scan the QR with your phone camera. The launcher PWA opens the app in a frame and injects Chii target.js.

4. `list_pages()` → expect one page. Use `take_screenshot()` and other CDP tools.

**Env 2 fidelity boundary**: uses the mock SDK (`call_sdk` hits the mock). For real SDK fidelity, move to env 3. CDP runs on the real WebKit engine, so DOM, console, and screenshot reflect the real device screen.

**Local-PC verification**: `e2e/launcher-cdp.test.ts` automates node-side relay startup (`startChiiRelay({port:0})`) and launcher param forwarding (Playwright). Browser-side Chii target.js injection is not automated in CI due to the localhost host gate (Layer B1) and ws:// vs wss:// constraints — completed by the manual procedure above on a real device with a trycloudflare.com hostname.

### Debug mode (CDP via Chii)

For a step-by-step walkthrough of the on-device relay debug loop (dogfood build → QR scan → relay attach) including common failure recovery, see **[`docs/dogfood-relay-loop.md`](./docs/dogfood-relay-loop.md)** (Korean). For crash triage — `list_pages.crashDetectedAt`, iOS Console.app `.ips` analysis, and the redact procedure — see **[`docs/crash-triage.md`](./docs/crash-triage.md)** (Korean).

Read-only tools only. Tools are registered in two tiers based on attach state — before attach, only the bootstrap tools (`build_attach_url`, `list_pages`) are visible; once a relay/local page attaches, the attach-dependent tools are registered dynamically in the same session via `notifications/tools/list_changed` (no session restart needed). The phone attach roundtrip is fully wired; all that remains is a single on-device acceptance run. The tool layer is CI-verified via a mockable injectable CDP connection / AIT source.

Running `devtools-mcp` as a stdio server starts a local Chii relay on an OS-assigned port and opens a cloudflared quick tunnel, printing a public `wss://*.trycloudflare.com` URL and a QR code in the terminal (secrets/auth codes are never printed). When the phone enters the dogfood entry point, the in-app attach UI connects to the relay with that URL, and the agent reads console/network/page state via `chrome-devtools-mcp`-compatible tools — diagnosing regressions without anyone watching the phone.

Environments 3 and 4 (intoss-private relay) — start `devtools-mcp` as-is, then enter via `start_debug(mode)`:

```json
{
  "mcpServers": {
    "ait-debug": {
      "command": "pnpm",
      "args": ["exec", "devtools-mcp"]
    }
  }
}
```

- Environment 3 (dogfood relay): `start_debug({mode: 'relay-staging'})`
- Environment 4 (LIVE relay, LIVE guard enabled): `start_debug({mode: 'relay-live', confirm: true})`

**`start_debug(mode)` is the single in-session entry path.** `MCP_ENV=relay-live` remains only as a deprecated alias that seeds `liveIntent` at boot — in a new session, enter via `start_debug({mode: 'relay-live', confirm: true})`.

| Tool | CDP / AIT backing | Description |
|---|---|---|
| `list_console_messages` | `Runtime.consoleAPICalled` | Recent console.log/warn/error messages (level, text, timestamp, args) |
| `list_network_requests` | `Network.requestWillBeSent` + `responseReceived` | Recent XHR/fetch requests (url, method, status, timing) |
| `list_pages` | Chii relay target list | Attached pages + tunnel status + wss URL |
| `build_attach_url` | (pure synthesis) | Splices `debug=1` + the relay URL into an `ait deploy --scheme-only` URL, prints a QR. Scanning the QR with the phone camera is the single entry path for env 2/3 (requires `list_pages` first) |
| `get_dom_document` | `DOM.getDocument` | DOM tree read (structural/layout regression diagnosis) |
| `take_snapshot` | `DOMSnapshot.captureSnapshot` | Page snapshot (documents + interned strings, visual regression) |
| `take_screenshot` | `Page.captureScreenshot` | Page PNG screenshot (returned as an MCP image content block) |
| `measure_safe_area` | `Runtime.evaluate` | Runs a safe-area probe on the attached page → returns normalized safe-area insets, viewport geometry, DPR, and User-Agent. Read-only. Use in a relay session to get ground-truth values for upgrading a viewport preset from extrapolated/placeholder to measured. Requires attach (`list_pages` first) |
| `evaluate` | `Runtime.evaluate` | Evaluates an arbitrary JS expression on the attached page (returnByValue) and returns the result. **Not read-only** — the expression can have side effects (DOM mutations, SDK calls, state changes). Requires attach |
| `call_sdk` | `window.__sdkCall` bridge (via `Runtime.evaluate`) | Calls a dogfood SDK method via the `window.__sdkCall` bridge (exported by `@apps-in-toss/web-framework` in `__DEBUG_BUILD__` bundles only). **Not read-only** — SDK calls have side effects (navigation, payments, permissions, etc.). Hits the real SDK on env 3/4, mock SDK on env 1. Env 2 (PWA) does not inject the SDK — not available there. On env 4, `confirm: true` is required (LIVE guard). Requires attach. Returns `{ok,value}` / `{ok,error}` |
| `AIT.getSdkCallHistory` | AIT domain | SDK call trace (method, args, result/error, timestamp) |
| `AIT.getMockState` | AIT domain | Mock state snapshot (`window.__ait`) |
| `AIT.getOperationalEnvironment` | AIT domain | `getOperationalEnvironment()` + SDK version |

`AIT.*` covers what raw CDP cannot; the same MCP server forwards it alongside CDP. In debug mode the in-app side answers over the Chii channel.

### Dev mode (mock state)

`devtools-mcp --mode=dev` reads the mock state from a running browser. It shares the same `AIT.*` tool surface as debug mode.

#### Architecture

```
Browser (aitState)
  └─ POST /api/ait-devtools/state (auto-pushed by the panel on every state change)
       └─ Vite dev server (unplugin with mcp: true)
            └─ GET /api/ait-devtools/state
                 └─ MCP stdio server (dist/mcp/server.js)
                      └─ AI agent (AIT.getMockState tool)
```

#### Setup

**1. Add `mcp: true` to the Vite plugin**

```ts
// vite.config.ts
import aitDevtools from '@ait-co/devtools/unplugin';

export default {
  plugins: [aitDevtools.vite({ mcp: true })],
};
```

**2. Configure your MCP client (e.g. Claude Code `.claude/settings.json`)**

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "pnpm",
      "args": ["exec", "devtools-mcp", "--mode=dev"],
      "env": {
        "AIT_DEVTOOLS_URL": "http://localhost:5173"
      }
    }
  }
}
```

`AIT_DEVTOOLS_URL` defaults to `http://localhost:5173` — you can omit it if you're using the default port.

**3. Open the app in your browser, then call the tool from your AI agent**

```
> AIT.getMockState
```

Returns the full current mock state (permissions, location, auth, network, IAP, etc.) as JSON.

| Tool | Description |
|---|---|
| `AIT.getMockState` | Returns the current `AitDevtoolsState` snapshot (read-only) |
| `AIT.getOperationalEnvironment` | Environment + version derived from the mock state's `environment` + `appVersion` |
| `AIT.getSdkCallHistory` | Empty in dev mode (the HTTP endpoint records no trace) |
| `devtools_get_mock_state` | Backward-compatible alias of `AIT.getMockState` (prefer `AIT.getMockState` in new configs) |

## Package export structure

| Import path | Purpose |
|---|---|
| `@ait-co/devtools` or `@ait-co/devtools/mock` | All mock exports (bundler alias target) |
| `@ait-co/devtools/panel` | Floating DevTools Panel (auto-mounts on import) |
| `@ait-co/devtools/unplugin` | Bundler plugin (.vite, .webpack, .rspack, .esbuild, .rollup) |
| `@ait-co/devtools/mcp/server` | Dev-mode MCP stdio server function (Node.js) |
| `@ait-co/devtools/mcp/cli` | `devtools-mcp` bin entry point (debug / dev mode, Node.js) |
| `@ait-co/devtools/in-app` | In-app debug attach — runtime gate (layers B/C) + Chii target.js injection. The consumer wraps the import in `if (__DEBUG_BUILD__)` so it is DCE'd from release builds — dogfood builds only |
| `@ait-co/devtools/in-app/auto` | Self-gating side-effect entry — a single `import '@ait-co/devtools/in-app/auto'` line wires attach + SDK bridge. Active only when `?debug=1` / `?relay=` are in the URL or it is a DEV build; stays dormant on normal production loads. See the [section above](#on-device-debugging-in-one-line) |

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
