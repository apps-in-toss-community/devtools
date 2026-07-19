---
'@ait-co/devtools': patch
---

failureModes에 soft-resolve 다이얼 추가 — grantPromotionReward/grantPromotionRewardForGame(`{errorCode,message}`)·getSubscriptionInfo(`{}`) 세 곳이 다이얼 켠 상태에서만 env3 프로비저닝-의존 soft-resolve shape로 resolve. 기본값은 선언 타입 성공 유지(zero behavior change). #785 close, payment는 #303 폰-gated로 제외(#789).
