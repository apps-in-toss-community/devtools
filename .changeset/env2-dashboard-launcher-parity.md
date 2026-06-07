---
'@ait-co/devtools': patch
---

환경 2(unplugin 터널 대시보드 + launcher PWA)에서 PR #409가 실기기에서 드러낸 절반 패리티 결함 두 개를 정정한다 (#411).

- 대시보드 "연결된 Pages" 섹션: env 2(unplugin 터널)는 plugin 핸들이 connected target을 노출하지 않아 라이브 page 목록을 알 수 없는데도 항상 빈 목록을 보여줬다. 거짓 빈 목록 대신 섹션 자체를 숨긴다 — `DashboardState.pages`를 `Array | null`로 넓혀 `null`이면 정적 렌더와 SSE 갱신 양쪽에서 섹션을 생략하고, env 3/4(MCP)는 기존대로 `router.active.listTargets()`로 실제 목록(빈 배열은 "attach된 페이지 없음")을 채운다.
- launcher deep-link: 미설치 브라우저 탭에서 `?url=` deep-link가 도착하면 곧장 live로 넘어가 설치 안내(install CTA)를 영구히 가려버렸다. 미설치(`!standalone && !local-dev`) 상태면 deep-link/저장 URL을 보존한 채 설치 화면을 먼저 띄우고 "설치 없이 이번만 열기" 버튼으로 막다른 길을 피한다. standalone/local-dev는 기존대로 바로 live, 설치 완료(`appinstalled`) 시 보존된 URL로 진입한다.
