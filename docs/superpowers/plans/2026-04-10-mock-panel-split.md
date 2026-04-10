# Mock/Panel Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate mock and panel so devtools panel can be used in production without mock aliasing (monitoring-only mode).

**Architecture:** The unplugin gets `forceEnable` and `mock` options. `NODE_ENV` determines defaults: dev always enables mock+panel, production requires explicit `forceEnable`. A new `mockEnabled` boolean in `AitDevtoolsState` lets the panel render in monitoring-only mode (inputs disabled, badge shown). No runtime SDK switching — mock=false means alias is simply not applied at build time.

**Tech Stack:** TypeScript, unplugin, vitest (jsdom), vanilla DOM

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/mock/state.ts` | Modify | Add `mockEnabled` field to state + default |
| `src/unplugin/index.ts` | Modify | Add `forceEnable`, `mock` options; NODE_ENV logic |
| `src/panel/index.ts` | Modify | Add mock toggle in header; disable inputs when monitoring-only |
| `src/panel/styles.ts` | Modify | Add disabled & badge styles |
| `src/__tests__/state.test.ts` | Modify | Test `mockEnabled` field |
| `src/__tests__/unplugin.test.ts` | Create | Test unplugin option logic |
| `src/__tests__/panel.test.ts` | Create | Test panel monitoring-only mode |

---

### Task 1: Add `mockEnabled` to state

**Files:**
- Modify: `src/mock/state.ts:75-149` (AitDevtoolsState interface + DEFAULT_STATE)
- Test: `src/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/state.test.ts`:

```ts
it('mockEnabled: 기본값은 true이다', () => {
  expect(aitState.state.mockEnabled).toBe(true);
});

it('mockEnabled: update로 토글할 수 있다', () => {
  aitState.update({ mockEnabled: false });
  expect(aitState.state.mockEnabled).toBe(false);
});

