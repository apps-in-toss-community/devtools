---
'@ait-co/devtools': patch
---

launcher: 미니앱이 webViewType을 self-report해 game 모드로 자동 진입 — 수동 navBarType URL 편집 제거. 미니앱이 `{ type: 'ait:web-view-type', value }`를 부모 launcher에 postMessage하고(in-app self-report), launcher가 game 타입에서 자동으로 game 모드로 전환한다. unplugin은 `webViewType` 옵션으로 `__WEB_VIEW_TYPE__` 빌드 상수를 Vite define으로 주입한다(granite.config.ts 자동 읽기는 TS 로더가 필요해 명시 옵션으로 보류, 기본값 `'partner'`) (#580).
