---
'@ait-co/devtools': patch
---

`devtools-test` runner의 on-device expect shim에 `toHaveLength(n)` matcher를 추가한다 — Vitest 의미론과 동일하게 `received.length === n`을 배열·문자열·유사배열에 대해 검사한다. 그동안 미구현이라 `expect(arr).toHaveLength(n)`을 쓰는 소비자 테스트가 env1(Vitest)에서는 통과하고 env3(실기기 runner)에서만 `toHaveLength is not a function`으로 실패했다 — harness 결함이지 device 발견이 아니었는데도 env3 리포트의 fail 카운트를 오염시켰다.

`src/test-runner/runtime.ts`의 `Expectation` 클래스에 매칭 케이스(성공/실패/`not.toHaveLength`/길이 없는 receiver)를 추가하고, `src/__tests__/test-runner-runtime.test.ts`에 회귀 테스트를 추가했다.

검증: `pnpm build`·`pnpm typecheck`(4개 라인)·`pnpm test`(113 files / 2571 tests)·`pnpm lint` 모두 EXIT:0.
