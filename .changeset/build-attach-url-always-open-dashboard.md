---
"@ait-co/devtools": patch
---

`build_attach_url` 도구에서 `open_in_browser` 입력 옵션을 제거하고 항상 브라우저 대시보드 오픈을 시도하도록 변경합니다. 구버전 클라이언트가 `open_in_browser` 키를 전달해도 에러 없이 무시됩니다(하위호환). GUI 없는 headless 환경에서는 기존과 동일하게 텍스트 QR fallback이 출력됩니다.
