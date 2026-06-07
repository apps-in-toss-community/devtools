/**
 * Floating DevTools Panel — React 19 client component.
 *
 * Replaces the old vanilla `mount()`/`disposePanel()` hand-rolled DOM + the
 * `disposePanel()`→`mount()` "remount on locale change" dance. The chrome
 * (toggle button, header, badge, tab bar, body) is JSX; the tab BODIES stay
 * imperative and are mounted through `<TabHost>` (see that file).
 *
 * Key design points (per the conversion critique):
 *   1. POSITION is a ref + localStorage (`useDraggable`), never React state, so a
 *      locale re-render never disturbs where the button sits.
 *   2. The per-tab `<TabErrorBoundary>` is a CLASS component wrapping ONLY the
 *      active tab subtree.
 *   3. Imperative third-party/DOM logic (viewport sim, device emulation, the tab
 *      bodies) is called from effects/refs, not rewritten as React.
 *   4. Locale reactivity is `useT()` (a `useSyncExternalStore` over the i18n
 *      core): a `setLocale()` re-renders this subtree in place — strings refresh,
 *      tab + position survive, no unmount.
 *
 * The CSS-class / attribute contract relied on by `e2e/panel.test.ts`
 * (`.ait-panel`, `.ait-panel.open`, `button.ait-panel-toggle`, `.ait-panel-body`,
 * `.ait-panel-tab[data-tab=…]` + `.active`, `.ait-mock-badge` text "EDIT",
 * `.ait-panel-tab-error`, …) is emitted verbatim below.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/react.js';
import { type AitDevtoolsState, aitState } from '../mock/state.js';
import { telemetry } from '../telemetry/index.js';
import { TabErrorBoundary } from './tab-error-boundary.js';
import { TabHost } from './tab-host.js';
import { setDeviceRefreshPanel } from './tabs/device.js';
import { createTabRenderers, getTabs, type TabId } from './tabs/index.js';
import { updatePanelPosition, useDraggable } from './use-draggable.js';
import { disposeViewport, initViewport } from './viewport.js';

/** MCP endpoint registered by the unplugin when `mcp: true` is set */
const MCP_STATE_PATH = '/api/ait-devtools/state';

/**
 * Push a state snapshot to the Vite dev-server MCP endpoint.
 * No-ops silently when the endpoint is not available (e.g., mcp option not set,
 * or running in production). Fire-and-forget — never throws.
 */
function pushStateToMcpEndpoint(state: AitDevtoolsState): void {
  if (typeof fetch === 'undefined') return;
  fetch(MCP_STATE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }).catch(() => {
    /* Silently ignore — endpoint is not available when mcp option is not set */
  });
}

// Tabs whose body must re-render on a mock-state change (mirrors the old
// `aitState.subscribe` allow-list in index.ts).
const STATE_DRIVEN_TABS = new Set<TabId>([
  'env',
  'analytics',
  'storage',
  'device',
  'viewport',
  'iap',
  'ads',
  'presets',
]);

