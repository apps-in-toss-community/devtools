---
"@ait-co/devtools": patch
---

test-runner: run_tests 번들 경로의 두 독립 버그 수정 (#678)

1. **getRuntimePath의 co-location 가정 붕괴.** `getRuntimePath()`가 `import.meta.url` 기준으로 co-located `runtime.js`만 탐색하던 것을, 없으면 `../test-runner/runtime.js`(sibling 디렉토리)도 순서대로 시도하도록 확장했다. `dist/mcp/cli.js` 진입에서는 co-located 경로가 존재하지 않아 esbuild "Could not resolve" 오류가 발생하며 `run_tests`가 전부 실패하던 문제를 해결한다.

2. **userFactoryPlugin이 multi-line import를 정확히 top-level 블록으로 유지.** 줄 단위 휴리스틱이 한 줄로 안 닫히는 `import { … } from '…'`(멤버를 줄마다 나열한 형태)를 분해해, 멤버 줄과 닫는 `} from '…'` 줄이 factory body로 새어 들어가던 문제를 수정했다. 그 결과 top-level에 닫히지 않은 `import {`가 남아 esbuild가 `Expected "as"`를 던졌다 — env3 run_tests에서 multi-line SDK import를 쓰는 테스트 파일이 전부 깨지던 원인이다. import/re-export 문이 종결될 때까지 한 블록으로 묶어 top-level에 유지한다.
