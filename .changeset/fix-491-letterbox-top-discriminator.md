---
"@ait-co/devtools": patch
---

fix(launcher): letterbox 판별자를 #479 top-inset 규칙으로 복원 — phantom bottom 실측 반영 (#491)

실기기 측정(iPhone, iOS 18.7, 2026-06-11): launcher 재설치 직후 cold start에서 letterbox 상태(innerHeight 797 vs screen 844, shortfall 47)임에도 `safeAreaBottom`이 0이 아니라 phantom 34를 보고 — #487이 도입한 `safeAreaBottom===0` 판별자가 false-negative를 냄.

원인: `safeAreaBottom`은 healthy 상태와 letterbox 상태 **모두**에서 phantom 34를 보고하므로 신호가 없다. #487이 가정한 "letterbox에서 bottom이 0으로 붕괴"는 실기기에서 반증됨.

변경:

- `letterbox.ts`: 판별자를 `standalone && portrait && shortfall >= 24 && safeAreaTop > 0`으로 복원 (#479 규칙). `safeAreaBottom`을 판별자에서 완전 배제. black-translucent 하에서 healthy window는 shortfall이 없으므로 top>0 규칙의 false-positive는 성립 불가 — #487의 우려는 shortfall 요건과 결합하면 해소된다. 5-케이스 분석 표를 헤더 주석에 추가.
- `letterbox.ts`: `computeBridgeInsets()` 순수 함수 추가 — letterbox 감지 시 bridge 전달 insets의 bottom을 0으로 보정 (창이 home indicator에 못 닿으므로 앱 패딩 불필요; top은 그대로). `SafeAreaInsets` interface도 함께 export.
- `Launcher.tsx`: `postSafeAreaInsetsTo()`가 `computeBridgeInsets()`를 통해 보정된 insets를 전달하도록 수정.
- `letterbox.vitest.ts`: 실측 기반으로 픽스처 재정정 — 오늘 실측(797/844, top 47, bottom 34) → detected=true, 신메타 healthy(shortfall 0) → false, bottom 값이 0/1/34/99 무관하게 판정에 영향 없음 명시. `computeBridgeInsets()` 테스트 추가.

이 변경은 #487 변경분의 부분 정정이다.
