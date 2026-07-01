---
"@ait-co/devtools": patch
---

fix(test-runner): the CLI devtools-test path now waits for the mini-app page to be attached (enableDomains succeeded) before returning from open(), and enables domains BEFORE injecting the debug indicator/cell globals. Previously open() returned as soon as /targets was non-empty — before the page-level CDP websocket was open — so injectDebugIndicator threw (swallowed), injectGlobals threw fatally when --cell was set, and a transient relay disconnect in that window aborted the whole run. open() now enables domains first, then injects, and retries the attach→enableDomains sequence to ride out a disconnect/reconnect, so once the phone is attached the 12-file batch runs to completion.
