---
"@ait-co/devtools": patch
---

fix: build_attach_url이 qrHttpServer 시작을 await하지 않아 첫 호출 race로 unicode QR fallback이 트리거되던 버그 수정.
