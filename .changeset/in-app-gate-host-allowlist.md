---
"@ait-co/devtools": patch
---

feat(in-app): add Layer B1 host allowlist to the runtime debug gate

The runtime gate now requires the page to be served from a
`*.private-apps.tossmini.com` host before any debug attach is considered.
A production `intoss://` entry is served from `*.apps.tossmini.com` (no
`.private-apps.` segment) and is now rejected with `reason: 'host'`.

This closes a gap: Layer A keeps debug code out of release bundles, but a
dogfood build that somehow lands on a production entry still had its code
present. Layer B1 stops that build from attaching on a production host.

A live CDP probe of dogfood mini-app 31146 confirmed the host is the only
usable signal — `getSchemeUri()` normalises `intoss-private://` to
`intoss://`, and `getOperationalEnvironment()` / `getWebViewType()` return
the same value (`"toss"` / `"partner"`) for dogfood and production entries.

`GateInput` gains a required `hostname` field; `checkDebugGate()` fills it
from `window.location.hostname`, so consumers calling it with no arguments
need no change. New export: `isPrivateAppsHost`.
