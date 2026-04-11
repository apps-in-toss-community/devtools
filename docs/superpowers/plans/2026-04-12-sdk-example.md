# sdk-example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone React app that interactively tests every `@apps-in-toss/web-framework` API, then update devtools to use it for E2E tests.

**Architecture:** Mobile-first SPA with React Router. Each SDK domain gets its own page with interactive forms (parameter inputs, execute, result display, history). IAP and Ads pages use step-by-step workflow UIs. The app imports the real SDK but uses `@ait-co/devtools/unplugin` to swap it for mocks in dev. A `__typecheck.ts` ensures all SDK exports are covered. CI watches for SDK version bumps.

**Tech Stack:** React 19, Vite 6, TypeScript 5, Tailwind CSS 4, React Router 7

**Spec:** `docs/superpowers/specs/2026-04-12-sdk-example-design.md`

**Repositories:**
- sdk-example: `/Users/dave/Projects/github.com/apps-in-toss-community/sdk-example/`
- devtools: `/Users/dave/Projects/github.com/apps-in-toss-community/devtools/`

---

## File Structure (sdk-example)

```
sdk-example/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js           # Tailwind v4 config (if needed, else CSS-only)
├── src/
│   ├── main.tsx                 # Entry: import panel + mount React
│   ├── index.css                # Tailwind directives + mobile-first base styles
│   ├── App.tsx                  # React Router setup, Layout wrapper
│   ├── __typecheck.ts           # Compile-time SDK export coverage check
│   ├── components/
│   │   ├── Layout.tsx           # Mobile shell: max-w-[430px], centered, bg
│   │   ├── PageHeader.tsx       # Back button + title
│   │   ├── ApiCard.tsx          # Single API test card: name, params, execute, result
│   │   ├── ParamInput.tsx       # Type-aware input: text, number, toggle, dropdown, json
│   │   ├── ResultView.tsx       # JSON result + success/error badge
│   │   ├── HistoryLog.tsx       # Timestamped call history
│   │   └── WorkflowStepper.tsx  # Multi-step workflow UI for IAP/Ads
│   └── pages/
│       ├── HomePage.tsx
│       ├── AuthPage.tsx
│       ├── NavigationPage.tsx
│       ├── EnvironmentPage.tsx
│       ├── PermissionsPage.tsx
│       ├── StoragePage.tsx
│       ├── LocationPage.tsx
│       ├── CameraPage.tsx
│       ├── ContactsPage.tsx
│       ├── ClipboardPage.tsx
│       ├── HapticPage.tsx
│       ├── IAPPage.tsx
│       ├── AdsPage.tsx
│       ├── GamePage.tsx
│       ├── AnalyticsPage.tsx
│       └── PartnerPage.tsx
├── .github/
│   └── workflows/
│       └── check-sdk-update.yml
└── .gitignore
```

---

## Part 1: Project Scaffolding

### Task 1: Initialize project with Vite + React + TypeScript

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `.gitignore`
- Create: `src/main.tsx`
- Create: `src/index.css`
- Create: `src/App.tsx`

All work happens in `/Users/dave/Projects/github.com/apps-in-toss-community/sdk-example/`.

- [ ] **Step 1: Scaffold with Vite**

```bash
cd /Users/dave/Projects/github.com/apps-in-toss-community/sdk-example
pnpm create vite . --template react-ts
```

If the directory is non-empty (has .git), select current directory and overwrite.

- [ ] **Step 2: Install dependencies**

```bash
pnpm install
pnpm add react-router-dom @apps-in-toss/web-framework @ait-co/devtools
pnpm add -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Tailwind CSS v4**

Replace `src/index.css` with:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Configure Vite with unplugin and Tailwind**

Replace `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { aitDevtools } from '@ait-co/devtools/unplugin';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    aitDevtools.vite({ panel: true }),
  ],
});
```

- [ ] **Step 5: Configure TypeScript**

Replace `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Set up entry point**

