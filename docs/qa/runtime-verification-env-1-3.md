# 런타임 검증 가이드 — 환경 1·3

> 이 가이드는 `start_debug(mode)` 단일 진입 모델(#348/#356/#358)을 기준으로 환경 1(로컬 Chromium), 환경 3(intoss-private dogfood relay)의 acceptance 체크리스트를 담는다.
>
> 환경 3은 BLOCK-phone — 실 iPhone이 있어야 완주할 수 있다. 환경 1 섹션은 실기기 없이 자율 검증 가능.
>
> **환경 2(AITC Sandbox PWA)는 이 가이드 범위 밖이다** — 진입 메커니즘이 다르다(아래 핵심 모델 참고). 절차·acceptance는 [`docs/env2-pwa-acceptance.md`](../env2-pwa-acceptance.md)가 정본. **폰 세션 순서는 환경 2를 먼저** 돈다 — 토스 앱·검수가 불필요해 마찰이 낮고, CDP relay 경로의 절반을 더 싼 환경에서 먼저 검증한 뒤 환경 3(dogfood relay)으로 넘어간다.

## 핵심 모델 — `start_debug(mode)` 단일 진입

`#348/#356/#358`로 MCP 진입 방식이 바뀌었다:

- **상시 기동된 데몬 하나**가 local(env 1) + relay(env 3) 두 connection을 동시 보유한다.
- 환경 전환은 **`start_debug({mode})`** 한 번 — MCP 서버 재시작 없이 active connection을 runtime에 swap한다.
- 유효 mode: `local-browser` | `relay-sandbox` | `relay-staging` (#398 hard rename — 옛 이름 `local`/`mobile`/`staging` 및 deprecated 별칭은 모두 제거됨)
- **`relay-sandbox`(env 2)만은 런타임 swap이 거부된다** — 외부-PWA origin(`*.trycloudflare.com`)이라 `relay-staging`(같은 `intoss-private` 물리 슬롯)와 다른 별도 relay family다. unplugin `tunnel:{cdp:true}`가 띄운 Chii relay의 공개 base URL(`AIT_RELAY_BASE_URL`)을 데몬이 보고 외부 relay family로 부팅해야 하고, attach는 `scheme_url`이 아니라 `AIT_TUNNEL_BASE_URL`을 쓴다. 정확한 진입 명령은 폰 세션에서 1회 관측 후 [`env2-pwa-acceptance.md`](../env2-pwa-acceptance.md)에 박제한다(현재 미검증).

> **`MCP_ENV` back-compat 각주**: `MCP_ENV` 내보내기로 환경을 고정하는 방식은 이 모델로 교체됐다 — 환경 전환은 `start_debug(mode)`를 쓴다.

---

## 환경 1 — 로컬 Chromium dev (자율 검증 가능)

실기기 없이 자율 검증 가능한 환경이다. `start_debug(local-browser)` → relay swap → 다시 local-browser 전환으로 무재구동 스위칭을 확인한다.

### 준비물

- Node 24 + `@ait-co/devtools` 설치 (또는 `npx -y @ait-co/devtools devtools-mcp`)
- 데스크톱: Claude Code 세션

### 진입 절차

```bash
# --target=local 로 기동 — local eager, relay lazy
npx @ait-co/devtools devtools-mcp --target=local
```

Claude Code에서:

```
start_debug({mode: 'local-browser'})
```

### acceptance 체크리스트

- [ ] **`start_debug({mode: 'local-browser'})` 응답**
  - `mode: "local-browser"`
  - `kind: "local"`
  - `nextStep`에 "list_pages로 로컬 Chromium 페이지 attach를 확인하세요" 포함

- [ ] **`list_pages` 응답**
  - 로컬 Chromium 탭이 `pages[0]`에 노출됨
  - `tunnel.up: false` — local-target에서 tunnel이 없는 것이 **정상** (restart 권장 아님)

- [ ] **`start_debug({mode: 'relay-staging'})`로 swap (같은 MCP 세션)** — `relay-staging`은 입력 mode; 출력 env.kind는 `"relay-dev"` 유지
  - 응답: `kind: "relay"`
  - 재핸드셰이크·재시작 없음 — 같은 MCP stdio 세션 유지

- [ ] **`get_debug_status` — relay-staging(env.kind=relay-dev) 상태 확인**
  ```json
  {
    "environment": {
      "kind": "relay-dev",
      "env": "relay"
    }
  }
  ```
  - `kind: "relay-dev"` (출력 env.kind 불변)
  - `tunnel.up: false` 도 가능 — relay lazy-boot됐지만 `start_attach` 호출 전에는 tunnel 미부팅 상태 정상

- [ ] **다시 local-browser로 전환: `start_debug({mode: 'local-browser'})`**
  - `kind: "local"` 확인

**PASS 판정**: 모든 체크 통과, 재시작 없이 local-browser↔relay 전환이 한 세션에서 완료됨.

---

## 환경 3 — intoss-private dogfood relay (10분 예상, BLOCK-phone)

### 준비물

- 실 iPhone 1대 (토스 앱 설치, dogfood 빌드 진입 가능한 계정)
- 데스크톱: Claude Code 세션 + `aitcc` 로그인된 상태
- 31146 `aitcc app status` → `locked: false` 확인 (BLOCK-31146 해제 상태)

### 1. dogfood 번들 배포

```bash
cd ~/Projects/github.com/apps-in-toss-community/sdk-example
ait build
ait deploy --scheme-only
# 출력: intoss-private://aitc-sdk-example?_deploymentId=<uuid>
```

### 2. MCP 기동 + staging 진입 (env 3)

```bash
# TOTP secret 설정 (선택 — relay URL 유출 방어)
export AIT_DEBUG_TOTP_SECRET=<.env에서 복사>
npx @ait-co/devtools devtools-mcp
```

MCP 서버가 올라오면 Claude Code에서:

```
start_debug({mode: 'relay-staging'})
```

응답 예 (`mode`는 입력 canonical 값, `environment`는 출력 env.kind 불변):

```json
{
  "mode": "relay-staging",
  "kind": "relay",
  "nextStep": "start_attach로 attach QR을 생성하세요 (relay 세션)."
}
```

### 3. QR 발급 → 폰에서 토스 앱 cold-load

```
start_attach({scheme_url: "intoss-private://aitc-sdk-example?_deploymentId=<uuid>"})
→ QR PNG 자동 열림 + attachUrl 출력
```

QR 스캔 → 토스 앱이 dogfood bundle cold-load (PREPARE 상태에서도 OK).
데스크톱 터미널에서 `[relay] page attached: ...` 로그 확인.

### 4. acceptance 도구 시퀀스

```
list_pages        → pages[0].url에 deploymentId 포함, tunnel.up: true
measure_safe_area → source: "relay-dev" (출력 env.kind 불변), sdkInsetsSource: "window.__sdk"
call_sdk("getOperationalEnvironment", []) → {ok: true, value: "toss" 또는 "sandbox"}
```

### 5. 결과 박제

- `value: "toss"` vs `"sandbox"` 어느 쪽이 dogfood SDK 토큰인지 확정 (현재 docs는 둘 다 가능으로 표기)
- mismatch 발견 시 devtools issue 등록


---

## 환경 전환 시나리오 — 한 세션에서 1→3→1 완주

재구동 없이 한 MCP 세션에서 모든 환경을 순환할 수 있다:

```
# Step 1: 로컬로 시작 (입력 mode: 'local-browser')
start_debug({mode: 'local-browser'})
→ kind: "local"

# Step 2: relay-staging(env 3)으로 swap (입력 mode: 'relay-staging', 출력 env.kind: "relay-dev")
start_debug({mode: 'relay-staging'})
→ kind: "relay"
(→ start_attach로 dogfood QR 생성, 폰에서 스캔)

# Step 3: 다시 local-browser로 돌아가기
start_debug({mode: 'local-browser'})
→ kind: "local"
```

**acceptance**: Step 1~3 전체가 서버 재시작 없이 완료됨.

---

## 결과 보고 양식

각 환경마다:

- 시퀀스 PASS/FAIL 표
- 응답 envelope 1개씩 (시크릿 redact 후) 첨부
- docs ↔ 실 동작 mismatch
- 한 줄 평가

---

## SECRET-HANDLING

- TOTP secret 값과 `at=<code>` 모두 출력 금지
- aitcc 쿠키/TBIZAUTH 출력 금지
- 응답 redact: `at=`, `Authorization`, `Cookie`, deploymentId(첫 8자만 남기기)

---

## 운영팀 처리 대기 시

`errorCode: 4046` (REVIEW lock)이 떨어지면 31146 update mode를 강제하지 말 것. 운영팀 처리 trail로 두고 다음 세션 대기 (umbrella §3).
