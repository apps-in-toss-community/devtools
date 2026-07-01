---
"@ait-co/devtools": patch
---

fix(test-runner): the CLI web-QR dashboard now shows a scannable QR — createRelayConnectionFactory called prepareAttach before the cloudflared tunnel was up, so the attach URL never reached the dashboard (getDashboardState().attachUrl stayed null) and /qr.png 500'd on the empty u param. open() now wires bootRelayFamily's onWssUrl callback (mirroring the MCP daemon path) to await tunnel readiness before prepareAttach and to re-push dashboard state on late tunnel-up. The failure path also closes the QR server (no leaked listener), and /qr.png degrades gracefully on an empty u instead of 500.
