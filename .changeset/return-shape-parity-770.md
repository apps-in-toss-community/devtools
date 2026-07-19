---
'@ait-co/devtools': patch
---

env1↔env3 반환-shape 동치 — analytics 4건 null resolve + setClipboardText { text } 반환 (#770). env1(mock)↔env3(실기기 2.x×iOS) capture 전수 diff에서 mock이 실기기와 다른 값으로 resolve하던 5건을 실기기 관측에 맞춘다: `eventLog`·`Analytics.click`·`Analytics.impression`·`Analytics.screen`은 mock이 `undefined`로 resolve했으나 실기기는 `null`로 resolve한다. `setClipboardText`도 mock이 `undefined`로 resolve했으나 실기기는 `{ text: <설정한 문자열> }` 객체로 resolve한다(returnType: "object", valueKeys: ["text"]). 원본 SDK 타입 선언은 두 라인(2.x·3.0-beta) 모두 `Promise<void>`이므로 시그니처는 그대로 유지하고 런타임 반환값만 캐스트해 실측과 동치시켰다 — `pnpm typecheck`의 두 라인 `AssertCompat` 모두 통과.