it('mockEnabled: reset 시 기본값으로 복원된다', () => {
  aitState.update({ mockEnabled: false });
  aitState.reset();
  expect(aitState.state.mockEnabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/state.test.ts`
Expected: FAIL — `mockEnabled` property does not exist on type

- [ ] **Step 3: Add `mockEnabled` to `AitDevtoolsState` and `DEFAULT_STATE`**

In `src/mock/state.ts`, add to the `AitDevtoolsState` interface (after line 148, before closing `}`):

```ts
  // mock 활성화 상태
  mockEnabled: boolean;
```

In `DEFAULT_STATE` (after `mockData` block, before closing `}`):

```ts
  mockEnabled: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/state.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/mock/state.ts src/__tests__/state.test.ts
git commit -m "feat(state): add mockEnabled field to AitDevtoolsState"
```

---

### Task 2: Extend unplugin options

**Files:**
- Modify: `src/unplugin/index.ts`
- Create: `src/__tests__/unplugin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/unplugin.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We test the unplugin's resolveId and transform behavior by importing the raw plugin creator.
// unplugin's createUnplugin returns an object with .raw(), which gives us the hooks.

describe('aitDevtoolsPlugin options', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // Helper: dynamically import the plugin to pick up fresh NODE_ENV
  async function loadPlugin(options?: Record<string, unknown>) {
    // Re-import each time so process.env.NODE_ENV is read fresh
    const mod = await import('../unplugin/index.js');
    const plugin = mod.default;
    // .raw() returns the raw plugin hooks
    const hooks = plugin.raw(options as any);
    return hooks;
  }

  describe('development mode (NODE_ENV !== production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('기본 옵션: mock alias가 활성화된다', async () => {
      const hooks = await loadPlugin();
      const resolved = (hooks as any).resolveId('@apps-in-toss/web-framework');
      expect(resolved).toBe('@ait-co/devtools/mock');
    });

    it('기본 옵션: panel이 주입된다', async () => {
      const hooks = await loadPlugin();
      const shouldTransform = (hooks as any).transformInclude('src/main.tsx');
      expect(shouldTransform).not.toBe(false);
    });

    it('mock: false여도 dev에서는 mock alias가 비활성화된다', async () => {
      const hooks = await loadPlugin({ mock: false });
      const resolved = (hooks as any).resolveId('@apps-in-toss/web-framework');
      expect(resolved).toBeNull();
    });
  });

  describe('production mode (NODE_ENV === production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('기본 옵션: 아무것도 활성화되지 않는다', async () => {
      const hooks = await loadPlugin();
      const resolved = (hooks as any).resolveId('@apps-in-toss/web-framework');
      expect(resolved).toBeNull();
      const shouldTransform = (hooks as any).transformInclude?.('src/main.tsx');
      expect(shouldTransform).toBeFalsy();
    });

    it('forceEnable: true: panel만 주입되고 mock alias는 비활성화', async () => {
      const hooks = await loadPlugin({ forceEnable: true });
      const resolved = (hooks as any).resolveId('@apps-in-toss/web-framework');
      expect(resolved).toBeNull();
      // panel should be injected
      const shouldTransform = (hooks as any).transformInclude?.('src/main.tsx');
      expect(shouldTransform).not.toBe(false);
    });

    it('forceEnable: true + mock: true: mock alias + panel 모두 활성화', async () => {
      const hooks = await loadPlugin({ forceEnable: true, mock: true });
      const resolved = (hooks as any).resolveId('@apps-in-toss/web-framework');
      expect(resolved).toBe('@ait-co/devtools/mock');
    });

    it('forceEnable: true + panel: false: mock alias만 활성화, panel 미주입', async () => {
      const hooks = await loadPlugin({ forceEnable: true, mock: true, panel: false });
      const resolved = (hooks as any).resolveId('@apps-in-toss/web-framework');
      expect(resolved).toBe('@ait-co/devtools/mock');
      const shouldTransform = (hooks as any).transformInclude?.('src/main.tsx');
      expect(shouldTransform).toBeFalsy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/unplugin.test.ts`
Expected: FAIL — current plugin doesn't check NODE_ENV, missing `forceEnable`/`mock` options

- [ ] **Step 3: Implement unplugin option changes**

Replace `src/unplugin/index.ts` content with:

```ts
/**
 * @ait-co/devtools unplugin
 *
 * 모든 주요 번들러를 지원하는 단일 플러그인.
 * @apps-in-toss/web-framework → @ait-co/devtools/mock 으로 alias 설정.
 *
 * Usage:
 *   import aitDevtools from '@ait-co/devtools/unplugin';
 *
 *   // Vite
 *   export default { plugins: [aitDevtools.vite()] };
 *
 *   // Webpack / Next.js
 *   config.plugins.push(aitDevtools.webpack());
 *
 *   // Rspack
 *   config.plugins.push(aitDevtools.rspack());
 *
 *   // esbuild
 *   { plugins: [aitDevtools.esbuild()] }
 *
 *   // Rollup
 *   { plugins: [aitDevtools.rollup()] }
 */

import { createUnplugin } from 'unplugin';

export interface AitDevtoolsOptions {
  /**
   * 패널 자동 주입 여부 (default: true)
   * true이면 진입점에 floating panel import를 자동 추가한다.
   */
  panel?: boolean;

  /**
   * production 환경에서도 devtools를 강제로 활성화 (default: false)
   * true이면 production에서도 panel을 주입한다.
   */
  forceEnable?: boolean;

  /**
   * mock alias 활성화 여부
   * default: true (development), false (production + forceEnable)
   * true이면 @apps-in-toss/web-framework를 mock으로 alias한다.
   */
  mock?: boolean;
}

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
const BRIDGE_ID = '@apps-in-toss/web-bridge';
const ANALYTICS_ID = '@apps-in-toss/web-analytics';

const aitDevtoolsPlugin = createUnplugin((options?: AitDevtoolsOptions) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldEnable = isDev || (options?.forceEnable ?? false);
  const shouldMock = shouldEnable && (options?.mock ?? isDev);
  const shouldPanel = shouldEnable && (options?.panel ?? true);

  return {
    name: 'ait-co-devtools',
    enforce: 'pre' as const,

    resolveId(id: string) {
      if (!shouldMock) return null;
      // @apps-in-toss/web-framework → @ait-co/devtools/mock
      if (id === FRAMEWORK_ID || id === BRIDGE_ID || id === ANALYTICS_ID) {
        return '@ait-co/devtools/mock';
      }
      return null;
    },

    transformInclude(id: string) {
      if (!shouldPanel) return false;
      // 진입점 파일에만 패널 import를 주입
      return /\.(tsx?|jsx?)$/.test(id) && /main|index|entry|app/i.test(id);
    },

    transform(code: string, id: string) {
      if (!shouldPanel) return null;
      // 이미 패널이 import 되어있으면 스킵
      if (code.includes('@ait-co/devtools/panel')) return null;
      // 진입점에서 가장 처음으로 실행되도록 prepend
      if (/main|index|entry/i.test(id) && !id.includes('node_modules')) {
        return `import '@ait-co/devtools/panel';\n${code}`;
      }
      return null;
    },
  };
});

export const vite = aitDevtoolsPlugin.vite;
export const webpack = aitDevtoolsPlugin.webpack;
export const rollup = aitDevtoolsPlugin.rollup;
export const esbuild = aitDevtoolsPlugin.esbuild;
export const rspack = aitDevtoolsPlugin.rspack;

export default aitDevtoolsPlugin;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/unplugin.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/unplugin/index.ts src/__tests__/unplugin.test.ts
git commit -m "feat(unplugin): add forceEnable and mock options for production devtools"
```

---

### Task 3: Add disabled & badge styles to `styles.ts`

**Files:**
- Modify: `src/panel/styles.ts`

- [ ] **Step 1: Add disabled and badge CSS to `PANEL_STYLES`**

Append to the end of the CSS string in `src/panel/styles.ts` (before the closing backtick):

```css
  /* Disabled state for monitoring-only mode */
  .ait-select:disabled,
  .ait-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ait-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Mock status badge */
  .ait-mock-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .ait-mock-badge-on {
    background: #1a4731;
    color: #4ade80;
  }
  .ait-mock-badge-off {
    background: #4a1a1a;
    color: #f87171;
  }

  /* Mock toggle button in header */
  .ait-mock-toggle {
    background: none;
    border: 1px solid #3a3a5a;
    border-radius: 4px;
    color: #aaa;
    font-size: 10px;
    padding: 2px 6px;
    cursor: pointer;
    font-family: inherit;
    margin-left: 6px;
  }
  .ait-mock-toggle:hover {
    border-color: #5a5a7a;
    color: #e0e0e0;
  }

  /* Monitoring-only notice */
  .ait-monitoring-notice {
    background: #2a1a00;
    border: 1px solid #6b4c00;
    border-radius: 4px;
    padding: 6px 10px;
    margin-bottom: 12px;
    font-size: 11px;
    color: #fbbf24;
  }
```

- [ ] **Step 2: Run build to verify no syntax errors**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/panel/styles.ts
git commit -m "feat(panel): add disabled and mock badge styles"
```

---

### Task 4: Add mock toggle and monitoring-only mode to panel

**Files:**
- Modify: `src/panel/index.ts`

- [ ] **Step 1: Update `mount()` header to include mock badge and toggle**

In `src/panel/index.ts`, replace the header construction inside `mount()` (currently lines 499-502):

```ts
  const header = h('div', { className: 'ait-panel-header' },
    h('span', {}, 'AIT DevTools'),
    h('span', { style: 'font-size:11px;color:#666;font-weight:400' }, `v${__VERSION__}`),
  );
```

with:

```ts
  const mockBadge = h('span', {
    className: `ait-mock-badge ${aitState.state.mockEnabled ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`,
  }, aitState.state.mockEnabled ? 'MOCK ON' : 'MOCK OFF');

  const mockToggle = h('button', { className: 'ait-mock-toggle' }, 'Toggle');
  mockToggle.addEventListener('click', () => {
    aitState.update({ mockEnabled: !aitState.state.mockEnabled });
    // Update badge
    mockBadge.className = `ait-mock-badge ${aitState.state.mockEnabled ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`;
    mockBadge.textContent = aitState.state.mockEnabled ? 'MOCK ON' : 'MOCK OFF';
    refreshPanel();
  });

  const headerRight = h('span', { style: 'display:flex;align-items:center;gap:6px' },
    mockBadge,
    mockToggle,
    h('span', { style: 'font-size:11px;color:#666;font-weight:400' }, `v${__VERSION__}`),
  );

  const header = h('div', { className: 'ait-panel-header' },
    h('span', {}, 'AIT DevTools'),
    headerRight,
  );
```

- [ ] **Step 2: Add monitoring-only notice helper**

Add this function before `TAB_RENDERERS` (around line 454):

```ts
function monitoringNotice(): HTMLElement {
  return h('div', { className: 'ait-monitoring-notice' },
    'Monitoring only — mock is disabled. Settings are read-only.',
  );
}
```

- [ ] **Step 3: Update `selectRow` and `inputRow` to support disabled state**

Replace `selectRow` (lines 44-58):

```ts
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
```

Replace `inputRow` (lines 60-64):

```ts
function inputRow(label: string, value: string, onChange: (v: string) => void, disabled = false): HTMLElement {
  const input = h('input', { className: 'ait-input', value });
  if (disabled) input.disabled = true;
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), input);
}
```

- [ ] **Step 4: Update tab renderers to pass disabled flag**

For tabs that should be read-only in monitoring mode (env, permissions, location, device, iap, events), pass `!aitState.state.mockEnabled` as the `disabled` parameter to all `selectRow` and `inputRow` calls.

In `renderEnvTab`:
```ts
function renderEnvTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.mockEnabled;
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
```

In `renderPermissionsTab`:
```ts
function renderPermissionsTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.mockEnabled;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());

  const names: PermissionName[] = ['camera', 'photos', 'geolocation', 'clipboard', 'contacts', 'microphone'];
  const statuses: PermissionStatus[] = ['allowed', 'denied', 'notDetermined'];

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
```

In `renderLocationTab`:
```ts
function renderLocationTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.mockEnabled;
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
```

In `renderIapTab`:
```ts
function renderIapTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.mockEnabled;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());

  const results: IapNextResult[] = ['success', 'USER_CANCELED', 'INVALID_PRODUCT_ID', 'PAYMENT_PENDING', 'NETWORK_ERROR', 'ITEM_ALREADY_OWNED', 'INTERNAL_ERROR'];

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
```

In `renderEventsTab`:
```ts
function renderEventsTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.mockEnabled;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());

  const backBtn = h('button', { className: 'ait-btn' }, 'Trigger Back Event');
  if (disabled) backBtn.disabled = true;
  backBtn.addEventListener('click', () => aitState.trigger('backEvent'));

  const homeBtn = h('button', { className: 'ait-btn' }, 'Trigger Home Event');
  if (disabled) homeBtn.disabled = true;
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
      }, disabled),
      selectRow('Toss Login Integrated', ['true', 'false'], String(aitState.state.auth.isTossLoginIntegrated), v => {
        aitState.patch('auth', { isTossLoginIntegrated: v === 'true' });
      }, disabled),
    ),
  );
  return container;
}
```

In `renderDeviceTab` — add disabled flag to device mode selectors and action buttons:
```ts
function renderDeviceTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.mockEnabled;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());

  // Prompt banner (if active, only when mock is enabled)
  if (s.mockEnabled) {
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
    if (disabled) removeBtn.disabled = true;
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
  if (disabled) addBtn.disabled = true;
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
  if (disabled) defaultsBtn.disabled = true;
  defaultsBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [...getDefaultPlaceholderImages()] });
    refreshPanel();
  });

  const clearImagesBtn = h('button', { className: 'ait-btn-secondary' }, 'Clear');
  if (disabled) clearImagesBtn.disabled = true;
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
```

Note: `renderAnalyticsTab` and `renderStorageTab` remain **unchanged** — they are monitoring-friendly (read-only log viewers) and work in both modes.

- [ ] **Step 5: Run build to verify compilation**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/panel/index.ts
git commit -m "feat(panel): add mock toggle and monitoring-only mode with disabled inputs"
```

---

### Task 5: Run typecheck and full verification

**Files:**
- No new files

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors (including `__typecheck.ts` SDK compatibility)

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds, dist/ contains all output files

- [ ] **Step 4: Final commit with all remaining changes (if any)**

```bash
git add -A
git commit -m "feat: separate mock and panel for production devtools support"
```
