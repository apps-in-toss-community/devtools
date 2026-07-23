---
'@ait-co/devtools': patch
---

in-app 디버그 indicator에 freeze/스피너 출처 판별 신호 3종 추가 — 실기기 스피너가 (i) 네이티브 브리지 호출 대기인지 (ii) 미니앱 자체 UI인지 (iii) JS 메인스레드 멈춤인지를 배지에서 한눈에 구별 (#749).

run7 사후, 사용자가 스피너 출처를 구별할 수 없다고 지적했으나 in-app 디버그 표면엔 판별 정보가 없었다. debug 빌드 한정으로 #804 배지(`buildIndicatorExpression`)를 확장해 세 신호를 노출한다:

- **Pending 브리지 호출**(`⏳ <API명> <경과>s`): 진행 중인 네이티브 호출을 API명·실시간 경과와 함께. 관측 지점은 새 `src/in-app/bridge-observer.ts`가 잡는다 — mock의 `observe()`/`aitState.sdkCallLog`는 **mock SDK만** 감싸므로 env3(실 토스 WebView) 실 SDK 호출을 못 본다(run7이 벌어진 지점). 모든 실 async 브리지 호출이 지나는 단일 choke point를 래핑한다: 3.0 라인은 `window.__appsInTossNativeBridge.callAsyncMethod`(네이티브 Promise 반환 → 한 훅에서 pending→settle 전체 수명), 2.x 라인은 단일 dispatcher가 없어 START를 `ReactNativeWebView.postMessage`, SETTLE을 `__GRANITE_NATIVE_EMITTER.emit('<m>/resolve|reject/<id>')`에서. version-agnostic — GA flip 2.x↔3.0에 흔들리지 않는다.
- **Main-thread 하트비트**: compositor 구동 pulse dot(`Element.animate`, JS jank 중에도 계속 도는 opacity 애니메이션) **+** JS 구동 `♥<beats>` 토큰(1 Hz `setInterval`). `CSS pulse 살아있음 + ♥ 정지 = JS 메인스레드 멈춤`. CSS 애니메이션은 compositor라 freeze여도 돌기 때문에 하트비트는 반드시 JS 구동이어야 한다는 이슈의 핵심 통찰을 그대로 반영. 오버헤드는 초당 텍스트 1회 write(레이아웃 thrash 없음).
- **마지막 SDK 호출 스탬프**(`last: <API명> <벽시계>`): 가장 최근 호출의 API명 + 시각. `⏳ 없고 하트비트 정상 = 앱 자체 UI`.

triage 매핑(`⏳ 대기 = 토스앱 스피너 · ♥ 정지 = JS 멈춤 · ⏳ 없고 ♥ 정상 = 앱 UI`)은 배지 `title` 툴팁에 명시.

- **#804 lifecycle 통합**: 1 Hz 인터벌은 컨트롤러(`c.hb`)에 저장되고 `c.stop()`(detach 시 호출)·self-dismiss 제거·노드 detach(다음 tick self-clear) 모두에서 정리 — detach 이후 타이머 leak 없음. `detachDebugSurface()`(attach.ts)가 배지 `stop()` + `uninstallBridgeObserver()`(브리지 래핑 복구 + `window.__ait_bridge` 제거)를 함께 수행.
- **SECRET-HANDLING**: API **명**과 타이밍만 노출 — 호출 인자/결과는 절대 기록·표시하지 않는다(토큰·URL·유저 데이터 유출 방지). outbound 파서는 `type`/`name`/`functionName`/`callbackId`/`eventId`만 읽고 `params`/`args`는 건드리지 않는다. relay wss/TOTP/tunnel 값은 배지 표현식에 전무.
- **debug 빌드 한정**: 전량 in-app 그래프(`maybeAttach` 경유)에 있어 release 빌드에서 DCE — `check:debug-surface-absent`(release 번들 0 bytes) green 유지, 프로덕션 영향 0.

env2(mock)/브리지 부재 컨텍스트에선 pending/last 라인이 비고 하트비트만 렌더돼 graceful. 실기기 triage 실효성 검증은 폰-게이트라 다음 env3 세션에서 확인 예정.

Refs #749.
