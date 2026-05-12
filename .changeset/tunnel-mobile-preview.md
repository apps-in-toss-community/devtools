---
"@ait-co/devtools": patch
---

unplugin: add a `tunnel` option (Vite dev only) that exposes the dev server via a
Cloudflare quick tunnel (`*.trycloudflare.com`, no account) and prints the public
URL + an ASCII QR in the terminal. Pair it with the new launcher PWA at
`https://devtools.aitc.dev/launcher/` to run the dev app full-screen on a real
phone — scan/paste the URL once per session; the launcher remembers the last URL.
`cloudflared` / `qrcode-terminal` are loaded only when the option is on. See
"Run on a real phone" in the README.
