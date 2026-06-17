---
'@ait-co/devtools': patch
---

unplugin: in-app attach(`@ait-co/devtools/in-app` → `maybeAttach()`)를 panel 주입과 같은 transform 지점에서 게이트된 dynamic import로 자동 주입한다. 소비자가 `main.tsx`에 수동으로 배선하지 않아도 `?debug=1&relay=` 파라미터 존재 시 relay attach가 동작한다(#465, sdk-example#162 silent seam break 재발 방지). `inApp: false`로 비활성화 가능.
