---
"@ait-co/devtools": patch
---

fix: attach/dashboard HTML default locale을 ko로 + ko/en lang switcher + ?lang= override 추가 (#455)

- `parseAcceptLanguage` fallback을 `'en'`에서 `'ko'`로 변경 (빈/없는 Accept-Language 헤더 시 한국어 기본)
- `/attach`·`/` 대시보드 양쪽에 ko/en lang switcher 추가 (SSR 방식 — `?lang=` query param 기반 `<a href>` 링크, JS 핸들러 없음)
- `?lang=ko|en` query param이 Accept-Language 헤더보다 우선 적용
- switcher 링크는 기존 query(`u=` attachUrl, TOTP `at=` 캡슐 포함)를 보존하고 `lang`만 교체
