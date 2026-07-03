---
"@ait-co/devtools": patch
---

test-runner `--manual-blocking` 수동-변형 러너 모드 추가 (#741) — blocking 네이티브 UI(포토 피커·권한 다이얼로그·전면 광고) 테스트를 사람이 지켜보며 마지막 순서로 실행

- `*.manual.ait.test.ts` 파일명 규칙으로 태깅합니다. `--manual-blocking` 없이는 이 파일들이 glob 확장에서 제외되어 기존 무인 실행 경로는 그대로 유지됩니다(zero-diff). `--manual-blocking`을 주면 이 파일들이 포함되고, 항상 나머지 일반 파일 전부보다 뒤에 스케줄됩니다.
- 수동 파일을 주입하기 직전, 실시간 QR 대시보드(#734 SSE)에 현재 파일명 + 진행도(k/n)를 담은 `manualPrompt` 상태를 push하고 같은 안내를 CLI stdout에도 출력합니다. 사람이 폰을 탭할 시간을 주기 위해 수동 파일의 per-file evaluate timeout은 5분(`MANUAL_FILE_TIMEOUT_MS`)으로 고정되며, 일반 파일의 `--timeout`과는 독립적입니다.
- 리포트 provenance: 수동 파일의 결과에는 `mode: 'manual'`이 찍히고(부재 = 무인 실행), `--report-dir` 사용 시 수동 파일 결과는 표준 `<sdkLine>.<platform>.json`을 오염시키지 않도록 별도 `<sdkLine>.<platform>.manual.json`에 함께(대체가 아니라 추가로) 기록됩니다.
