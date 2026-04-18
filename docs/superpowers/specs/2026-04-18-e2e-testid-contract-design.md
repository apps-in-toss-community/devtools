# E2E testid 계약 + devtools E2E 재작성 Design

> **배경**: 원래 `2026-04-18-A-e2e-selector-audit` plan은 "현재 sdk-example markup에 selector만 어긋남"을 전제로 했으나, sdk-example은 React Router + 16개 도메인 페이지 + 공통 `ApiCard` 구조로 전면 재작성됐고 `data-testid`가 전혀 없다. 75/75 테스트가 `beforeEach`의 `getByTestId('auth-section')`에서 실패. 단순 selector 교정으로 해결 불가. 이 design은 그 plan을 대체한다.

## 1. Purpose

devtools E2E가 sdk-example의 새 아키텍처(React Router + `ApiCard`)를 consumer로 삼아 다음 3가지 레이어를 증명한다:

- **A. 도메인 smoke** — 각 도메인의 mock API가 크래시 없이 실행되고 결과가 UI에 나타난다.
- **B. 패널 UX** — devtools 패널 자체(열기/닫기, 드래그, 모바일 풀스크린, 위치 영속성)가 sdk-example 위에서 정상 동작한다.
- **C. 패널 ↔ 앱 bridge** — devtools 패널에서 mock 설정을 바꾸면 sdk-example의 API 결과가 따라 변한다.

세밀 mock 반환값 검증(레이어 D)은 제외. 이미 jsdom 유닛 테스트(`src/__tests__/`)가 커버한다.

## 2. Architecture — 2-PR serial

**PR #1 (sdk-example)** — testid 계약을 3개 공통 컴포넌트에 추가. 기존 consumer 없으므로 순수 additive. 독립 merge.

**PR #2 (devtools)** — `e2e/panel.test.ts`를 21개 테스트로 재작성. `playwright.config.ts`의 `webServer`는 기존 그대로 sdk-example main을 clone. PR #1 merge 이후 CI에서 자연스럽게 green.

두 PR은 umbrella CLAUDE.md "각 repo 변경은 개별 PR로 분리" 원칙에 따른다. Cross-repo의존은 merge 완료 한 점에만 있다.

## 3. sdk-example testid 계약 (PR #1)

공통 컴포넌트 3개에만 testid를 추가한다. 도메인 페이지는 건드리지 않는다.

| 위치 | testid | 용도 |
|---|---|---|
| `<PageHeader>` 루트 | `page-${testId}` | 도메인 페이지 landmark. `testId`는 `PageHeader`의 신규 필수 prop. 각 도메인 페이지가 명시적으로 전달 (예: `testId="auth"`) |
| `<ApiCard>` 루트 | `api-card-${name}` | name prop을 그대로 사용 (예: `api-card-appLogin`) |
| `<ApiCard>` 실행 버튼 | `api-card-${name}-run` | 카드 내부 "실행" 버튼 |
| `<ResultView>` status 뱃지 | `result-status` | 텍스트: `Success` 또는 `Error`. `idle`/`loading` 상태에서는 해당 요소 없음 |
| `<ResultView>` data/error 영역 | `result-data` | `<pre>` 안의 JSON 또는 에러 메시지 텍스트 |

### 설계 노트

- **`result-status` / `result-data`는 테스트 시 카드 내부로 scope 된다**: `page.getByTestId('api-card-appLogin').getByTestId('result-status')`. 한 페이지에 카드가 여러 개라 scope 없이 쓰면 중복된다.
- **slug는 `PageHeader`의 신규 필수 prop `testId`로 명시 전달**한다 (title이 한국어라 자동 유도가 애매함). 각 도메인 페이지(`AuthPage.tsx` 등)는 kebab-case slug를 넘긴다. 페이지 자체의 레이아웃이나 JSX는 바꾸지 않는다 — 단 한 줄 prop 추가.
- slug 명명: 라우트 path에서 선행 `/`를 제거한 값 (`/auth` → `auth`, `/camera` → `camera`). 단일 어휘 권장.
- **ApiCard name 충돌 방지**: 한 페이지 내 같은 name이 없도록 한다(현재도 그렇다). 다른 페이지 간 중복은 허용(테스트는 페이지 진입 후 scope).

## 4. devtools E2E 구성 (PR #2)

총 **~21개** 테스트.

### 4.1 Smoke (1)

- 홈 로드 시 `pageerror` 0개, 도메인 리스트(`SDK Example` 헤딩 + 16개 링크)가 렌더된다.

### 4.2 Layer A — 도메인 smoke (12)

16개 도메인 중 레이어 C 시나리오에서 이미 커버되는 4개(Environment, Permissions, Clipboard, Events)를 **제외**한 12개 도메인 × 각 1개 테스트:

Auth, Navigation, Storage, Location, Camera, Contacts, Haptic, IAP, Ads, Game, Analytics, Partner.

