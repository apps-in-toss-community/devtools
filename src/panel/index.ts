/**
 * @ait-co/devtools Floating Panel
 *
 * import 하면 자동으로 페이지에 DevTools 패널을 마운트한다.
 * 외부 의존성 없이 vanilla DOM으로 구현.
 */

import { LOCALE_CHANGE_EVENT, t } from '../i18n/index.js';
import { aitState } from '../mock/state.js';
import { telemetry } from '../telemetry/index.js';
import { h } from './helpers.js';
import { PANEL_FULLSCREEN_BREAKPOINT, PANEL_HEIGHT, PANEL_STYLES, PANEL_WIDTH } from './styles.js';
import { setDeviceRefreshPanel } from './tabs/device.js';
import { createTabRenderers, getTabs, type TabId } from './tabs/index.js';
import { disposeViewport, initViewport } from './viewport.js';

// --- Draggable toggle button ---

function makeDraggable(el: HTMLElement, onClickOnly: () => void) {
  let isDragging = false;
  let startX = 0,
    startY = 0;
  let startLeft = 0,
    startTop = 0;
  let hasMoved = false;

  el.addEventListener('pointerdown', (e) => {
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
      el.classList.add('dragging');
    }
    if (!hasMoved) return;

    el.style.left = `${startLeft + dx}px`;
    el.style.top = `${startTop + dy}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });

  el.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    el.classList.remove('dragging');
    el.releasePointerCapture(e.pointerId);

    if (hasMoved) {
      snapToEdge(el);
      updatePanelPosition(el);
      saveButtonPosition(el);
    } else {
      onClickOnly();
    }
  });

  el.addEventListener('pointercancel', (e) => {
    isDragging = false;
    el.classList.remove('dragging');
    el.releasePointerCapture(e.pointerId);
    if (hasMoved) {
      snapToEdge(el);
      updatePanelPosition(el);
      saveButtonPosition(el);
    }
  });
}

function snapToEdge(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const margin = 16;

  if (cx < vw / 2) {
    el.style.left = `${margin}px`;
    el.style.right = 'auto';
  } else {
    el.style.left = 'auto';
    el.style.right = `${margin}px`;
  }

  const top = Math.max(margin, Math.min(vh - rect.height - margin, rect.top));
  el.style.top = `${top}px`;
  el.style.bottom = 'auto';
}

function updatePanelPosition(toggleEl: HTMLElement) {
  if (!panelEl) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // On narrow viewports, CSS media query handles fullscreen — clear any inline positioning
  if (vw <= PANEL_FULLSCREEN_BREAKPOINT) {
    panelEl.style.top = '';
    panelEl.style.left = '';
    panelEl.style.right = '';
    panelEl.style.bottom = '';
    return;
  }

  const rect = toggleEl.getBoundingClientRect();
  const _panelWidth = PANEL_WIDTH;
  const panelHeight = PANEL_HEIGHT;
  const margin = 16;

  // Horizontal: place panel on the same side as the toggle button
  if (rect.left < vw / 2) {
    panelEl.style.left = `${margin}px`;
    panelEl.style.right = 'auto';
  } else {
    panelEl.style.left = 'auto';
    panelEl.style.right = `${margin}px`;
  }

  // Vertical: place below button if it's in top half, above if bottom half
  // Clamp so panel stays within viewport
  if (rect.top < vh / 2) {
    const top = Math.min(rect.bottom + 8, vh - panelHeight - margin);
    panelEl.style.top = `${Math.max(margin, top)}px`;
    panelEl.style.bottom = 'auto';
  } else {
    const bottom = Math.min(vh - rect.top + 8, vh - panelHeight - margin);
    panelEl.style.top = 'auto';
    panelEl.style.bottom = `${Math.max(margin, bottom)}px`;
  }
}

function saveButtonPosition(el: HTMLElement) {
  localStorage.setItem(
    '__ait_btn_pos',
    JSON.stringify({
      left: el.style.left,
      top: el.style.top,
      right: el.style.right,
      bottom: el.style.bottom,
    }),
  );
}

// Uses __ait_btn_pos (not __ait_storage: prefix) — panel-internal state, not mock storage
function restoreButtonPosition(el: HTMLElement) {
  const saved = localStorage.getItem('__ait_btn_pos');
  if (saved) {
    try {
      const pos = JSON.parse(saved);
      if (typeof pos !== 'object' || pos === null) return;
      const allowedKeys = ['left', 'top', 'right', 'bottom'] as const;
      const validCssValue = /^(\d+px|auto)$/;
      for (const key of allowedKeys) {
        if (key in pos && typeof pos[key] === 'string' && validCssValue.test(pos[key])) {
          el.style[key] = pos[key];
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    el.style.bottom = '16px';
    el.style.right = '16px';
  }
}

// --- Mount ---

let currentTab: TabId = 'env';
let isOpen = false;
let panelEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let tabsEl: HTMLElement | null = null;
let toggleEl: HTMLElement | null = null;
let injectedStyle: HTMLStyleElement | null = null;

// Saved listener refs so disposePanel() can detach them. Anonymous handlers
// can't be removed, so mount() now binds these to module-level vars.
let panelSwitchTabHandler: ((e: Event) => void) | null = null;
let resizeHandler: (() => void) | null = null;
let aitStateUnsubscribe: (() => void) | null = null;
let localeChangeHandler: (() => void) | null = null;

// Lazy-initialized after refreshPanel is defined
let tabRenderers: Record<TabId, () => HTMLElement> | null = null;

function refreshPanel() {
  if (!bodyEl || !tabsEl) return;
  if (!tabRenderers) tabRenderers = createTabRenderers(refreshPanel);
  bodyEl.innerHTML = '';
  try {
    bodyEl.appendChild(tabRenderers[currentTab]());
  } catch (err) {
    console.error(`[@ait-co/devtools] Error rendering tab "${currentTab}":`, err);
    bodyEl.appendChild(
      h('div', { className: 'ait-panel-tab-error' }, t('panel.tabError', { tab: currentTab })),
    );
  }

  tabsEl.querySelectorAll('.ait-panel-tab').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-tab') === currentTab);
  });
}

function mount() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('.ait-panel-toggle')) return;

  // Wire up device tab's refreshPanel reference
  setDeviceRefreshPanel(refreshPanel);

  // Viewport simulation: restore from sessionStorage, apply to DOM, auto-sync.
  initViewport();

  // Styles
  injectedStyle = document.createElement('style');
  injectedStyle.textContent = PANEL_STYLES;
  document.head.appendChild(injectedStyle);

  // Toggle button
  const toggle = h(
    'button',
    { className: 'ait-panel-toggle', title: t('panel.toggle.title') },
    'AIT',
  );
  toggleEl = toggle;
  restoreButtonPosition(toggle);

  // Panel
  panelEl = h('div', { className: 'ait-panel' });

  const closeBtn = h('button', { className: 'ait-panel-close', title: t('panel.close') }, '\u00d7');
  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panelEl!.classList.remove('open');
    telemetry.onPanelClose();
  });

  const mockBadge = h(
    'span',
    {
      className: `ait-mock-badge ${aitState.state.panelEditable ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`,
      title: t('panel.editMode.toggleTitle'),
    },
    aitState.state.panelEditable ? t('panel.editMode.on') : t('panel.editMode.off'),
  );

  mockBadge.addEventListener('click', () => {
    aitState.update({ panelEditable: !aitState.state.panelEditable });
    mockBadge.className = `ait-mock-badge ${aitState.state.panelEditable ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`;
    mockBadge.textContent = aitState.state.panelEditable
      ? t('panel.editMode.on')
      : t('panel.editMode.off');
    refreshPanel();
  });

  const headerRight = h(
    'span',
    { style: 'display:flex;align-items:center;gap:6px' },
    mockBadge,
    h('span', { style: 'font-size:11px;color:#666;font-weight:400' }, `v${__VERSION__}`),
    closeBtn,
  );
  const header = h(
    'div',
    { className: 'ait-panel-header' },
    h('span', {}, t('panel.title')),
    headerRight,
  );

  tabsEl = h('div', { className: 'ait-panel-tabs' });
  for (const tab of getTabs()) {
    const tabEl = h('button', { className: 'ait-panel-tab', 'data-tab': tab.id }, tab.label);
    tabEl.addEventListener('click', () => {
      currentTab = tab.id;
      telemetry.onTabView(tab.id);
      refreshPanel();
    });
    tabsEl.appendChild(tabEl);
  }

  bodyEl = h('div', { className: 'ait-panel-body' });

  panelEl.append(header, tabsEl, bodyEl);
  document.body.append(panelEl, toggle);

  // Re-clamp restored position to current viewport (e.g., saved on wider screen)
  snapToEdge(toggle);
  saveButtonPosition(toggle);

  makeDraggable(toggle, () => {
    isOpen = !isOpen;
    panelEl!.classList.toggle('open', isOpen);
    if (isOpen) {
      updatePanelPosition(toggle);
      refreshPanel();
      telemetry.onPanelOpen();
    } else {
      telemetry.onPanelClose();
    }
  });

  // Re-clamp button and panel position on window resize (rAF-throttled)
  let resizeRaf = 0;
  resizeHandler = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      snapToEdge(toggle);
      saveButtonPosition(toggle);
      if (isOpen) updatePanelPosition(toggle);
    });
  };
  window.addEventListener('resize', resizeHandler);

  // 상태 변경 시 자동 갱신 (analytics, storage, device, viewport, iap 탭)
  // Defense-in-depth: outer catch complements refreshPanel's inner tab-rendering catch.
  aitStateUnsubscribe = aitState.subscribe(() => {
    try {
      if (
        isOpen &&
        (currentTab === 'analytics' ||
          currentTab === 'storage' ||
          currentTab === 'device' ||
          currentTab === 'viewport' ||
          currentTab === 'iap' ||
          currentTab === 'ads' ||
          currentTab === 'presets')
      ) {
        refreshPanel();
      }
    } catch (err) {
      console.error('[@ait-co/devtools] Error in subscribe callback:', err);
    }
  });

  // Listen for tab switch requests from device tab (prompt auto-open).
  // Bound here (not at module scope) so disposePanel() can detach it; outside
  // of a mount, switching tabs has no panel to act on anyway.
  panelSwitchTabHandler = (e: Event) => {
    const detail = (e as CustomEvent).detail as { tab: TabId };
    currentTab = detail.tab;
    if (panelEl && !panelEl.classList.contains('open')) {
      isOpen = true;
      panelEl.classList.add('open');
    }
    refreshPanel();
  };
  window.addEventListener('__ait:panel-switch-tab', panelSwitchTabHandler);

  // Locale change → tear down the panel and re-mount so every string in the
  // tree re-evaluates against the new catalog. The mount path is already
  // idempotent (`document.querySelector('.ait-panel-toggle')` guard), so
  // dispose+mount is the simplest "re-render whole panel" hook.
  localeChangeHandler = () => {
    // disposePanel() resets currentTab to 'env' and isOpen to false. Capture
    // them first so the user stays on the same tab and the panel doesn't
    // close out from under them mid-interaction.
    const savedTab = currentTab;
    const savedOpen = isOpen;
    disposePanel();
    try {
      mount();
      currentTab = savedTab;
      if (savedOpen && panelEl) {
        isOpen = true;
        panelEl.classList.add('open');
      }
      refreshPanel();
    } catch (err) {
      console.error('[@ait-co/devtools] Failed to re-mount after locale change:', err);
    }
  };
  window.addEventListener(LOCALE_CHANGE_EVENT, localeChangeHandler);

  refreshPanel();

  // Telemetry: check consent state, show toast if needed, fire panel_mount if granted.
  telemetry.init();
}

/**
 * Pairs with `mount()` (and the existing `disposeViewport()`).
 * Idempotent — safe to call before mount or twice in a row.
 *
 * Removes panel DOM (toggle + panel root), the injected `<style>`, all
 * window/aitState listeners, and resets module-level state. After dispose,
 * `mount()` can be called again to re-mount cleanly.
 */
function disposePanel(): void {
  if (typeof document === 'undefined') return;

  if (panelSwitchTabHandler && typeof window !== 'undefined') {
    window.removeEventListener('__ait:panel-switch-tab', panelSwitchTabHandler);
  }
  if (resizeHandler && typeof window !== 'undefined') {
    window.removeEventListener('resize', resizeHandler);
  }
  if (localeChangeHandler && typeof window !== 'undefined') {
    window.removeEventListener(LOCALE_CHANGE_EVENT, localeChangeHandler);
  }
  if (aitStateUnsubscribe) aitStateUnsubscribe();

  toggleEl?.remove();
  panelEl?.remove();
  injectedStyle?.remove();

  disposeViewport();
  setDeviceRefreshPanel(() => {});

  panelSwitchTabHandler = null;
  resizeHandler = null;
  localeChangeHandler = null;
  aitStateUnsubscribe = null;
  toggleEl = null;
  panelEl = null;
  bodyEl = null;
  tabsEl = null;
  injectedStyle = null;
  tabRenderers = null;
  currentTab = 'env';
  isOpen = false;
}

// DOM ready 시 마운트
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
