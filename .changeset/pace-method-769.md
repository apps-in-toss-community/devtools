---
'@ait-co/devtools': patch
---

테스트 러너 sdkRedirect 계층에 per-method 최소 간격 pacing을 추가 (#769). #767의 `--pace`는 테스트 간·파일 간 간격이라 한 테스트 BODY 안의 같은-메서드 연타(예: clipboard happy 루프의 `setClipboardText`/`getClipboardText` 8연타)에는 무력해, 2.x×iOS 실측(sdk-example#293)에서 그 burst 자체가 네이티브 per-method rate limit(`APP_BRIDGE_THROTTLED`)을 포화시켰다. 새 `--pace-method <ms>`(`AIT_PACE_METHOD` env 폴백) 플래그를 신설해 `bundle.ts`의 sdkRedirect 가상 모듈에서 `window.__sdk[name]` 함수 접근을 per-name pacing wrapper로 감싼다 — 페이지 글로벌 레지스트리(`__AIT_METHOD_PACE_STATE__`)에 메서드별 마지막 호출 시각을 저장하고, 호출 전 경과 시간이 간격보다 짧으면 그만큼 대기한 뒤 실제 호출을 수행한다. 결과/rejection은 그대로 통과하고, 클래스 export(`PermissionError` 등)는 `new` 호출이 깨지지 않도록 pacing 대상에서 제외한다. `--cell-sdk-line 2.x`(미지정 시 기본값도 2.x)에서는 기본 250ms(preflight가 이미 실증한 안전 간격), 그 외에는 기본 0 — 명시 플래그가 항상 우선이라 `--pace-method 0`으로 opt-out 가능. `bridge-stub.ts`(devtools#740)와의 합성 순서는 pacing이 stub 판정보다 안쪽(`wrapSdkWithStub(wrapWithMethodPacing(sdk, gap), enabled)`) — 스텁된 이름은 fixture로 즉시 응답하고 pacing 지연을 겪지 않는다.
