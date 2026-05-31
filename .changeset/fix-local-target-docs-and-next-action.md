---
"@ait-co/devtools": patch
---

fix(docs/mcp): `--mode=local` docs 정정 + local-target nextRecommendedAction 분기 (#321 #325)

- docs의 `--mode=local` 표기를 올바른 `--target=local`(`--mode=debug --target=local`의 단축형)으로 일괄 정정 (`docs/scenarios/env-1.md`, `docs/qa/scenarios.md`)
- `computeNextRecommendedAction`에 env 분기 추가: local-target(mock env)에서 `tunnel.up=false`는 정상 상태이므로 "restart" 대신 `wait_for_page`를 반환하도록 수정 — relay env에서만 tunnel down → restart 유지
