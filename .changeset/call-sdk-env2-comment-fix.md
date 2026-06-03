---
"@ait-co/devtools": patch
---

`call_sdk` 도구 description(에이전트 노출 문자열)에서 환경 2 가용성 서술 모순을 정정했다. 기존 `(env 2 PWA does not inject the SDK — call_sdk is not available there.)`는 code ground truth(`callSdkMethod` JSDoc) 및 docs 4곳과 정반대였다 — `call_sdk` descriptor는 `availableIn: 'both'`라 환경 2에서 tier-gating으로 막히지 않고, 환경 2 relay(`kind:'relay'`)를 타고 폰 PWA iframe의 mock SDK에 닿는다. description을 정합화: `on env 1 (local mock) and env 2 (PWA relay — real WebKit, mock SDK) it hits the mock SDK.` 환경 2를 client로 운전하는 MCP-attach 진입은 별개 관심사로 `start_debug({mode:'mobile'})`(#378)이 담당하며, tool 가용성 서술과 혼동하지 않는다.
