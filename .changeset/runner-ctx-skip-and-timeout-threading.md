---
"@ait-co/devtools": patch
---

fix(test-runner): 러너 shim ctx 미전달 + CLI --timeout 미반영 수정 (#746, #747)

**FIX 1 (#746, ctx 미전달)**: sdk-example run7(2.x 실기기) 관측 — `it('...', async (ctx) => { ctx.skip(cond, note); ... })` 패턴이 env1(진짜 vitest)에선 통과하지만 env3 러너 shim에선 `undefined is not an object (evaluating 'ctx.skip')`로 fail(camera 1F, contacts 1F). 원인: `runtime.ts`의 in-page shim `it` 구현이 테스트 함수를 인자 없이 호출해 vitest 4 호환 task context가 전달되지 않았다. 수정: 각 테스트 실행 시 최소 vitest 4 호환 context(`{ skip(cond?, note?), task: { name } }`)를 생성해 첫 인자로 전달. `ctx.skip()`(무인자)은 무조건 skip, `ctx.skip(cond, note)`는 cond가 truthy일 때만 skip — 내부 sentinel(`InPageSkipSentinel`)을 throw해 테스트 바디를 즉시 중단하고, 러너가 이를 캐치해 `fail`이 아닌 `skip`으로 기록한다(note는 `TestResult.note` 신규 필드에 실림). cond가 falsy면 스킵 없이 바디가 계속 진행된다.

**FIX 2 (#747, CLI --timeout 미반영)**: `--timeout` 기본 60s(#732)에도 파일 evaluate가 여전히 `CDP 명령이 타임아웃됐습니다 (Runtime.evaluate, 30000ms)`로 30초에 죽는 현상. 원인: `rpc.ts`의 JS-side race는 caller의 `timeoutMs`(60s)를 쓰지만, 그 아래 `chii-connection.ts`의 `sendCommand()` 자체 watchdog(`commandTimeoutMs` 기본 30s)이 먼저 발동해 rpc-level race를 무력화했다. 수정: `CdpConnection.send`/`ChiiCdpConnection.sendCommand`에 `opts.timeoutMs` per-call override를 추가하고, `injectAndRunBundle`(rpc.ts)이 파일-evaluate 예산(+5s 여유)을 그 override로 흘려보내 connection watchdog가 rpc-level race보다 먼저 끊기지 않게 정렬했다. 전역 기본 30s는 그대로 유지(다른 짧은 명령은 기존처럼 빠르게 fail) — rpc-level race가 여전히 파일 timeout의 권위 있는 기준이다. `LocalCdpConnection`은 자체 watchdog이 없어 override를 무시한다.
