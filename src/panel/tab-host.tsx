/**
 * Bridge between the React panel chrome and the imperative tab bodies.
 *
 * The tab renderers (`src/panel/tabs/*.ts`) stay imperative: each returns a
 * detached `HTMLElement`. That is deliberate (critique decision #3) — the tabs
 * carry third-party / DOM-mutating logic (e.g. the Ads tab imperatively mounts a
 * `TossAds.attachBanner` slot, the Device tab opens native file pickers) that is
 * awkward and risky to rewrite as JSX, and they are unit-tested against the DOM
 * they emit. `TabHost` renders that DOM into the React tree:
 *
 *   1. It calls `renderTab()` DURING React render. A throw therefore propagates
 *      synchronously up to the wrapping `<TabErrorBoundary>` (effects-time throws
 *      would NOT — React error boundaries only catch render/commit errors), which
 *      is what keeps the per-tab error contract intact.
 *   2. It mounts the produced node into a host `<div>` via `useLayoutEffect` so
 *      the DOM is in place before paint.
 *
 * The `nonce` prop lets the panel force a re-render of the active tab (e.g. after
 * a mock-state change or a storage/preset CRUD) without remounting the chrome.
 */

import { useLayoutEffect, useRef } from 'react';

interface Props {
  /** Imperative renderer for the active tab — produces a detached DOM subtree. */
  renderTab: () => HTMLElement;
  /** Bump to re-invoke `renderTab` (state/locale/CRUD-driven refresh). */
  nonce: number;
}

export function TabHost({ renderTab, nonce }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);

  // Render-time call: a throw here is caught by the surrounding error boundary.
  const node = renderTab();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `node` is freshly built each render; `nonce` is the explicit refresh trigger and keeps the dependency honest without re-running on unrelated chrome renders.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(node);
    return () => {
      host.replaceChildren();
    };
  }, [node, nonce]);

  return <div ref={hostRef} className="ait-tab-host" style={{ display: 'contents' }} />;
}
