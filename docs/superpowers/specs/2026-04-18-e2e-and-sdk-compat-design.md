# E2E 안정화 & SDK 호환성 게이팅 설계

**작성일**: 2026-04-18
**상태**: 설계 (구현 전)
**범위**: TODO.md의 High Priority 3개 + "devtools ↔ SDK 버전 관계" 정책

## 배경

TODO.md High Priority 3개가 미해결이고, 각각이 서로 다른 신뢰도 문제를 가리킨다.

- **E2E 스위트 검증**: `playwright.config.ts`가 sdk-example을 git clone해 띄우도록 바뀌었지만, 전체 스위트를 main에 머지된 상태로 한 번도 완주 검증하지 않았다.
- **Selector 감사**: `e2e/panel.test.ts`의 selector들이 (a) 구 `examples/vite-react` UI 기준으로 작성되었는지 (b) 현재 sdk-example markup과 실제로 맞는지 검증되지 않았다.
- **PR CI 게이팅**: 현재 PR은 `build + typecheck + unit test`만 거치고 E2E는 수동으로만 돌아간다. sdk-example markup 변경 또는 mock 회귀가 PR에서 검출되지 않는다.

그리고 이 세 가지와 얽혀 더 근본적인 문제가 있다.

- **"devtools에서는 green, 실제 SDK에서는 red"** — mock 신뢰도의 뿌리 문제. 현재 proxy fallback이 미구현 API를 `console.warn` + no-op으로 조용히 처리해서, 사용자가 mock엔 없는데 실 SDK에는 있는 API를 호출해도 브라우저에선 멀쩡해 보인다. "잘 되는 척" 시나리오.

## 목표

1. E2E 스위트가 main 기준으로 실제 통과하고, PR마다 게이팅한다.
2. devtools가 지원하는 `@apps-in-toss/web-framework` 버전 범위를 좁고 명시적으로 선언하고, CI가 그 범위 전체를 검증한다.
3. 미구현 API 호출을 시끄러운 실패로 바꿔, "잘 되는 척" 시나리오를 원천 차단한다.

## 비목표

- SDK major 버전 간 adaptive 분기 코드 작성 (YAGNI).
- devtools 자체의 SemVer 레인 정책 도입 (main만 따라감).
- E2E를 실 SDK에서 재실행하는 dual-run 검증 (환경 부재로 불가).
- sdk-example을 태그/SHA로 pin (TODO Medium, 본 설계 범위 밖).

## 작업 분해: 4개 독립 PR

### A. Selector audit + E2E local green

**파일**: `e2e/panel.test.ts`, 필요시 `playwright.config.ts`
**내용**:
- `pnpm test:e2e`를 로컬에서 완주. sdk-example을 `.tmp/sdk-example`에 git clone → build → preview → 스위트 실행.
- 실패하는 selector를 현재 sdk-example markup 기준으로 교정.
- 전체 스위트 green 달성 후 PR.

### B. PR CI에 E2E job 추가

**파일**: `.github/workflows/ci.yml`
**내용**:
- 기존 `build-and-test` job 유지.
- `e2e` job 추가: Playwright install → `pnpm test:e2e`. `build-and-test`에 `needs` 의존.
- **선행 조건**: A가 main에 머지되어 있어야 red main 위험 없음.

### C1. Peer range lock + proxy throw + 정책 문서

**파일**: `package.json`, `src/mock/proxy.ts`, `README.md`, `CLAUDE.md`

**Peer range 잠금**:
- `peerDependencies["@apps-in-toss/web-framework"]`: `^2.0.0` → `>=2.4.0 <2.4.8` (2.4.0 이상, 현재 최신 2.4.7 포함. range literal 관행상 `<2.4.8`로 표기)
- `peerDependenciesMeta["@apps-in-toss/web-framework"].optional`: `true` → `false`
- `devDependencies["@apps-in-toss/web-framework"]`: `^2.4.5` → `2.4.7` (range의 max를 정확히 고정)

**참고**: 향후 SDK `2.4.8` 등 새 패치가 나오면 `check-sdk-update` cron이 감지 → peer range + devDep + CI matrix를 함께 bump하는 별도 PR을 연다. 이는 본 4개 PR 범위 밖 (일상적인 유지보수 플로우).

**Proxy fallback을 throw로 전환** (`src/mock/proxy.ts`):
- `console.warn` + `return async () => undefined` → `throw new Error(...)`
- 에러 메시지: `[@ait-co/devtools] <moduleName>.<prop> is not mocked. This API may exist in the real SDK but devtools does not support it yet. Please file an issue: https://github.com/apps-in-toss-community/devtools/issues`
- `WARNED` 캐시와 `resetWarned` export는 제거 (throw 이후 불필요).
- 영향 받는 테스트: `src/__tests__/proxy.test.ts`를 throw 검증으로 전면 교체.

**문서**:
- README에 "Supported SDK versions" 섹션 추가:
  - 지원 범위 `>=2.4.0 <2.4.8` 명시
  - "범위 밖 SDK는 peer 경고로 install-time에 차단됩니다"
  - "미구현 API 호출은 런타임에 throw합니다. mock엔 없는데 실 SDK엔 있는 API를 쓰다가 '잘 되는 척' 하는 상황을 방지합니다"
- CLAUDE.md의 "SDK 업데이트 대응" 섹션에 새 정책 반영:
  - 지원 범위 확장 시 peer range + devDep + `__typecheck.ts` + CI matrix를 함께 bump하는 절차

**Breaking change 인지**: 현재 `0.0.2` → 실사용자 거의 없음. 다음 publish는 `0.1.0`으로 minor bump (release-please가 자동 판단).

### C2. CI 매트릭스 typecheck (compat-check)

