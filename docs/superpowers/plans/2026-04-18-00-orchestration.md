# Orchestration: 4 PRs for E2E & SDK Compat

이 문서는 개별 PR plan을 **어떻게 엮어 실행할지** 지시한다. 각 PR의 세부 Task는 해당 plan 파일을 참고.

**Spec**: [`../specs/2026-04-18-e2e-and-sdk-compat-design.md`](../specs/2026-04-18-e2e-and-sdk-compat-design.md)

---

## 4개 PR 개요

| PR | Plan | 파일 수정 대상 | 의존 |
|---|---|---|---|
| **A** | [selector audit + E2E green](./2026-04-18-A-e2e-selector-audit.md) | `e2e/panel.test.ts` | 없음 |
| **B** | [PR CI E2E gating](./2026-04-18-B-ci-e2e-gating.md) | `.github/workflows/ci.yml` | A 머지 후 |
| **C1** | [peer range lock + proxy throw + docs](./2026-04-18-C1-peer-range-and-proxy-throw.md) | `package.json`, `src/mock/proxy.ts`, `src/__tests__/proxy.test.ts`, `README.md`, `CLAUDE.md` | 없음 |
| **C2** | [SDK compat matrix](./2026-04-18-C2-sdk-compat-matrix.md) | `.github/workflows/ci.yml` | C1 머지 후 |

---

## 실행 타임라인

### Phase 1 (병렬, 즉시 시작 가능)

A와 C1은 독립적. `gw` 2번 spawn해서 병렬로 진행.

```
gw spawn "PR A: follow docs/superpowers/plans/2026-04-18-A-e2e-selector-audit.md"
gw spawn "PR C1: follow docs/superpowers/plans/2026-04-18-C1-peer-range-and-proxy-throw.md"
```

두 PR이 열리면 리뷰 및 머지.

### Phase 2 (A, C1 머지 후, 병렬)

```
gw spawn "PR B: follow docs/superpowers/plans/2026-04-18-B-ci-e2e-gating.md"
gw spawn "PR C2: follow docs/superpowers/plans/2026-04-18-C2-sdk-compat-matrix.md"
```

둘 다 `ci.yml`을 수정하지만 서로 다른 job을 추가하므로 논리 충돌은 없음. 먼저 머지되는 쪽이 head → 나머지 rebase.

---

## Merge Conflict 처리 매뉴얼

### B ↔ C2: 둘 다 `.github/workflows/ci.yml` 수정

두 PR 모두 `jobs:` 아래에 새 job(각각 `e2e`, `compat-check`)을 append. 실제 YAML 충돌 가능성:

- **Append 위치가 다르면**: auto-merge 가능 (git의 3-way merge가 처리)
- **Append 위치가 겹치면**: 수동 resolve. 두 job을 순서대로 놓으면 끝.

**권장 순서**: B를 먼저 머지 → C2 rebase. B가 한 번의 단순 append, C2의 matrix YAML이 더 복잡해 conflict resolve 비용이 C2 쪽이 낮음.

### C1 ↔ 다른 PR

C1이 `package.json`, `pnpm-lock.yaml`을 수정. 다른 PR이 lockfile을 건드리지 않으면 충돌 없음. A는 `e2e/panel.test.ts`만, B와 C2는 `ci.yml`만 건드려 무관.

---

## 진행 체크리스트

**Phase 1**:
- [ ] PR A 열림
- [ ] PR C1 열림
- [ ] PR A 머지
- [ ] PR C1 머지

**Phase 2**:
- [ ] PR B 열림 (A 머지된 main에서 분기)
- [ ] PR C2 열림 (C1 머지된 main에서 분기)
- [ ] PR B 머지
- [ ] PR C2 머지 (필요 시 rebase)

**릴리스**:
- [ ] C1 머지 후 release-please가 `0.1.0` PR을 자동 생성하는지 확인. minor bump가 맞는지 release notes 검토.

---

## 범위 밖 작업 (이 batch에 포함 안 됨)

- sdk-example ref pinning (TODO Medium)
- `check-sdk-update` cron을 daily로 또는 자동 PR 생성 봇으로 강화
- E2E를 dual-run (mock + real SDK) — 환경 부재로 불가
