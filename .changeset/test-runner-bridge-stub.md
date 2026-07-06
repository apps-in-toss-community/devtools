---
"@ait-co/devtools": patch
---

feat(test-runner): env3 blocking-UI SDK 호출 bridge-stub 인터셉터 — 무인화 마지막 조각 (#740)

`devtools-test`가 실기기 CDP relay로 `.ait.test` 번들을 주입해 돌리는 env3 러너에서, fullscreen 광고 `show*`·권한 다이얼로그(`openPermissionDialog`/`requestPermission`)·공유 시트(`saveBase64Data`)처럼 네이티브 UI를 띄우는 블로킹 SDK 호출은 사람이 직접 탭해야 해서 `*.manual.ait.test.ts` + `--manual-blocking`로 격리돼 있었다. 이번 PR은 그 격리 파일들도 **무인으로** 돌릴 수 있는 opt-in `--stub-blocking` 플래그를 추가한다.

새 `src/test-runner/bridge-stub.ts`가 페이지 쪽에서 `window.__sdk`를 감싸 위 4개 API 호출을 실제 네이티브 브리지로 보내지 않고 실기기 캡처(run11, 2.x iOS)에서 뽑은 고정 fixture로 즉시 응답한다. 기본은 OFF — 플래그를 안 주면 기존 동작과 바이트 단위로 동일하다. 스텁된 결과는 `<sdkLine>.<platform>.stubbed.json`이라는 별도 report 아티팩트로 분리되고 `cell.bridgeStub: true`로 도장을 찍어, 실기기 baseline/manual 리포트와 절대 섞이지 않는다.
