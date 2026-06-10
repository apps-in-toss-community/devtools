---
"@ait-co/devtools": patch
---

attach 시 자동 오픈되는 DevTools inspector URL을 appspot 의존에서 chii 자가 호스팅 front_end + fresh TOTP(`at=`)로 전환. `buildChiiInspectorUrl`이 relay base 경유 `<relay>/front_end/chii_app.html?wss=<host>/client/<uuid>?target=<id>&at=<code>` 포맷을 조립하며, `AutoDevtoolsOpener.open()`은 기존 2-arg 시그니처 대신 `DevtoolsOpenOptions` 객체를 받아 relay HTTP base URL·target id·mintTotp 클로저를 받는다. relay gate(#478) 4401 거부와 appspot `@` 리비전 미검증 문제를 함께 해소.
