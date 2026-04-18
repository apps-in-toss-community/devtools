# PR C2: SDK Compat Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR CI에 `compat-check` matrix job을 추가해, 지원 범위의 양 끝 버전(`2.4.0`, `2.4.7`) 모두에서 `pnpm typecheck`가 통과하는지 게이팅한다.

**Architecture:** `peerDependencies`가 선언한 범위(`>=2.4.0 <2.4.8`)의 양 끝 버전을 GitHub Actions matrix로 돌린다. 각 matrix job은 해당 SDK 버전으로 override 설치한 뒤 `pnpm typecheck`를 실행 — 시그니처 drift가 있으면 `src/__typecheck.ts`의 `Assert<>` 타입에서 에러 발생. 범위가 한 minor(2.4.x) 안으로 좁아 patch 간 drift는 실무적으로 무시 가능하다는 가정.

**Tech Stack:** GitHub Actions, pnpm.

**Base branch:** `main` (PR C1이 머지된 후에 분기). Worktree: `ci/sdk-compat-matrix`.

**의존 PR:** PR C1 (peer range lock). C1이 없으면 matrix가 검증할 "범위" 자체가 없다.

**Merge conflict 주의:** PR B가 먼저 머지되어 있을 수 있음. B가 `ci.yml`에 `e2e` job을, 이 PR이 `compat-check` job을 추가. 서로 다른 job이라 rebase로 해소 가능.

---

### Task 1: 준비 — C1, 가능하면 B 머지 확인

**Files:** 없음

- [ ] **Step 1: 최신 main에서 C1이 머지되었는지 확인**

Run:
```bash
git fetch origin
git log origin/main --oneline | head -10
```

Expected: PR C1의 머지 커밋("feat!: lock SDK peer range and throw on unmocked API" 또는 유사)이 보인다. 없으면 이 PR은 시작 불가 — C1 머지 대기.

- [ ] **Step 2: 현재 peer range 확인**

Run:
```bash
grep -A2 'peerDependencies' package.json
```

Expected: `"@apps-in-toss/web-framework": ">=2.4.0 <2.4.8"`. 다르면 이 plan의 matrix 값을 실제 range에 맞춰 조정.

---

### Task 2: compat-check job 추가

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 새 job 추가**

`.github/workflows/ci.yml`의 `jobs:` 섹션에 다음을 **추가** (기존 `build-and-test`와 `e2e`(존재 시)는 유지):

```yaml
  compat-check:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        sdk-version: ['2.4.0', '2.4.7']
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Override @apps-in-toss/web-framework to ${{ matrix.sdk-version }}
        run: pnpm add -D @apps-in-toss/web-framework@${{ matrix.sdk-version }}

      - run: pnpm typecheck
```

주의사항:
- `fail-fast: false`: 한 matrix 실패가 다른 matrix를 cancel하지 않게 (둘 다 결과 보고 싶음)
- `pnpm add -D ... @${{ matrix.sdk-version }}`: `--no-save` 대신 `-D`를 쓰는 이유 = pnpm의 `-D`는 여전히 `pnpm-lock.yaml`을 로컬에서만 mutate, CI runner 내에선 문제없고 checkout이 isolated라 영향 없음. 단, lock drift를 명시적으로 피하려면 다음 대안 사용:
  ```yaml
  - run: pnpm install @apps-in-toss/web-framework@${{ matrix.sdk-version }} -D
  ```
- matrix 값은 peer range의 literal edge와 일치: `2.4.0` (>=의 하한), `2.4.7` (<2.4.8의 실질 최대)

- [ ] **Step 2: YAML 구조 육안 확인**

`.github/workflows/ci.yml`을 열어 구조가 다음과 같은지 확인:

```
jobs:
  build-and-test:
    ...
  e2e:          # PR B가 머지되었다면
    ...
  compat-check: # 이 PR
    strategy:
      matrix: ...
    ...
```

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add SDK compatibility matrix typecheck

지원 SDK range (>=2.4.0 <2.4.8)의 양 끝 버전 (2.4.0, 2.4.7)에 대해
pnpm typecheck를 matrix로 실행. 시그니처 drift를 PR 단계에서 게이팅."
```

---

### Task 3: PR 생성 및 matrix 자체 검증

**Files:** 없음

- [ ] **Step 1: PR push**

Run:
```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: PR 생성**

`gh pr create`:
- **Title**: `ci: add SDK compatibility matrix typecheck`
- **Body**:
  ```
  ## Summary
  - 지원 SDK range 양 끝 버전 (2.4.0, 2.4.7)에 대해 pnpm typecheck를 matrix로 실행
  - #<PR C1 번호>의 peer range lock에 의존. 범위 확장 시 이 matrix도 함께 bump해야 함

  ## Why
  peer range만으론 "install 가능하다"만 보장. 실제로 모든 버전에서 타입이 맞는지는
  각 버전을 실제 설치해봐야 앎. matrix가 이를 gating.

  ## Test plan
  - [x] 자체 PR의 CI에서 compat-check (2.4.0), compat-check (2.4.7) 둘 다 green
  ```

- [ ] **Step 3: PR CI 결과 확인**

Run:
```bash
gh pr checks --watch
```

Expected: `compat-check (2.4.0)`, `compat-check (2.4.7)` 두 matrix job이 둘 다 green.

**만약 `2.4.0` matrix가 red라면**: 현재 `src/__typecheck.ts`가 최신 SDK(2.4.7) 기준으로 작성되어 있어 구버전에서 없는 시그니처를 참조할 가능성. 처리 방침:

- 2.4.0에만 있고 2.4.7엔 없는 시그니처 → 거의 없음
- 2.4.7에만 있고 2.4.0엔 없는 시그니처 (new export) → `__typecheck.ts`의 해당 `Assert` 라인이 fail
  - 옵션 A: peer range 하한을 올린다 (예: `>=2.4.5 <2.4.8`)
  - 옵션 B: `__typecheck.ts`에서 해당 라인을 제거하거나 `// @ts-expect-error` 처리 (권장하지 않음 — 지원 범위의 의미 약화)

옵션 A가 기본. 결정 시 PR description 갱신하고 peer range도 함께 수정한 commit을 이 PR에 추가.

---

### Task 4: 의도적 실패 검증 (선택)

**Files:** 없음 (throwaway 확인만)

- [ ] **Step 1: 실패 유도 확인 (선택)**

이 matrix가 진짜 drift를 잡는지 확인하려면 throwaway 브랜치에서:
- `src/__typecheck.ts`에 존재하지 않는 `typeof Original.somethingNonExistent` 참조 추가
- PR을 열어 CI에서 matrix 2개 다 red되는지 확인
- 확인 후 브랜치 폐기

선택 사항. 시간 없으면 skip.

---

## Self-review 체크리스트 (머지 전)

- [ ] 수정한 파일은 `.github/workflows/ci.yml` 하나뿐
- [ ] matrix 값(`2.4.0`, `2.4.7`)이 `package.json`의 peer range literal edge와 정확히 일치
- [ ] `fail-fast: false` 설정됨
- [ ] 자체 PR의 CI에서 compat-check matrix 둘 다 green
- [ ] B가 이미 머지되었다면 `jobs:` 섹션에 `build-and-test`, `e2e`, `compat-check` 3개 모두 존재
