---
'@ait-co/devtools': patch
---

feat(gate): env 4 제거 + positive-allowlist kill-switch (#665)

relay-live (env 4 — 프로덕션 WebView)와 LIVE guard(`liveIntent`/`confirm` 게이트)를 완전 제거하고 positive-allowlist kill-switch로 교체한다.

**변경 요약:**

- `isDebugAllowedHost(hostname)` 함수 추가 — 허용 호스트: localhost/loopback, `*.trycloudflare.com` (env 2), `*.private-apps.tossmini.com` (env 3). `apps.tossmini.com` (env 4 LIVE)는 허용 목록에 없어 차단.
- `McpEnvironment`: `'relay-live'` 제거 → 3-value union (`mock | relay-dev | relay-mobile`).
- `StartDebugMode`: `'relay-live'` 제거 → 3-value union.
- `ConnectionRouter.switchMode`: `confirm: boolean` 파라미터 제거.
- `ModeSwitchReport.liveGuardActive`: 필드 제거.
- `deriveEnvironment`: `liveIntent` 파라미터 제거, 2-param 시그니처.
- `liveIntent`/`getLiveIntent`/`setLiveIntent`/`seedLiveIntentFromEnv`/`isLiveRelayEnv`/`liveGuardError` 완전 삭제.
- `evaluate`/`call_sdk`/`run_tests` 핸들러: LIVE guard → `connectionHostsAllowed(conn)` positive-allowlist 검사로 교체.
- `DiagnosticsResult.environment.liveGuardActive`: `false` literal 타입으로 고정 (`@deprecated`).
- `in-app/auto.ts`: `isDebugAllowedHost` 체크 추가 — 허용 호스트 아니면 dormant.
- `in-app/gate.ts`: Layer B1에 `isDebugAllowedHost` 체크 통합.

**SECRET-HANDLING:** hostname 값은 로그에 절대 출력하지 않음 — allowlist 검사 결과(boolean)만 사용.
