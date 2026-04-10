/**
 * @ait-co/devtools Floating Panel
 *
 * import 하면 자동으로 페이지에 DevTools 패널을 마운트한다.
 * 외부 의존성 없이 vanilla DOM으로 구현.
 */

import { aitState } from '../mock/state.js';
import type { PermissionName, PermissionStatus, NetworkStatus, PlatformOS, OperationalEnvironment, IapNextResult, DeviceApiMode } from '../mock/state.js';
import { getDefaultPlaceholderImages } from '../mock/device/index.js';
import { PANEL_STYLES, PANEL_WIDTH, PANEL_HEIGHT } from './styles.js';

type TabId = 'env' | 'permissions' | 'location' | 'iap' | 'events' | 'analytics' | 'storage' | 'device';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'env', label: 'Environment' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'location', label: 'Location' },
  { id: 'device', label: 'Device' },
  { id: 'iap', label: 'IAP' },
  { id: 'events', label: 'Events' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'storage', label: 'Storage' },
];

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else el.setAttribute(k, v);
    }
  }
  for (const child of children) {
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function selectRow(
  label: string,
  options: string[],
  value: string,
  onChange: (v: string) => void,
  disabled = false,
): HTMLElement {
  const select = h('select', { className: 'ait-select' });
  if (disabled) select.disabled = true;
  for (const opt of options) {
    const option = h('option', { value: opt }, opt);
    if (opt === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), select);
}

function inputRow(label: string, value: string, onChange: (v: string) => void, disabled = false): HTMLElement {
  const input = h('input', { className: 'ait-input', value });
  if (disabled) input.disabled = true;
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), input);
}

function renderEnvTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Platform'),
      selectRow('OS', ['ios', 'android'], s.platform, v => aitState.update({ platform: v as PlatformOS }), disabled),
      inputRow('App Version', s.appVersion, v => aitState.update({ appVersion: v }), disabled),
      selectRow('Environment', ['toss', 'sandbox'], s.environment, v => aitState.update({ environment: v as OperationalEnvironment }), disabled),
      inputRow('Locale', s.locale, v => aitState.update({ locale: v }), disabled),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Network'),
      selectRow('Status', ['WIFI', '4G', '5G', '3G', '2G', 'OFFLINE', 'WWAN', 'UNKNOWN'], s.networkStatus, v => aitState.update({ networkStatus: v as NetworkStatus }), disabled),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Safe Area Insets'),
      inputRow('Top', String(s.safeAreaInsets.top), v => aitState.patch('safeAreaInsets', { top: Number(v) }), disabled),
      inputRow('Bottom', String(s.safeAreaInsets.bottom), v => aitState.patch('safeAreaInsets', { bottom: Number(v) }), disabled),
    ),
  );
  return container;
}

function renderPermissionsTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');
  const names: PermissionName[] = ['camera', 'photos', 'geolocation', 'clipboard', 'contacts', 'microphone'];
  const statuses: PermissionStatus[] = ['allowed', 'denied', 'notDetermined'];

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Device Permissions'),
      ...names.map(name =>
        selectRow(name, statuses, s.permissions[name], v => {
          aitState.patch('permissions', { [name]: v as PermissionStatus });
        }, disabled),
      ),
    ),
  );
  return container;
}

function renderLocationTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Current Location'),
      inputRow('Latitude', String(s.location.coords.latitude), v => {
        const coords = { ...s.location.coords, latitude: Number(v) };
        aitState.patch('location', { coords } as Partial<typeof s.location>);
      }, disabled),
      inputRow('Longitude', String(s.location.coords.longitude), v => {
        const coords = { ...s.location.coords, longitude: Number(v) };
        aitState.patch('location', { coords } as Partial<typeof s.location>);
      }, disabled),
      inputRow('Accuracy', String(s.location.coords.accuracy), v => {
        const coords = { ...s.location.coords, accuracy: Number(v) };
        aitState.patch('location', { coords } as Partial<typeof s.location>);
      }, disabled),
    ),
  );
  return container;
}

function renderIapTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');
  const results: IapNextResult[] = ['success', 'USER_CANCELED', 'INVALID_PRODUCT_ID', 'PAYMENT_PENDING', 'NETWORK_ERROR', 'ITEM_ALREADY_OWNED', 'INTERNAL_ERROR'];

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'IAP Simulator'),
      selectRow('Next Purchase Result', results, s.iap.nextResult, v => {
        aitState.patch('iap', { nextResult: v as IapNextResult });
      }, disabled),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'TossPay'),
      selectRow('Next Payment Result', ['success', 'fail'], s.payment.nextResult, v => {
        aitState.patch('payment', { nextResult: v as 'success' | 'fail' });
      }, disabled),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, `Completed Orders (${s.iap.completedOrders.length})`),
      ...s.iap.completedOrders.slice(-5).map(o =>
        h('div', { className: 'ait-log-entry' },
          h('span', { className: 'ait-log-type' }, o.status),
          `${o.sku} (${o.orderId.slice(-8)})`,
        ),
      ),
    ),
  );
  return container;
}

function renderEventsTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  const backBtn = h('button', { className: 'ait-btn' }, 'Trigger Back Event');
  backBtn.addEventListener('click', () => aitState.trigger('backEvent'));
  if (disabled) backBtn.disabled = true;

  const homeBtn = h('button', { className: 'ait-btn' }, 'Trigger Home Event');
  homeBtn.addEventListener('click', () => aitState.trigger('homeEvent'));
  if (disabled) homeBtn.disabled = true;

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Navigation Events'),
      h('div', { className: 'ait-row' }, backBtn, homeBtn),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Login'),
      selectRow('Logged In', ['true', 'false'], String(aitState.state.auth.isLoggedIn), v => {
        aitState.patch('auth', { isLoggedIn: v === 'true' });
      }, disabled),
      selectRow('Toss Login Integrated', ['true', 'false'], String(aitState.state.auth.isTossLoginIntegrated), v => {
        aitState.patch('auth', { isTossLoginIntegrated: v === 'true' });
      }, disabled),
    ),
  );
  return container;
}

function renderAnalyticsTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());
  const logs = aitState.state.analyticsLog;

  const clearBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Clear');
  if (disabled) clearBtn.disabled = true;
  clearBtn.addEventListener('click', () => {
    aitState.state.analyticsLog.length = 0;
    refreshPanel();
  });

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-row' },
        h('div', { className: 'ait-section-title' }, `Analytics Log (${logs.length})`),
        clearBtn,
      ),
      ...logs.slice(-30).reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString('ko-KR', { hour12: false });
        return h('div', { className: 'ait-log-entry' },
          h('span', { className: 'ait-log-time' }, time),
          h('span', { className: 'ait-log-type' }, entry.type),
          JSON.stringify(entry.params),
        );
      }),
    ),
  );
  return container;
}

function renderStorageTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());
  const prefix = '__ait_storage:';
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      entries.push([key.slice(prefix.length), localStorage.getItem(key) ?? '']);
    }
  }

  const clearBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Clear All');
  if (disabled) clearBtn.disabled = true;
  clearBtn.addEventListener('click', () => {
    entries.forEach(([key]) => localStorage.removeItem(prefix + key));
    refreshPanel();
  });

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-row' },
        h('div', { className: 'ait-section-title' }, `Storage (${entries.length} items)`),
        clearBtn,
      ),
      entries.length === 0
        ? h('div', { style: 'color:#555;font-size:12px' }, 'No items in storage')
        : h('div', {},
            ...entries.map(([key, value]) =>
              h('div', { className: 'ait-storage-row' },
                h('span', { className: 'ait-storage-key' }, key),
                h('span', { className: 'ait-storage-value' }, value.length > 100 ? value.slice(0, 100) + '...' : value),
              ),
            ),
          ),
    ),
  );
  return container;
}

// --- Prompt mode state ---
interface PendingPrompt {
  type: string;
}
let pendingPrompt: PendingPrompt | null = null;

