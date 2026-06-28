---
"@ait-co/devtools": patch
---

feat: `start_attach` 단일 통합 MCP tool — `build_attach_url` 대체 + 호출 안 attach 대기 + TOTP 자동 재발행

기존 `build_attach_url`(QR/deep-link 합성) + 별도 attach 폴링의 2호출 흐름을 `start_attach` 단일 tool로 합쳤다. `start_attach`은 attach URL을 합성해 QR을 띄운 뒤 **같은 호출 안에서 폰이 attach될 때까지 대기**하고, 그동안 TOTP 코드를 자동 재발행한다.

- **단일 진입 tool**: `build_attach_url`을 완전히 대체. descriptor는 bootstrap·`availableIn: 'relay'` 유지.
- **`mode` 인자**: `local-browser` | `relay-sandbox` | `relay-staging` enum. mode를 주면 `start_debug`처럼 세션 환경을 함께 전환한 뒤(per-call 스냅샷으로 active connection·env 재캡처) 그 환경 기준으로 attach를 진행한다. relay 환경이 아니면 거부한다.
- **기본 attach 대기**: `wait_for_attach` 인자는 제거됐고, 대기가 기본 동작이다(`wait_timeout_seconds`, 1–600s, 기본 60s로 조절). attach되면 호출이 그대로 페이지 목록을 반환한다.
- **TOTP 호출-내 자동 재발행**: 대기를 30초 세그먼트로 쪼개고, 코드가 relay 검증 창(±6 step = 180s)에 가까워지면(150s 경과) 새 코드로 URL을 재합성해 대시보드 QR을 갱신한다. 재발행 횟수는 결과의 `totp.reminted`로 노출된다(최대 ~4회/600s). 대기 중 수동 재호출 불필요.

SECRET-HANDLING 유지: TOTP 코드 값·tunnel host·relay wss·hostname은 stdout/log/tool-result/에러에 노출하지 않는다. tool-result의 `totp` 블록은 `expiresAt` + `reminted`만 싣고, 코드는 attachUrl(QR 페이로드)·`127.0.0.1` 대시보드 안에만 존재한다.

모든 검증 게이트(typecheck·test·lint·build·check:mcp-react-free·check:debug-surface-absent·check:dashboard-html-fresh) 통과.
