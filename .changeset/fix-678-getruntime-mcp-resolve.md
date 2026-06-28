---
"@ait-co/devtools": patch
---

test-runner: getRuntimePath가 dist/mcp/cli.js 진입에서도 runtime.js를 resolve하도록 — co-location 가정 붕괴 수정 (#678)

`getRuntimePath()`가 `import.meta.url` 기준으로 co-located `runtime.js`만 탐색하던 것을, 없으면 `../test-runner/runtime.js`(sibling 디렉토리)도 순서대로 시도하도록 확장했다. `dist/mcp/cli.js` 진입에서는 co-located 경로가 존재하지 않아 esbuild "Could not resolve" 오류가 발생하며 `run_tests`가 전부 실패하던 문제를 해결한다.
