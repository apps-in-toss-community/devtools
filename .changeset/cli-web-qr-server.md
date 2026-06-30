---
"@ait-co/devtools": patch
---

feat(test-runner): serve the relay-attach QR as a loopback web page (browser auto-open) so `devtools-test` is scannable even when stdout is non-interactive

`createRelayConnectionFactory` now starts the same `qr-http-server` loopback dashboard that the MCP `start_attach` path uses, wires it into `AttachDeps`, and prints `http://127.0.0.1:<port>/` to stderr. The browser auto-opens on GUI machines; headless users see only the stderr URL. If the server fails to start the factory falls back to the existing text-QR path without crashing. TOTP codes and relay wss URLs remain in-memory only — no secrets touch stdout or stderr.
