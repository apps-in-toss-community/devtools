# PR C1: Peer Range Lock + Proxy Throw + 정책 문서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@apps-in-toss/web-framework` peer range를 `>=2.4.0 <2.4.8`로 좁게 잠그고, `src/mock/proxy.ts`의 미구현 API fallback을 `console.warn` no-op에서 `throw`로 전환하며, README/CLAUDE.md에 새 지원 정책을 명문화한다.

**Architecture:** 설치 게이트(peer range)와 런타임 게이트(proxy throw)의 2중 방어. peer range는 지원 범위를 좁게 선언해 install-time에 불일치를 경고하고, proxy throw는 "mock엔 없는데 실 SDK엔 있을 수 있는" 호출을 런타임에 시끄럽게 실패시켜 "devtools green → 실 SDK red" 시나리오를 차단한다.

**Tech Stack:** TypeScript, pnpm, Vitest.

**Base branch:** `main`. Worktree: `chore/sdk-peer-constraint`.

**의존 PR:** 없음. Phase 1에서 PR A와 병렬 실행.

**Breaking change:** `proxy.ts` 변경은 consumer behavior를 바꿈. release-please가 minor bump(`0.0.2` → `0.1.0`)를 판단하도록 커밋 메시지에 적절히 반영.

---

## 참고: 변경 전 상태 요약

- `package.json`:
  - `peerDependencies["@apps-in-toss/web-framework"]`: `^2.0.0`
  - `peerDependenciesMeta["@apps-in-toss/web-framework"].optional`: `true`
  - `devDependencies["@apps-in-toss/web-framework"]`: `^2.4.5`
- `src/mock/proxy.ts`: `console.warn` + no-op return, `WARNED` set + `resetWarned` export
- `src/__tests__/proxy.test.ts`: warn 행동 검증

---

### Task 1: Peer range + devDep 버전 잠금

**Files:**
- Modify: `package.json`

- [ ] **Step 1: package.json 편집**

`package.json`에서 세 곳을 수정:

```json
"peerDependencies": {
  "@apps-in-toss/web-framework": ">=2.4.0 <2.4.8"
},
"peerDependenciesMeta": {
  "@apps-in-toss/web-framework": {
    "optional": false
  }
},
"devDependencies": {
  "@apps-in-toss/web-framework": "2.4.7",
  ...
}
```

주의:
- peer range literal은 `>=2.4.0 <2.4.8`. 2.4.0~2.4.7 모두 포함.
- devDep은 caret/tilde 없이 정확히 `"2.4.7"`로 고정. 이 버전이 `__typecheck.ts` 대조의 기준.
- `peerDependenciesMeta` 객체는 유지하되 optional만 false로. (빈 객체가 되면 그냥 삭제해도 무방.)

- [ ] **Step 2: 락 파일 갱신**

Run:
```bash
pnpm install
```

Expected: `pnpm-lock.yaml` 업데이트. `@apps-in-toss/web-framework`가 `2.4.7`로 정확히 고정되어야 함.

- [ ] **Step 3: typecheck + test 확인**

Run:
```bash
pnpm typecheck && pnpm test
```

Expected: PASS. (아직 proxy.ts는 안 건드렸으므로 기존 테스트 그대로 green.)

- [ ] **Step 4: 커밋**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): lock @apps-in-toss/web-framework peer range to >=2.4.0 <2.4.8

지원 SDK 버전을 좁게 선언. devDep은 range의 max인 2.4.7로 고정.
peerDependenciesMeta.optional을 false로 변경해 install-time에 불일치를 명시적으로 경고."
```

---

### Task 2: proxy.ts를 throw로 전환 (TDD)

**Files:**
- Modify: `src/__tests__/proxy.test.ts`
- Modify: `src/mock/proxy.ts`

- [ ] **Step 1: 실패할 테스트로 전면 재작성**

`src/__tests__/proxy.test.ts`를 다음 내용으로 **전체 교체**:

```ts
import { describe, it, expect } from 'vitest';
import { createMockProxy } from '../mock/proxy.js';

