# 시나리오 4 — 배포된 앱 live relay debug (환경 4) acceptance 절차

> 대상: 실기기 토스 앱 WebView(LIVE, 검수 통과) + CDP relay.
> HMR X, relay O (read-only 디버깅).

## 전제조건

- `MCP_ENV=relay npx @ait-co/devtools devtools-mcp` (debug 모드, relay env 명시)
- 검수 통과 + OPENED 상태의 앱 (`miniAppId: 31146`) — `aitcc app status 31146`으로 확인
- deep-link: `intoss-private://aitc-sdk-example?_deploymentId=<uuid>&debug=1&relay=<wss>`
- QR 스캔 (단일 정식 경로)

> 참고 — debug-relay 모드는 환경 기본값을 `relay`로 둔다 (issue #309). 첫 `tools/list`부터
> `build_attach_url`이 노출되므로 `MCP_ENV=relay` 강제 안내가 더는 필요 없다. `MCP_ENV`를
> 명시하면 그 값이 우선한다.

## MCP 도구 acceptance 체크리스트

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)
```

1. **`list_pages`**
   - `pages[0].url`이 live deploymentId 포함
   - `tunnel.up: true`
   - `lastSeenAt`이 30초 이내
   - `crashDetectedAt: null`

2. **`measure_safe_area`**
   - `source: "relay"`
   - `sdkInsetsSource: "window.__sdk"`
   - `sdkInsets.top`이 실기기 nav bar 높이

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `ok: true`
   - `value.environment: "production"` (LIVE 앱)

## 주의사항

- 환경 4는 read-only 디버깅용 — 상태 변경 SDK 호출(navigate, IAP 등)은 실유저에게 영향을 줌.
- `evaluate` + `call_sdk` 사용 시 side-effect 있는 호출 주의.
- 이 환경은 station 6(operate) 지원 — 배포 후 런타임 관측.
- dev-mode (`--mode=dev`) 미지원 — 이 환경은 debug-mode 전용.
- `MCP_ENV=relay`를 명시하지 않으면 터널 URL 감지 전 bootstrap 단계에서 `build_attach_url`이 노출되지 않을 수 있다.

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

| 필드 | 환경 1 (mock) | 환경 3·4 (relay) |
|---|---|---|
| `source` | `"mock"` | `"relay"` |
| `sdkInsetsSource` | `"window.__ait"` | `"window.__sdk"` |
| `sdkInsets.top` | DevTools panel 설정값 (예: 47) | 실기기 측정값 (예: 54) |
| `cssEnv.top` | CSS env var (panel context) | 0 (Toss host WebView override) |
| `userAgent` | desktop Chrome UA | iOS/Android Toss WebView UA |

이 diff를 기준으로 mock preset을 실측값으로 업그레이드한다.
