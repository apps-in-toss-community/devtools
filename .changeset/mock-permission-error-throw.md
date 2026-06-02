---
'@ait-co/devtools': patch
---

fix(mock): checkPermission()이 per-API *PermissionError 서브클래스를 throw하도록 변경 (#372)

권한 거부 시 plain Error 대신 web-framework 3.0의 타입드 PermissionError 서브클래스를
throw한다 — `instanceof PermissionError` / `instanceof OpenCameraPermissionError` 분기가
mock에서도 동작하도록 실 SDK 동작과 정렬.
