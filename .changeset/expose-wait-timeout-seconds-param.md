---
"@ait-co/devtools": patch
---

`build_attach_url` 도구에 `wait_timeout_seconds` param 추가 — `wait_for_attach=true` 시 대기 시간을 1–600 s 범위에서 조절 가능 (default 60 s). 유효 범위 밖 입력(0/음수/NaN/비숫자)은 에러 없이 default로 폴백. `deps.waitForAttachTimeoutMs` 기본값을 90 000 ms → 60 000 ms로 정정, 도구 description의 stale "polls up to 30 s" 문구를 "default 60 s, wait_timeout_seconds로 조절"로 갱신.
