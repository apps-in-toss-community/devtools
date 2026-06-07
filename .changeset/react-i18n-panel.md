---
'@ait-co/devtools': patch
---

Floating DevTools Panel을 vanilla DOM에서 client-side React 19로 전환하고 i18n을 반응형으로 만든다. locale 변경 시 패널을 disposePanel→mount로 다시 마운트하지 않고, `useT()`(i18n store 구독)로 패널 subtree만 제자리에서 다시 렌더한다 — 현재 탭과 토글 버튼 위치가 그대로 유지된다. 패널 chrome(토글/헤더/배지/탭바/바디)만 React로 바꾸고 탭 본체는 명령형 렌더러로 유지하며, React는 `dist/panel/index.js`에 번들된다(published `dependencies`에는 들어가지 않음). `e2e/panel.test.ts`가 의존하는 CSS 클래스/속성 계약은 그대로 보존된다.
