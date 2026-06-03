---
"@ait-co/devtools": patch
---

start_debug에 `mobile`(환경 2 실기기 PWA) 모드를 1급 모드로 추가하고 `relay-mobile` 출력 env를 도입했다. unplugin이 `tunnel: { cdp: true }`로 외부에 띄운 Chii relay에 MCP가 attach하는 쪽 절반으로, MCP는 relay/tunnel을 새로 띄우지 않고 `AIT_RELAY_BASE_URL`로 전달된 relay base에 CDP 클라이언트만 연다.

`mobile`과 `staging`은 둘 다 `kind:'relay'`라 출력에서 구분돼야 하므로, URL을 스니핑하지 않고 부팅된 family에 실어 나르는 `relayOrigin`(`'intoss-webview'` vs `'external-pwa'`) 디스크리미네이터를 `deriveEnvironment`에 넣었다. dual-connection 라우터는 단일 lazy slot을 `FamilyKey`(local/relay-intoss/relay-external) 키 Map으로 일반화해 두 relay family가 같은 슬롯에서 충돌하지 않는다. relay-mobile은 liveIntent가 항상 꺼져 있어 LIVE side-effect 가드 대상이 아니다.
