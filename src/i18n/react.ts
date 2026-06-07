/**
 * React reactivity layer over the vanilla i18n core (`./index.ts`).
 *
 * This adds NO second i18n system — it is a thin `useSyncExternalStore` wrapper
 * over the existing `getLocale()` / `setLocale()` / `LOCALE_CHANGE_EVENT` so that
 * React surfaces (panel, fixture, launcher) re-render their subtree when the
 * locale changes, instead of the vanilla panel's old `disposePanel()` → `mount()`
 * full-remount dance.
 *
 * Type safety is preserved end to end: `useT()` returns a `(key: StringKey, …)`
 * closure, so `ko.ts` stays the source of truth and `en.ts`'s
 * `Record<StringKey, string>` mirror keeps a missing key a compile error all the
 * way to JSX call sites.
 */

import { useSyncExternalStore } from 'react';
import { getLocale, LOCALE_CHANGE_EVENT, type Locale, type StringKey, t } from './index.js';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LOCALE_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LOCALE_CHANGE_EVENT, onChange);
}

// The `__ait:localechange` CustomEvent carries no `detail`, so the snapshot
// reads the authoritative value via `getLocale()` rather than an event payload.
function getSnapshot(): Locale {
  return getLocale();
}

// SSR / non-browser render falls back to the same default `detectLocale()` uses
// when `navigator` is absent, keeping server and first client render consistent.
function getServerSnapshot(): Locale {
  return 'en';
}

/**
 * Subscribe to the active locale. Re-renders the calling component whenever
 * `setLocale()` dispatches `LOCALE_CHANGE_EVENT`.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Returns a `t`-compatible translation function bound to the live locale.
 * Calling `useLocale()` establishes the subscription, so any `setLocale()`
 * re-renders every component holding a `useT()` result and the strings
 * re-evaluate without unmounting. The closure delegates to the vanilla `t()`
 * (which reads the live locale itself); it is intentionally NOT memoised — a
 * translation call is cheap and a fresh closure each render keeps the locale
 * subscription the single source of reactivity.
 */
export function useT(): (key: StringKey, vars?: Record<string, string | number>) => string {
  useLocale();
  return t;
}
