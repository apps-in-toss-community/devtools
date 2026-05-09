import { renderAdsTab } from './ads.js';
import { renderAnalyticsTab } from './analytics.js';
import { renderDeviceTab } from './device.js';
import { renderEnvironmentTab } from './environment.js';
import { renderEventsTab } from './events.js';
import { renderIapTab } from './iap.js';
import { renderLocationTab } from './location.js';
import { renderPermissionsTab } from './permissions.js';
import { renderPresetsTab } from './presets.js';
import { renderStorageTab } from './storage.js';
import { renderViewportTab } from './viewport.js';

export type TabId =
  | 'env'
  | 'presets'
  | 'permissions'
  | 'location'
  | 'iap'
  | 'ads'
  | 'events'
  | 'analytics'
  | 'storage'
  | 'device'
  | 'viewport';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'env', label: 'Environment' },
  { id: 'presets', label: 'Presets' },
  { id: 'viewport', label: 'Viewport' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'location', label: 'Location' },
  { id: 'device', label: 'Device' },
  { id: 'iap', label: 'IAP' },
  { id: 'ads', label: 'Ads' },
  { id: 'events', label: 'Events' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'storage', label: 'Storage' },
];

// storage tab receives refreshPanel because its clear button modifies localStorage
// directly (not aitState), so it must trigger a re-render explicitly.
// presets tab needs refreshPanel for the same reason (user preset CRUD touches localStorage).
// device tab uses setDeviceRefreshPanel() for prompt-related local state (pendingPrompt);
// its aitState mutations are auto-refreshed via the subscription in index.ts.
// Other tabs only modify aitState or use input controls that reflect changes immediately.
export function createTabRenderers(refreshPanel: () => void): Record<TabId, () => HTMLElement> {
  return {
    env: renderEnvironmentTab,
    presets: () => renderPresetsTab(refreshPanel),
    permissions: renderPermissionsTab,
    location: renderLocationTab,
    device: renderDeviceTab,
    viewport: renderViewportTab,
    iap: renderIapTab,
    ads: renderAdsTab,
    events: renderEventsTab,
    analytics: renderAnalyticsTab,
    storage: () => renderStorageTab(refreshPanel),
  };
}
