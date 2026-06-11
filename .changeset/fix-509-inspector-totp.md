---
"@ait-co/devtools": patch
---

대시보드 탭 stale + idle TOTP 만료 해소 — attach 워처 연속 감지 + 주기 SSE 갱신 (#509)

① **대시보드 탭 stale 해소** — `startAttachWatcher`가 기존 one-shot(0→N 한 번 발화 후 interval 정지)에서 **target-id 시그니처 연속 감지**로 전환됐다. 이제 interval이 계속 돌면서 target 교체(1→1, id 변경 — rescan 등)나 detach 후 재attach 때도 콜백(`recordAttach` + `onPageAttach` → `qrServer.notifyStateChange()`)이 발화한다. 결과: 열려 있는 대시보드 브라우저 탭이 SSE를 통해 새 target id + 신선한 TOTP 링크를 받게 된다.

② **idle 탭 TOTP 만료 방지** — `startQrHttpServer`가 `sseRefreshIntervalMs`(기본 90,000ms) 주기로 SSE 구독자에게 상태를 push한다. `getDashboardState()` 호출 시점에 `at=` TOTP 코드가 재발급되므로, push 자체가 열린 탭의 인스펙터 링크를 신선하게 유지한다. 90s 주기 < relay gate 허용창 ~3분(±6 steps)이므로 탭이 열려 있는 한 링크가 항상 유효하다.

③ **inspector URL fail-closed (defense-in-depth 유지)** — `buildChiiInspectorUrl`이 `mintTotp` getter 없으면 `null`을 반환하는 기존 결함 A 대책은 그대로 유지된다. 살아있는 세션에서 relay 링크를 클릭했을 때 죽은 링크 대신 대기 안내를 보여주는 방어 계층이다.
