---
'@ait-co/devtools': patch
---

feat(dashboard): 로컬 대시보드에 인스펙터 열기 링크 추가 — 살아있는 세션 기준 DevTools 진입점 (#503)

relay가 up이고 페이지가 attach된 경우, MCP 데몬 대시보드와 unplugin 터널 대시보드 모두에
"인스펙터 열기" 링크(ko) / "Open inspector" 링크(en)가 표시된다. 링크는 `target="_blank"`로
새 탭에서 Chii 인스펙터를 열며, TOTP at= 코드는 매 요청마다 fresh mint된다.

- `DashboardState`에 `inspectorUrl` 필드 추가
- 기존 `buildChiiInspectorUrl` (#485 수리) 재사용 — 중복 구현 없음
- SSE `/events` push로 라이브 갱신 (페이지 attach/detach 즉시 반영)
- i18n: ko "인스펙터 열기" / en "Open inspector"
- 환경 2(unplugin 터널): target ID 미노출 → `inspectorUrl: null` → 대기 hint 표시
- SECRET-HANDLING: 대시보드 HTML anchor href는 의도된 transport, stdout/로그 출력 없음