describe('createMockProxy', () => {
  it('구현된 프로퍼티는 정상적으로 접근 가능하다', () => {
    const mock = createMockProxy('TestModule', {
      hello: () => 'world',
    });
    expect(mock.hello()).toBe('world');
  });

  it('미구현 프로퍼티 접근 시 throw한다', () => {
    const ref = createMockProxy('TestModule', { existing: () => 42 }) as Record<string, unknown>;

    expect(() => ref['unknownMethod']).toThrow(
      /TestModule\.unknownMethod is not mocked/,
    );
  });

  it('throw되는 에러 메시지는 이슈 URL을 포함한다', () => {
    const ref = createMockProxy('Ads', {}) as Record<string, unknown>;

    expect(() => ref['someNewApi']).toThrow(
      /github\.com\/apps-in-toss-community\/devtools\/issues/,
    );
  });

  it('심볼 접근은 undefined를 반환한다 (throw하지 않음)', () => {
    const ref = createMockProxy('TestModule', {}) as Record<string | symbol, unknown>;
    const anySymbol = Symbol('any');
    expect(ref[anySymbol]).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행해서 fail 확인**

Run:
```bash
pnpm test src/__tests__/proxy.test.ts
```

Expected: `미구현 프로퍼티 접근 시 throw한다`, `throw되는 에러 메시지는 이슈 URL을 포함한다` 테스트 FAIL (현재 구현은 warn만 하고 throw 안 하므로).

- [ ] **Step 3: proxy.ts 재작성**

`src/mock/proxy.ts`를 다음 내용으로 **전체 교체**:

```ts
/**
 * 미구현 API용 Proxy fallback.
 *
 * 호출되면 throw한다. 이는 "devtools에서는 멀쩡히 돌지만 실 SDK에선 실제로 동작하는"
 * 시나리오를 차단하기 위한 의도적 선택이다. mock이 미구현인 API는 실 SDK에서는
 * 존재할 수 있고, 사용자가 이를 인지하지 못한 채 개발을 이어가면 배포 시점에
 * 놀라게 된다. 에러 메시지에 이슈 URL을 포함해 사용자가 mock 누락을 제보할
 * 수 있게 한다.
 */

const ISSUES_URL = 'https://github.com/apps-in-toss-community/devtools/issues';

export function createMockProxy<T extends Record<string, unknown>>(
  moduleName: string,
  implementations: T,
): T {
  return new Proxy(implementations, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];

      throw new Error(
        `[@ait-co/devtools] ${moduleName}.${prop} is not mocked. ` +
        `This API may exist in the real @apps-in-toss/web-framework SDK, ` +
        `but devtools does not support it yet. ` +
        `Please file an issue: ${ISSUES_URL}`,
      );
    },
  }) as T;
}
```

변경 요지:
- `WARNED` set 제거
- `resetWarned` export 제거
- `console.warn` + `return async () => undefined` 제거
- 미구현 property 접근은 즉시 throw

- [ ] **Step 4: 테스트 재실행해서 green 확인**

Run:
```bash
pnpm test src/__tests__/proxy.test.ts
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 다른 테스트들이 깨지지 않는지 확인**

Run:
```bash
pnpm test
```

Expected: 전체 vitest 스위트 PASS.

**가능한 파생 실패**: 다른 테스트(예: `iap.test.ts`, `ads.test.ts`)에서 `resetWarned`를 import했거나, mock의 미구현 속성을 호출하고 있었다면 실패. 각 케이스별 처리:

- `resetWarned` import가 있는 파일 → import 제거 (beforeEach의 `resetWarned()` 호출도 제거)
- 미구현 속성 호출 테스트 → 해당 속성을 mock 구현체에 추가하거나 테스트에서 해당 호출 제거

- [ ] **Step 6: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/mock/proxy.ts src/__tests__/proxy.test.ts
# 다른 테스트 파일에 수정이 있었다면 함께 add
git commit -m "feat!: throw on unmocked API access instead of silent no-op

미구현 API 접근 시 console.warn + no-op 반환에서 throw로 전환.
mock엔 없는데 실 SDK엔 있을 수 있는 API를 사용자가 조용히 호출해
'devtools green → 실 SDK red' 상황을 겪는 시나리오를 원천 차단한다.

BREAKING CHANGE: createMockProxy로 감싼 모듈의 미구현 속성 접근은
이제 Error를 throw한다. resetWarned export도 제거."
```

---

### Task 3: 문서 업데이트 — README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 기존 peer 문구 교체**

`README.md`의 다음 줄을 찾는다 (`grep -n "peerDependency" README.md`로 확인):

```md
> `@apps-in-toss/web-framework ^2.0.0`이 peerDependency로 설정되어 있습니다 (optional).
```

다음으로 교체:

```md
> **지원 SDK 버전**: `@apps-in-toss/web-framework >=2.4.0 <2.4.8` (peer, required).
>
> devtools는 위 범위의 SDK 버전에서만 동작이 검증됩니다. 범위 밖 SDK를 설치하면
> 패키지 매니저가 install-time에 peer 경고를 표시합니다. 또한 devtools가 아직 mock하지
> 않은 API를 호출하면 런타임에 에러가 발생합니다 — "devtools에서는 잘 되는데 실제 SDK에서는
> 안 되는" 상황을 방지하기 위한 의도적 동작입니다. 누락된 API는
> [이슈](https://github.com/apps-in-toss-community/devtools/issues)로 알려주세요.
```

- [ ] **Step 2: 기존 "SDK 업데이트 대응" 관련 설명이 있다면 일관성 맞추기**

Run:
```bash
grep -n "proxy\|graceful\|warn" README.md
```

만약 "proxy fallback이 graceful warning으로 처리" 같은 문구가 있으면 "throw로 차단"으로 갱신.

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs(readme): document strict SDK peer range and throw-on-unmocked policy"
```

---

### Task 4: 문서 업데이트 — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: "SDK 업데이트 대응" 섹션 교체**

`CLAUDE.md`의 `## SDK 업데이트 대응` 섹션을 찾아 내용을 다음으로 교체:

```md
## SDK 업데이트 대응

devtools는 `@apps-in-toss/web-framework`의 좁은 범위(`>=2.4.0 <2.4.8`)만 공식 지원한다.
이 범위는 CI matrix (`compat-check` job)로 양 끝 버전(min/max)이 typecheck되어야 green.

- `@apps-in-toss/web-framework`는 **required** peerDependency + 고정 devDependency (`2.4.7`)
- `src/__typecheck.ts`가 컴파일 타임에 시그니처 불일치 감지
- `src/mock/proxy.ts`의 `createMockProxy`는 **미구현 API 접근 시 throw** — "잘 되는 척" 방지
- `.github/workflows/check-sdk-update.yml`이 매주 월요일 새 버전 감지 → 이슈 생성

### 지원 범위 확장 절차 (새 SDK 버전 나왔을 때)

SDK `2.4.8`이 publish된 경우를 예로:

1. `pnpm add -D @apps-in-toss/web-framework@2.4.8`
2. `pnpm typecheck` — 시그니처 변경이 있으면 여기서 드러남. mock 수정.
3. `package.json`의 peer range를 `>=2.4.0 <2.4.9`로 넓힘
4. `.github/workflows/ci.yml`의 `compat-check` matrix에 `2.4.8` 추가
5. (선택) 오래된 버전 지원 중단하려면 peer range의 하한도 올림
6. 단일 PR로 올린다 — peer range + devDep + matrix가 한 번에 일관된 상태여야 함
```

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update SDK compat policy with strict peer range and throw semantics"
```

---

### Task 5: 최종 검증 + PR 생성

**Files:** 없음

- [ ] **Step 1: 전체 검증**

Run:
```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Expected: 모두 PASS.

- [ ] **Step 2: PR push**

Run:
```bash
git push -u origin <branch-name>
```

- [ ] **Step 3: PR 생성**

`gh pr create`:
- **Title**: `feat!: lock SDK peer range and throw on unmocked API`
- **Body**:
  ```
  ## Summary
  - `@apps-in-toss/web-framework` peer range를 `>=2.4.0 <2.4.8`로 좁게 잠그고 required로 전환
  - `src/mock/proxy.ts`의 미구현 API fallback을 warn+no-op → throw로 전환
  - README/CLAUDE.md에 새 지원 정책 명문화

  ## Why
  "devtools에서는 green, 실제 SDK에서는 red"라는 최악의 사용자 경험을 차단하기 위함.
  peer range가 설치 단계를, proxy throw가 런타임을 각각 담당하는 2중 방어.

  ## Breaking
  - `createMockProxy`의 미구현 속성 접근이 이제 throw (이전엔 warn + no-op)
  - `resetWarned` export 제거
  - Peer dep가 required로 변경

  사용자 거의 없는 `0.0.2` 단계라 영향 미미. release-please가 0.1.0 minor bump로 판단 예정.

  ## Test plan
  - [x] `pnpm test` pass
  - [x] `pnpm typecheck` pass
  - [x] `pnpm build` pass
  ```

- [ ] **Step 4: PR CI 확인**

Run:
```bash
gh pr checks --watch
```

Expected: `build-and-test` green.

---

## Self-review 체크리스트 (머지 전)

- [ ] `package.json`의 peer range가 `>=2.4.0 <2.4.8`, optional: false
- [ ] devDep이 정확히 `"2.4.7"` (caret/tilde 없음)
- [ ] `pnpm-lock.yaml`이 함께 커밋됨
- [ ] `src/mock/proxy.ts`에 `WARNED`/`resetWarned` 흔적 없음
- [ ] `src/__tests__/proxy.test.ts`가 throw 검증으로 전면 재작성됨
- [ ] `pnpm test` 전체 green (다른 테스트들이 `resetWarned`를 의존하지 않음)
- [ ] README에 새 peer range + throw 정책 명시
- [ ] CLAUDE.md에 확장 절차 명시
- [ ] 커밋 메시지에 `feat!:` 또는 `BREAKING CHANGE:` 포함 (release-please 트리거)
