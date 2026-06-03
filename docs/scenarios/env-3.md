# 시나리오 3 — intoss-private relay dev (환경 3) acceptance 절차

> 대상: 실기기 토스 앱 WebView(dogfood) + CDP relay.
> HMR X (구조적 불가 — 결정 확정), relay O.

## 전제조건

- `devtools-mcp` 실행 후 `start_debug({mode: 'staging'})` 호출 (debug 모드)
  - MCP 기동: `npx @ait-co/devtools devtools-mcp`
  - 그런 다음 Claude Code에서: `start_debug({mode: 'staging'})`
  - `MCP_ENV=relay-dev` / `MCP_ENV=relay` 는 deprecated back-compat 별칭 — 새 세션에서는 `start_debug(staging)` 사용
- dogfood bundle deploy: `ait build && ait deploy --scheme-only`
- deep-link: `intoss-private://aitc-sdk-example?_deploymentId=<uuid>&debug=1&relay=<wss>`
- 진입 경로: QR 스캔 (단일 정식 경로 — `test-push` 폐기됨)

> 참고 — `devtools-mcp` 기동 직후 `start_debug({mode: 'staging'})`를 호출하면 relay connection이 준비된다.
> `--target=local`로 기동했어도 `start_debug(staging)`으로 relay로 hot-switch 가능하다(#356 DualConnectionRouter 대칭화 — 재시작 불필요).

## MCP 도구 acceptance 체크리스트

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)
```

1. **`list_pages`**
   - `pages[0].url`이 `intoss-private://` scheme + deploymentId 포함
   - `tunnel.up: true`
   - `lastSeenAt`이 30초 이내

2. **`measure_safe_area`**
   - `source: "relay-dev"` (출력 env.kind 불변 — 입력 mode `staging`에서도 동일)
   - `sdkInsetsSource: "window.__sdk"`
   - `sdkInsets.top`이 토스 앱 nav bar 높이 (일반적으로 44–54 CSS px)
   - `userAgent`에 Toss WebView / Mobile Safari 포함

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `ok: true`
   - `value: "toss"` (dogfood — 실기기 토큰. 실기기 검증 후 확정 필요: `'toss' | 'sandbox'` 중 하나)
   - 참고: `AIT.getOperationalEnvironment`(mock-only)는 `{environment, sdkVersion}` 객체를 반환하지만, `call_sdk("getOperationalEnvironment", [])`는 scalar `value`를 포함한 `{ok, value}` envelope를 반환한다

## attach 절차

1. `ait deploy --scheme-only` → scheme URL 획득
2. `build_attach_url(scheme_url, wait_for_attach=true)` 호출
3. QR 스캔 → 토스 앱이 dogfood bundle 로드 + relay attach
4. `list_pages` 확인 후 이후 도구 사용

## TOTP (선택)

`AIT_DEBUG_TOTP_SECRET` 설정 시 relay 인증 활성화 — relay URL 유출 방어.

- `build_attach_url` 호출 시 현재 유효 TOTP 코드(`at=<code>`)가 attachUrl에 **자동 splice**된다.
  별도 작업 불필요 — `build_attach_url`을 호출하면 최신 코드가 항상 포함된다.
- 응답에 `totp.expiresAt` (ISO timestamp) 포함 — 이 시각 이후 스캔 시 relay가 인증 실패.
  만료 시 `build_attach_url`을 재호출하면 새 코드가 포함된 URL을 발급받는다.
- 시크릿 값과 `at=` 코드는 절대 stdout/stderr/log 출력 금지.

troubleshooting: QR 스캔했는데 relay가 인증 실패 → `totp.expiresAt` 확인 후 `build_attach_url` 재호출.

## 트러블슈팅

### MCP 서버가 "이미 실행 중" 안내가 뜰 때

`devtools-mcp`가 이미 실행 중인 세션을 감지하면 stderr에 PID + wssUrl + 회복 명령을 출력합니다.
`--force` 플래그로 기존 세션을 종료하고 takeover할 수 있습니다:

```bash
npx @ait-co/devtools devtools-mcp --force
```

## get_diagnostics — environment 필드

`get_diagnostics` 응답의 `environment` 필드:

```json
{
  "kind": "relay-dev",
  "env": "relay",
  "reason": "derived:kind=relay,liveIntent=false",
  "liveGuardActive": false
}
```

- `kind`: 정밀 세 값(`mock` | `relay-dev` | `relay-live`).
- `env`: backward-compat 두 값(`mock` | `relay`). 기존 코드가 이 필드를 읽더라도 동작.
- `liveGuardActive`: relay-dev에서는 `false` — side-effect 도구(`call_sdk`, `evaluate`) 자유롭게 호출 가능.


## 환경 3 한계

- HMR 없음 (토스 WebView cold-load만)
- OPENED 전환 전 `PREPARE` 상태 cold-load: 가능
- dev-mode (`--mode=dev`) 미지원 — 이 환경은 debug-mode 전용

다음 단계: live(OPENED) 앱 디버깅이 필요하면 환경 4(`docs/scenarios/env-4.md`)로 진입.
