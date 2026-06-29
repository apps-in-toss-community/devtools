---
"@ait-co/devtools": patch
---

getRuntimePath가 rolldown이 dist/ 루트로 hoisting한 공유 chunk에서 runtime.js를 못 찾던 회귀(#697 노출)를 depth-robust probe로 수정. env3 run_tests/devtools-test 빌드 실패 해소.
