---
"@ait-co/devtools": patch
---

fix(test-runner): CLI 기본 timeout 30s→60s 정합 + relay 재연결로 파일 간 연쇄 실패 방지 (#731)

**FIX 1 (CLI 기본값 미반영)**: `cli.ts`가 `--timeout` 미지정 시 자체 기본값 `30_000`을 항상 `opts.timeoutMs`로 내려보내, `rpc.ts`의 `DEFAULT_TIMEOUT_MS = 60_000`(#726 상향분)이 CLI 경로에서 절대 쓰이지 않았다. 수정: CLI 기본값을 `60_000`으로 정합, help text·`relay-worker.ts`의 "(after retry)" 표시용 fallback도 동일하게 갱신.

**FIX 2 (relay WS 사망 시 파일 간 재연결 없음)**: 실측 run에서 한 파일의 30s×2 timeout 동안 트래픽이 없어 Cloudflare edge가 relay WebSocket을 idle-drop했고, 이후 모든 파일이 죽은 소켓에 즉시 실패하는 연쇄가 관측됐다. 에러 메시지 스스로 "enableDomains()로 재연결하세요"라고 안내하지만 러너는 이를 시도하지 않았다. 수정: `relay-worker.ts`의 파일 루프에서 WS-사망 계열 에러(`isRelayDisconnectMessage`, `chii-connection.ts`에서 export) 발생 시 다음 파일 전에 `enableDomains()` 재연결을 1회 시도(idempotent) — 성공 시 계속 진행, 실패 시 현재처럼 진행(루프 중단 없음). 타임아웃된 파일의 재시도 직전에도 방어적으로 1회 재연결(소켓이 이미 살아있으면 no-op).

**Out of scope**: 긴 evaluate 중 Cloudflare edge까지 keepalive가 전달되지 않는 근본 원인(#720)은 별도 후속 과제.
