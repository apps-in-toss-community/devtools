# TODO

## 완료됨

- [x] mock/panel 분리 — production에서 devtools 활성화 지원 (#24, #25)
- [x] production 빌드 관련 문서화 (#26)
- [x] Turbopack 설정 보강 (#26)
- [x] 수동 Alias 섹션에 Panel 직접 import 안내 (#26)
- [x] Next.js Webpack 모드 설정 안내 (#26)
- [x] README의 transformInclude 패턴 설명 수정 (#26)
- [x] 예제 프로젝트 로컬 링크 workaround 안내 (#26)
- [x] `transformInclude`와 `transform`의 패턴 불일치 수정 (#23)
- [x] console.log prefix `[@ait-co/devtools]`로 통일 (#23)
- [x] Promise 반환 패턴 통일 (#23)
- [x] `window.__ait` TypeScript 타입 선언 (#23)
- [x] CLAUDE.md 구조 트리에 `__tests__/` 디렉토리 추가 (#21)
- [x] 테스트 섹션에 jsdom 환경 필요 안내 (#21)
- [x] 서브패스 import 제한 문서화 (#21)
- [x] GitHub Pages 예제 앱 배포 (#22)
- [x] Panel 고정 높이 + 모바일 전체화면 + 드래그 이동 (#27)

## 남은 작업

- [ ] **v0.0.2 릴리즈** — release-please PR #18 merge → npm publish 자동 실행
- [ ] **E2E 테스트 보강** — mock/panel 분리, 드래그, 모바일 전체화면 등 새 기능에 대한 테스트
- [ ] **Panel 모니터링 전용 모드 고도화** — mock OFF 상태에서 원본 SDK 이벤트를 intercept하여 로그 표시

## 지원하지 않는 것

- **React Native** — 이 프로젝트는 WebView 미니앱 전용. RN은 지원 범위 밖.
