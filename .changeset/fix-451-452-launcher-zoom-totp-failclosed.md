---
"@ait-co/devtools": patch
---

fix: launcher PWA URL input auto-zoom 방지(16px) + build_attach_url relay 모드 TOTP fail-closed (defense-in-depth)

- launcher PWA(`e2e/fixture/launcher/Launcher.tsx`) URL 입력 input의 font-size를 15px→16px로 올림. iOS Safari는 focus 가능 요소의 font-size < 16px이면 auto-zoom하므로, 16px이 트리거 자체를 막는 정석 해법 (#451).
- `build_attach_url` relay-mobile·relay-dev/live 경로에서 TOTP secret이 없으면 `at=` 없는 URL을 발급하는 대신 명시적 mcpError로 거부 (#452 defense-in-depth). `assertRelayAuthConfigured`가 relay boot 시 이미 방어하므로 dead code지만, 하류 fail-open 가지를 닫는다.
