# PR A: Selector Audit & E2E Local Green Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 `e2e/panel.test.ts`의 전체 스위트가 sdk-example을 auto-clone한 상태로 로컬에서 green이 되도록 selector를 교정하고 필요 시 대기 로직을 보강한다.

**Architecture:** `playwright.config.ts`가 sdk-example을 `.tmp/sdk-example`에 git clone → `pnpm install && pnpm build && pnpm preview`로 띄운다. `e2e/panel.test.ts`는 이 preview 서버(`localhost:4173`)에 대해 돌아간다. 이 계획은 E2E 동작을 **변경하지 않고** 현재 sdk-example markup과 어긋난 selector만 수정한다. 스위트의 테스트 시나리오 범위 확장은 별도 작업 (범위 밖).

**Tech Stack:** Playwright, TypeScript, pnpm.

**Base branch:** `main` (worktree: `feat/e2e-selector-audit` 또는 유사)

**의존 PR:** 없음. 독립적으로 병렬 실행 가능 (Phase 1).

---

### Task 1: Baseline 실행 — 현재 실패 지점 파악

**Files:** 없음 (실행만)

- [ ] **Step 1: 빌드 + E2E 드라이 실행**

Run:
```bash
pnpm install --frozen-lockfile
pnpm test:e2e --reporter=list 2>&1 | tee /tmp/e2e-baseline.log
```

Expected: 일부 테스트 실패 (그 목록이 이 plan의 작업 대상). 로그에서 실패한 `describe`/`test` 이름을 모두 수집한다.

- [ ] **Step 2: 실패 목록 정리**

`/tmp/e2e-baseline.log`에서 `✘` 또는 `FAIL` 줄을 추출해 실패 테스트 목록을 문서화한다. 각 테스트별로:
- 어떤 selector가 실패했는지 (`locator('...')` 또는 `getByTestId('...')` 포함 stack)
- sdk-example 현재 markup과 어떻게 다른지 브라우저에서 실제 확인 (`playwright report`의 스크린샷 또는 `pnpm exec playwright show-report`)

**결과물**: 실패 목록(테스트 이름 + 실패 원인 한 줄 메모)을 PR description draft에 기록.

- [ ] **Step 3: sdk-example markup 참조 확보**

Run:
```bash
cd .tmp/sdk-example && grep -rn "data-testid" src/ | head -60
```

Expected: 현재 sdk-example의 `data-testid` 목록 출력. 이를 `e2e/panel.test.ts`의 `getByTestId('...')` 호출과 대조.

---

### Task 2: 실패 테스트 수정 (반복)

**Files:**
- Modify: `e2e/panel.test.ts`

**반복 패턴** — 각 실패 테스트에 대해 다음을 순서대로 수행:

- [ ] **Step 1: 실패 테스트 1개 선택**

Task 1의 목록에서 가장 위 테스트 하나를 선택.

- [ ] **Step 2: 실패 원인 정확히 진단**

브라우저 devtools로 sdk-example preview (`http://localhost:4173`)를 열고, 해당 테스트가 찾으려는 `data-testid` 또는 CSS selector가 실제로 존재하는지, 이름이 바뀌었는지, 또는 비동기 렌더링 타이밍 문제인지 구분한다.

진단 결과는 3가지 중 하나:
- **(a) testid가 리네임됨** → `e2e/panel.test.ts`의 testid만 교체
- **(b) markup 구조가 바뀌어 CSS selector/filter가 안 맞음** → selector 재작성
- **(c) 비동기 타이밍 문제** → 기존 `timeout` 늘리거나 `expect(...).toBeVisible()` 대기 추가

- [ ] **Step 3: 단일 테스트로 재실행 확인**

Run:
```bash
pnpm test:e2e --grep "<test name>" --reporter=list
```

Expected: 해당 테스트 PASS.

- [ ] **Step 4: 커밋 (작은 단위로)**

테스트 1~3개 단위로 묶어 커밋.
```bash
git add e2e/panel.test.ts
git commit -m "test(e2e): fix <describe> selectors for current sdk-example markup"
```

- [ ] **Step 5: 다음 실패 테스트로**

Task 2 Step 1로 돌아가 다음 테스트 수정. 모든 실패 테스트 처리될 때까지 반복.

---

### Task 3: 전체 스위트 Green 확인

**Files:** 없음

- [ ] **Step 1: 전체 스위트 실행**

Run:
```bash
pnpm test:e2e --reporter=list
```

Expected: 모든 테스트 PASS. 실패 0개.

- [ ] **Step 2: 불안정성 점검 — 2회 연속 실행**

Run:
```bash
pnpm test:e2e --reporter=list && pnpm test:e2e --reporter=list
```

Expected: 두 번 연속 전부 PASS. Flaky 테스트가 있으면 해당 테스트에 `expect.toPass` 또는 longer timeout 적용 후 재시도.

- [ ] **Step 3: 최종 로그 보존**

Run:
```bash
pnpm test:e2e --reporter=list 2>&1 | tee /tmp/e2e-final.log
```

이 로그를 PR description에 붙인다 (또는 screenshot of `pnpm exec playwright show-report` 첨부).

---

### Task 4: PR 생성

**Files:** 없음

- [ ] **Step 1: PR push**

Run:
```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: PR 생성**

`gh pr create`로 다음 내용 포함:
- **Title**: `test(e2e): fix selectors to match current sdk-example markup`
- **Body**:
  - 기존 실패 테스트 목록 + 수정 내용 요약
  - 최종 green 로그 (또는 report 스크린샷)
  - 리뷰 포인트: "이 PR은 selector만 교정. E2E 동작 자체나 새 테스트 추가는 없음."

- [ ] **Step 3: CI 확인**

PR 자체의 `build-and-test` job이 green인지 확인. (E2E 게이팅은 PR B에서 추가되므로 이 PR에서는 CI가 E2E를 돌리지 않음 — 정상.)

---

## Self-review 체크리스트 (머지 전)

- [ ] `e2e/panel.test.ts` 외의 파일은 수정하지 않았다 (필요 시 `playwright.config.ts` 타임아웃만 조정)
- [ ] 로컬 `pnpm test:e2e` 2회 연속 green
- [ ] 각 selector 교정이 "왜 바뀌었는지" PR description 또는 커밋 메시지에 설명되어 있다
- [ ] 새 테스트 케이스를 추가하지 않았다 (scope creep 방지)
