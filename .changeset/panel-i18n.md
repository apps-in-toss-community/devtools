---
'@ait-co/devtools': patch
---

feat(panel): full ko/en internationalization

DevTools panel and consent toast now render in Korean or English based on `navigator.language` (`/^ko\b/i` → ko, else en), persisted under `localStorage['__ait_locale']`. Environment tab gains a Language toggle; switching locales remounts the panel via the new `__ait:localechange` event. Strings are sourced from a typed catalog under `src/i18n/`; missing keys fall back to the key string. Internal devtools chrome (Load / Show / Clear / Apply / Lat / Lng / Send / Cancel) is intentionally left in English in both locales.
