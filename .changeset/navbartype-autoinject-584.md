---
'@ait-co/devtools': patch
---

env-2 deep-link에 webViewType→navBarType 자동 주입 (game 앱이 launcher에서 자동 game 모드로 진입) — `buildLauncherDeepLink`에 `webViewType:'game'` 옵션 추가, unplugin이 `printTunnelBanner`에 `webViewType`을 전달해 QR/터널 URL에 `&navBarType=game`이 자동 실린다 (#584).
