/**
 * Vanilla TS i18n for the floating DevTools panel.
 *
 * Public surface:
 *   - `t(key, vars?)` — look up a UI string, with `{name}` placeholder
 *     interpolation. Falls back to the key itself if a translation is missing.
 *   - `getLocale()` / `setLocale(locale)` — read/persist the active locale.
 *     `setLocale` dispatches `__ait:localechange` so the panel can remount.
 *   - `detectLocale()` — first-run heuristic from `navigator.language`.
 *
 * `ko` is the source of truth (keys are typed from it). `en` is also a full
 * `Record<StringKey, string>` (devtools is developer-facing, en is a real
 * audience). The `Partial` lookup table preserves the runtime `?? key` safety
 * net even though we ship complete catalogs today.
 */

import { en } from './en.js';
import { ko, type StringKey } from './ko.js';

export type Locale = 'ko' | 'en';

const LOCALE_STORAGE_KEY = '__ait_locale';
const LOCALE_CHANGE_EVENT = '__ait:localechange';

const tables: Record<Locale, Partial<Record<StringKey, string>>> = { ko, en };

let currentLocale: Locale | null = null;

function safeReadStorage(): Locale | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === 'ko' || raw === 'en') return raw;
  } catch {
    /* localStorage can throw in privacy modes — fall back silently */
  }
  return null;
}

function safeWriteStorage(locale: Locale): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore quota / privacy errors */
  }
}

/**
 * Decide a locale from a BCP-47 language tag. `ko` (and `ko-*`) → `'ko'`,
 * everything else → `'en'`. Shared by the browser (`navigator.language`) and
 * Node (`Accept-Language` header) paths so both resolve identically.
 */
function localeFromLanguageTag(lang: string): Locale {
  return /^ko\b/i.test(lang) ? 'ko' : 'en';
}

/**
 * Read `navigator.language` and decide a locale. `ko` (and `ko-*`) → `'ko'`,
 * everything else → `'en'`. Pure function; does not touch storage.
 */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return localeFromLanguageTag(navigator.language ?? '');
}

/**
 * Decide a locale from an HTTP `Accept-Language` header value. The Node-served
 * surfaces (e.g. the qr-http-server dashboard) have no `navigator`, so the
 * request header is the only language signal. Reads the FIRST language tag
 * (highest priority, ignoring `q=` weights — good enough for ko/en) and feeds
 * it through the same `ko`-vs-`en` heuristic `detectLocale` uses. Returns `'en'`
 * for an empty/missing header.
 */
export function parseAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return 'en';
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim() ?? '';
  return localeFromLanguageTag(first);
}

/**
 * A locale-bound string resolver for surfaces that can't use the in-memory
 * `getLocale()` cache — notably the Node HTTP server, which resolves locale
 * per-request from `Accept-Language` rather than from a process-global. Returns
 * a `t`-compatible closure over the SAME `ko`/`en` tables (single source of
 * truth), so the dashboard/attach HTML shares the exact 169-key catalog the
 * browser surfaces use. The `key: StringKey` signature keeps compile-time key
 * safety on the Node path identical to `t()`.
 */
export function resolveLocaleStrings(
  locale: Locale,
): (key: StringKey, vars?: Record<string, string | number>) => string {
  const table = tables[locale];
  return (key, vars) => {
    const raw = table[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  };
}

/**
 * Resolve the active locale, in order:
 *   1. previously set in-memory value (set by `setLocale`)
 *   2. localStorage `__ait_locale`
 *   3. `detectLocale()` from navigator
 */
export function getLocale(): Locale {
  if (currentLocale) return currentLocale;
  const stored = safeReadStorage();
  currentLocale = stored ?? detectLocale();
  return currentLocale;
}

/**
 * Persist a locale choice and notify listeners. The panel listens for
 * `__ait:localechange` and re-mounts so every string re-evaluates.
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
  safeWriteStorage(locale);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
  }
}

/**
 * Look up a UI string for the current locale. Falls back to the key if missing,
 * so a forgotten key surfaces visibly rather than rendering empty.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const raw = tables[getLocale()][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export type { StringKey };
export { LOCALE_CHANGE_EVENT, LOCALE_STORAGE_KEY };

/**
 * Test-only escape hatch — resets the cached in-memory locale so subsequent
 * `getLocale()` calls re-read storage / re-detect. Production code never needs
 * this; tests use it between cases.
 */
export function _resetLocaleCacheForTests(): void {
  currentLocale = null;
}
