---
'@ait-co/devtools': patch
---

stable peer를 2.8.0 라인까지 확장(`>=2.6.0 <3.0.0`) + mock을 web-framework 2.8.0·3.0-beta 두 라인 모두에 대해 컴파일 타임 검증(dual-line typecheck). `web-framework-2x` devDep alias(`npm:@apps-in-toss/web-framework@2.8.0`)와 `tsconfig.2x.json`·`__typecheck-2x.ts`를 추가해 `pnpm typecheck`가 양 라인을 모두 돈다. 라인별 표면 차이(2.x 부재 base `PermissionError` 1개)는 `AssertIfPresent`로 capability-gate (#583).
