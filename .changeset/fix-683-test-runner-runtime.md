---
"@ait-co/devtools": patch
---

env3 test-runner 런타임 수정 — sdk-example `.ait.test.ts`가 쓰는 `toMatchObject`/`toHaveProperty`/`toBeInstanceOf`/`toBeTypeOf` matcher 4종, `beforeAll`/`afterAll`/`beforeEach`/`afterEach` lifecycle hook, `vi.spyOn`/`vi.fn`/`vi.restoreAllMocks` shim, `it.skipIf`/`it.runIf` 조건부 등록을 runtime에 추가했습니다. bundle에 `vitest` redirect 플러그인을 추가해 `import { ... } from 'vitest'`가 접근 시점(call-time) globalThis getter로 연결되도록 했습니다 — 번들 평가 시점이 아니라 runtime이 globals를 설치한 뒤 해소되므로 테스트가 정상 등록됩니다.
