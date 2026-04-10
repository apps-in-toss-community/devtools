/**
 * @ait-co/devtools Floating Panel
 *
 * import 하면 자동으로 페이지에 DevTools 패널을 마운트한다.
 * 외부 의존성 없이 vanilla DOM으로 구현.
 */

import { aitState } from '../mock/state.js';
import { PANEL_STYLES, PANEL_WIDTH, PANEL_HEIGHT } from './styles.js';
import { h } from './helpers.js';
import { type TabId, TABS, createTabRenderers } from './tabs/index.js';
import { setDeviceRefreshPanel } from './tabs/device.js';

// --- Draggable toggle button ---

function makeDraggable(el: HTMLElement, onClickOnly: () => void) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
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

    el.style.left = (startLeft + dx) + 'px';
    el.style.top = (startTop + dy) + 'px';
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
    el.style.left = margin + 'px';
    el.style.right = 'auto';
  } else {
    el.style.left = 'auto';
    el.style.right = margin + 'px';
  }

  const top = Math.max(margin, Math.min(vh - rect.height - margin, rect.top));
  el.style.top = top + 'px';
  el.style.bottom = 'auto';
}

function updatePanelPosition(toggleEl: HTMLElement) {
  if (!panelEl) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // On mobile viewports, CSS media query handles fullscreen — clear any inline positioning
  if (vw <= 480) {
    panelEl.style.top = '';
    panelEl.style.left = '';
    panelEl.style.right = '';
    panelEl.style.bottom = '';
    return;
  }

  const rect = toggleEl.getBoundingClientRect();
  const panelWidth = PANEL_WIDTH;
  const panelHeight = PANEL_HEIGHT;
  const margin = 16;

  // Horizontal: place panel on the same side as the toggle button
  if (rect.left < vw / 2) {
    panelEl.style.left = margin + 'px';
    panelEl.style.right = 'auto';
  } else {
    panelEl.style.left = 'auto';
    panelEl.style.right = margin + 'px';
  }

  // Vertical: place below button if it's in top half, above if bottom half
  // Clamp so panel stays within viewport
  if (rect.top < vh / 2) {
    const top = Math.min(rect.bottom + 8, vh - panelHeight - margin);
    panelEl.style.top = Math.max(margin, top) + 'px';
    panelEl.style.bottom = 'auto';
  } else {
    const bottom = Math.min(vh - rect.top + 8, vh - panelHeight - margin);
    panelEl.style.top = 'auto';
    panelEl.style.bottom = Math.max(margin, bottom) + 'px';
  }
}

function saveButtonPosition(el: HTMLElement) {
  localStorage.setItem('__ait_btn_pos', JSON.stringify({
    left: el.style.left,
    top: el.style.top,
    right: el.style.right,
    bottom: el.style.bottom,
  }));
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
    } catch { /* ignore */ }
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
    bodyEl.appendChild(h('div', { className: 'ait-panel-tab-error' }, `Error rendering "${currentTab}" tab.`));
  }

  tabsEl.querySelectorAll('.ait-panel-tab').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-tab') === currentTab);
  });
}

// Listen for tab switch requests from device tab (prompt auto-open)
if (typeof window !== 'undefined') {
  window.addEventListener('__ait:panel-switch-tab', (e: Event) => {
    const detail = (e as CustomEvent).detail as { tab: TabId };
    currentTab = detail.tab;
    if (panelEl && !panelEl.classList.contains('open')) {
      isOpen = true;
      panelEl.classList.add('open');
    }
    refreshPanel();
  });
}

function mount() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('.ait-panel-toggle')) return;

  // Wire up device tab's refreshPanel reference
  setDeviceRefreshPanel(refreshPanel);

  // Styles
  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;
  document.head.appendChild(style);

  // Toggle button
  const toggle = h('button', { className: 'ait-panel-toggle', title: 'AIT DevTools' }, 'AIT');
  restoreButtonPosition(toggle);

  // Panel
  panelEl = h('div', { className: 'ait-panel' });

  const closeBtn = h('button', { className: 'ait-panel-close', title: 'Close' }, '\u00d7');
  closeBtn.addEventListener('click', () => {
    isOpen = false;
    panelEl!.classList.remove('open');
  });

  const mockBadge = h('span', {
    className: `ait-mock-badge ${aitState.state.panelEditable ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`,
    title: 'Toggle panel edit mode',
  }, aitState.state.panelEditable ? 'EDIT' : 'READ-ONLY');

  mockBadge.addEventListener('click', () => {
    aitState.update({ panelEditable: !aitState.state.panelEditable });
    mockBadge.className = `ait-mock-badge ${aitState.state.panelEditable ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`;
    mockBadge.textContent = aitState.state.panelEditable ? 'EDIT' : 'READ-ONLY';
    refreshPanel();
  });

  const headerRight = h('span', { style: 'display:flex;align-items:center;gap:6px' },
    mockBadge,
    h('span', { style: 'font-size:11px;color:#666;font-weight:400' }, `v${__VERSION__}`),
    closeBtn,
  );
  const header = h('div', { className: 'ait-panel-header' },
    h('span', {}, 'AIT DevTools'),
    headerRight,
  );

  tabsEl = h('div', { className: 'ait-panel-tabs' });
  for (const tab of TABS) {
    const tabEl = h('button', { className: 'ait-panel-tab', 'data-tab': tab.id }, tab.label);
    tabEl.addEventListener('click', () => {
      currentTab = tab.id;
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
    }
  });

  // Re-clamp button and panel position on window resize (rAF-throttled)
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      snapToEdge(toggle);
      saveButtonPosition(toggle);
      if (isOpen) updatePanelPosition(toggle);
    });
  });

  // 상태 변경 시 자동 갱신 (analytics, storage 탭)
  // Defense-in-depth: outer catch complements refreshPanel's inner tab-rendering catch.
  aitState.subscribe(() => {
    try {
      if (isOpen && (currentTab === 'analytics' || currentTab === 'storage' || currentTab === 'device')) {
        refreshPanel();
      }
    } catch (err) {
      console.error('[@ait-co/devtools] Error in subscribe callback:', err);
    }
  });

  refreshPanel();
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

export { mount };
