# dogfood → QR → relay 디버깅 루프 운영 가이드

이 문서는 **환경 3·4(실기기 토스 앱 WebView + CDP relay)** 의 디버깅 루프를 처음 실행하거나 반복 실행할 때 막힘 없이 완주하기 위한 메인테이너 가이드다.

설계 정본(환경 4겹 모델, relay TOTP 인증 아키텍처): [umbrella `meta/four-environments-fidelity.md`](https://github.com/apps-in-toss-community/umbrella/blob/main/meta/four-environments-fidelity.md)

---

## 사전 조건

| 항목 | 비고 |
|---|---|
| Node 24 LTS + pnpm 10.33.0 | `packageManager` 고정 |
| `AIT_DEBUG_TOTP_SECRET` 환경 변수 설정 | TOTP 인증 활성화에 필요. 미설정 시 relay 인증 없이 동작하지만, **production dogfood 루프에서는 반드시 설정**해야 터널 URL 유출 시 제3자 attach를 막을 수 있다. 값은 `<your-totp-secret>` 플레이스홀더로 대체 — 실 값은 절대 문서·로그·stdout에 출력 금지 |
| 토스 앱 설치된 실기기 | iOS 권장 |
| sdk-example dogfood 배포 완료 | 워크스페이스 `3095`, miniAppId `31146`. `aitcc app deploy` 로 배포. 배포 상태·운영 컨텍스트: [`console-cli/docs/api/mini-apps.md`](https://github.com/apps-in-toss-community/console-cli/blob/main/docs/api/mini-apps.md) |
| `intoss-private://...` scheme URL | `ait deploy --scheme-only` 출력값. `_deploymentId=<uuid>` 쿼리가 포함된 URL 형태여야 한다 |
| Claude Code `.mcp.json` 배선 완료 | umbrella `.mcp.json` 또는 아래 "MCP 서버 시작" 섹션 참조 |

---

## 단계별 루프

### 1. MCP 서버 시작

umbrella `.mcp.json`에 이미 배선돼 있다:

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-y", "@ait-co/devtools", "devtools-mcp"],
      "env": {
        "AIT_DEBUG_TOTP_SECRET": "<your-totp-secret>"
      }
    }
  }
}
```

Claude Code를 시작하면 MCP server가 자동 기동한다. `devtools-mcp`는 로컬 Chii relay를 OS 할당 포트로 띄우고 cloudflared quick tunnel(`*.trycloudflare.com`)을 발급한다.

> **반복 실행 시**: MCP server를 재시작하면 **tunnel URL이 교체된다**. 이전 세션의 QR/URL로는 relay에 붙을 수 없다 — 아래 "자주 깨지는 경우"를 참고.

### 2. 터널 상태 확인 — `list_pages`

```
list_pages
```

정상 응답:

```json
{
  "tunnelStatus": { "up": true, "wssUrl": "wss://<id>.trycloudflare.com" },
  "pages": []
}
```

`up: true` + `wssUrl`이 있으면 다음 단계로 진행한다. `up: false`이면 "자주 깨지는 경우" 섹션을 참고.

### 3. QR 페이지 생성 — `build_attach_url`

```
build_attach_url
  scheme_url: "intoss-private://aitc-sdk-example?_deploymentId=<uuid>"
