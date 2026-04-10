import { renderEnvironmentTab } from './environment.js';
import { renderPermissionsTab } from './permissions.js';
import { renderLocationTab } from './location.js';
import { renderDeviceTab } from './device.js';
import { renderIapTab } from './iap.js';
import { renderEventsTab } from './events.js';
import { renderAnalyticsTab } from './analytics.js';
import { renderStorageTab } from './storage.js';

export type TabId = 'env' | 'permissions' | 'location' | 'iap' | 'events' | 'analytics' | 'storage' | 'device';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'env', label: 'Environment' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'location', label: 'Location' },
  { id: 'device', label: 'Device' },
  { id: 'iap', label: 'IAP' },
  { id: 'events', label: 'Events' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'storage', label: 'Storage' },
];

// storage tab receives refreshPanel because its clear button modifies localStorage
// directly (not aitState), so it must trigger a re-render explicitly.
// device tab uses setDeviceRefreshPanel() for prompt-related local state (pendingPrompt);
// its aitState mutations are auto-refreshed via the subscription in index.ts.
// Other tabs only modify aitState or use input controls that reflect changes immediately.
export function createTabRenderers(refreshPanel: () => void): Record<TabId, () => HTMLElement> {
  return {
    env: renderEnvironmentTab,
    permissions: renderPermissionsTab,
    location: renderLocationTab,
    device: renderDeviceTab,
    iap: renderIapTab,
    events: renderEventsTab,
    analytics: renderAnalyticsTab,
    storage: () => renderStorageTab(refreshPanel),
  };
}
