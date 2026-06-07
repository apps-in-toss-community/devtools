---
'@ait-co/devtools': patch
---

qr-http-server 대시보드/attach 페이지에 Accept-Language i18n 적용 및 React 빌드타임 precompile 전환 (#413)

- `buildDashboardHtml`·`buildAttachHtml` HTML을 React JSX + `renderToStaticMarkup`으로 빌드타임에 precompile해 `src/mcp/dashboard.generated.ts`(plain string exports)로 커밋
- 런타임 `qr-http-server.ts`는 생성된 string만 import — react/react-dom을 정적·동적으로 절대 import하지 않음, INSTALL-GRAPH 불변식 유지
- `GET /`·`GET /attach` 요청에서 `Accept-Language` 헤더를 읽어 per-request locale 결정 (`parseAcceptLanguage()`); ko·en 문자열을 공유 i18n 테이블(`ko.ts`/`en.ts`)에서 해결
- ko.ts/en.ts에 dashboard·attach 전용 키 추가(`dashboard.*`, `attach.*` 32개)
- `pnpm build:dashboard-html` 스크립트 추가 (빌드 체인에 tsdown 앞에 자동 실행), `check:dashboard-html-fresh` CI 가드 추가
- `check-mcp-react-free.sh` 가드: `dist/mcp/cli.js`·`dist/mcp/server.js` react 유입 없음 확인
