---
"@ait-co/devtools": patch
---

fix(test-runner): retry-gate 활성화 — timeout 시 throw 대신 return, env3 기본 제한시간 60s 상향 (#726)

**BUG 1 (retry-gate 비활성)**: `rpc.ts`의 `injectAndRunBundle`이 per-file evaluate 제한 시간 초과 시 `Promise<never>` reject → throw 경로를 타 `relay-worker.ts`의 EVALUATE_TIMEOUT_MARKER 게이트(`return null` → 재시도 분기)에 절대 도달하지 못했다. 0.1.127에서 ship한 per-file retry(#723/#724)가 실질적으로 dead code였다. 수정: timeout arm을 `{ok:false, error:'rpc: evaluate timed out after …ms'}` return으로 변경해 relay-worker의 게이트가 발화하게 함. 진짜 CDP `exceptionDetails`는 계속 throw 유지(비재시도 경로).

**BUG 2 (env3 30s budget 부족)**: `DEFAULT_TIMEOUT_MS`를 30 000ms → 60 000ms로 상향. storage(13 device round-trip), iap(6–8 RTT), location(GPS cold-fix)이 단일 evaluate 내에서 누적 초과하던 문제 완화. per-it isolation은 별도 follow-up.

relay-worker.ts의 잘못된 주석("timeout은 ok=false return으로 표면화된다")도 실제 동작에 맞게 정정.
