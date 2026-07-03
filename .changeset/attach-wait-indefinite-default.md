---
"@ait-co/devtools": patch
---

test-runner: QR attach 대기 기본을 무제한으로 — `--attach-timeout` 명시 시에만 bound(CI용). 인터랙티브 dog-food에서 러너가 스캔 전에 죽는 문제 해소(#735)

`ait-test-runner`의 QR attach 대기 기본값이 600초(10분)라, 사람이 폰을 들고 스캔하는 인터랙티브 dog-food에서 러너가 스캔 전에 죽는 일이 반복됐다. QR 스캔 대기는 사람 페이스의 행위라 기본은 유저가 명시적으로 러너를 종료할 때까지(Ctrl-C/SIGTERM) 무제한 대기하도록 바꿨다. 시간 제한이 필요한 CI/headless 호출자는 기존 `--attach-timeout <ms>` 플래그로 그대로 opt-in할 수 있다.

`chii-connection.ts`의 `waitForFirstTarget`에는 non-finite(`Infinity`) timeout 가드를 추가했다 — Node가 `setTimeout(fn, Infinity)`를 ~1ms로 clamp하기 때문에, 가드 없이 그대로 넘기면 무제한 대기가 즉시 reject되어 버린다. 다른 호출자(기존 90초 기본값 경로)는 영향 없음.

세그먼트 wait의 TOTP `at=` re-mint(30초 슬라이스마다 aging 코드 재발급)는 이번 변경으로도 그대로 무한히 반복된다 — 유출된 stale URL을 거부하는(4401) 보안 모델이 대기 시간과 무관하게 계속 유효하다.