각 테스트 구조:
```
goto '/'
클릭 도메인 카드 (이름으로)
api-card-* 하나 선택 (첫 번째 또는 파라미터 불필요한 것)
-run 버튼 클릭
result-status == Success 대기
```

### 4.3 Layer B — 패널 UX (4)

| # | 시나리오 |
|---|---|
| B1 | Panel Toggle — 버튼 클릭으로 open/close |
| B2 | Draggable — 드래그로 Y 위치 변경 (edge snap은 생략) |
| B3 | Mobile Fullscreen — viewport 375×667에서 풀스크린 + close 버튼 |
| B4 | Position Persistence — 드래그 후 reload 시 위치 복원 |

패널은 devtools가 DOM에 직접 mount하므로 기존 `.ait-panel*` CSS selector 그대로 동작. sdk-example testid와 무관.

### 4.4 Layer C — 패널 ↔ 앱 bridge (4)

각 카테고리 bridge가 살아있음을 1개씩 증명.

| # | 카테고리 | 시나리오 |
|---|---|---|
| C1 | env | 패널 env 탭 → OS를 android로 변경 → Environment 페이지의 `getPlatformOS` API 실행 → 결과 `android` 확인 |
| C2 | permissions | 패널 permissions 탭 → camera=denied → Camera 페이지의 `openCamera` 실행 → `result-status == Error` + `result-data` 안에 `denied` 포함 |
| C3 | device modes | 패널 device 탭 → Clipboard=mock → Clipboard 페이지에서 `setClipboardText` → `getClipboardText` → 결정적 왕복 확인 |
| C4 | events | 패널 events 탭 → "Trigger Back Event" 클릭 → Events 페이지의 이벤트 로그(app-side 구독)에 `backEvent` 표시 |

**C4 참고**: 현재 sdk-example `EventsPage.tsx`가 이벤트 구독 + 로그 UI를 갖추고 있는지 구현 단계에서 재확인한다. 없으면 C4는 범위에서 드롭하고 B/C 통합 smoke로 대체(브레인스토밍 합의 시 "각 카테고리 1개"의 정신).

### 4.5 Test helpers

- `openPanel(page)` / `closePanel(page)` / `switchTab(page, tabId)` — 기존 그대로.
- `gotoHome(page)` — `page.goto('/')` + `SDK Example` 헤딩 대기.
- `gotoDomain(page, name)` — 홈에서 도메인 카드(`page.getByRole('link', { name })`) 클릭 후 `page-<slug>` 대기.
- `runApi(page, apiName)` — 현재 페이지 내 `api-card-<name>` scope 후 `-run` 클릭.
- `expectApiSuccess(page, apiName, opts?)` — `api-card-<name>` 내 `result-status == Success` 대기. `opts.timeout` 허용.
- `expectApiResultContains(page, apiName, text)` — `result-data` 텍스트 검증.

`beforeEach`는 `gotoHome(page)`로 대체. 기존의 `getByTestId('auth-section')` 대기는 제거.

## 5. Rollout & Verification

### PR #1 (sdk-example)
- 커밋 구성(예상): `feat: add data-testid contract to ApiCard, ResultView, PageHeader` 1개 커밋이면 충분.
- 로컬 검증: `pnpm typecheck && pnpm build && pnpm preview`로 렌더 확인. Playwright MCP로 각 도메인 1개씩 눈으로 확인.
- 독립 merge 가능. CI는 기존 그대로.

### PR #2 (devtools)
- `e2e/panel.test.ts` 전면 재작성. 단일 커밋 대신 레이어 단위로 분할(`test(e2e): rewrite smoke + layer A`, `test(e2e): add layer B panel UX`, `test(e2e): add layer C bridge`).
- **로컬 증명 절충**: 이 세션에서 PR #2 green을 보이려면 `playwright.config.ts`의 clone URL을 로컬 sdk-example 브랜치 경로로 임시 변경해 1회 실행 후 원상복구. 증명 로그를 PR description에 첨부.
- 절충이 막히면 PR #2 description에 "PR #1 merge 후 CI에서 green 검증"을 명시.
- `playwright.config.ts`는 clone URL / 타임아웃 외 변경 없음.

## 6. Scope 제외 (explicit non-goals)

- devtools 유닛 테스트, `src/` mock 구현은 변경하지 않는다.
- sdk-example 도메인 페이지의 UX/레이아웃은 변경하지 않는다 — `PageHeader`에 prop 추가 + 각 페이지에서 그 prop 전달만.
- 레이어 D(상세 mock 반환값 검증)는 E2E 범위 밖. jsdom 유닛에 위임.
- Playwright CI gating(PR B로 관리)은 이 design 대상이 아님.

## 7. 대체된 이전 plan

`docs/superpowers/plans/2026-04-18-A-e2e-selector-audit.md`는 이 design의 완료와 함께 폐기된다. 구현 plan 단계에서 그 파일을 삭제하거나 deprecated 마크를 붙인다.