```

MCP가 HTML 페이지를 브라우저에서 자동으로 연다. 페이지에는:

- **QR 코드** — TOTP가 활성화된 경우 30초 rotating `at=` 코드가 포함된 deep link를 인코딩
- 연결 방법 안내

TOTP 시크릿·코드 값은 QR 페이지에 표시되지 않는다(SECRET-HANDLING: 값은 relay 서버 내부에서만 처리).

### 4. 폰 카메라로 QR 스캔

기본 카메라 앱(iOS: 카메라, Android: 기본 카메라)으로 QR을 스캔한다.

> **주의**: 토스 앱 내 QR 리더로 스캔하면 안 된다. 토스 내 QR 리더는 별도 알림 채널로 처리되어 `debug=1&relay=...` 쿼리를 실어 보내지 못한다(gate Layer C 차단) — 환경 3 진입은 반드시 **기본 카메라 앱 스캔 → "토스로 열기" 탭** 경로만 유효하다.

스캔 후 "토스로 열기"를 탭하면 미니앱이 cold-load된다(`debug=1&relay=<wssUrl>&at=<totp-code>` 포함).

### 5. In-app gate 통과 확인

미니앱이 로드되면 in-app gate(Layer A/B/C)가 순서대로 처리된다:

| Layer | 역할 | 실패 원인 |
|---|---|---|
| A | `__DEBUG_BUILD__` 플래그 확인 | dogfood 빌드가 아닌 경우 |
| B | `@ait-co/devtools/in-app` 주입 여부 | in-app import 누락 |
| C | relay TOTP 인증 | `AIT_DEBUG_TOTP_SECRET` 미설정 또는 TOTP 코드 만료 |

모든 gate 통과 후 Chii `target.js`가 주입되고 relay에 WebSocket으로 연결된다.

### 6. Attach 확인 — `list_pages` 재호출

```
list_pages
```

attach 성공 시 `pages` 배열에 페이지가 나타난다:

```json
{
  "tunnelStatus": { "up": true, "wssUrl": "wss://..." },
  "pages": [{ "id": "...", "title": "aitc-sdk-example", "attached": true }]
}
```

이 시점부터 attach 의존 tool이 MCP 세션에 동적 등록된다(세션 재시작 불필요):

- `list_console_messages`, `list_network_requests`
- `get_dom_document`, `take_snapshot`, `take_screenshot`
- `measure_safe_area`, `evaluate`, `call_sdk`
- `AIT.getSdkCallHistory`, `AIT.getMockState`, `AIT.getOperationalEnvironment`

### 7. SDK API 관측

attach 이후 에이전트가 직접 관측한다. 예시:

```
# 기기 방향 전환 (Apps-in-Toss는 SDK-controlled, 자동 회전 없음)
call_sdk("setDeviceOrientation", [{ type: "portrait" }])

# safe-area 실측 (viewport preset 승급용)
measure_safe_area

# 콘솔 로그 확인
list_console_messages
```

> **앱인토스 방향 제어 주의**: 일반 웹과 달리 Apps-in-Toss 미니앱은 시스템 자동 회전이 없다. portrait/landscape 전환은 반드시 `setDeviceOrientation` SDK 호출로만 이뤄진다.

---

## 자주 깨지는 경우와 복구

### tunnel URL 교체 (MCP 재시작)

**증상**: `list_pages` → `up: false` 또는 폰 attach 후 페이지가 안 뜸.

**원인**: MCP server(또는 cloudflared tunnel)를 재시작하면 `*.trycloudflare.com` URL이 교체된다. 이전 QR/URL로 연결된 폰은 자동으로 끊긴다.

**복구**:
1. Claude Code에서 MCP server 재시작
2. `list_pages` → `up: true` + 새 `wssUrl` 확인
3. `build_attach_url`로 새 QR 생성
4. 폰 카메라로 새 QR 재스캔

### cloudflared tunnel 연결 끊김

**증상**: `list_pages` → `up: false`. MCP가 자동 fail-fast([#252](https://github.com/apps-in-toss-community/devtools/issues/252) 참조).

**복구**: MCP server 재시작 → "tunnel URL 교체" 절차와 동일.

### 폰 앱 백그라운드 전환 / 화면 잠금

**증상**: attach된 페이지가 `list_pages`에서 사라지거나 응답 없음.

**복구**: 폰에서 토스 앱을 다시 포그라운드로 가져온다. 필요 시 새 QR 재스캔.

### 미니앱 재로드 시 page가 두 개 뜨는 것처럼 보임

`list_pages`는 항상 **최대 1개** page를 반환한다(single-attach model — `singleAttachModel: true` 필드로 확인 가능). 같은 미니앱을 재로드하거나 QR을 다시 스캔하면 새 attach가 도착하는 순간 이전 page 세션은 자동으로 교체된다(last-attach wins). 이전 세션에 대기 중이던 CDP 명령은 즉시 `replaced-by-new-attach` 오류로 reject된다. 새 page가 `list_pages`에 나타나면 `enableDomains()`를 다시 호출해 CDP 연결을 재활성화한다.

### PREPARE 상태에서 cold-load 안 됨

**증상**: QR을 스캔해도 미니앱이 열리지 않거나 다른 화면으로 이동.

**원인**: scheme URL에 `_deploymentId=<uuid>` 쿼리가 없거나 잘못된 경우.

**복구**: `ait deploy --scheme-only`를 다시 실행해 올바른 URL을 얻는다. `_deploymentId`가 포함된 URL인지 확인 후 `build_attach_url` 재실행.

### REVIEW lock (errorCode 4046)

**증상**: `aitcc app deploy` 실패, `errorCode: 4046`.

**원인**: 앱인토스 콘솔 REVIEW lock 상태 — 운영팀 처리 대기 중.

**대응**: 운영팀 처리를 기다린다. **새 앱을 만들어 우회하지 않는다** — sdk-example dogfood는 miniAppId `31146` 단일 update 모드로만 운영한다. 배경: [`console-cli/docs/api/mini-apps.md`](https://github.com/apps-in-toss-community/console-cli/blob/main/docs/api/mini-apps.md).

### 잘못된 SDK 시그니처로 토스 앱 crash

**증상**: `call_sdk` 호출 직후 폰에서 토스 앱이 종료되거나, `list_pages` → `pages: []` (attach 소실).

**원인**: SDK 메서드가 객체 인자를 기대하는데 원시 값(문자열/숫자)을 전달하면 native bridge(Swift/Kotlin)에서 `.type` 등의 프로퍼티를 `undefined`로 읽어 crash한다.

흔한 실수 예:

```
# 잘못된 호출 — crash 위험
call_sdk("setDeviceOrientation", ["landscape"])   // ❌ 문자열 전달
call_sdk("setIosSwipeGestureEnabled", [true])     // ❌ boolean 전달
call_sdk("setSecureScreen", [{ isSecure: true }]) // ❌ 잘못된 키

