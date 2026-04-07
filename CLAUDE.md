# CLAUDE.md

## 프로젝트 개요

**ait-devtools** — `@apps-in-toss/web-framework` SDK의 mock 라이브러리.
앱인토스 미니앱을 토스 앱 없이 일반 크롬 브라우저에서 개발/테스트할 수 있게 해준다.

## 기술 스택

- **TypeScript** (ESM only, `"type": "module"`)
- **tsup** — 빌드 (ESM + CJS for unplugin)
- **vitest** — 테스트 (jsdom 환경)
- **unplugin** — 모든 번들러 지원 (유일한 runtime dependency)
- **pnpm** — 패키지 매니저

## 명령어

```bash
pnpm build          # tsup으로 dist/ 빌드
pnpm dev            # watch 모드
pnpm typecheck      # tsc --noEmit (원본 SDK 대비 타입 호환성 검증 포함)
pnpm test           # vitest 실행
pnpm check-sdk-update  # SDK 새 버전 감지
```

## 프로젝트 구조

```
src/
├── mock/              # @apps-in-toss/web-framework의 모든 export를 mock으로 대체
│   ├── state.ts       # 중앙 상태 관리 (AitStateManager), window.__ait 노출
│   ├── proxy.ts       # 미구현 API용 Proxy fallback
│   ├── permissions.ts # 권한 시스템 (withPermission, checkPermission)
│   ├── types.ts       # 공유 타입
│   ├── auth/          # appLogin, getUserKeyForGame 등
│   ├── navigation/    # closeView, openURL, graniteEvent, 환경정보, SafeAreaInsets
│   ├── device/        # Storage, Location, Camera, Clipboard, Haptic
│   ├── iap/           # IAP, checkoutPayment (TossPay)
│   ├── ads/           # GoogleAdMob, TossAds, FullScreenAd
│   ├── game/          # 게임센터, 프로모션, contactsViral
│   ├── analytics/     # Analytics, eventLog
│   ├── partner/       # partner, tdsEvent
│   └── index.ts       # 통합 re-export (이 파일이 번들러 alias 대상)
├── panel/             # Floating DevTools Panel (vanilla DOM, 프레임워크 없음)
│   ├── index.ts       # 마운트 로직, 7개 탭 렌더러
│   └── styles.ts      # CSS 문자열
├── unplugin/          # unplugin 기반 번들러 플러그인
│   └── index.ts       # Vite/Webpack/Rspack/esbuild/Rollup export
└── __typecheck.ts     # 원본 SDK 대비 타입 호환성 검증 (빌드에 포함 안 됨)
```

## 코딩 컨벤션

- **외부 의존성 최소화**: panel은 vanilla DOM으로 작성. React/Preact 등 프레임워크 사용 금지.
- **모든 mock 함수는 원본 SDK 시그니처와 호환**: `src/__typecheck.ts`의 `Assert<Mock, Original>` 타입으로 검증.
- **권한이 필요한 함수**는 `withPermission(fn, permissionName)`으로 감싸서 `.getPermission()`, `.openPermissionDialog()` 부착.
- **이벤트 시스템**: `window.dispatchEvent(new CustomEvent('__ait:eventName'))`으로 통신. `aitState.trigger('backEvent')` 사용.
- **Storage mock**: localStorage에 `__ait_storage:` prefix로 저장하여 앱 자체 localStorage와 분리.

## 새 API mock 추가 절차

1. 해당 카테고리 디렉토리에 함수 구현 (예: `src/mock/device/`)
2. `src/mock/index.ts`에 export 추가
3. `src/__typecheck.ts`에 `type _NewApi = Assert<typeof Mock.newApi, typeof Original.newApi>;` 추가
4. `pnpm typecheck`로 원본과 호환되는지 검증
5. 테스트 작성

## SDK 업데이트 대응

- `@apps-in-toss/web-framework`는 devDependencies + optional peerDependencies
- `src/__typecheck.ts`가 컴파일 타임에 시그니처 불일치 감지
- `src/mock/proxy.ts`의 `createMockProxy`가 런타임에 미구현 API를 graceful 처리 (경고 + no-op)
- `.github/workflows/check-sdk-update.yml`이 매주 월요일 자동 감지 → 이슈 생성

## 패키지 export 구조

| Import path | 용도 |
|---|---|
| `ait-devtools` 또는 `ait-devtools/mock` | 번들러 alias 대상, 모든 mock export |
| `ait-devtools/panel` | Floating DevTools Panel (import 시 자동 마운트) |
| `ait-devtools/unplugin` | 번들러 플러그인 (.vite, .webpack, .rspack, .esbuild, .rollup) |
