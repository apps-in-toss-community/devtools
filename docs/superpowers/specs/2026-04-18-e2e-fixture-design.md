# devtools 자기완결 E2E Fixture Design

> **대체 이력**: 이 spec은 앞서 작성된 `2026-04-18-e2e-testid-contract-design.md`(sdk-example에 testid 계약을 부여해 consumer로 쓰는 방향)를 대체한다. 브레인스토밍 중 "devtools 회귀 테스트가 다른 repo UI에 의존하는 것은 결합도가 과하다"는 판단으로 방향 전환. 이전 spec은 plan 단계에서 삭제된다.

## 1. Purpose

devtools의 E2E 회귀 테스트를 **자기완결적(self-contained)**으로 만든다. 현재 `playwright.config.ts`가 sdk-example을 git clone → install → build → preview 하는 경로는 제거한다.

E2E가 검증하는 것:

- **A. 도메인 smoke** — 각 mock API가 브라우저에서 크래시 없이 실행되고 결과 DOM에 반영된다.
- **B. 패널 UX** — devtools 패널의 열기/닫기, 드래그, 모바일 풀스크린, 위치 영속성.
- **C. 패널 ↔ 앱 bridge** — 패널 설정 변경(OS 변경, permission denied, clipboard mode, event trigger) → 앱 쪽 API 결과 변화.

제외:

- **D. 상세 mock 반환값** — jsdom 유닛 테스트(`src/__tests__/`)가 커버.
- sdk-example의 UI/데이터 흐름 — 이 spec 대상 아님.

## 2. Architecture

devtools repo 안에 최소 fixture 앱을 내장한다.

```
e2e/
├── fixture/
│   ├── index.html              # <div id="app"></div> + <script type="module" src="./main.ts">
│   ├── main.ts                 # 도메인 섹션 렌더 + devtools panel import
│   ├── helpers.ts              # apiButton() / apiSection() / apiInput() DOM 헬퍼
│   ├── vite.config.ts          # @ait-co/devtools/unplugin 적용, base '/' 
│   └── tsconfig.json           # 최상위 tsconfig를 extends, DOM lib 포함
└── panel.test.ts               # 21개 Playwright 테스트
```

`playwright.config.ts`의 `webServer`는 다음으로 바뀐다:

```ts
webServer: {
  command: [
    'pnpm build',                                              // devtools dist
    'pnpm --filter=false exec vite build --config e2e/fixture/vite.config.ts',
    'pnpm --filter=false exec vite preview --config e2e/fixture/vite.config.ts --port 4173',
  ].join(' && '),
  port: 4173,
  reuseExistingServer: !process.env.CI,
}
```

(`--filter=false`는 pnpm이 workspace filter 없이 루트 context에서 실행하도록 하는 관용. workspace가 단일 패키지면 생략 가능 — 구현 시 확인.)

### 핵심 점

- **unplugin 경로 검증**: `vite.config.ts`에서 `import aitDevtools from '@ait-co/devtools/unplugin'`를 적용해 `@apps-in-toss/web-framework` import를 mock으로 swap한다. 이게 E2E가 검증하는 **devtools의 본질 기능**.
- **panel 자동 마운트**: `main.ts`에서 `import '@ait-co/devtools/panel'` 한 줄. panel 자체도 devtools dist에서 온 것.
- **SDK import는 mock이 아닌 "실 SDK 경로"로**: fixture 코드는 `import { appLogin } from '@apps-in-toss/web-framework'`처럼 쓴다. 번들 시 unplugin이 devtools mock으로 치환 → 번들러 플러그인 경로 E2E 검증.

## 3. Fixture UI — flat HTML, 16 도메인 섹션

단일 페이지 하나에 16개 `<section>`이 stacked:

1. Auth
2. Navigation
3. Environment
4. Permissions
5. Storage
6. Location
7. Camera
8. Contacts
9. Clipboard
10. Haptic
11. IAP
12. Ads
13. Game
14. Analytics
15. Partner
16. Events

(총 16개 — devtools mock 전 도메인과 1:1. 레이어 C가 이미 커버하는 4개를 제외한 12개가 레이어 A의 타깃.)

### 3.1 Helper: `apiButton`, `apiInput`, `apiSection` (`e2e/fixture/helpers.ts`)

세밀한 testid는 전부 헬퍼가 규약으로 생성한다.

```ts
// 사용 예시 (실제 시그니처는 plan에서 확정)
apiSection('auth', 'Auth');            // <section data-testid="section-auth"><h2>Auth</h2>...
apiButton('auth-login', appLogin);      // <button data-testid="auth-login-btn">auth-login</button>
                                        // + <div data-testid="auth-login-result"></div>
apiInput('storage-key', 'Key');         // <input data-testid="storage-key-input">
```

- `apiButton(id, fn, opts?)`:
  - 렌더: 버튼 `data-testid="${id}-btn"` + 결과 `<div data-testid="${id}-result">`.
  - 클릭 시: `await fn()` 실행 → 성공 시 result div에 `JSON.stringify(value)` 또는 `'done'` 쓰기, 에러 시 result div에 `'error:' + String(err)` 쓰기.
  - `opts.formatResult?: (value) => string` 가 주어지면 직렬화 override.
  - `opts.withInputs?: string[]` 가 주어지면 해당 input testid에서 값을 읽어 fn(values)로 전달.
