---
'@ait-co/devtools': patch
---

launcher PWA를 vanilla DOM에서 client-side React로 전환하고 ko/en i18n을 적용합니다(#413 일부).

- `e2e/fixture/launcher/main.ts` → `main.tsx`로 전환, `createRoot`로 `<Launcher/>` 마운트
- `e2e/fixture/launcher/Launcher.tsx` 신규: 모든 data-testid 계약 보존, QrScanner/pwa-install ref·effect 배선, iframe src prop, localStorage 효과, 서비스워커 등록을 React 패턴으로 재구현
- `entry.ts` 순수 함수 무수정 유지 — entry.vitest.ts 7개 테스트 무변경 통과
- `src/i18n/ko.ts`·`en.ts`에 `launcher.*` 키 12개 추가(StringKey 타입 확장, en mirror parity 유지)
- `e2e/fixture/vite.config.ts`에 `@vitejs/plugin-react` 추가
- `e2e/fixture/tsconfig.json`: JSX 설정 포함 독립 tsconfig로 재작성, `src/i18n/**` 포함
- `launcher/index.html`을 `<div id="root">` shell로 단순화