export function Panel(): React.ReactElement {
  const t = useT();
  const [currentTab, setCurrentTab] = useState<TabId>('env');
  const [isOpen, setIsOpen] = useState(false);
  // Bumped to force the active tab's imperative body to re-render in place
  // (state change, preset/storage CRUD) without remounting the chrome.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mirrors for imperative callbacks (drag handlers, listeners) that must read
  // the live value without re-binding.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const currentTabRef = useRef(currentTab);
  currentTabRef.current = currentTab;

  const refresh = () => setRefreshNonce((n) => n + 1);

  // Tab renderers — created once. `presets`/`storage` need a `refreshPanel`
  // callback to re-render after CRUD that touches localStorage directly.
  const renderersRef = useRef<Record<TabId, () => HTMLElement> | null>(null);
  if (renderersRef.current === null) {
    renderersRef.current = createTabRenderers(refresh);
  }

  // --- Drag / snap / position (ref + localStorage, NOT state) ---
  useDraggable(toggleRef, {
    getPanelEl: () => panelRef.current,
    isOpenRef,
    onClickOnly: () => {
      setIsOpen((prev) => {
        const next = !prev;
        if (next) {
          // Position the panel relative to the (possibly dragged) button before
          // it becomes visible; runs after the open class lands via the effect.
          telemetry.onPanelOpen();
        } else {
          telemetry.onPanelClose();
        }
        return next;
      });
    },
  });

  // Reposition the panel whenever it opens (button may have been dragged).
  useEffect(() => {
    if (isOpen && toggleRef.current) {
      updatePanelPosition(toggleRef.current, panelRef.current);
    }
  }, [isOpen]);

  // --- One-time imperative wiring: viewport sim, device-tab refresh hook,
  // mock-state subscription, panel-switch-tab event, telemetry init. ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable singletons + refs; this effect intentionally runs once to set up imperative bridges (matches the old mount() lifecycle).
  useEffect(() => {
    setDeviceRefreshPanel(refresh);
    initViewport();

    const unsubscribe = aitState.subscribe(() => {
      try {
        if (isOpenRef.current && STATE_DRIVEN_TABS.has(currentTabRef.current)) {
          refresh();
        }
      } catch (err) {
        console.error('[@ait-co/devtools] Error in subscribe callback:', err);
      }
      // MCP state push (unplugin `mcp: true`). Fire-and-forget.
      pushStateToMcpEndpoint(aitState.state);
    });

    // Device tab (prompt auto-open) / telemetry toggles request a tab switch.
    const onSwitchTab = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab: TabId };
      setCurrentTab(detail.tab);
      setIsOpen(true);
      refresh();
    };
    window.addEventListener('__ait:panel-switch-tab', onSwitchTab);

    telemetry.init();

    return () => {
      unsubscribe();
      window.removeEventListener('__ait:panel-switch-tab', onSwitchTab);
      setDeviceRefreshPanel(() => {});
      disposeViewport();
    };
  }, []);

  const editable = aitState.state.panelEditable;

  const onTabClick = (id: TabId) => {
    setCurrentTab(id);
    telemetry.onTabView(id);
    refresh();
  };

  const onBadgeClick = () => {
    aitState.update({ panelEditable: !aitState.state.panelEditable });
    refresh();
  };

  const onClose = () => {
    setIsOpen(false);
    telemetry.onPanelClose();
  };

  const activeRenderer = renderersRef.current[currentTab];

  return (
    <>
      <div ref={panelRef} className={isOpen ? 'ait-panel open' : 'ait-panel'}>
        <div className="ait-panel-header">
          <span>{t('panel.title')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Kept as a <span> (not <button>) so the `.ait-mock-badge` CSS and the
                e2e contract that reads its textContent stay byte-identical; made
                keyboard-operable to satisfy a11y. */}
            {/* biome-ignore lint/a11y/useSemanticElements: must stay a <span> for the `.ait-mock-badge` style + e2e text-content contract; keyboard handler below covers operability. */}
            <span
              className={`ait-mock-badge ${editable ? 'ait-mock-badge-on' : 'ait-mock-badge-off'}`}
              title={t('panel.editMode.toggleTitle')}
              role="button"
              tabIndex={0}
              onClick={onBadgeClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onBadgeClick();
                }
              }}
            >
              {editable ? t('panel.editMode.on') : t('panel.editMode.off')}
            </span>
            <span style={{ fontSize: '11px', color: '#666', fontWeight: 400 }}>v{__VERSION__}</span>
            <button
              type="button"
              className="ait-panel-close"
              title={t('panel.close')}
              onClick={onClose}
            >
              {'×'}
            </button>
          </span>
        </div>

        <div className="ait-panel-tabs">
          {getTabs().map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={tab.id === currentTab ? 'ait-panel-tab active' : 'ait-panel-tab'}
              data-tab={tab.id}
              onClick={() => onTabClick(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ait-panel-body">
          {/* Boundary keyed by tab so switching away from a thrown tab resets it. */}
          <TabErrorBoundary key={currentTab} tab={currentTab}>
            <TabHost renderTab={activeRenderer} nonce={refreshNonce} />
          </TabErrorBoundary>
        </div>
      </div>

      <button
        ref={toggleRef}
        type="button"
        className="ait-panel-toggle"
        title={t('panel.toggle.title')}
      >
        AIT
      </button>
    </>
  );
}
