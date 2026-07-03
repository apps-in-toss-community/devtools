---
"@ait-co/devtools": patch
---

test-runner 권한-상태 preflight hook 추가 (#739) — 첫 테스트 파일 실행 전 `__AIT_PERMS__`를 노출해 결정적 권한-상태 분기 지원

- 관련 세션당 한 번(첫 파일 주입 직전, 파일별 아님) `Runtime.evaluate`로 `window.__sdk`의 6개 권한-보유 API(`getClipboardText`/`setClipboardText`/`fetchAlbumPhotos`/`openCamera`/`fetchContacts`/`getCurrentLocation`) `.getPermission()`을 조회(non-blocking — `openPermissionDialog`/`requestPermission` 같은 네이티브 UI는 절대 열지 않음)해 `globalThis.__AIT_PERMS__ = { clipboardRead, clipboardWrite, album, camera, contacts, location }`로 노출합니다. 각 값은 `'allowed'|'denied'|'notDetermined'|'unavailable'`.
- 설계: 번들이 SDK를 독립적으로 import하지 않고 `window.__sdk`(`src/in-app/auto.ts`가 설치하는 페이지 전역)를 런타임에 참조한다는 사실을 확인하고, preflight를 번들 prepend가 아니라 **독립 페이지-전역 injectGlobals 방식**(`cell.ts`의 `runPermissionPreflight`)으로 구현했습니다 — `rpc.ts`의 번들 실행 경로는 무변경.
- Non-fatal: 프로브 실패/부재는 `'unavailable'`로 수렴하고, preflight 전체가 실패·타임아웃(10s bound)해도 stderr 한 줄만 남기고 테스트 실행은 계속됩니다.
- Report provenance: 수집된 권한 상태는 `RelayRunReport.preflight.permissions`와 (`--report-dir` 사용 시) 온디스크 리포트의 `preflight.permissions`에 실려, 4-cell diff가 테스트 결과와 실기기 권한 상태를 상관시킬 수 있습니다.
- env1(vitest, mock)은 이 러너를 거치지 않으므로 out of scope — sdk-example#265가 mock 자체 상태로 `__AIT_PERMS__`를 채우는 별도 seam을 담당합니다.
