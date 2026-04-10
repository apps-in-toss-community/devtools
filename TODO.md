# TODO

## High Priority
- [ ] Split `src/mock/device/index.ts` (427 lines) into per-domain files — Storage, Location, Camera, Clipboard, Haptic, Contacts, Network이 한 파일에 혼재. auth/, navigation/ 등 다른 모듈의 디렉토리 분리 패턴과 비일관적.
- [ ] Add tests for Camera/Photos/Contacts — `openCamera()`, `fetchAlbumPhotos()`, `fetchContacts()` 등 withPermission + mode dispatch를 사용하는 함수들에 테스트 없음.

## Medium Priority
- [ ] Fix `startUpdateLocation` permission pattern — `getCurrentLocation`은 `withPermission()` 래퍼를 사용하는데 `startUpdateLocation`은 `Object.assign()`으로 수동 부착. 패턴 통일 필요.
- [ ] Split `src/panel/index.ts` (~700 lines) into tab renderers — 8개 탭 렌더러 + 마운트 + 드래그 로직이 단일 파일. 탭별 분리 고려 (예: `panel/tabs/environment.ts`).
- [ ] Add error boundary to Panel mount — `aitState.subscribe()` 콜백에서 에러 시 패널이 조용히 죽음. try/catch 필요.
- [ ] E2E 테스트 보강 — mock/panel 분리, 드래그, 모바일 전체화면 등 새 기능에 대한 테스트.

## Low Priority
- [ ] Move shared types to `types.ts` — `PermissionName`, `PermissionStatus`, `DeviceMode` 등이 `state.ts`에 집중. `types.ts`로 옮기면 순환 의존 위험 감소.
- [ ] Improve prompt mode timeout message — 30초 타임아웃 시 패널 존재 여부와 무관하게 "Is panel imported?" 메시지 표시. 패널 유무에 따라 분기 필요.

## Out of Scope
- **React Native** — 이 프로젝트는 WebView 미니앱 전용. RN은 지원 범위 밖.
