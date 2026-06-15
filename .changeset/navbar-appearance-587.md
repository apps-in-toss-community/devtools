---
'@ait-co/devtools': patch
---

env-2 launcher가 navigationBar transparentBackground/theme(SDK 2.8.0)를 host chrome으로 재현 + deep-link 자동 주입 — `buildLauncherDeepLink`에 `navBarTransparent`/`navBarTheme` 옵션 추가, unplugin Options에 두 필드 추가, launcher partner bar가 투명 배경 + light/dark 전경 테마를 지원하며 `&navBarTransparent=1`/`&navBarTheme=<v>`로 QR/터널 URL에 자동 실린다 (#587).