- `apiInput(id, label)`:
  - 렌더: `<label>` + `<input data-testid="${id}-input">`.
  - 테스트가 `page.getByTestId('${id}-input').fill(...)`.
- `apiSection(id, title)`:
  - 렌더: `<section data-testid="section-${id}"><h2>${title}</h2>...</section>`.
  - body를 반환해 이 섹션 안에 후속 `apiButton/apiInput` 호출.
- 또한 Environment / Storage 값 표시처럼 읽기 전용이 필요한 경우를 위해 **`apiValue(id)` or 유사 helper**가 필요 — `<div data-testid="${id}-value">`를 미리 만들고, 이후 코드가 해당 div에 값을 write. main.ts가 페이지 로드 시 env 값을 직접 조회해 채운다.

### 3.2 예외 — 현재 스위트가 요구하는 고유 testid

(c) 규약으로 전부 커버되지 않는 예외:

- **Environment 페이지 로드시 12값 표시** — `apiValue('env-platform')` 등을 렌더, main.ts가 로드 직후 `document.getElementById(...)` 대신 helper가 반환한 ref에 값 설정.
- **Event subscriber 영역** — `apiSubscriber('events-back', subscribeFn)` 유사 helper가 empty state / log entries 구분 렌더. 세부는 plan Task에서 확정.

## 4. Playwright 테스트 구성 (`e2e/panel.test.ts`)

총 21개.

### 4.1 Smoke (1)
- 홈 로드 `pageerror` 0, `data-testid="section-auth"` 등 랜드마크 렌더.

### 4.2 Layer A — 도메인 smoke (12)
아래 12 도메인 × 1 API = 12개. 각 테스트 구조:
```
page.getByTestId('<api-id>-btn').click()
expect(page.getByTestId('<api-id>-result')).not.toBeEmpty()  // 또는 특정 substring
```

각 도메인별 대표 API(plan에서 확정):
- auth → `auth-login` (appLogin)
- navigation → `nav-sharelink` (getTossShareLink)
- storage → `storage-clear` (clearItems)
- location → `location-current` (getCurrentLocation)
- camera → `photos-fetch` (fetchAlbumPhotos)
- contacts → `contacts-fetch` (fetchContacts)
- haptic → `haptic-tap` (generateHapticFeedback tap)
- iap → `iap-products` (getProductItemList)
- ads → `ads-admob-load` (loadAppsInTossAdMob)
- game → `game-profile` (getGameCenterGameProfile)
- analytics → `analytics-click` (Analytics.click)
- partner → `partner-add` (addAccessoryButton)

(4개 도메인 Environment / Permissions / Clipboard / Events는 Layer C가 이미 커버.)

### 4.3 Layer B — 패널 UX (4)
- Panel Toggle open/close
- Drag Y 변경
- Mobile Fullscreen (375×667 viewport)
- Position Persistence (reload 후 복원)

패널은 `.ait-panel*` CSS selector 기반 — fixture와 무관.

### 4.4 Layer C — 패널 ↔ 앱 bridge (4)
- **env**: 패널 env 탭 OS → android → `env-platform-value` 표시 변화
- **permissions**: 패널 permissions camera=denied → `camera-open-btn` 클릭 → `camera-open-result`에 `denied`
- **device**: 패널 device Clipboard=mock → `clipboard-input` fill → `clipboard-set-btn` → `clipboard-get-btn` → `clipboard-get-result`에 값 표시
- **events**: 패널 events "Trigger Back Event" → fixture의 `events-back-log`에 수신 엔트리 증가

testid는 plan에서 helper 호출 시점에 확정.

## 5. Build & Run

- `pnpm test:e2e` 실행 흐름: devtools build → fixture vite build → vite preview 4173 → Playwright.
- 첫 실행 시간 예상: sdk-example clone/install/build를 하지 않으므로 **대폭 단축** (수 분 → 수 초).
- CI: 이 PR의 `build-and-test` job은 기존 그대로 (unit만). E2E CI gating은 PR B(별도) 소관.

## 6. 의존성 변화

devtools `package.json` devDependencies 추가:
- `vite` (fixture 번들/preview). Vite 6.x (2026-04 기준 현행).

`@ait-co/devtools` 자체는 이미 이 repo의 code라 self-reference. fixture의 vite.config에서 `@ait-co/devtools/unplugin`, `@ait-co/devtools/panel`, `@apps-in-toss/web-framework` import는 기존 export path + devDependency를 통해 해결된다.

## 7. Scope 제외 (non-goals)

- sdk-example 수정 없음.
- devtools `src/mock/*`, `src/panel/*`, `src/unplugin/*` 구현 수정 없음.
- Playwright CI gating은 PR B.
- 레이어 D(상세 값 검증)는 jsdom 유닛에 위임.

## 8. 대체/삭제되는 문서

plan 단계에서 다음 파일들을 삭제(또는 일괄 정리)한다:

- `docs/superpowers/specs/2026-04-18-e2e-testid-contract-design.md` — 본 spec이 대체.
- `docs/superpowers/plans/2026-04-18-A-e2e-selector-audit.md` — 기 폐기된 초기 plan.
- `docs/superpowers/plans/2026-04-18-e2e-testid-contract.md` — testid 계약 접근에 해당하는 plan.
