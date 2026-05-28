---
'@ait-co/devtools': patch
---

partner safe-area 모델 정정 — 실기기 fidelity 맞춤(#275).

- `computeSafeAreaInsets` portrait top=0으로 정정. 토스 native nav bar는 partner WebView viewport 밖이라 SDK top=54는 정보용 — 소비자가 padding으로 적용하면 double-count. mock도 top=0을 반환해 실기기와 같은 결과를 낸다.
- `applyViewport` body `padding-top` 주입 제거. 실기기 WebView는 top=0부터 콘텐츠 시작.
- `computeSafeAreaInsets` 시그니처에서 `navBarVisible`/`navBarType` 파라미터 제거 (top이 0 고정이라 불필요).
- iPhone 15 Pro preset `height` 852→754. 실측: partner type innerHeight=754(native chrome 98pt가 WebView 바깥).
- fidelity-QA whitelist의 safe-area 항목 reason 갱신.
