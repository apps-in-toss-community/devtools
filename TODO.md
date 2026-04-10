# TODO

## 아키텍처 변경 (높은 우선순위)

### mock/panel 분리 — production에서 devtools 활성화 지원

현재 devtools = mock + panel이 한 덩어리로 묶여있다. 이를 분리하여:

- **development**: mock ON + panel ON (현재 동작 유지)
- **production (기본)**: devtools 완전 비활성화
- **production (forceEnable)**: panel ON + mock OFF (모니터링 전용). Panel에서 mock ON/OFF 토글 가능

#### 구현 방향

1. **unplugin 옵션 추가**:
   ```ts
   aitDevtools.vite({
     forceEnable: true,  // production에서도 devtools 유지 (mock 기본 OFF)
   })
   ```

2. **런타임 mock ON/OFF 토글**:
   - 원본 SDK와 mock을 둘 다 번들에 포함
   - 프록시 레이어에서 mock 상태에 따라 분기
   - Panel 헤더에 `[Mock: ON/OFF]` 토글 스위치

3. **Panel 모니터링 전용 모드** (mock OFF 상태에서도 유용한 기능):
   - Analytics 로그 뷰어
   - Storage 인스펙터
   - 환경 정보 표시
   - 이벤트 로그

4. **`import '@ait-co/devtools/panel'`만으로 Panel만 사용** (mock 없이)

## 문서 개선 (높은 우선순위)

- [x] **production 빌드 관련 문서화** — 조건부 적용 패턴 안내
- [x] **Turbopack 설정 보강** — Panel import 안내를 같은 섹션에 포함, `@apps-in-toss/web-bridge` 및 `@apps-in-toss/web-analytics` alias 추가
- [x] **수동 Alias 섹션에 Panel 직접 import 안내 추가** — 플러그인 없이 alias만 사용 시 Panel이 자동 주입되지 않는다는 점 명시
- [x] **Next.js Webpack 모드 설정 안내 추가** — `aitDevtools.webpack()`을 `next.config.js`에서 사용하는 방법
- [x] **README의 transformInclude 패턴 설명 수정** — 실제 코드와 일치
- [x] **예제 프로젝트 로컬 링크 workaround 안내** — `examples/vite-react`의 `file:` 링크 관련 주석

## 코드 개선 (중간 우선순위)

- [x] **`transformInclude`와 `transform`의 패턴 불일치 수정** — `src/unplugin/index.ts`에서 `app` 포함 여부 통일
- [x] **console.log prefix 통일** — `[@ait-co/devtools]`로 변경
- [x] **Promise 반환 패턴 통일** — async/await으로 일괄 전환
- [x] **`window.__ait` TypeScript 타입 선언 제공** — `src/env.d.ts`에 `Window` 인터페이스 확장

## 문서 보완 (낮은 우선순위)

- [x] **CLAUDE.md 구조 트리에 `__tests__/` 디렉토리 추가**
- [x] **테스트 섹션에 jsdom 환경 필요 안내 추가**
- [x] **서브패스 import 제한 문서화** — `@apps-in-toss/web-framework/some-subpath` 형태는 alias 미적용

## 배포/인프라

- [x] **GitHub Pages로 예제 앱 배포** — main push 시 자동 빌드 + 배포, `vite.config.ts`에 `base: '/devtools/'` 설정

## 지원하지 않는 것

- **React Native** — 이 프로젝트는 WebView 미니앱 전용. RN은 지원 범위 밖.
