---
"@ait-co/devtools": patch
---

env 2·3·4 폰 화면 in-page 콘솔 추가 — eruda를 `maybeAttach()`의 gate 통과 직후 Chii target.js 주입과 나란히 마운트한다. 데스크톱 F12가 없는 모바일(env 2 PWA WebKit, env 3·4 토스 WebView)에서 폰 화면의 console/network/DOM/storage를 직접 본다. 디버그 코드는 소비자의 `if (__DEBUG_BUILD__)` 가드로 release 빌드에서 DCE되어 0 bytes로 사라지고(Vite/rolldown 검증), 들어간 디버그 빌드에서도 host allowlist + `debug=1` + relay + TOTP 4겹 gate를 그대로 상속한다 (#647)
