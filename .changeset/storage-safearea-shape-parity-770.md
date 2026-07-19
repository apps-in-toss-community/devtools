---
'@ait-co/devtools': patch
---

Storage 3종·getSafeAreaInsets 반환 shape를 실기기 실측과 동치시킴

`Storage.setItem`/`removeItem`/`clearItems`는 `undefined`가 아니라 `null`로 resolve하고,
`getSafeAreaInsets()`는 숫자가 아니라 `{ top, right, bottom, left }` 객체를 반환한다 —
둘 다 실기기(2.x×iOS) capture 실측에 맞춘 것으로, 상류 SDK 타입 선언은 그대로 두고
런타임 반환값만 정렬했다.
