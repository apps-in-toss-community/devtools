/**
 * @ait-co/devtools Floating Panel
 *
 * import 하면 자동으로 페이지에 DevTools 패널을 마운트한다.
 * 외부 의존성 없이 vanilla DOM으로 구현.
 */

import { aitState } from '../mock/state.js';
import type { PermissionName, PermissionStatus, NetworkStatus, PlatformOS, OperationalEnvironment, IapNextResult, DeviceApiMode } from '../mock/state.js';
import { getDefaultPlaceholderImages } from '../mock/device/index.js';
import { PANEL_STYLES } from './styles.js';

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
): HTMLElement {
  const select = h('select', { className: 'ait-select' });
  for (const opt of options) {
    const option = h('option', { value: opt }, opt);
    if (opt === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), select);
}

function inputRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const input = h('input', { className: 'ait-input', value });
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), input);
}

function renderEnvTab(): HTMLElement {
  const s = aitState.state;
  const container = h('div');

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Platform'),
      selectRow('OS', ['ios', 'android'], s.platform, v => aitState.update({ platform: v as PlatformOS })),
      inputRow('App Version', s.appVersion, v => aitState.update({ appVersion: v })),
      selectRow('Environment', ['toss', 'sandbox'], s.environment, v => aitState.update({ environment: v as OperationalEnvironment })),
      inputRow('Locale', s.locale, v => aitState.update({ locale: v })),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Network'),
      selectRow('Status', ['WIFI', '4G', '5G', '3G', '2G', 'OFFLINE', 'WWAN', 'UNKNOWN'], s.networkStatus, v => aitState.update({ networkStatus: v as NetworkStatus })),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Safe Area Insets'),
      inputRow('Top', String(s.safeAreaInsets.top), v => aitState.patch('safeAreaInsets', { top: Number(v) })),
      inputRow('Bottom', String(s.safeAreaInsets.bottom), v => aitState.patch('safeAreaInsets', { bottom: Number(v) })),
    ),
  );
  return container;
}

function renderPermissionsTab(): HTMLElement {
  const s = aitState.state;
  const container = h('div');
  const names: PermissionName[] = ['camera', 'photos', 'geolocation', 'clipboard', 'contacts', 'microphone'];
  const statuses: PermissionStatus[] = ['allowed', 'denied', 'notDetermined'];

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Device Permissions'),
      ...names.map(name =>
        selectRow(name, statuses, s.permissions[name], v => {
          aitState.patch('permissions', { [name]: v as PermissionStatus });
        }),
      ),
    ),
  );
  return container;
}

function renderLocationTab(): HTMLElement {
  const s = aitState.state;
  const container = h('div');

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Current Location'),
      inputRow('Latitude', String(s.location.coords.latitude), v => {
        const coords = { ...s.location.coords, latitude: Number(v) };
        aitState.patch('location', { coords } as Partial<typeof s.location>);
      }),
      inputRow('Longitude', String(s.location.coords.longitude), v => {
        const coords = { ...s.location.coords, longitude: Number(v) };
        aitState.patch('location', { coords } as Partial<typeof s.location>);
      }),
      inputRow('Accuracy', String(s.location.coords.accuracy), v => {
        const coords = { ...s.location.coords, accuracy: Number(v) };
        aitState.patch('location', { coords } as Partial<typeof s.location>);
      }),
    ),
  );
  return container;
}

function renderIapTab(): HTMLElement {
  const s = aitState.state;
  const container = h('div');
  const results: IapNextResult[] = ['success', 'USER_CANCELED', 'INVALID_PRODUCT_ID', 'PAYMENT_PENDING', 'NETWORK_ERROR', 'ITEM_ALREADY_OWNED', 'INTERNAL_ERROR'];

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'IAP Simulator'),
      selectRow('Next Purchase Result', results, s.iap.nextResult, v => {
        aitState.patch('iap', { nextResult: v as IapNextResult });
      }),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'TossPay'),
      selectRow('Next Payment Result', ['success', 'fail'], s.payment.nextResult, v => {
        aitState.patch('payment', { nextResult: v as 'success' | 'fail' });
      }),
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
  const container = h('div');

  const backBtn = h('button', { className: 'ait-btn' }, 'Trigger Back Event');
  backBtn.addEventListener('click', () => aitState.trigger('backEvent'));

  const homeBtn = h('button', { className: 'ait-btn' }, 'Trigger Home Event');
  homeBtn.addEventListener('click', () => aitState.trigger('homeEvent'));

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Navigation Events'),
      h('div', { className: 'ait-row' }, backBtn, homeBtn),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Login'),
      selectRow('Logged In', ['true', 'false'], String(aitState.state.auth.isLoggedIn), v => {
        aitState.patch('auth', { isLoggedIn: v === 'true' });
      }),
      selectRow('Toss Login Integrated', ['true', 'false'], String(aitState.state.auth.isTossLoginIntegrated), v => {
        aitState.patch('auth', { isTossLoginIntegrated: v === 'true' });
      }),
    ),
  );
  return container;
}

function renderAnalyticsTab(): HTMLElement {
  const container = h('div');
  const logs = aitState.state.analyticsLog;

  const clearBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Clear');
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
  const container = h('div');
  const prefix = '__ait_storage:';
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      entries.push([key.slice(prefix.length), localStorage.getItem(key) ?? '']);
    }
  }

  const clearBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Clear All');
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
  const container = h('div');
  // Prompt banner (if active)
  const promptBanner = renderPromptBanner();
  if (promptBanner) container.appendChild(promptBanner);

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
        }),
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

  const defaultsBtn = h('button', { className: 'ait-btn-secondary' }, 'Use defaults');
  defaultsBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [...getDefaultPlaceholderImages()] });
    refreshPanel();
  });

  const clearImagesBtn = h('button', { className: 'ait-btn-secondary' }, 'Clear');
  clearImagesBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [] });
    refreshPanel();
  });

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, `Mock Images (${images.length})`),
      imageGrid,
      h('div', { className: 'ait-btn-row' }, addBtn, defaultsBtn, clearImagesBtn),
    ),
  );

  return container;
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

  // Panel
  panelEl = h('div', { className: 'ait-panel' });

  const header = h('div', { className: 'ait-panel-header' },
    h('span', {}, 'AIT DevTools'),
    h('span', { style: 'font-size:11px;color:#666;font-weight:400' }, `v${__VERSION__}`),
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

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    panelEl!.classList.toggle('open', isOpen);
    if (isOpen) refreshPanel();
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
