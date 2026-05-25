---
"@ait-co/devtools": patch
---

feat(mock): sdkCallLog 관측 layer + no-op API 일괄 가시화 (#195)

`aitState`에 구조화된 `sdkCallLog` slice(ring buffer, 상한 200)와 `logSdkCall`을 추가하고, 시그니처를 보존하는 `observe(apiName, fidelity, fn)` 래퍼를 도입한다. MCP `AIT.getSdkCallHistory`가 이 로그를 실제 데이터 소스로 읽는다. proxy는 기본 throw를 유지하되 `KNOWN_UNIMPLEMENTED` 이름만 🔴(inert) 기록 후 no-op 반환한다. 패널 Analytics 탭에 fidelity 뱃지(🟢/🟡/🔴) SDK Calls 뷰 추가.
