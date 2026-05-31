---
"@ait-co/devtools": patch
---

docs(env-1): clarify call_sdk acceptance for non-dogfood fixture (#324)

`--mode=local`에서 non-dogfood fixture를 사용하면 `call_sdk("getOperationalEnvironment", [])` 결과가 `ok: false`로 반환된다. `window.__sdkCall` bridge는 dogfood 빌드(`__DEBUG_BUILD__` 정의)에서만 주입되므로 non-dogfood fixture에서는 bridge가 없어 `ok: false`가 정상 동작이다. `--mode=dev`는 mock state HTTP 폴링을 사용해 dogfood 빌드 없이 `ok: true`를 반환한다.

`docs/scenarios/env-1.md`와 `docs/qa/scenarios.md`를 각 모드·빌드 조합별로 예상 결과를 명시하도록 정정.
