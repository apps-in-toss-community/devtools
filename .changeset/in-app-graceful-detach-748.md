---
'@ait-co/devtools': patch
---

in-app 디버그 표면에 graceful detach 추가 — run 종료 시 우리가 주입한 오버레이·상태를 정리해 미니앱을 조작 가능 상태로 되돌린다 (#748).

run7 실기기 관측(디버그 세션 종료 후 "Debugger Disconnected" 잔존)의 (b)-가설 코드 원인은 우리 표면 3건이었다: ① CDP로 주입된 `#__ait_debug_indicator` 배지가 종료 후 영구 잔존(`attach-orchestrator.ts` `buildIndicatorExpression`가 렌더, `relay-factory.ts` `close()`가 disconnected로만 바꾸고 제거는 안 함), ② eruda 인-페이지 콘솔이 unmount 없이 잔존, ③ keepAwake가 `beforeunload`에서만 복구돼 세션 종료(비-unload) 시 화면이 계속 awake.

- **배지**(`buildIndicatorExpression`): disconnected 상태를 non-blocking(`pointer-events:none` 즉시)·self-dismissing(창 이후 fade→DOM 제거)으로 변경. 재연결(`ait:relay-ws-state` open) 시 self-dismiss 취소·재마운트(transient 터널 blip은 배지를 날리지 않음), 컨트롤러는 유지돼 재주입 시 `window.WebSocket` 이중 래핑 없음. 기본 disconnected 라벨을 ko-primary `디버거 연결 끊김`으로.
- **in-app**(`attach.ts` `detachDebugSurface()`): 단일 idempotent·비-throw 정리 함수. 배지 제거 + eruda unmount(`unmountEruda()`) + keepAwake 복구. relay WS 종료의 모든 경로에 배선 — 비-4401 종료는 grace window 후(재연결 시 취소), 4401(TOTP 만료=종결)은 즉시, `error`는 방어적 스케줄, `pagehide`는 즉시(beforeunload-safe). `#478` fail-fast 보존을 위해 WS observer proxy는 의도적으로 유지.

경계(가설 a): 스피너 + 전체 터치 무반응은 우리 레이어 밖 — 우리 표면은 full-viewport 요소·body 스크롤/pointer 잠금·capture-phase 리스너가 없어 구조적으로 모든 입력을 흡수할 수 없다. 네이티브 토스 앱 오버레이는 JS로 해제 불가라 시도하지 않고 코드 주석으로 명시. 실기기 run7 재현 확인은 폰-게이트라 다음 env3 세션에서 검증 예정.
