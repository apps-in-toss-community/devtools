---
"@ait-co/devtools": patch
---

fix(launcher): standalone 인앱 QR 스캔 경로에서 selfdebug 미발동 수정 (#535)

standalone PWA(홈 화면 앱)에서 인앱 QR 스캔으로 `selfdebug=1` + `relay=<wss>` URL을 읽을 때도 `injectSelfTarget()`을 호출한다. start_url 부팅(쿼리 없음)이라 `maybeAttachSelf()`가 발동하지 않는 경로를 `showLive()`에서 보완. selfdebug 모드에서는 iframe에 CDP 파라미터를 포워딩하지 않아 이중 attach를 방지한다(option a). `selfAttached` 가드가 중복 스캔 시 단일 주입을 보장. `parseSelfDebugFromScannedUrl` 순수 함수 추가 + vitest 커버리지 확장.
