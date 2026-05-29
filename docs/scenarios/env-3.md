# 시나리오 3 — intoss-private relay dev (환경 3) acceptance 절차

> 대상: 실기기 토스 앱 WebView(dogfood) + CDP relay.
> HMR X (구조적 불가 — 결정 확정), relay O.

## 전제조건

- `devtools-mcp` 실행 (debug 모드)
  - **`MCP_ENV=relay-dev` 권장** (명시적으로 설정 — 환경 변수 미설정 시 CDP URL 패턴 자동 감지 + `defaultEnv=relay-dev`로 fallback되지만 명시가 안전함)
  - `MCP_ENV=relay`도 동작 (backward-compat alias → `relay-dev`로 해석)
- dogfood bundle deploy: `ait build && ait deploy --scheme-only`
- deep-link: `intoss-private://aitc-sdk-example?_deploymentId=<uuid>&debug=1&relay=<wss>`
- 진입 경로: QR 스캔 (단일 정식 경로 — `test-push` 폐기됨)

> 참고 — `devtools-mcp`의 debug-relay 모드는 기본 환경을 `relay`로 가정한다 (issue #309).
> 즉 빈 세션의 첫 `tools/list`부터 `build_attach_url`이 노출돼 `MCP_ENV=relay`를 강제할
> 필요가 없다. `MCP_ENV`를 명시하면 그 값이 우선한다.

## MCP 도구 acceptance 체크리스트

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)
```

1. **`list_pages`**
   - `pages[0].url`이 `intoss-private://` scheme + deploymentId 포함
   - `tunnel.up: true`
   - `lastSeenAt`이 30초 이내

2. **`measure_safe_area`**
   - `source: "relay"`
   - `sdkInsetsSource: "window.__sdk"`
   - `sdkInsets.top`이 토스 앱 nav bar 높이 (일반적으로 44–54 CSS px)
   - `userAgent`에 Toss WebView / Mobile Safari 포함

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `ok: true`
   - `value.environment: "dev"` (dogfood)
   - `value.sdkVersion` 포함

## attach 절차

1. `ait deploy --scheme-only` → scheme URL 획득
2. `build_attach_url(scheme_url, wait_for_attach=true)` 호출
3. QR 스캔 → 토스 앱이 dogfood bundle 로드 + relay attach
4. `list_pages` 확인 후 이후 도구 사용

## TOTP (선택)

`AIT_DEBUG_TOTP_SECRET` 설정 시 relay 인증 활성화 — relay URL 유출 방어.
시크릿 값은 절대 stdout/stderr/log 출력 금지.

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
  "reason": "env-var-relay-dev",
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
