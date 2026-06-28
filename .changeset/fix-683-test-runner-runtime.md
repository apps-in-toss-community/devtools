---
"@ait-co/devtools": patch
---

env3 test-runner 런타임 수정 — sdk-example `.ait.test.ts`가 쓰는 `toMatchObject`/`toHaveProperty`/`toBeInstanceOf`/`toBeTypeOf` matcher 4종, `beforeAll`/`afterAll`/`beforeEach`/`afterEach` lifecycle hook, `vi.spyOn`/`vi.fn`/`vi.restoreAllMocks` shim을 runtime에 추가했습니다. bundle에 `vitest` redirect 플러그인을 추가해 `import { ... } from 'vitest'`가 globalThis globals로 연결되도록 했습니다.
