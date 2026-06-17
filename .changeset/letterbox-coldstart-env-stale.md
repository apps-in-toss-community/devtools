---
'@ait-co/devtools': patch
---

fix(launcher): letterbox cold-start env() stale-0 보정 게이트 누락 수정 + verdict 사유 노출 (#536)

iOS standalone cold start에서 env(safe-area-inset-top)가 0/stale을 반환해
letterbox 보정이 발동하지 않던 WebKit 결함(WebKit #274773)에 대응한다.

- `scheduleSafeAreaTopPolls()` 순수 함수 추가: 100/300/600/1000ms 4-checkpoint
  multi-timeout으로 env()를 재측정해 stale-0을 벗어난 값이 도착하면 즉시
  보정 게이트를 재평가한다.
- `detectLetterboxWithReason()` 함수 추가: 판정 사유(detected / notStandalone /
  landscape / shortfallTooSmall / safeAreaTopZero)를 반환해 cold-start 중
  `safeAreaTopZero` 상태를 diag 패널에서 식별 가능하게 한다.
- Launcher.tsx 뷰포트 측정 effect를 multi-timeout 방식으로 교체, diag 패널에
  판정 사유(`verdict`) + safeAreaTop 재측정 추이(`top re-measure trace`) 행 추가.
- letterbox.vitest.ts에 cold-start stale-0 → 재측정 후 정정 시나리오 테스트 추가.
