---
"@ait-co/devtools": patch
---

fix(test-runner): bundle.ts에 runtime.ts 포함 — describe is not defined 수정 (#656)

`bundleTestFile`이 사용자 테스트 파일만 번들링하고 `runtime.ts`를 포함하지 않아 WebView에서 `describe is not defined` 오류가 발생하는 버그를 수정한다.

- `userFactoryPlugin` 추가: 사용자의 최상위 테스트 등록 코드(`describe/it/test` 호출)를 `__userFactory` async 함수로 래핑해 `runTestModule`이 글로벌을 설치한 뒤 실행되도록 함.
- esbuild `stdin` 래퍼로 runtime.ts와 사용자 팩토리를 단일 IIFE에 함께 번들링.
- `footer` 옵션으로 `globalThis[globalName]` 명시 할당 — rpc.ts의 async IIFE 래퍼 안에서도 globalThis 접근 가능.
- `rpc.ts`: `runTestModule(globalThis.__testBundle.__userFactory)` 호출로 팩토리 전달.
- `e2e/run-tests-integration.test.ts`: 실제 Chromium + 실제 LocalCdpConnection으로 전체 파이프라인을 검증하는 회귀 방지 테스트 추가 (mock 없음).
