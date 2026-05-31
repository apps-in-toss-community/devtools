# 환경 3·4 runtime 검증 가이드 — 사용자 폰 세션

> 자율 가능 범위 (환경 1·2)는 별도 task로 진행 중. 이 가이드는 BLOCK-phone인 환경 3·4를 사용자 1세션에 효율적으로 끝내기 위한 체크리스트다.

## 준비물

- 실 iPhone 1대 (토스 앱 설치, dogfood 빌드 진입 가능한 계정)
- 데스크톱: Claude Code 세션 + `aitcc` 로그인된 상태
- 31146 `aitcc app status` → `locked: false` 확인 (BLOCK-31146 해제 상태)

## 환경 3 — intoss-private dogfood relay (10분 예상)

### 1. dogfood 번들 배포
```bash
cd ~/Projects/github.com/apps-in-toss-community/sdk-example
ait build
ait deploy --scheme-only
# 출력: intoss-private://aitc-sdk-example?_deploymentId=<uuid>
```

### 2. MCP 기동 + QR 발급
별도 터미널:
```bash
export MCP_ENV=relay-dev
export AIT_DEBUG_TOTP_SECRET=<.env에서 복사>  # 선택 (relay URL 유출 방어)
devtools-mcp
```

Claude Code에서:
```
build_attach_url 호출 → QR PNG 자동 열림 + attachUrl 출력
```

### 3. QR 스캔 → 폰에서 토스 앱 자동 로드
- 토스 앱이 dogfood bundle을 cold-load (PREPARE 상태에서도 OK)
- 데스크톱 터미널에서 `[relay] page attached: ...` 로그 확인

### 4. acceptance 도구 시퀀스
```
list_pages    → pages[0].url에 deploymentId, tunnel.up=true
measure_safe_area → source:"relay-dev", sdkInsetsSource:"window.__sdk"
call_sdk("getOperationalEnvironment", []) → {ok:true, value:"toss" 또는 "sandbox"}
```

### 5. 결과 박제
- `value:"toss"` vs `"sandbox"` 어느 쪽이 dogfood SDK 토큰인지 확정 (현재 docs는 둘 다 가능으로 표기)
- mismatch 발견 시 devtools issue 등록

## 환경 4 — LIVE relay read-only (5분 예상)

### 1. LIVE 앱 OPENED 확인
- `aitcc app status 31146` → `OPENED` 상태

### 2. MCP 기동 — **`MCP_ENV=relay-live` 명시 필수**
```bash
export MCP_ENV=relay-live  # 이 값이 LIVE side-effect guard 활성화
export AIT_DEBUG_TOTP_SECRET=<.env에서 복사>
devtools-mcp
```

### 3. LIVE 앱 진입
- 토스 앱에서 31146 검색 → 일반 사용자 흐름으로 진입
- LIVE relay는 검수 통과한 출시 번들이 attach (dogfood 빌드 아님)

### 4. read-only 도구만 사용
```
list_pages
measure_safe_area              → source:"relay-live"
list_console_messages
take_screenshot
AIT.getOperationalEnvironment  → environment:"production"
```

### 5. side-effect guard 검증
```
call_sdk("getOperationalEnvironment", [])  → guard reject (confirm 누락)
call_sdk("getOperationalEnvironment", [], confirm:true)  → 통과
evaluate("window.location.href")  → guard reject
evaluate("window.location.href", confirm:true)  → 통과
```

guard reject 메시지가 `[LIVE relay guard] confirm: true required ...` 형태인지 확인.

### 6. 절대 하지 말 것
- `call_sdk("closeView", [], confirm:true)` 같은 실 SDK side-effect — 실유저 영향
- 실 결제·로그인 API 호출 — confirm:true 명시 후라도 금지
- 검수 큐 제출 (#164) — 비가역, 별도 명시 승인 필요

## 결과 보고 양식

각 환경마다:
- 시퀀스 PASS/FAIL 표
- 응답 envelope 1개씩 (시크릿 redact 후) 첨부
- docs ↔ 실 동작 mismatch
- 한 줄 평가

## SECRET-HANDLING

- TOTP secret 값과 `at=<code>` 모두 출력 금지
- aitcc 쿠키/TBIZAUTH 출력 금지
- 응답 redact: `at=`, `Authorization`, `Cookie`, deploymentId(첫 8자만 남기기)

## 운영팀 처리 대기 시

`errorCode: 4046` (REVIEW lock)이 떨어지면 31146 update mode를 강제하지 말 것. 운영팀 처리 trail로 두고 다음 세션 대기 (umbrella §3).
