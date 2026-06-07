/**
 * @ait-co/devtools Floating Panel — entry + auto-mount.
 *
 * Importing `@ait-co/devtools/panel` mounts the DevTools panel on the page. The
 * panel UI is a self-contained client-side React 19 tree (`<Panel>`); React is
 * BUNDLED into `dist/panel/index.js` (the tsdown panel entry has no `external`),
 * so consumers do not need React in their own graph and react never appears in
 * this package's published `dependencies` (it is a devDependency).
 *
 * `mount()` / `disposePanel()` keep the same public contract as the old vanilla
 * implementation (idempotent mount guard, full teardown) so existing tests and
 * the locale-reactivity layer continue to work. Locale changes no longer remount
 * the panel — `<Panel>` subscribes to the i18n store via `useT()` and re-renders
 * its subtree in place (tab + button position survive).
 */

import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Panel } from './Panel.js';
import { PANEL_STYLES } from './styles.js';

const HOST_CLASS = 'ait-panel-root';

let host: HTMLElement | null = null;
let root: Root | null = null;
let injectedStyle: HTMLStyleElement | null = null;

function mount(): void {
  if (typeof document === 'undefined') return;
  // Idempotent: the toggle button is the stable "already mounted" marker (same
  // guard the vanilla panel used).
  if (document.querySelector('.ait-panel-toggle')) return;

  // Inject the panel stylesheet once (removed again by disposePanel).
  injectedStyle = document.createElement('style');
  injectedStyle.textContent = PANEL_STYLES;
  document.head.appendChild(injectedStyle);

  // Single React host appended to <body>. `display:contents` so the host adds no
  // box of its own — the toggle/panel position exactly as before.
  host = document.createElement('div');
  host.className = HOST_CLASS;
  host.style.display = 'contents';
  document.body.appendChild(host);

  root = createRoot(host);
  // flushSync so the panel DOM exists synchronously after mount() returns —
  // preserves the synchronous contract the unit tests (and the idempotent guard)
  // rely on.
  flushSync(() => {
    root!.render(<Panel />);
  });
}

/**
 * Pairs with `mount()`. Idempotent — safe to call before mount or twice in a row.
 * Unmounts the React tree, removes the host + injected `<style>`, and resets
 * module state so `mount()` can re-mount cleanly.
 */
function disposePanel(): void {
  if (typeof document === 'undefined') return;

  if (root) {
    // Synchronous unmount so the DOM is gone when disposePanel() returns.
    flushSync(() => {
      root!.unmount();
    });
    root = null;
  }
  host?.remove();
  injectedStyle?.remove();
  host = null;
  injectedStyle = null;
}

// DOM ready → mount.
if (typeof document !== 'undefined') {
  const safeMount = () => {
    try {
      mount();
    } catch (err) {
      console.error('[@ait-co/devtools] Failed to mount panel:', err);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeMount);
  } else {
    safeMount();
  }
}

export { disposePanel, mount };
