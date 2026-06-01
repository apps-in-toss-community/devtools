# 시나리오 4 — 배포된 앱 live relay debug (환경 4) acceptance 절차

> 대상: 실기기 토스 앱 WebView(LIVE, 검수 통과) + CDP relay.
> HMR X, relay O (read-only 디버깅).

## 전제조건

- `devtools-mcp` 실행 후 `start_debug({mode: 'relay-live', confirm: true})` 호출 (debug 모드)
  - MCP 기동: `npx @ait-co/devtools devtools-mcp`
  - 그런 다음 Claude Code에서: `start_debug({mode: 'relay-live', confirm: true})`
  - `confirm: true` 없이 `relay-live` 호출하면 즉시 거부됨 — LIVE 진입 1차 게이트
  - `MCP_ENV=relay-live` 는 deprecated back-compat 별칭 (부팅 시 liveIntent 시드용). 새 세션에서는 `start_debug` 사용
- 검수 통과 + OPENED 상태의 앱 (`miniAppId: 31146`) — `aitcc app status 31146`으로 확인
- deep-link: `intoss-private://aitc-sdk-example?_deploymentId=<uuid>&debug=1&relay=<wss>`
- QR 스캔 (단일 정식 경로)

> 참고 — `start_debug({mode: 'relay-live', confirm: true})`가 LIVE guard를 무재구동으로 arms한다.
> `--target=local`로 기동했어도 `start_debug`로 relay-live로 hot-switch 가능하다(#356 DualConnectionRouter 대칭화).
> local 계열로 전환하면 LIVE guard가 자동 disarm된다.

## MCP 도구 acceptance 체크리스트

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment, [], confirm: true)
```

1. **`list_pages`**
   - `pages[0].url`이 live deploymentId 포함
   - `tunnel.up: true`
   - `lastSeenAt`이 30초 이내
   - `crashDetectedAt: null`

2. **`measure_safe_area`**
   - `source: "relay-live"`
   - `sdkInsetsSource: "window.__sdk"`
   - `sdkInsets.top`이 실기기 nav bar 높이

3. **`call_sdk("getOperationalEnvironment", [], confirm: true)`**
   - `ok: true`
   - `value: "toss"` (LIVE 앱 — 실기기 토큰. 실기기 검증 후 확정 필요: `'toss' | 'sandbox'` 중 하나)
   - LIVE guard 우회를 위해 `confirm: true` 필수 (없으면 거부됨 — 위 "LIVE side-effect guard" 섹션 참조)
   - 참고: `AIT.getOperationalEnvironment`(mock-only)는 `{environment, sdkVersion}` 객체를 반환하지만, `call_sdk("getOperationalEnvironment", [])`는 scalar `value`를 포함한 `{ok, value}` envelope를 반환한다

## LIVE side-effect guard

`relay-live` 세션(`start_debug({mode: 'relay-live', confirm: true})` 이후)에서 `call_sdk` 또는 `evaluate`를 호출하면 **명시적 동의 인자(`confirm: true`)가 없을 때 거부된다**.

```
[LIVE relay guard] call_sdk은 현재 relay-live(실 출시 런타임) 세션에서 side-effect 호출입니다.
...
1. `confirm: true` 인자를 추가해 재호출: call_sdk(…, confirm: true)
2. 읽기 전용 도구(list_pages, list_console_messages, take_screenshot 등)를 사용하세요.
3. dogfood 빌드(relay-dev 환경)에서 먼저 검증 후 live에 적용하세요.
```

**동의 후 호출 예시**:

```
call_sdk("getOperationalEnvironment", [], confirm: true)
evaluate("window.location.href", confirm: true)
```

읽기 전용 도구(`list_pages`, `list_console_messages`, `list_network_requests`, `take_screenshot`, `measure_safe_area`, `get_dom_document` 등)는 `confirm` 없이 자유롭게 호출 가능.

`get_diagnostics` 응답의 `environment.liveGuardActive`가 `true`이면 guard 활성 상태:

```json
{
  "kind": "relay-live",
  "env": "relay",
  "reason": "derived:kind=relay,liveIntent=true",
  "liveGuardActive": true
}
```

## TOTP (권장)

LIVE 환경에서는 `AIT_DEBUG_TOTP_SECRET` 설정을 권장한다 — relay URL이 유출되면 임의의 클라이언트가 attach할 수 있으므로 TOTP로 gate를 닫는다.

- `build_attach_url` 호출 시 현재 유효 TOTP 코드(`at=<code>`)가 attachUrl에 **자동 splice**된다.
- 응답에 `totp.expiresAt` (ISO timestamp) 포함 — 이 시각 이후 스캔 시 relay가 인증 실패.
  만료 시 `build_attach_url`을 재호출하면 새 코드가 포함된 URL을 발급받는다.
- 시크릿 값과 `at=` 코드는 절대 stdout/stderr/log 출력 금지.

troubleshooting: QR 스캔했는데 relay가 인증 실패 → `totp.expiresAt` 확인 후 `build_attach_url` 재호출.

## 주의사항

- 환경 4는 read-only 디버깅용 — 상태 변경 SDK 호출(navigate, IAP 등)은 실유저에게 영향을 줌.
- `evaluate` + `call_sdk` 사용 시 side-effect 있는 호출은 `confirm: true` 필수(guard가 강제).
- 이 환경은 station 6(operate) 지원 — 배포 후 런타임 관측.
- dev-mode (`--mode=dev`) 미지원 — 이 환경은 debug-mode 전용.
- 환경 3(`relay-dev`)은 `confirm` 없이 자유롭게 `call_sdk` 호출 가능. 환경 4(`relay-live`)는 LIVE guard 때문에 `confirm: true` 필수.

다음 단계: 운영 문제 발견 시 환경 3에서 dogfood 번들로 재현 후 `list_exceptions`·`take_screenshot`으로 진단.

## 트러블슈팅

### MCP 서버가 "이미 실행 중" 안내가 뜰 때

`devtools-mcp`가 이미 실행 중인 세션을 감지하면 stderr에 PID + wssUrl + 회복 명령을 출력합니다.
`--force` 플래그로 기존 세션을 종료하고 takeover할 수 있습니다:

```bash
npx @ait-co/devtools devtools-mcp --force
```

## 시나리오별 mock vs relay diff

환경 1(mock)과 환경 3·4(relay)의 `measure_safe_area` 응답 비교:

| 필드 | 환경 1 (mock) | 환경 3 (relay-dev) | 환경 4 (relay-live) |
|---|---|---|---|
| `source` | `"mock"` | `"relay-dev"` | `"relay-live"` |
| `sdkInsetsSource` | `"window.__ait"` | `"window.__sdk"` | `"window.__sdk"` |
| `sdkInsets.top` | DevTools panel 설정값 (예: 47) | 실기기 측정값 (예: 54) | 실기기 측정값 (예: 54) |
| `cssEnv.top` | CSS env var (panel context) | 0 (Toss host WebView override) | 0 (Toss host WebView override) |
| `userAgent` | desktop Chrome UA | iOS/Android Toss WebView UA | iOS/Android Toss WebView UA |

이 diff를 기준으로 mock preset을 실측값으로 업그레이드한다.