**파일**: `.github/workflows/ci.yml`
**내용**:
- 새 job `compat-check` 추가.
- Matrix: `sdk-version: [2.4.0, 2.4.7]` (min + max 양 끝만).
- 각 버전에 대해:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm add -D @apps-in-toss/web-framework@${{ matrix.sdk-version }} --ignore-scripts`
  3. `pnpm typecheck`
- `build-and-test`와 병렬 실행, 독립 게이트.
- 지원 범위가 좁아(single minor) patch 간 drift는 실무적으로 무시 가능. 범위 확장 시 matrix도 함께 확장.

**선행 조건**: C1이 main에 머지되어 있어야 matrix가 의미 있는 범위를 검증한다.

## 실행 순서 & Worktree 전략

4개 작업을 모두 **독립 PR**로 올린다. 순서와 병렬성은 다음과 같다.

```
Phase 1 (병렬, gw spawn 2개):
  A.  selector audit + E2E local green
  C1. peer range lock + proxy throw + 정책 문서

Phase 2 (A, C1 머지 후, 병렬, gw spawn 2개):
  B.  PR CI E2E gating            (A 위에서 파생)
  C2. CI matrix typecheck         (C1 위에서 파생)
```

### Worktree 상세

`superpowers:using-git-worktrees` 패턴으로 각 PR을 isolated worktree에서 진행:

- **Phase 1**:
  - `gw <A task>` → 새 worktree, branch `e2e/selector-audit` (예시), main에서 분기
  - `gw <C1 task>` → 새 worktree, branch `chore/sdk-peer-constraint`, main에서 분기
- **Phase 2**:
  - A merged → main pull
  - `gw <B task>` → 새 worktree, branch `ci/e2e-gating`, 최신 main에서 분기
  - C1 merged → main pull
  - `gw <C2 task>` → 새 worktree, branch `ci/sdk-compat-matrix`, 최신 main에서 분기

## Merge Conflict 위험 매트릭스

| 쌍 | 겹치는 파일 | 위험 |
|---|---|---|
| A ↔ C1 | 없음 (A: `e2e/`, C1: `package.json`/`src/mock/proxy.ts`/docs) | 없음 |
| A ↔ B | 없음 (A: `e2e/`, B: `.github/workflows/ci.yml`) | 없음 |
| A ↔ C2 | 없음 | 없음 |
| C1 ↔ B | 없음 | 없음 |
| C1 ↔ C2 | C2가 C1의 `package.json` peer range 위에서 작동. **C1 선행 필수**. | 순서 지키면 없음 |
| **B ↔ C2** | **둘 다 `ci.yml` 수정** | 있음 |

### B ↔ C2 충돌 처리

둘 다 `.github/workflows/ci.yml`에 새 job을 추가한다. 서로 다른 job이라 논리 충돌은 없고 YAML 섹션 순서의 텍스트 충돌만 가능.

**처리 방침**:
- 먼저 머지되는 쪽(B 먼저 가는 게 자연스러움)이 head가 됨.
- 나중 PR은 rebase. Rebase 시 `ci.yml`의 `jobs:` 섹션 끝부분에 job을 append하는 형태라 auto-resolve 가능성 높음.
- conflict가 나면 수동 resolve. 각자 job 이름이 다르므로 단순 병합.

## 대안과 거부 이유

### 대안 1: SDK 버전 adaptive 분기 (옵션 3)

mock 코드 안에서 `if (sdkVersion.gte('2.5')) { ... }`로 동작 분기.

**거부 이유**:
- 구현/유지 비용 과다.
- "미구현 API 누락"은 여전히 못 잡음 (분기 안 된 API는 그대로 없음).
- 현 SDK가 breaking change를 자주 내지 않아 YAGNI.

### 대안 2: Proxy warn 유지 + peer range + matrix만 (옵션 2의 경량형)

Breaking change 없이 peer range와 CI matrix로만 방어.

**거부 이유**:
- Matrix는 **시그니처 drift**는 잡지만 **mock 누락**은 못 잡는다. 사용자가 warn을 놓치면 "잘 되는 척" 그대로 재현.
- 본 설계의 핵심 동기("devtools green → 실 SDK red 차단")가 충족 안 됨.

### 대안 3: 전체를 하나의 PR로

4개 변경을 한 PR에.

**거부 이유**:
- 리뷰 단위 너무 큼. selector 교정과 정책 변경은 리뷰 성격이 다름.
- 롤백 단위도 너무 큼.

### 대안 4: sdk-example을 태그/SHA로 pin

TODO Medium의 "Consider a stable sdk-example ref".

**본 설계에서는 보류 이유**:
- 현재 설계의 동기(신뢰도 게이팅)와 별개 문제. 별도 PR로 진행하는 게 깔끔.
- 본 4개 PR이 머지된 후 Medium Priority로 이관.

## 검증 계획

각 PR마다:

- **A**: 로컬 `pnpm test:e2e`가 전부 pass. PR description에 로그/스크린샷 첨부.
- **B**: PR 자체의 CI가 새 `e2e` job을 포함한 채 green.
- **C1**:
  - `pnpm test`의 `proxy.test.ts`가 throw 검증으로 재작성된 채 pass.
  - 로컬에서 `pnpm typecheck` pass (peer range lock 후에도).
  - README/CLAUDE.md 변경분 직접 리뷰.
- **C2**: PR 자체의 CI가 새 `compat-check` matrix 2개 (2.4.0, 2.4.7) 전부 green.

## Rollout

- 4개 PR 순차/병렬 머지 후, 다음 release-please PR에서 `0.1.0` minor bump 유도 (proxy breaking change).
- Release notes에 "proxy fallback now throws" 명시.
