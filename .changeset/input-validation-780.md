---
'@ait-co/devtools': patch
---

mock이 잘못된 입력을 조용히 통과시키던 3건을 실기기(env3) 거부 동작에 맞춰 수정 (#780). env1(mock)↔env3(실기기 토스 WebView) capture diff 실측에서, 성공/실패 자체가 갈리는 발산 3건을 찾았다 — 반환 shape 불일치(#770/#775/#779)와 달리 dev에서 통과한 코드가 실기기에서 reject된다는 점에서 개발자에게 가장 비싼 부류다. `getTossShareLink`는 scheme 없는 bare path(`/some/path`)를, `generateHapticFeedback`은 `HapticFeedbackType` union 밖의 알 수 없는 `type`을, `GoogleAdMob.isAppsInTossAdMobLoaded`는 형식이 잘못된(빈 문자열/공백뿐) `adGroupId`를 이제 실기기와 동일하게 reject한다(각각 `errorCode: EXECUTION_ERROR`/`EXECUTION_ERROR`/`INVALID_REQUEST`). 세 곳 모두 평범한 `new Error(...)`에 `.errorCode`를 붙여 던진다 — 캡처 하네스가 `errorName`을 `err.constructor.name`에서 뽑는데 실기기 실측이 `errorName: "Error"`이기 때문에, `Error` 서브클래스를 쓰면 오히려 새 불일치가 생긴다.
