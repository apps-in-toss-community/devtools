---
'@ait-co/devtools': patch
---

launcher PWA를 홈 화면 설치 상태에서만 동작하도록 게이팅하고, 터널 QR을 `…/launcher/?url=<tunnel>` 딥링크로 인코딩해 스캔 한 번으로 자동 진입하도록 변경했습니다. 로컬 dev(`http://localhost`)에서는 게이팅이 풀려 e2e 픽스처가 그대로 동작합니다.

Gate the launcher PWA to its installed home-screen context (browser-tab visitors now see only the install hint, with the input and scanner hidden) and encode the tunnel QR as a `…/launcher/?url=<tunnel>` deep-link so a single scan auto-opens the dev URL. The gate is relaxed on `http://localhost` so the bundled e2e fixture keeps working in a normal tab.
