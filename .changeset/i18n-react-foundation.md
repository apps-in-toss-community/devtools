---
'@ait-co/devtools': patch
---

사용자 대면 표면 전면 React 전환의 토대를 추가한다 (#413). 기존 vanilla i18n 코어(`src/i18n`) 위에 React 반응성 레이어 `src/i18n/react.ts`(`useLocale`/`useT`, `useSyncExternalStore`로 `LOCALE_CHANGE_EVENT` 구독)를 얹어 두 번째 i18n 시스템 없이 React 표면이 locale 변경에 리렌더하도록 한다. `useT`는 `(key: StringKey, …)` 시그니처를 유지해 `ko.ts` 타입 소스 → `en.ts` typecheck-enforced mirror 안전망이 JSX 호출부까지 전파된다. navigator가 없는 Node 표면(qr-http-server)을 위해 `parseAcceptLanguage`(Accept-Language 헤더 → locale)와 `resolveLocaleStrings`(동일 169키 카탈로그를 공유하는 locale-bound resolver)를 같은 모듈에 더한다. 루트 tsconfig에 `jsx: react-jsx`를 켜고 react-dom·@testing-library/react·@vitejs/plugin-react를 devDependency로만 추가한다(install-graph 불변식 유지 — `dependencies`엔 react가 없다). MCP 데몬 번들(`dist/mcp/cli.js`·`dist/mcp/server.js`)이 react를 import하지 않음을 빌드 후 강제하는 CI 가드(`scripts/check-mcp-react-free.sh`)를 추가한다. 이 PR은 순수 가산 토대로, 어떤 표면도 아직 변환하지 않으며 기존 테스트는 모두 green이다.