// Listen for prompt requests from device APIs
if (typeof window !== 'undefined') {
  window.addEventListener('__ait:prompt-request', (e: Event) => {
    const detail = (e as CustomEvent).detail as { type: string };
    pendingPrompt = { type: detail.type };
    // Auto-switch to device tab and open panel
    currentTab = 'device';
    if (panelEl && !panelEl.classList.contains('open')) {
      panelEl.classList.add('open');
    }
    refreshPanel();
  });
}

function resolvePrompt(type: string, data: unknown) {
  window.dispatchEvent(new CustomEvent('__ait:prompt-response:' + type, { detail: data }));
  pendingPrompt = null;
  refreshPanel();
}

function renderPromptBanner(): HTMLElement | null {
  if (!pendingPrompt) return null;

  const banner = h('div', { className: 'ait-prompt-banner' });

  if (pendingPrompt.type === 'camera') {
    banner.append(
      h('div', { className: 'ait-prompt-title' }, 'Camera Prompt — Select an image'),
    );
    const input = h('input', { type: 'file', accept: 'image/*', style: 'font-size:11px;color:#aaa' });
    input.addEventListener('change', () => {
      const file = (input as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => resolvePrompt('camera', reader.result as string);
      reader.readAsDataURL(file);
    });
    banner.appendChild(input);
  } else if (pendingPrompt.type === 'photos') {
    banner.append(
      h('div', { className: 'ait-prompt-title' }, 'Photos Prompt — Select images'),
    );
    const input = h('input', { type: 'file', accept: 'image/*', multiple: '', style: 'font-size:11px;color:#aaa' });
    input.addEventListener('change', () => {
      const files = Array.from((input as HTMLInputElement).files ?? []);
      if (files.length === 0) return;
      Promise.all(files.map(file => new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.readAsDataURL(file);
      }))).then(dataUris => resolvePrompt('photos', dataUris));
    });
    banner.appendChild(input);
  } else if (pendingPrompt.type === 'location' || pendingPrompt.type === 'location-update') {
    banner.append(
      h('div', { className: 'ait-prompt-title' },
        pendingPrompt.type === 'location' ? 'Location Prompt — Enter coordinates' : 'Location Update — Send coordinates'),
    );
    const latInput = h('input', { className: 'ait-input', value: String(aitState.state.location.coords.latitude), style: 'width:80px' });
    const lngInput = h('input', { className: 'ait-input', value: String(aitState.state.location.coords.longitude), style: 'width:80px' });
    const sendBtn = h('button', { className: 'ait-btn ait-btn-sm' }, 'Send');
    sendBtn.addEventListener('click', () => {
      const loc = {
        coords: {
          latitude: Number((latInput as HTMLInputElement).value),
          longitude: Number((lngInput as HTMLInputElement).value),
          altitude: 0,
          accuracy: 10,
          altitudeAccuracy: 0,
          heading: 0,
        },
        timestamp: Date.now(),
        accessLocation: 'FINE' as const,
      };
      resolvePrompt(pendingPrompt!.type, loc);
    });
    banner.append(
      h('div', { className: 'ait-prompt-input-row' },
        h('label', {}, 'Lat'), latInput,
        h('label', {}, 'Lng'), lngInput,
        sendBtn,
      ),
    );
  } else {
    // Fallback for unknown prompt types
    banner.append(
      h('div', { className: 'ait-prompt-title' }, `Prompt: ${pendingPrompt.type}`),
    );
  }

  // Cancel button for all prompt types
  const cancelBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger', style: 'margin-top:8px' }, 'Cancel');
  cancelBtn.addEventListener('click', () => {
    pendingPrompt = null;
    window.dispatchEvent(new CustomEvent('__ait:prompt-cancel'));
    refreshPanel();
  });
  banner.appendChild(cancelBtn);

  return banner;
}

function renderDeviceTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  // Prompt banner (if active, only when panelEditable)
  if (s.panelEditable) {
    const promptBanner = renderPromptBanner();
    if (promptBanner) container.appendChild(promptBanner);
  }

  // Device API Mode selectors
  const modeEntries: Array<{ label: string; key: keyof typeof s.deviceModes; options: string[] }> = [
    { label: 'Camera', key: 'camera', options: ['mock', 'web', 'prompt'] },
    { label: 'Photos', key: 'photos', options: ['mock', 'web', 'prompt'] },
    { label: 'Location', key: 'location', options: ['mock', 'web', 'prompt'] },
    { label: 'Network', key: 'network', options: ['mock', 'web'] },
    { label: 'Clipboard', key: 'clipboard', options: ['mock', 'web'] },
  ];

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Device API Modes'),
      ...modeEntries.map(entry =>
        selectRow(entry.label, entry.options, s.deviceModes[entry.key], v => {
          aitState.patch('deviceModes', { [entry.key]: v } as Partial<typeof s.deviceModes>);
          refreshPanel();
        }, disabled),
      ),
    ),
  );

  // Mock Images management
  const images = s.mockData.images;
  const imageGrid = h('div', { className: 'ait-image-grid' });
  images.forEach((dataUri, idx) => {
    const thumb = h('div', { className: 'ait-image-thumb' });
    const img = h('img', { src: dataUri });
    const removeBtn = h('button', { className: 'ait-image-remove' }, 'x');
    removeBtn.addEventListener('click', () => {
      const newImages = [...aitState.state.mockData.images];
      newImages.splice(idx, 1);
      aitState.patch('mockData', { images: newImages });
      refreshPanel();
    });
    if (disabled) removeBtn.disabled = true;
    thumb.append(img, removeBtn);
    imageGrid.appendChild(thumb);
  });

  const addBtn = h('button', { className: 'ait-btn-secondary' }, '+ Add');
  addBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      Promise.all(files.map(file => new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.readAsDataURL(file);
      }))).then(dataUris => {
        aitState.patch('mockData', { images: [...aitState.state.mockData.images, ...dataUris] });
        refreshPanel();
      });
    };
    input.click();
  });
  if (disabled) addBtn.disabled = true;

  const defaultsBtn = h('button', { className: 'ait-btn-secondary' }, 'Use defaults');
  defaultsBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [...getDefaultPlaceholderImages()] });
    refreshPanel();
  });
  if (disabled) defaultsBtn.disabled = true;

  const clearImagesBtn = h('button', { className: 'ait-btn-secondary' }, 'Clear');
  clearImagesBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [] });
    refreshPanel();
  });
  if (disabled) clearImagesBtn.disabled = true;

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, `Mock Images (${images.length})`),
      imageGrid,
      h('div', { className: 'ait-btn-row' }, addBtn, defaultsBtn, clearImagesBtn),
    ),
  );

  return container;
}

function monitoringNotice(): HTMLElement {
  return h('div', { className: 'ait-monitoring-notice' },
    'Read-only — mock responses are controlled at build time.',
  );
}

const TAB_RENDERERS: Record<TabId, () => HTMLElement> = {
  env: renderEnvTab,
  permissions: renderPermissionsTab,
  location: renderLocationTab,
  device: renderDeviceTab,
  iap: renderIapTab,
  events: renderEventsTab,
  analytics: renderAnalyticsTab,
  storage: renderStorageTab,
};

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
let panelEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let tabsEl: HTMLElement | null = null;

function refreshPanel() {
  if (!bodyEl || !tabsEl) return;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(TAB_RENDERERS[currentTab]());

  tabsEl.querySelectorAll('.ait-panel-tab').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-tab') === currentTab);
  });
}

function mount() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('.ait-panel-toggle')) return;

  // Styles
  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;
  document.head.appendChild(style);

  // Toggle button
  const toggle = h('button', { className: 'ait-panel-toggle', title: 'AIT DevTools' }, 'AIT');
  let isOpen = false;
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
  aitState.subscribe(() => {
    if (isOpen && (currentTab === 'analytics' || currentTab === 'storage' || currentTab === 'device')) {
      refreshPanel();
    }
  });

  refreshPanel();
}

// DOM ready 시 마운트
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}

export { mount };
