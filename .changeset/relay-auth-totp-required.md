---
"@ait-co/devtools": patch
---

relay 인증 TOTP를 필수 baseline으로 강제한다 (#250). 기존에는 `AIT_DEBUG_TOTP_SECRET`이 설정된 경우에만 §4 Layer C TOTP gate가 켜져, 미설정 시 relay가 공개 `wss://…trycloudflare.com` 터널을 인증 없이 노출했다 — URL이 유출되면 제3자가 dogfood/live 미니앱에 디버거를 attach할 수 있는 갭. 이제 public relay가 실제로 부팅되는 모든 지점에서 fail-fast한다.

- 새 가드 `assertRelayAuthConfigured()`(`src/mcp/totp.ts`)를 `bootRelayFamily`(intoss env 3/4)와 `bootExternalRelayFamily`(env-2 PWA) 진입에 배치 — eager·lazy(DualConnectionRouter) relay boot 양쪽 모두 relay/CDP가 열리기 전에 검증한다. local-only 세션(relay 미부팅)은 가드를 거치지 않아 그대로 면제.
- unplugin `tunnel: { cdp: true }`의 env-2 relay도 가드 + `verifyAuth`를 배선 — 이전엔 이 relay가 `verifyAuth` 없이 떠 secret과 무관하게 인증이 비어 있었다. 미설정 시 relay를 띄우지 않고 화면 미리보기로 degrade.
- 검증은 hex(base16, `Buffer.from(secret, 'hex')` decode 경로에 정합) 형식 + 32자 이상 + 짝수 길이. 미설정/빈 문자열/약형은 거부.
- fail-fast 안내는 요구사항과 발급 명령(`openssl rand -hex 32`)만 출력하고 secret 값·길이·파생값을 절대 노출하지 않는다.
