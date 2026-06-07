---
'@ait-co/devtools': patch
---

e2e fixture(`e2e/fixture/`)를 vanilla DOM에서 client-side React 19로 전환한다 (#413 PR4). `helpers.ts`의 `apiSection`/`apiButton`/`apiInput`/`apiValue`/`apiSubscriber` DOM 헬퍼를 React 컴포넌트(`components.tsx`)로 재구현하되 emit하는 DOM 구조와 `data-testid` 계약(`section-<id>`, `<id>-btn`, `<id>-result`, `<id>-input`, `<id>-value`, `<id>-log`, `<id>-empty`)을 byte-identical로 유지한다. `main.ts` 549줄 IIFE 블록을 `main.tsx` JSX로 변환하고 `createRoot`로 마운트한다. `@ait-co/devtools/panel` import 최상단 순서와 ENV-2 CDP gate(`?debug=1&relay=` → `@ait-co/devtools/in-app` dynamic import) 블록을 그대로 보존한다. `pnpm test:e2e` 40/40 무수정 통과 확인. fixture는 npm 패키지에 포함되지 않으므로 package surface 변경 없음.
