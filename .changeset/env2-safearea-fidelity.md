---
"@ait-co/devtools": patch
---

환경 2(AITC Sandbox PWA) 상단 safe-area fidelity 개선 (#484, slice 1+2).

- launcher PWA를 `apple-mobile-web-app-status-bar-style: black-translucent`로 전환 — standalone 웹뷰가 status bar 밑까지 확장돼 흰 띠 + 죽은 ~54px 공간이 사라진다(game-type 토스 표현에 근접). launcher 자체 UI는 `env(safe-area-inset-top)`을 스스로 패딩.
- letterbox 감지기(#469/#479)를 새 기하에 맞춰 재설계 — black-translucent에서는 healthy 창도 top inset이 0이 아니라서, 판별자를 top inset에서 bottom inset으로 역전(letterbox = 높이 부족 + bottom 0, healthy = 풀 높이 + bottom>0).
- launcher가 측정한 실 `env(safe-area-inset-*)` 4값을 framed page로 `postMessage({ type: 'ait:safe-area-insets', insets })` 전달(load·resize·orientationchange 시). framed page의 mock `SafeAreaInsets` 상태가 수신해 preset을 덮어쓰고 subscribe 이벤트를 발화한다. 수신 측은 type·숫자·범위(0~200) 검증, 비정상 메시지는 조용히 무시. 메시지 주도라 desktop 환경 1(launcher 없음)은 preset이 그대로 유지된다.