Replace `src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Set up App with React Router (placeholder)**

Replace `src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function Home() {
  return <div className="p-4 text-center text-gray-500">sdk-example</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Clean up scaffolded files**

Delete files that Vite scaffolded but we don't need:

```bash
rm -f src/App.css src/assets/react.svg public/vite.svg
```

- [ ] **Step 9: Verify dev server starts**

```bash
pnpm dev
```

Expected: Dev server starts on localhost, shows "sdk-example" text.

- [ ] **Step 10: Update .gitignore**

Ensure `.gitignore` contains:

```
node_modules
dist
.DS_Store
*.local
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with Vite, React, TypeScript, Tailwind"
```

---

## Part 2: Shared Components

### Task 2: Layout component

**Files:**
- Create: `src/components/Layout.tsx`

- [ ] **Step 1: Create Layout**

```tsx
import { Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-[430px] min-h-screen bg-white shadow-sm">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App.tsx**

Replace `src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';

function Home() {
  return <div className="p-4 text-center text-gray-500">sdk-example</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Verify**

```bash
pnpm dev
```

Expected: White card centered on gray background, max 430px wide.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.tsx src/App.tsx
git commit -m "feat: add mobile-first Layout component"
```

### Task 3: PageHeader component

**Files:**
- Create: `src/components/PageHeader.tsx`

- [ ] **Step 1: Create PageHeader**

```tsx
import { useNavigate } from 'react-router-dom';

export function PageHeader({ title }: { title: string }) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-3 border-b border-gray-100">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 transition-colors"
        aria-label="뒤로가기"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/PageHeader.tsx
git commit -m "feat: add PageHeader component"
```

### Task 4: ResultView component

**Files:**
- Create: `src/components/ResultView.tsx`

- [ ] **Step 1: Create ResultView**

```tsx
interface ResultViewProps {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: unknown;
  error?: string;
}

export function ResultView({ status, data, error }: ResultViewProps) {
  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <div className="mt-2 px-3 py-2 rounded-lg bg-gray-50 text-sm text-gray-500">
        Loading...
      </div>
    );
  }

  const isError = status === 'error';

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 ${isError ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
      <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded ${isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
        {isError ? 'Error' : 'Success'}
      </span>
      <pre className="mt-1 text-xs text-gray-800 whitespace-pre-wrap break-all overflow-auto max-h-48">
        {isError ? error : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ResultView.tsx
git commit -m "feat: add ResultView component"
```

### Task 5: ParamInput component

**Files:**
- Create: `src/components/ParamInput.tsx`

- [ ] **Step 1: Create ParamInput**

```tsx
interface ParamInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'toggle' | 'select';
  options?: { label: string; value: string }[];
  placeholder?: string;
}

export function ParamInput({ label, value, onChange, type = 'text', options, placeholder }: ParamInputProps) {
  if (type === 'toggle') {
    return (
      <label className="flex items-center justify-between py-1.5">
        <span className="text-sm text-gray-700">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={value === 'true'}
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value === 'true' ? 'bg-gray-900' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${value === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </label>
    );
  }

  if (type === 'select' && options) {
    return (
      <label className="block py-1.5">
        <span className="text-sm text-gray-700">{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="block py-1.5">
      <span className="text-sm text-gray-700">{label}</span>
      <input
        type={type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ParamInput.tsx
git commit -m "feat: add ParamInput component"
```

### Task 6: HistoryLog component

**Files:**
- Create: `src/components/HistoryLog.tsx`

- [ ] **Step 1: Create HistoryLog**

```tsx
export interface HistoryEntry {
  timestamp: number;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

interface HistoryLogProps {
  entries: HistoryEntry[];
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function HistoryLog({ entries }: HistoryLogProps) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <p className="text-xs font-medium text-gray-500 mb-1">History ({entries.length})</p>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className="text-gray-400 shrink-0">{formatTime(entry.timestamp)}</span>
            <span className={entry.status === 'error' ? 'text-red-600' : 'text-green-600'}>
              {entry.status === 'error' ? entry.error : JSON.stringify(entry.data)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HistoryLog.tsx
git commit -m "feat: add HistoryLog component"
```

### Task 7: ApiCard component

**Files:**
- Create: `src/components/ApiCard.tsx`

This is the main reusable component that composes ParamInput, ResultView, and HistoryLog for each API function.

- [ ] **Step 1: Create ApiCard**

```tsx
import { useState, useCallback } from 'react';
import { ParamInput } from './ParamInput';
import { ResultView } from './ResultView';
import { HistoryLog, type HistoryEntry } from './HistoryLog';

interface ParamDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'toggle' | 'select';
  options?: { label: string; value: string }[];
  placeholder?: string;
  defaultValue?: string;
}

interface ApiCardProps {
  name: string;
  description?: string;
  params?: ParamDef[];
  execute: (params: Record<string, string>) => Promise<unknown>;
}

export function ApiCard({ name, description, params = [], execute }: ApiCardProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p.name, p.defaultValue ?? '']))
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string>('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const handleExecute = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await execute(values);
      setStatus('success');
      setResult(data);
      setHistory((prev) => [{ timestamp: Date.now(), status: 'success', data }, ...prev].slice(0, 20));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setError(msg);
      setHistory((prev) => [{ timestamp: Date.now(), status: 'error', error: msg }, ...prev].slice(0, 20));
    }
  }, [execute, values]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 font-mono">{name}</h3>
      </div>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}

      {params.length > 0 && (
        <div className="mt-3 space-y-1">
          {params.map((p) => (
            <ParamInput
              key={p.name}
              label={p.label}
              value={values[p.name] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [p.name]: v }))}
              type={p.type}
              options={p.options}
              placeholder={p.placeholder}
            />
          ))}
        </div>
      )}

      <button
        onClick={handleExecute}
        disabled={status === 'loading'}
        className="mt-3 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
      >
        Execute
      </button>

      <ResultView status={status} data={result} error={error} />
      <HistoryLog entries={history} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ApiCard.tsx
git commit -m "feat: add ApiCard component"
```

### Task 8: WorkflowStepper component

**Files:**
- Create: `src/components/WorkflowStepper.tsx`

- [ ] **Step 1: Create WorkflowStepper**

```tsx
import { type ReactNode } from 'react';

interface Step {
  title: string;
  description?: string;
  content: ReactNode;
}

interface WorkflowStepperProps {
  steps: Step[];
  activeStep: number;
  onStepClick: (index: number) => void;
}

export function WorkflowStepper({ steps, activeStep, onStepClick }: WorkflowStepperProps) {
  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const isActive = i === activeStep;
        const isDone = i < activeStep;

        return (
          <div key={i} className="relative">
            <button
              onClick={() => onStepClick(i)}
              className={`w-full text-left rounded-xl border p-4 transition-colors ${
                isActive
                  ? 'border-gray-900 bg-gray-50'
                  : isDone
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-white opacity-60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                  isDone ? 'bg-green-500 text-white' : isActive ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {isDone ? '✓' : i + 1}
                </span>
                <span className="text-sm font-semibold text-gray-900">{step.title}</span>
              </div>
              {step.description && (
                <p className="mt-1 ml-8 text-xs text-gray-500">{step.description}</p>
              )}
            </button>

            {isActive && (
              <div className="mt-2 ml-3 pl-5 border-l-2 border-gray-200">
                {step.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/WorkflowStepper.tsx
git commit -m "feat: add WorkflowStepper component"
```

---

## Part 3: HomePage

### Task 9: HomePage with search and domain navigation

**Files:**
- Create: `src/pages/HomePage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create HomePage**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';

const domains = [
  { path: '/auth', name: 'Auth', description: 'appLogin, getUserKeyForGame 등', apis: ['appLogin', 'getIsTossLoginIntegratedService', 'getUserKeyForGame', 'appsInTossSignTossCert'] },
  { path: '/navigation', name: 'Navigation', description: 'closeView, openURL, share 등', apis: ['closeView', 'openURL', 'share', 'getTossShareLink', 'setIosSwipeGestureEnabled', 'setDeviceOrientation', 'setScreenAwakeMode', 'setSecureScreen', 'requestReview'] },
  { path: '/environment', name: 'Environment', description: 'getPlatformOS, getNetworkStatus 등', apis: ['getPlatformOS', 'getOperationalEnvironment', 'getNetworkStatus', 'getTossAppVersion', 'isMinVersionSupported', 'getSchemeUri', 'getLocale', 'getDeviceId', 'getGroupId', 'getServerTime', 'getDeploymentId', 'getAppsInTossGlobals', 'SafeAreaInsets', 'getSafeAreaInsets'] },
  { path: '/permissions', name: 'Permissions', description: 'getPermission, openPermissionDialog 등', apis: ['getPermission', 'openPermissionDialog', 'requestPermission'] },
  { path: '/storage', name: 'Storage', description: 'setItem, getItem, removeItem 등', apis: ['setItem', 'getItem', 'removeItem', 'clearItems'] },
  { path: '/location', name: 'Location', description: 'getCurrentLocation, startUpdateLocation', apis: ['getCurrentLocation', 'startUpdateLocation'] },
  { path: '/camera', name: 'Camera & Photos', description: 'openCamera, fetchAlbumPhotos', apis: ['openCamera', 'fetchAlbumPhotos'] },
  { path: '/contacts', name: 'Contacts', description: 'fetchContacts', apis: ['fetchContacts'] },
  { path: '/clipboard', name: 'Clipboard', description: 'get/setClipboardText', apis: ['getClipboardText', 'setClipboardText'] },
  { path: '/haptic', name: 'Haptic', description: 'generateHapticFeedback, saveBase64Data', apis: ['generateHapticFeedback', 'saveBase64Data'] },
  { path: '/iap', name: 'IAP', description: '상품 조회, 구매, 주문 관리', apis: ['getProductItemList', 'createOneTimePurchaseOrder', 'createSubscriptionPurchaseOrder', 'getPendingOrders', 'getCompletedOrRefundedOrders', 'getSubscriptionInfo', 'checkoutPayment'] },
  { path: '/ads', name: 'Ads', description: 'GoogleAdMob, TossAds, FullScreenAd', apis: ['loadAppsInTossAdMob', 'showAppsInTossAdMob', 'isAppsInTossAdMobLoaded', 'initialize', 'attach', 'attachBanner', 'destroy', 'destroyAll', 'loadFullScreenAd', 'showFullScreenAd'] },
  { path: '/game', name: 'Game', description: '게임센터, 프로모션, contactsViral', apis: ['grantPromotionReward', 'grantPromotionRewardForGame', 'submitGameCenterLeaderBoardScore', 'getGameCenterGameProfile', 'openGameCenterLeaderboard', 'contactsViral'] },
  { path: '/analytics', name: 'Analytics', description: 'screen, impression, click, eventLog', apis: ['screen', 'impression', 'click', 'eventLog'] },
  { path: '/partner', name: 'Partner', description: 'addAccessoryButton, removeAccessoryButton', apis: ['addAccessoryButton', 'removeAccessoryButton'] },
];

export function HomePage() {
  const [search, setSearch] = useState('');
  const query = search.toLowerCase();

  const filtered = domains.filter(
    (d) =>
      d.name.toLowerCase().includes(query) ||
      d.description.toLowerCase().includes(query) ||
      d.apis.some((api) => api.toLowerCase().includes(query))
  );

  return (
    <div className="px-4 pb-8">
      <div className="sticky top-0 z-10 bg-white pt-4 pb-3">
        <h1 className="text-xl font-bold text-gray-900">SDK Example</h1>
        <p className="mt-1 text-sm text-gray-500">@apps-in-toss/web-framework</p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="API 이름으로 검색..."
          className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
        />
      </div>

      <div className="mt-2 space-y-2">
        {filtered.map((d) => (
          <Link
            key={d.path}
            to={d.path}
            className="block rounded-xl border border-gray-200 bg-white p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{d.name}</h2>
              <span className="text-xs text-gray-400">{d.apis.length} APIs</span>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{d.description}</p>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">검색 결과가 없습니다</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire HomePage into App.tsx**

Replace `src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Verify**

```bash
pnpm dev
```

Expected: Home page shows 15 domain cards, search filters by API name.

- [ ] **Step 4: Commit**

```bash
git add src/pages/HomePage.tsx src/App.tsx
git commit -m "feat: add HomePage with domain list and search"
```

---

## Part 4: Domain Pages (Interactive Form Pattern)

Each task below follows the same pattern: create the page, add the route to App.tsx, verify in browser.

### Task 10: AuthPage

**Files:**
- Create: `src/pages/AuthPage.tsx`
- Modify: `src/App.tsx` (add route)

- [ ] **Step 1: Create AuthPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import {
  appLogin,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
  appsInTossSignTossCert,
} from '@apps-in-toss/web-framework';

export function AuthPage() {
  return (
    <div>
      <PageHeader title="Auth" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="appLogin"
          description="앱 로그인, authorizationCode 반환"
          execute={async () => await appLogin()}
        />
        <ApiCard
          name="getIsTossLoginIntegratedService"
          description="토스 로그인 연동 서비스 여부"
          execute={async () => getIsTossLoginIntegratedService()}
        />
        <ApiCard
          name="getUserKeyForGame"
          description="게임용 유저 해시 키"
          execute={async () => await getUserKeyForGame()}
        />
        <ApiCard
          name="appsInTossSignTossCert"
          description="토스 인증서 서명"
          params={[{ name: 'txId', label: 'txId', placeholder: 'transaction-id' }]}
          execute={async (p) => await appsInTossSignTossCert({ txId: p.txId })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

Add import and route:

```tsx
import { AuthPage } from './pages/AuthPage';
// inside <Route element={<Layout />}>:
<Route path="/auth" element={<AuthPage />} />
```

- [ ] **Step 3: Verify in browser**

Navigate to `/auth`. Confirm all 4 API cards render, execute buttons work, results display.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AuthPage.tsx src/App.tsx
git commit -m "feat: add AuthPage"
```

### Task 11: NavigationPage

**Files:**
- Create: `src/pages/NavigationPage.tsx`
- Modify: `src/App.tsx` (add route)

- [ ] **Step 1: Create NavigationPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import {
  closeView,
  openURL,
  share,
  getTossShareLink,
  setIosSwipeGestureEnabled,
  setDeviceOrientation,
  setScreenAwakeMode,
  setSecureScreen,
  requestReview,
} from '@apps-in-toss/web-framework';

export function NavigationPage() {
  return (
    <div>
      <PageHeader title="Navigation" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="closeView"
          description="현재 뷰 닫기"
          execute={async () => { closeView(); return 'closed'; }}
        />
        <ApiCard
          name="openURL"
          description="URL 열기"
          params={[{ name: 'url', label: 'URL', placeholder: 'https://example.com' }]}
          execute={async (p) => { openURL(p.url); return 'opened'; }}
        />
        <ApiCard
          name="share"
          description="메시지 공유"
          params={[{ name: 'message', label: 'Message', placeholder: '공유할 메시지' }]}
          execute={async (p) => { await share({ message: p.message }); return 'shared'; }}
        />
        <ApiCard
          name="getTossShareLink"
          description="토스 공유 링크 생성"
          params={[
            { name: 'path', label: 'Path', placeholder: '/some/path' },
            { name: 'ogImageUrl', label: 'OG Image URL (optional)', placeholder: 'https://...' },
          ]}
          execute={async (p) => await getTossShareLink(p.path, p.ogImageUrl || undefined)}
        />
        <ApiCard
          name="setIosSwipeGestureEnabled"
          description="iOS 스와이프 제스처 활성화"
          params={[{ name: 'isEnabled', label: 'Enabled', type: 'toggle', defaultValue: 'true' }]}
          execute={async (p) => { setIosSwipeGestureEnabled({ isEnabled: p.isEnabled === 'true' }); return 'set'; }}
        />
        <ApiCard
          name="setDeviceOrientation"
          description="화면 방향 설정"
          params={[{
            name: 'type', label: 'Orientation', type: 'select',
            options: [{ label: 'Portrait', value: 'portrait' }, { label: 'Landscape', value: 'landscape' }],
            defaultValue: 'portrait',
          }]}
          execute={async (p) => { setDeviceOrientation({ type: p.type as 'portrait' | 'landscape' }); return 'set'; }}
        />
        <ApiCard
          name="setScreenAwakeMode"
          description="화면 꺼짐 방지"
          params={[{ name: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'true' }]}
          execute={async (p) => await setScreenAwakeMode({ enabled: p.enabled === 'true' })}
        />
        <ApiCard
          name="setSecureScreen"
          description="보안 화면 설정"
          params={[{ name: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'true' }]}
          execute={async (p) => await setSecureScreen({ enabled: p.enabled === 'true' })}
        />
        <ApiCard
          name="requestReview"
          description="앱 리뷰 요청"
          execute={async () => { await requestReview(); return 'requested'; }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

```tsx
import { NavigationPage } from './pages/NavigationPage';
// <Route path="/navigation" element={<NavigationPage />} />
```

- [ ] **Step 3: Verify and commit**

```bash
git add src/pages/NavigationPage.tsx src/App.tsx
git commit -m "feat: add NavigationPage"
```

### Task 12: EnvironmentPage

**Files:**
- Create: `src/pages/EnvironmentPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create EnvironmentPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import {
  getPlatformOS,
  getOperationalEnvironment,
  getNetworkStatus,
  getTossAppVersion,
  isMinVersionSupported,
  getSchemeUri,
  getLocale,
  getDeviceId,
  getGroupId,
  getServerTime,
  env,
  getAppsInTossGlobals,
  SafeAreaInsets,
  getSafeAreaInsets,
} from '@apps-in-toss/web-framework';

export function EnvironmentPage() {
  return (
    <div>
      <PageHeader title="Environment" />
      <div className="p-4 space-y-3">
        <ApiCard name="getPlatformOS" description="플랫폼 OS" execute={async () => getPlatformOS()} />
        <ApiCard name="getOperationalEnvironment" description="실행 환경" execute={async () => getOperationalEnvironment()} />
        <ApiCard name="getNetworkStatus" description="네트워크 상태" execute={async () => await getNetworkStatus()} />
        <ApiCard name="getTossAppVersion" description="토스 앱 버전" execute={async () => getTossAppVersion()} />
        <ApiCard
          name="isMinVersionSupported"
          description="최소 버전 지원 확인"
          params={[
            { name: 'android', label: 'Android', placeholder: '5.0.0', defaultValue: '5.0.0' },
            { name: 'ios', label: 'iOS', placeholder: '5.0.0', defaultValue: '5.0.0' },
          ]}
          execute={async (p) => isMinVersionSupported({ android: p.android, ios: p.ios })}
        />
        <ApiCard name="getSchemeUri" description="현재 scheme URI" execute={async () => getSchemeUri()} />
        <ApiCard name="getLocale" description="로케일" execute={async () => getLocale()} />
        <ApiCard name="getDeviceId" description="디바이스 ID" execute={async () => getDeviceId()} />
        <ApiCard name="getGroupId" description="그룹 ID" execute={async () => getGroupId()} />
        <ApiCard name="getServerTime" description="서버 시간" execute={async () => await getServerTime()} />
        <ApiCard name="env.getDeploymentId" description="배포 ID" execute={async () => env.getDeploymentId()} />
        <ApiCard name="getAppsInTossGlobals" description="앱인토스 글로벌 설정" execute={async () => getAppsInTossGlobals()} />
        <ApiCard name="SafeAreaInsets.get" description="Safe Area Insets" execute={async () => SafeAreaInsets.get()} />
        <ApiCard name="getSafeAreaInsets" description="Safe Area Insets (legacy)" execute={async () => getSafeAreaInsets()} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/EnvironmentPage.tsx src/App.tsx
git commit -m "feat: add EnvironmentPage"
```

### Task 13: PermissionsPage

**Files:**
- Create: `src/pages/PermissionsPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create PermissionsPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import {
  getPermission,
  openPermissionDialog,
  requestPermission,
} from '@apps-in-toss/web-framework';

const permissionOptions = [
  { label: 'camera', value: 'camera' },
  { label: 'photo', value: 'photo' },
  { label: 'contacts', value: 'contacts' },
  { label: 'location', value: 'location' },
  { label: 'microphone', value: 'microphone' },
  { label: 'notification', value: 'notification' },
];

export function PermissionsPage() {
  return (
    <div>
      <PageHeader title="Permissions" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="getPermission"
          description="권한 상태 조회"
          params={[{
            name: 'name', label: 'Permission', type: 'select',
            options: permissionOptions, defaultValue: 'camera',
          }]}
          execute={async (p) => await getPermission(p.name as any)}
        />
        <ApiCard
          name="openPermissionDialog"
          description="권한 요청 다이얼로그"
          params={[{
            name: 'name', label: 'Permission', type: 'select',
            options: permissionOptions, defaultValue: 'camera',
          }]}
          execute={async (p) => await openPermissionDialog(p.name as any)}
        />
        <ApiCard
          name="requestPermission"
          description="권한 요청"
          params={[
            {
              name: 'name', label: 'Permission', type: 'select',
              options: permissionOptions, defaultValue: 'camera',
            },
            { name: 'access', label: 'Access', placeholder: 'read', defaultValue: 'read' },
          ]}
          execute={async (p) => await requestPermission({ name: p.name as any, access: p.access })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/PermissionsPage.tsx src/App.tsx
git commit -m "feat: add PermissionsPage"
```

### Task 14: StoragePage

**Files:**
- Create: `src/pages/StoragePage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create StoragePage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { Storage } from '@apps-in-toss/web-framework';

export function StoragePage() {
  return (
    <div>
      <PageHeader title="Storage" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="Storage.setItem"
          description="값 저장"
          params={[
            { name: 'key', label: 'Key', placeholder: 'myKey' },
            { name: 'value', label: 'Value', placeholder: 'myValue' },
          ]}
          execute={async (p) => { await Storage.setItem(p.key, p.value); return 'stored'; }}
        />
        <ApiCard
          name="Storage.getItem"
          description="값 조회"
          params={[{ name: 'key', label: 'Key', placeholder: 'myKey' }]}
          execute={async (p) => await Storage.getItem(p.key)}
        />
        <ApiCard
          name="Storage.removeItem"
          description="값 삭제"
          params={[{ name: 'key', label: 'Key', placeholder: 'myKey' }]}
          execute={async (p) => { await Storage.removeItem(p.key); return 'removed'; }}
        />
        <ApiCard
          name="Storage.clearItems"
          description="전체 삭제"
          execute={async () => { await Storage.clearItems(); return 'cleared'; }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/StoragePage.tsx src/App.tsx
git commit -m "feat: add StoragePage"
```

### Task 15: LocationPage

**Files:**
- Create: `src/pages/LocationPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create LocationPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { getCurrentLocation, startUpdateLocation } from '@apps-in-toss/web-framework';

export function LocationPage() {
  return (
    <div>
      <PageHeader title="Location" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="getCurrentLocation"
          description="현재 위치 조회"
          execute={async () => await getCurrentLocation()}
        />
        <ApiCard
          name="startUpdateLocation"
          description="위치 업데이트 시작"
          execute={async () => { const result = startUpdateLocation(); return result ?? 'started'; }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/LocationPage.tsx src/App.tsx
git commit -m "feat: add LocationPage"
```

### Task 16: CameraPage

**Files:**
- Create: `src/pages/CameraPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create CameraPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { openCamera, fetchAlbumPhotos } from '@apps-in-toss/web-framework';

export function CameraPage() {
  return (
    <div>
      <PageHeader title="Camera & Photos" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="openCamera"
          description="카메라 열기"
          execute={async () => await openCamera()}
        />
        <ApiCard
          name="fetchAlbumPhotos"
          description="앨범 사진 가져오기"
          params={[{ name: 'maxCount', label: 'Max Count', type: 'number', defaultValue: '5' }]}
          execute={async (p) => await fetchAlbumPhotos({ maxCount: Number(p.maxCount) })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/CameraPage.tsx src/App.tsx
git commit -m "feat: add CameraPage"
```

### Task 17: ContactsPage

**Files:**
- Create: `src/pages/ContactsPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create ContactsPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { fetchContacts } from '@apps-in-toss/web-framework';

export function ContactsPage() {
  return (
    <div>
      <PageHeader title="Contacts" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="fetchContacts"
          description="연락처 가져오기"
          params={[
            { name: 'size', label: 'Size', type: 'number', defaultValue: '10' },
            { name: 'offset', label: 'Offset', type: 'number', defaultValue: '0' },
          ]}
          execute={async (p) => await fetchContacts({ size: Number(p.size), offset: Number(p.offset) })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/ContactsPage.tsx src/App.tsx
git commit -m "feat: add ContactsPage"
```

### Task 18: ClipboardPage

**Files:**
- Create: `src/pages/ClipboardPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create ClipboardPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { getClipboardText, setClipboardText } from '@apps-in-toss/web-framework';

export function ClipboardPage() {
  return (
    <div>
      <PageHeader title="Clipboard" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="setClipboardText"
          description="클립보드에 텍스트 복사"
          params={[{ name: 'text', label: 'Text', placeholder: '복사할 텍스트' }]}
          execute={async (p) => { await setClipboardText(p.text); return 'copied'; }}
        />
        <ApiCard
          name="getClipboardText"
          description="클립보드 텍스트 읽기"
          execute={async () => await getClipboardText()}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/ClipboardPage.tsx src/App.tsx
git commit -m "feat: add ClipboardPage"
```

### Task 19: HapticPage

**Files:**
- Create: `src/pages/HapticPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create HapticPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { generateHapticFeedback, saveBase64Data } from '@apps-in-toss/web-framework';

export function HapticPage() {
  return (
    <div>
      <PageHeader title="Haptic" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="generateHapticFeedback"
          description="햅틱 피드백 생성"
          params={[{
            name: 'type', label: 'Type', type: 'select',
            options: [
              { label: 'tickWeak', value: 'tickWeak' },
              { label: 'tap', value: 'tap' },
              { label: 'success', value: 'success' },
              { label: 'error', value: 'error' },
              { label: 'confetti', value: 'confetti' },
            ],
            defaultValue: 'success',
          }]}
          execute={async (p) => { generateHapticFeedback({ type: p.type as any }); return 'triggered'; }}
        />
        <ApiCard
          name="saveBase64Data"
          description="Base64 데이터 저장"
          params={[
            { name: 'data', label: 'Base64 Data', placeholder: 'SGVsbG8=', defaultValue: 'SGVsbG8=' },
            { name: 'fileName', label: 'File Name', placeholder: 'test.txt', defaultValue: 'test.txt' },
            { name: 'mimeType', label: 'MIME Type', placeholder: 'text/plain', defaultValue: 'text/plain' },
          ]}
          execute={async (p) => { await saveBase64Data({ data: p.data, fileName: p.fileName, mimeType: p.mimeType }); return 'saved'; }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/HapticPage.tsx src/App.tsx
git commit -m "feat: add HapticPage"
```

### Task 20: GamePage

**Files:**
- Create: `src/pages/GamePage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create GamePage**

```tsx
import { useState, useCallback } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { ResultView } from '../components/ResultView';
import {
  grantPromotionReward,
  grantPromotionRewardForGame,
  submitGameCenterLeaderBoardScore,
  getGameCenterGameProfile,
  openGameCenterLeaderboard,
  contactsViral,
} from '@apps-in-toss/web-framework';

function ContactsViralCard() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState('');

  const handleExecute = useCallback(() => {
    setStatus('loading');
    contactsViral({
      options: { templateId: 'test-template' },
      onEvent: (event) => {
        setStatus('success');
        setResult(event);
      },
      onError: (err) => {
        setStatus('error');
        setError(String(err));
      },
    });
  }, []);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900 font-mono">contactsViral</h3>
      <p className="mt-0.5 text-xs text-gray-500">연락처 바이럴 공유</p>
      <button
        onClick={handleExecute}
        disabled={status === 'loading'}
        className="mt-3 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
      >
        Execute
      </button>
      <ResultView status={status} data={result} error={error} />
    </div>
  );
}

export function GamePage() {
  return (
    <div>
      <PageHeader title="Game" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="grantPromotionReward"
          description="프로모션 리워드 지급"
          params={[
            { name: 'promotionCode', label: 'Promotion Code', placeholder: 'PROMO_001', defaultValue: 'PROMO_001' },
            { name: 'amount', label: 'Amount', type: 'number', defaultValue: '100' },
          ]}
          execute={async (p) => await grantPromotionReward({ params: { promotionCode: p.promotionCode, amount: Number(p.amount) } })}
        />
        <ApiCard
          name="grantPromotionRewardForGame"
          description="게임 프로모션 리워드 지급"
          params={[
            { name: 'promotionCode', label: 'Promotion Code', placeholder: 'GAME_001', defaultValue: 'GAME_001' },
            { name: 'amount', label: 'Amount', type: 'number', defaultValue: '100' },
          ]}
          execute={async (p) => await grantPromotionRewardForGame({ params: { promotionCode: p.promotionCode, amount: Number(p.amount) } })}
        />
        <ApiCard
          name="submitGameCenterLeaderBoardScore"
          description="리더보드 점수 제출"
          params={[{ name: 'score', label: 'Score', placeholder: '1000', defaultValue: '1000' }]}
          execute={async (p) => await submitGameCenterLeaderBoardScore({ score: p.score })}
        />
        <ApiCard
          name="getGameCenterGameProfile"
          description="게임 프로필 조회"
          execute={async () => await getGameCenterGameProfile()}
        />
        <ApiCard
          name="openGameCenterLeaderboard"
          description="리더보드 열기"
          execute={async () => { await openGameCenterLeaderboard(); return 'opened'; }}
        />
        <ContactsViralCard />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/GamePage.tsx src/App.tsx
git commit -m "feat: add GamePage"
```

### Task 21: AnalyticsPage

**Files:**
- Create: `src/pages/AnalyticsPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create AnalyticsPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { Analytics, eventLog } from '@apps-in-toss/web-framework';

export function AnalyticsPage() {
  return (
    <div>
      <PageHeader title="Analytics" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="Analytics.screen"
          description="화면 조회 로그"
          params={[{ name: 'page', label: 'Page', placeholder: 'home', defaultValue: 'home' }]}
          execute={async (p) => { await Analytics.screen({ page: p.page }); return 'logged'; }}
        />
        <ApiCard
          name="Analytics.impression"
          description="노출 로그"
          params={[
            { name: 'component', label: 'Component', placeholder: 'banner', defaultValue: 'banner' },
            { name: 'page', label: 'Page', placeholder: 'home', defaultValue: 'home' },
          ]}
          execute={async (p) => { await Analytics.impression({ component: p.component, page: p.page }); return 'logged'; }}
        />
        <ApiCard
          name="Analytics.click"
          description="클릭 로그"
          params={[
            { name: 'component', label: 'Component', placeholder: 'button', defaultValue: 'button' },
            { name: 'page', label: 'Page', placeholder: 'home', defaultValue: 'home' },
          ]}
          execute={async (p) => { await Analytics.click({ component: p.component, page: p.page }); return 'logged'; }}
        />
        <ApiCard
          name="eventLog"
          description="커스텀 이벤트 로그"
          params={[
            { name: 'log_name', label: 'Log Name', placeholder: 'custom_event', defaultValue: 'custom_event' },
            { name: 'log_type', label: 'Log Type', placeholder: 'click', defaultValue: 'click' },
          ]}
          execute={async (p) => { await eventLog({ log_name: p.log_name, log_type: p.log_type, params: {} }); return 'logged'; }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/AnalyticsPage.tsx src/App.tsx
git commit -m "feat: add AnalyticsPage"
```

### Task 22: PartnerPage

**Files:**
- Create: `src/pages/PartnerPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create PartnerPage**

```tsx
import { PageHeader } from '../components/PageHeader';
import { ApiCard } from '../components/ApiCard';
import { partner } from '@apps-in-toss/web-framework';

export function PartnerPage() {
  return (
    <div>
      <PageHeader title="Partner" />
      <div className="p-4 space-y-3">
        <ApiCard
          name="partner.addAccessoryButton"
          description="액세서리 버튼 추가"
          params={[
            { name: 'id', label: 'Button ID', placeholder: 'btn-1', defaultValue: 'btn-1' },
            { name: 'title', label: 'Title', placeholder: 'My Button', defaultValue: 'My Button' },
            { name: 'iconName', label: 'Icon Name', placeholder: 'star', defaultValue: 'star' },
          ]}
          execute={async (p) => { await partner.addAccessoryButton({ id: p.id, title: p.title, icon: { name: p.iconName } }); return 'added'; }}
        />
        <ApiCard
          name="partner.removeAccessoryButton"
          description="액세서리 버튼 제거"
          execute={async () => { await partner.removeAccessoryButton(); return 'removed'; }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/PartnerPage.tsx src/App.tsx
git commit -m "feat: add PartnerPage"
```

---

## Part 5: Workflow Pages

### Task 23: IAPPage (workflow pattern)

**Files:**
- Create: `src/pages/IAPPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create IAPPage**

```tsx
import { useState, useCallback } from 'react';
import { PageHeader } from '../components/PageHeader';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { ApiCard } from '../components/ApiCard';
import { ResultView } from '../components/ResultView';
import { HistoryLog, type HistoryEntry } from '../components/HistoryLog';
import { IAP, checkoutPayment } from '@apps-in-toss/web-framework';

export function IAPPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [purchaseStatus, setPurchaseStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [purchaseResult, setPurchaseResult] = useState<unknown>(undefined);
  const [purchaseError, setPurchaseError] = useState('');
  const [eventLog, setEventLog] = useState<HistoryEntry[]>([]);

  const addLog = useCallback((status: 'success' | 'error', data?: unknown, error?: string) => {
    setEventLog((prev) => [{ timestamp: Date.now(), status, data, error }, ...prev].slice(0, 20));
  }, []);

  const handlePurchase = useCallback(async (type: 'onetime' | 'subscription') => {
    if (!selectedSku) return;
    setPurchaseStatus('loading');
    const method = type === 'onetime'
      ? IAP.createOneTimePurchaseOrder
      : IAP.createSubscriptionPurchaseOrder;
    method({
      options: {
        sku: selectedSku,
        processProductGrant: async () => {
          addLog('success', { event: 'processProductGrant', sku: selectedSku });
          return true;
        },
      },
      onEvent: (event) => {
        setPurchaseStatus('success');
        setPurchaseResult(event);
        addLog('success', event);
      },
      onError: (error) => {
        setPurchaseStatus('error');
        setPurchaseError(String(error));
        addLog('error', undefined, String(error));
      },
    });
  }, [selectedSku, addLog]);

  const steps = [
    {
      title: '상품 조회',
      description: 'getProductItemList()로 상품 목록을 가져옵니다',
      content: (
        <div className="space-y-3 py-2">
          <ApiCard
            name="IAP.getProductItemList"
            description="상품 목록 조회"
            execute={async () => {
              const result = await IAP.getProductItemList();
              const items = (result as any)?.products ?? [];
              setProducts(items);
              if (items.length > 0) setSelectedSku(items[0].sku ?? items[0].productId ?? '');
              return result;
            }}
          />
          {products.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-500 mb-2">상품 선택</p>
              {products.map((p: any, i: number) => (
                <button
                  key={i}
                  onClick={() => { setSelectedSku(p.sku ?? p.productId ?? ''); setActiveStep(1); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${
                    selectedSku === (p.sku ?? p.productId) ? 'bg-gray-900 text-white' : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  {p.displayName ?? p.sku ?? p.productId} — {p.displayAmount ?? p.price ?? '?'}
                </button>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '구매',
      description: `선택한 상품(${selectedSku || '없음'})을 구매합니다`,
      content: (
        <div className="space-y-3 py-2">
          <p className="text-sm text-gray-700">SKU: <span className="font-mono font-semibold">{selectedSku || '상품을 먼저 선택하세요'}</span></p>
          <div className="flex gap-2">
            <button
              onClick={() => handlePurchase('onetime')}
              disabled={!selectedSku || purchaseStatus === 'loading'}
              className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              일회성 구매
            </button>
            <button
              onClick={() => handlePurchase('subscription')}
              disabled={!selectedSku || purchaseStatus === 'loading'}
              className="flex-1 rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              구독 구매
            </button>
          </div>
          <ResultView status={purchaseStatus} data={purchaseResult} error={purchaseError} />
          <HistoryLog entries={eventLog} />
        </div>
      ),
    },
    {
      title: '주문 관리',
      description: '미완료 주문 조회, 완료/환불 내역, 구독 정보',
      content: (
        <div className="space-y-3 py-2">
          <ApiCard
            name="IAP.getPendingOrders"
            description="미완료 주문 조회"
            execute={async () => await IAP.getPendingOrders()}
          />
          <ApiCard
            name="IAP.getCompletedOrRefundedOrders"
            description="완료/환불 주문 조회"
            execute={async () => await IAP.getCompletedOrRefundedOrders()}
          />
          <ApiCard
            name="IAP.getSubscriptionInfo"
            description="구독 정보 조회"
            params={[{ name: 'orderId', label: 'Order ID', placeholder: 'order-123' }]}
            execute={async (p) => await IAP.getSubscriptionInfo({ params: { orderId: p.orderId } })}
          />
          <ApiCard
            name="checkoutPayment"
            description="TossPay 결제"
            params={[{ name: 'payToken', label: 'Pay Token', placeholder: 'token-123' }]}
            execute={async (p) => await checkoutPayment({ params: { payToken: p.payToken } })}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="IAP" />
      <div className="p-4">
        <WorkflowStepper steps={steps} activeStep={activeStep} onStepClick={setActiveStep} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/IAPPage.tsx src/App.tsx
git commit -m "feat: add IAPPage with workflow stepper"
```

### Task 24: AdsPage (workflow pattern)

**Files:**
- Create: `src/pages/AdsPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create AdsPage**

```tsx
import { useState, useCallback, useRef } from 'react';
import { PageHeader } from '../components/PageHeader';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { ResultView } from '../components/ResultView';
import { HistoryLog, type HistoryEntry } from '../components/HistoryLog';
import { ApiCard } from '../components/ApiCard';
import { GoogleAdMob, TossAds, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

export function AdsPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [adLoaded, setAdLoaded] = useState(false);
  const [eventLog, setEventLog] = useState<HistoryEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [loadResult, setLoadResult] = useState<unknown>(undefined);
  const [loadError, setLoadError] = useState('');
  const tossAdsRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((status: 'success' | 'error', data?: unknown, error?: string) => {
    setEventLog((prev) => [{ timestamp: Date.now(), status, data, error }, ...prev].slice(0, 20));
  }, []);

  const handleLoad = useCallback(() => {
    setLoadStatus('loading');
    GoogleAdMob.loadAppsInTossAdMob({
      onEvent: (e) => {
        setLoadStatus('success');
        setLoadResult(e);
        setAdLoaded(true);
        addLog('success', e);
        setActiveStep(1);
      },
      onError: (e) => {
        setLoadStatus('error');
        setLoadError(String(e));
        addLog('error', undefined, String(e));
      },
    });
  }, [addLog]);

  const handleShow = useCallback(() => {
    GoogleAdMob.showAppsInTossAdMob({
      onEvent: (e) => addLog('success', e),
      onError: (e) => addLog('error', undefined, String(e)),
    });
  }, [addLog]);

  const steps = [
    {
      title: '광고 로드',
      description: '광고를 미리 로드합니다',
      content: (
        <div className="space-y-3 py-2">
          <button
            onClick={handleLoad}
            disabled={loadStatus === 'loading'}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            GoogleAdMob.loadAppsInTossAdMob
          </button>
          <ResultView status={loadStatus} data={loadResult} error={loadError} />
        </div>
      ),
    },
    {
      title: '광고 표시',
      description: '로드된 광고를 화면에 표시합니다',
      content: (
        <div className="space-y-3 py-2">
          <button
            onClick={handleShow}
            disabled={!adLoaded}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            GoogleAdMob.showAppsInTossAdMob
          </button>
          <HistoryLog entries={eventLog} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Ads" />
      <div className="p-4 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">GoogleAdMob</h2>
          <WorkflowStepper steps={steps} activeStep={activeStep} onStepClick={setActiveStep} />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">FullScreen Ad</h2>
          <div className="space-y-3">
            <ApiCard
              name="loadFullScreenAd"
              description="전면 광고 로드"
              execute={async () => {
                return new Promise((resolve, reject) => {
                  loadFullScreenAd({
                    onEvent: (e) => resolve(e),
                    onError: (e) => reject(e),
                  });
                });
              }}
            />
            <ApiCard
              name="showFullScreenAd"
              description="전면 광고 표시"
              execute={async () => {
                return new Promise((resolve, reject) => {
                  showFullScreenAd({
                    onEvent: (e) => resolve(e),
                    onError: (e) => reject(e),
                  });
                });
              }}
            />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">TossAds</h2>
          <div className="space-y-3">
            <ApiCard
              name="TossAds.initialize"
              description="TossAds 초기화"
              execute={async () => { TossAds.initialize({}); return 'initialized'; }}
            />
            <ApiCard
              name="TossAds.destroyAll"
              description="모든 TossAds 슬롯 제거"
              execute={async () => { TossAds.destroyAll(); return 'destroyed'; }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route, verify, commit**

```bash
git add src/pages/AdsPage.tsx src/App.tsx
git commit -m "feat: add AdsPage with workflow stepper"
```

---

## Part 6: Final App.tsx Assembly

### Task 25: Complete App.tsx with all routes

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Write final App.tsx with all routes**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { AuthPage } from './pages/AuthPage';
import { NavigationPage } from './pages/NavigationPage';
import { EnvironmentPage } from './pages/EnvironmentPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { StoragePage } from './pages/StoragePage';
import { LocationPage } from './pages/LocationPage';
import { CameraPage } from './pages/CameraPage';
import { ContactsPage } from './pages/ContactsPage';
import { ClipboardPage } from './pages/ClipboardPage';
import { HapticPage } from './pages/HapticPage';
import { IAPPage } from './pages/IAPPage';
import { AdsPage } from './pages/AdsPage';
import { GamePage } from './pages/GamePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { PartnerPage } from './pages/PartnerPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/navigation" element={<NavigationPage />} />
          <Route path="/environment" element={<EnvironmentPage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/location" element={<LocationPage />} />
          <Route path="/camera" element={<CameraPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/clipboard" element={<ClipboardPage />} />
          <Route path="/haptic" element={<HapticPage />} />
          <Route path="/iap" element={<IAPPage />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/game" element={<GamePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/partner" element={<PartnerPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Verify all routes work**

```bash
pnpm dev
```

Navigate through all 15 domain pages from home. Confirm each loads, APIs execute, results display.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: complete all routes in App.tsx"
```

---

## Part 7: SDK Export Coverage Check

### Task 26: __typecheck.ts

**Files:**
- Create: `src/__typecheck.ts`

This file ensures every SDK export is used somewhere in the example. If a new export is added to `@apps-in-toss/web-framework` and not imported here, `tsc --noEmit` will fail.

- [ ] **Step 1: Create __typecheck.ts**

```ts
/**
 * Compile-time SDK export coverage check.
 * Every public export from @apps-in-toss/web-framework must be imported here.
 * If a new export is added to the SDK and not listed, `pnpm typecheck` fails.
 *
 * This file is NOT included in the bundle (excluded by vite config or tsconfig).
 */

import type {
  // Types
  PlatformOS as _PlatformOS,
  OperationalEnvironment as _OperationalEnvironment,
  NetworkStatus as _NetworkStatus,
  PermissionStatus as _PermissionStatus,
  PermissionName as _PermissionName,
  HapticFeedbackType as _HapticFeedbackType,
} from '@apps-in-toss/web-framework';

import {
  // Auth
  appLogin,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
  appsInTossSignTossCert,
  // Navigation
  closeView,
  openURL,
  share,
  getTossShareLink,
  setIosSwipeGestureEnabled,
  setDeviceOrientation,
  setScreenAwakeMode,
  setSecureScreen,
  requestReview,
  // Environment
  getPlatformOS,
  getOperationalEnvironment,
  getNetworkStatus,
  getTossAppVersion,
  isMinVersionSupported,
  getSchemeUri,
  getLocale,
  getDeviceId,
  getGroupId,
  getServerTime,
  env,
  getAppsInTossGlobals,
  SafeAreaInsets,
  getSafeAreaInsets,
  // Events
  graniteEvent,
  appsInTossEvent,
  tdsEvent,
  onVisibilityChangedByTransparentServiceWeb,
  // Device
  Storage,
  Accuracy,
  getCurrentLocation,
  startUpdateLocation,
  openCamera,
  fetchAlbumPhotos,
  fetchContacts,
  getClipboardText,
  setClipboardText,
  generateHapticFeedback,
  saveBase64Data,
  getDefaultPlaceholderImages,
  // IAP
  IAP,
  checkoutPayment,
  // Ads
  GoogleAdMob,
  TossAds,
  loadFullScreenAd,
  showFullScreenAd,
  // Game
  grantPromotionReward,
  grantPromotionRewardForGame,
  submitGameCenterLeaderBoardScore,
  getGameCenterGameProfile,
  openGameCenterLeaderboard,
  contactsViral,
  // Analytics
  Analytics,
  eventLog,
  // Partner
  partner,
  // Permissions
  getPermission,
  openPermissionDialog,
  requestPermission,
} from '@apps-in-toss/web-framework';

// Ensure all imports are "used" to prevent unused-import errors
void appLogin;
void getIsTossLoginIntegratedService;
void getUserKeyForGame;
void appsInTossSignTossCert;
void closeView;
void openURL;
void share;
void getTossShareLink;
void setIosSwipeGestureEnabled;
void setDeviceOrientation;
void setScreenAwakeMode;
void setSecureScreen;
void requestReview;
void getPlatformOS;
void getOperationalEnvironment;
void getNetworkStatus;
void getTossAppVersion;
void isMinVersionSupported;
void getSchemeUri;
void getLocale;
void getDeviceId;
void getGroupId;
void getServerTime;
void env;
void getAppsInTossGlobals;
void SafeAreaInsets;
void getSafeAreaInsets;
void graniteEvent;
void appsInTossEvent;
void tdsEvent;
void onVisibilityChangedByTransparentServiceWeb;
void Storage;
void Accuracy;
void getCurrentLocation;
void startUpdateLocation;
void openCamera;
void fetchAlbumPhotos;
void fetchContacts;
void getClipboardText;
void setClipboardText;
void generateHapticFeedback;
void saveBase64Data;
void getDefaultPlaceholderImages;
void IAP;
void checkoutPayment;
void GoogleAdMob;
void TossAds;
void loadFullScreenAd;
void showFullScreenAd;
void grantPromotionReward;
void grantPromotionRewardForGame;
void submitGameCenterLeaderBoardScore;
void getGameCenterGameProfile;
void openGameCenterLeaderboard;
void contactsViral;
void Analytics;
void eventLog;
void partner;
void getPermission;
void openPermissionDialog;
void requestPermission;
```

- [ ] **Step 2: Add typecheck script to package.json**

Add to `package.json` scripts:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS (no errors). If any SDK export is missing, TypeScript will report it.

- [ ] **Step 4: Commit**

```bash
git add src/__typecheck.ts package.json
git commit -m "feat: add SDK export coverage typecheck"
```

---

## Part 8: CI Workflows

### Task 27: SDK update check workflow

**Files:**
- Create: `.github/workflows/check-sdk-update.yml`

- [ ] **Step 1: Create workflow**

```yaml
name: Check SDK Update

on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday 09:00 UTC
  workflow_dispatch:

jobs:
  check-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Check for SDK updates
        run: |
          # Check @apps-in-toss/web-framework
          CURRENT_SDK=$(node -p "require('./package.json').dependencies['@apps-in-toss/web-framework']")
          LATEST_SDK=$(pnpm view @apps-in-toss/web-framework version 2>/dev/null || echo "unknown")

          # Check @ait-co/devtools
          CURRENT_DEVTOOLS=$(node -p "require('./package.json').dependencies['@ait-co/devtools']")
          LATEST_DEVTOOLS=$(pnpm view @ait-co/devtools version 2>/dev/null || echo "unknown")

          echo "SDK: current=$CURRENT_SDK latest=$LATEST_SDK"
          echo "Devtools: current=$CURRENT_DEVTOOLS latest=$LATEST_DEVTOOLS"

          NEEDS_UPDATE=false

          if [ "$LATEST_SDK" != "unknown" ] && [ "$CURRENT_SDK" != "^$LATEST_SDK" ]; then
            echo "sdk_update=true" >> $GITHUB_ENV
            echo "sdk_latest=$LATEST_SDK" >> $GITHUB_ENV
            NEEDS_UPDATE=true
          fi

          if [ "$LATEST_DEVTOOLS" != "unknown" ] && [ "$CURRENT_DEVTOOLS" != "^$LATEST_DEVTOOLS" ]; then
            echo "devtools_update=true" >> $GITHUB_ENV
            echo "devtools_latest=$LATEST_DEVTOOLS" >> $GITHUB_ENV
            NEEDS_UPDATE=true
          fi

          echo "needs_update=$NEEDS_UPDATE" >> $GITHUB_ENV

      - name: Try update and typecheck
        if: env.needs_update == 'true'
        id: typecheck
        continue-on-error: true
        run: |
          if [ "${{ env.sdk_update }}" = "true" ]; then
            pnpm add @apps-in-toss/web-framework@latest
          fi
          if [ "${{ env.devtools_update }}" = "true" ]; then
            pnpm add @ait-co/devtools@latest
          fi
          pnpm typecheck 2>&1 | head -50 | tee /tmp/typecheck-output.txt

      - name: Create issue if typecheck fails
        if: env.needs_update == 'true' && steps.typecheck.outcome == 'failure'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const output = fs.readFileSync('/tmp/typecheck-output.txt', 'utf8');
            const title = `SDK update available — typecheck failures detected`;
            const body = [
              '## SDK Update Check',
              '',
              `- SDK: ${process.env.sdk_latest || 'no update'}`,
              `- Devtools: ${process.env.devtools_latest || 'no update'}`,
              '',
              '### Typecheck Output',
              '```',
              output,
              '```',
              '',
              'Update the dependencies and fix type errors.',
            ].join('\n');
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title,
              body,
              labels: ['sdk-update'],
            });
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/check-sdk-update.yml
git commit -m "ci: add SDK update check workflow"
```

---

## Part 9: devtools Repository Changes

### Task 28: Remove examples/vite-react and deploy-pages workflow

**Files (in devtools repo):**
- Delete: `examples/vite-react/` (entire directory)
- Delete: `.github/workflows/deploy-pages.yml`
- Modify: `package.json` (remove `example` script)
- Modify: `CLAUDE.md` (update references)

All work in `/Users/dave/Projects/github.com/apps-in-toss-community/devtools/`.

- [ ] **Step 1: Delete examples directory**

```bash
cd /Users/dave/Projects/github.com/apps-in-toss-community/devtools
rm -rf examples/
```

- [ ] **Step 2: Delete deploy-pages workflow**

```bash
rm .github/workflows/deploy-pages.yml
```

- [ ] **Step 3: Remove example script from package.json**

In `package.json`, remove the `"example"` script line:

```json
"example": "pnpm build && pnpm --dir examples/vite-react dev"
```

- [ ] **Step 4: Update CLAUDE.md**

Replace the Playwright MCP "사전 준비" section references from:
```
3. example 앱의 dev 서버를 띄운다: `cd examples/vite-react && pnpm install && pnpm dev`
```
to:
```
3. sdk-example 레포를 별도로 clone하여 dev 서버를 띄운다: `cd ../sdk-example && pnpm install && pnpm dev`
```

- [ ] **Step 5: Update playwright.config.ts**

Replace the webServer command to clone and use sdk-example:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  baseURL: 'http://localhost:4173',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: [
      'pnpm build',
      'rm -rf .tmp/sdk-example',
      'git clone --depth 1 https://github.com/apps-in-toss-community/sdk-example.git .tmp/sdk-example',
      'cd .tmp/sdk-example && pnpm install && pnpm build && pnpm preview --port 4173',
    ].join(' && '),
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 6: Add .tmp to .gitignore**

Append to `.gitignore`:

```
.tmp/
```

- [ ] **Step 7: Update vitest.config.ts exclude**

Change `'examples/**'` to `'.tmp/**'` in the exclude list if present.

- [ ] **Step 8: Verify tests still pass**

```bash
pnpm test
pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove examples/vite-react, use sdk-example repo for E2E

- Delete examples/ directory and deploy-pages workflow
- Update playwright.config.ts to git clone sdk-example
- Update CLAUDE.md references
- Remove example script from package.json"
```

---

## Summary

| Part | Tasks | Description |
|---|---|---|
| 1 | 1 | Project scaffolding (Vite + React + TS + Tailwind) |
| 2 | 2-8 | Shared components (Layout, PageHeader, ApiCard, ParamInput, ResultView, HistoryLog, WorkflowStepper) |
| 3 | 9 | HomePage with search and domain navigation |
| 4 | 10-22 | 13 domain pages with interactive forms |
| 5 | 23-24 | 2 workflow pages (IAP, Ads) |
| 6 | 25 | Final App.tsx assembly with all routes |
| 7 | 26 | SDK export coverage typecheck |
| 8 | 27 | CI workflow for SDK update detection |
| 9 | 28 | devtools repo changes (remove old example, update E2E) |