# 올바른 호출
call_sdk("setDeviceOrientation", [{ type: "landscape" }])      // ✓
call_sdk("setIosSwipeGestureEnabled", [{ isEnabled: false }])  // ✓
call_sdk("setSecureScreen", [{ enabled: true }])               // ✓
```

`call_sdk` 도구는 등록된 메서드(12개)에 대해 bridge 호출 전에 인자를 검증하고, 시그니처 불일치 시 즉시 `{ok:false, error}` 형태로 거부한다 ([#264](https://github.com/apps-in-toss-community/devtools/issues/264)). 미등록 메서드는 passthrough되므로, crash 후 `AIT.getSdkCallHistory`로 호출 이력을 확인해 인자 형태를 검토한다.

**복구**: `build_attach_url`로 새 QR을 생성해 폰을 다시 attach한다.

### TOTP 코드 만료 (Layer C 실패)

**증상**: QR 스캔 → 미니앱은 열리지만 relay에 붙지 않음. `list_pages`에 페이지 미등장.

**원인**: TOTP 코드(`at=`)는 30초마다 교체된다. `build_attach_url` 호출 후 30초 이상 경과하면 코드가 만료된다.

**복구**: `build_attach_url`을 다시 호출해 새 QR을 받고 즉시 스캔한다.

---

## Acceptance 기준 (이 문서 완료 조건) {#acceptance}

- [ ] 메인테이너가 dogfood 빌드부터 relay 관측까지 이 문서만으로 완주
- [ ] 2회차 실행 시 1회차 대비 새로운 수동 우회 없음

---

## 관련 링크

- [umbrella `meta/four-environments-fidelity.md`](https://github.com/apps-in-toss-community/umbrella/blob/main/meta/four-environments-fidelity.md) — 환경 3·4 설계 정본 (이 루프가 환경 3·4에 해당)
- [#194](https://github.com/apps-in-toss-community/devtools/issues/194) — relay TOTP 인증 구현 (`AIT_DEBUG_TOTP_SECRET` 배경)
- [#252](https://github.com/apps-in-toss-community/devtools/issues/252) — cloudflared 연결 끊김 fail-fast
- [`console-cli/docs/api/mini-apps.md`](https://github.com/apps-in-toss-community/console-cli/blob/main/docs/api/mini-apps.md) — 31146 dogfood 앱 운영 컨텍스트 (REVIEW 상태·이력)
- [README.md `## MCP Server`](../README.md#mcp-server) — devtools MCP tool 레퍼런스

---

커뮤니티 오픈소스 프로젝트입니다.
