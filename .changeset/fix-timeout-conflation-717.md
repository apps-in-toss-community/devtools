---
"@ait-co/devtools": patch
---

fix(test-runner): --timeout no longer collapses the human QR-scan wait into the per-file evaluate timeout. devtools-test passed a single 30s value to both createRelayConnectionFactory (how long to wait for a phone to scan the QR) and the per-file evaluate clock, so the web-QR dashboard was torn down 30s after boot — before anyone could scan it. --timeout now controls only the per-file evaluate timeout (default 30s); a new --attach-timeout controls the QR-scan wait and defaults to the generous 10-minute factory default when omitted.
