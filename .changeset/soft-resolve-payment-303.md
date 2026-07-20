---
'@ait-co/devtools': patch
---

soft-resolve 다이얼에 payment 두 곳(checkoutPayment/requestTossPayPaysBilling) 배선 — 다이얼 켠 상태에서만 env3 미프로비저닝 결제 shape `{ false, reason }`(valueKeys=['false','reason'], booleanValues=null)로 resolve. 기본값은 선언 타입 `{ success }` 유지(zero behavior change). 이 shape의 리터럴 `false` 키가 하네스 artifact가 아니라 실기기 WebView 관측값임을 코드로 확정(capture는 relay 개입 전 WebView 안 Object.keys로 계산 — capture.ts) → 폰 재측정 없이 재현 가능. Refs #303, #789 payment 범위.
