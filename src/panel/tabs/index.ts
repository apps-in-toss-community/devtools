import { type StringKey, t } from '../../i18n/index.js';
import { renderAdsTab } from './ads.js';
import { renderAnalyticsTab } from './analytics.js';
import { renderDeviceTab } from './device.js';
import { renderEnvironmentTab } from './environment.js';
import { renderEventsTab } from './events.js';
import { renderIapTab } from './iap.js';
import { renderLocationTab } from './location.js';
import { renderNotificationsTab } from './notifications.js';
import { renderPermissionsTab } from './permissions.js';
import { renderPresetsTab } from './presets.js';
import { renderStorageTab } from './storage.js';
import { renderViewportTab } from './viewport.js';

export type TabId =
  | 'env'
  | 'presets'
  | 'permissions'
  | 'notifications'
  | 'location'
  | 'iap'
  | 'ads'
  | 'events'
  | 'analytics'
  | 'storage'
  | 'device'
  | 'viewport';

// Tab ordering + label-key map. `label` is re-resolved through `t()` at each
// mount so locale changes pick up the new translation.
const TAB_DEFS: Array<{ id: TabId; labelKey: StringKey }> = [
  { id: 'env', labelKey: 'panel.tab.env' },
  { id: 'presets', labelKey: 'panel.tab.presets' },
  { id: 'viewport', labelKey: 'panel.tab.viewport' },
  { id: 'permissions', labelKey: 'panel.tab.permissions' },
  { id: 'notifications', labelKey: 'panel.tab.notifications' },
  { id: 'location', labelKey: 'panel.tab.location' },
  { id: 'device', labelKey: 'panel.tab.device' },
  { id: 'iap', labelKey: 'panel.tab.iap' },
  { id: 'ads', labelKey: 'panel.tab.ads' },
  { id: 'events', labelKey: 'panel.tab.events' },
  { id: 'analytics', labelKey: 'panel.tab.analytics' },
  { id: 'storage', labelKey: 'panel.tab.storage' },
];

export function getTabs(): Array<{ id: TabId; label: string }> {
  return TAB_DEFS.map((def) => ({ id: def.id, label: t(def.labelKey) }));
}

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
    notifications: renderNotificationsTab,
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
