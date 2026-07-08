---
'@ait-co/devtools': patch
---

in-app gate가 3.0 런타임 서빙 계약을 통과하도록 수정 (#760). 3.0 로더는 미니앱을 `*.private-apps.tossmini.com`이 아닌 tossmini 계열 호스트에서 서빙하고 `_deploymentId`를 네이티브에서 소비해 페이지 URL로 전파하지 않는다 — 기존 gate는 Layer B 호스트 allowlist와 B2 `_deploymentId` 요구에서 이중 차단됐다. 이제 Layer B는 `*.tossmini.com` 계열 필터(`isTossminiHost` 신설·export)로 넓히되, private-apps가 아닌 tossmini 호스트에서는 Layer C3가 TOTP `at=` 파라미터를 (verifier 미주입 시에도) 필수로 요구해 #665의 "production 계열 호스트에서 naked attach 금지" 불변식을 유지한다. B2는 private-apps 호스트에서만 `_deploymentId`를 요구하고 그 외에는 존재 시 보고만 한다.
