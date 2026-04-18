# PR B: PR CI E2E Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR CI에 E2E job을 추가해, sdk-example auto-clone 기반 Playwright 스위트를 모든 PR에서 게이팅한다.

**Architecture:** 기존 `.github/workflows/ci.yml`에 새 job `e2e`를 추가. `build-and-test`와 병렬로 돌지만, Playwright가 preview 서버를 띄우는 시간이 길어 독립 job으로 분리. Playwright browser는 `pnpm exec playwright install --with-deps chromium`으로 캐시 활용.

**Tech Stack:** GitHub Actions, Playwright, pnpm.

**Base branch:** `main` (PR A가 머지된 후에 분기). Worktree: `ci/e2e-gating`.

**의존 PR:** PR A (selector audit). A가 main에 들어가 E2E가 green 상태여야 이 job 추가가 의미 있음.

**Merge conflict 주의:** PR C2도 같은 `ci.yml`을 수정함. 순서가 앞서면 이 PR이 먼저 들어가고, C2가 rebase (둘 다 별도 job 추가라 auto-merge 가능성 높음).

---

### Task 1: 현 ci.yml 확인 + branch 준비

**Files:** 없음 (준비만)

- [ ] **Step 1: 최신 main 확인**

Run:
```bash
git fetch origin
git log origin/main --oneline -5
```

Expected: PR A의 머지 커밋이 보인다. 없으면 이 PR은 아직 시작하면 안 됨 — 중단하고 A 머지 대기.

- [ ] **Step 2: 로컬 E2E green 재확인**

Run:
```bash
pnpm install --frozen-lockfile
pnpm test:e2e --reporter=list
```

Expected: 모든 테스트 PASS. 만약 fail이면 PR A 이후 drift가 생긴 것. 이 PR 진행 중단하고 원인 파악.

---

### Task 2: ci.yml에 e2e job 추가

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 새 job 추가 (빌드 + Playwright 실행)**

`.github/workflows/ci.yml`을 열고 `build-and-test` job 뒤에 다음 block을 추가한다:

```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browser
        run: pnpm exec playwright install --with-deps chromium

      - name: Run E2E tests
        run: pnpm test:e2e

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

주의사항:
- `build-and-test`의 구조를 복사하지 말고 "필요한 것만" 수록 (E2E는 자체적으로 `pnpm test:e2e` 안에서 build를 돌린다 — `playwright.config.ts`의 `webServer.command`가 `pnpm build`를 포함).
- `needs:`를 걸지 않음 — `build-and-test`와 병렬 실행.
- `--with-deps`는 Playwright가 Ubuntu 시스템 패키지까지 설치하므로 필수.

- [ ] **Step 2: 로컬 syntax 검증**

Run:
```bash
# YAML 파싱 확인 (actionlint가 로컬에 있으면)
yamllint .github/workflows/ci.yml 2>/dev/null || echo "yamllint not installed — skipping"
```

Expected: YAML lint 에러 없음. (도구 없으면 육안 확인.)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add E2E gating job for PRs

PR마다 sdk-example auto-clone + Playwright 스위트가 녹색이어야 머지 가능하도록
ci.yml에 e2e job 추가. 실패 시 playwright-report를 artifact로 업로드."
```

---

### Task 3: PR 생성 및 CI에서 자체 검증

**Files:** 없음

- [ ] **Step 1: PR push**

Run:
```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: PR 생성**

`gh pr create`:
- **Title**: `ci: add E2E gating job to PR workflow`
- **Body**:
  - 변경 요약: "PR CI에 Playwright E2E job 추가. sdk-example을 auto-clone해 실행."
  - 선행 PR 참조: "#<PR A 번호>에 의존 (selector가 정렬되어야 green)"
  - 예상 CI 소요: "약 3~5분 (install + build + sdk-example clone + preview + 스위트)"

- [ ] **Step 3: 자체 PR의 CI 결과 확인**

Run:
```bash
gh pr checks --watch
```

Expected: 새 `e2e` job이 나타나고 green. 실패 시 `playwright-report` artifact 다운로드해서 원인 분석.

- [ ] **Step 4: 일시적 실패 유도 테스트 (선택)**

이 job이 진짜로 gating하는지 확인하려면 별도 throwaway 브랜치에서 `e2e/panel.test.ts`에 `expect(true).toBe(false)`를 일시 추가한 PR을 열어, CI가 red가 되는지 확인. 확인 후 폐기. (선택적이지만 권장.)

---

## Self-review 체크리스트 (머지 전)

- [ ] 수정한 파일은 `.github/workflows/ci.yml` 하나뿐
- [ ] 이 PR 자체의 CI에서 새 `e2e` job이 green
- [ ] `build-and-test` job은 변경하지 않았다
- [ ] Playwright browser install이 `--with-deps`를 포함한다
- [ ] 실패 시 artifact 업로드가 설정되어 있다
