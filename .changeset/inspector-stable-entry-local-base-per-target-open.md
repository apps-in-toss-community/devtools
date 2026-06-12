---
"@ait-co/devtools": patch
---

안정 `/inspector` 엔드포인트, env 2 로컬 relay base, 타겟 단위 자동-열기 추가 (issue #530)

**A. 안정 `/inspector` 엔드포인트 (QR HTTP 서버)**

`GET http://127.0.0.1:<qr-port>/inspector`를 추가한다. 요청마다 `getDirectInspectorUrl()` getter를
호출해 활성 타겟의 TOTP를 생성하고 `buildChiiInspectorUrl`로 조립한 URL로 302 redirect한다.
relay 비활성 또는 타겟 없음이면 502 + ko/en HTML. URL에 시크릿이 없으므로 stdout·대시보드·로그에
출력 가능. redirect Location은 HTTP 응답으로만 전달 — 로그 금지.

`getDashboardState().inspectorUrl`(= `/inspector` 자기 자신)을 redirect 대상으로 쓰면
무한 루프(ERR_TOO_MANY_REDIRECTS)가 발생한다. `/inspector` 라우트는 `getDirectInspectorUrl`
getter를 별도로 주입받아 직접 chii front_end URL을 조립하도록 분리해 이 루프를 방지한다.

**B. env 2 inspector는 로컬 base 우선**

unplugin이 relay 기동 후 `relayLocalUrl: http://127.0.0.1:<relay-port>`를 `.ait_urls`와
`AIT_RELAY_LOCAL_URL` env var에 기록한다. `bootExternalRelayFamily`는 이를 읽어
`BootedFamily.relayLocalHttpUrl`에 저장하고, `activeRelayHttpUrl` getter가 tunnel base 대신
로컬 base를 반환해 inspector URL 조립에 쓴다. CDP 연결 자체는 그대로 tunnel base 사용 (변경 시
attach 흐름 회귀 위험).

**C. 타겟 단위 자동-열기**

`AutoDevtoolsOpener._opened: boolean` (세션 1회 가드)를 `_openedTargets: Set<string>` (타겟 단위 dedupe)로
교체한다. 새 targetId의 첫 attach마다 자동으로 열리고, 같은 target 재통지는 dedupe(no-op). 여는 URL은
A의 안정 `/inspector` URL (`inspectorStableUrl`) 우선 — TOTP 만료 레이스 없음. legacy 경로는 하위 호환으로 유지.
