---
"@ait-co/devtools": patch
---

fix: QR open in browser reliability + headless fallback (#288)

- `open_in_browser=true`인데 GUI 없는 환경(headless/remote)이면 자동으로 text QR fallback으로 폴백 + 안내 메시지
- 브라우저 열기 실패 시 `openResult: { attempted, succeeded, failureReason?, pngUrl? }` 구조화 필드를 응답에 포함해 에이전트가 실패 원인 파악 가능
- `openQrInBrowser` retry 1회 추가 (ephemeral process launch 타이밍 문제 대응)
- `canOpenBrowser()` 결과를 요청당 1회만 평가해 일관성 보장
- 기존 `브라우저 자동 열기에 실패했습니다` 안내에 `[open_in_browser]` prefix 추가로 구분
