# 토스 앱 crash 원인 추적 — 4-source 매트릭스

이 문서는 실기기 토스 앱 WebView에서 crash가 발생했을 때 **메인테이너가 원인을 추적하기 위해 동원할 수 있는 데이터 소스와 절차**를 정리한다. 2026-05-28 `setDeviceOrientation` 시그니처 mismatch 사례를 계기로 작성됐다.

설계 정본(환경 4겹 모델, relay TOTP 인증 아키텍처): [umbrella `meta/four-environments-fidelity.md`](https://github.com/apps-in-toss-community/umbrella/blob/main/meta/four-environments-fidelity.md)

---

## 1. 데이터 소스 매트릭스

crash 분석에 동원 가능한 소스는 5개다. 각 소스는 다른 겹(layer)의 정보를 준다 — 하나로 충분한 경우는 드물고, 대개 두세 소스를 교차 확인한다.

| 소스 | 어디서 얻는가 | 무엇을 알 수 있는가 | secret 주의 |
|---|---|---|---|
| **iOS Console.app** (Mac 필요) | Mac ↔ 폰 USB 연결 → Console.app → 폰 선택 → "Crash Reports" 탭 | Swift/ObjC crash thread stack, symbolicated frame, `exception.type`, `asi` (마지막 NSException 메시지) | crash log의 `url` 또는 query string에 `relay=wss://...` + `at=<TOTP>` + `_deploymentId=...` 포함 가능 → **공유 전 반드시 redact** |
| **폰 내장 로그** (Mac 없이) | Settings → Privacy & Security → Analytics & Improvements → Analytics Data | `Toss-YYYY-MM-DD-HHMMSS.ips` JSON 파일. Console.app과 동일 내용 | 동상 |
| **MCP `list_pages.crashDetectedAt`** | attach 살아있을 때 `list_pages` 호출 | `Inspector.targetCrashed` 이벤트 발생 시각. crash 발생 여부와 시점을 page 단위로 확정 | 없음 |
| **MCP `list_exceptions`** | attach 살아있을 때 `list_exceptions` 호출 (#267 구현 후) | `Runtime.exceptionThrown` ring buffer — JS-level SDK throw, unhandled rejection, 스택 포함 | exception 텍스트에 SDK call args가 노출될 수 있음 — TOTP 값이 args에 포함된 경우 스키마 레벨에서 redact됨 |
| **MCP `list_console_messages`** | attach 살아있을 때 `list_console_messages` 호출 | `console.error`/`warn`/`log` 기록. native bridge가 console로 흘린 메시지도 잡힘 | console에 실수로 출력된 토큰·URL 주의 |

> `crashDetectedAt`이 채워진다는 것은 **page-level crash**가 확정됐다는 의미다. 이 시각 이전의 `list_exceptions`·`list_console_messages` 레코드와 타임스탬프를 비교하면 원인 계층을 좁힐 수 있다.

---

## 2. 빠른 분류 — devtools 측에서, attach 살아있을 때

attach가 살아있는 동안 다음 순서로 호출한다. 폰을 들여다볼 필요 없이 에이전트가 단독으로 수행할 수 있다.

### 단계 1 — `list_pages` → `crashDetectedAt` 확인

```
list_pages
```

| `crashDetectedAt` | `pages` 배열 | 해석 |
|---|---|---|
| 채워져 있음 | page 있음 (detached 가능) | page-level crash 확정 → 단계 2로 |
| `null` / 없음 | page 없음 | crash 아닌 다른 원인(tunnel 끊김, TOTP 만료 등) → `docs/dogfood-relay-loop.md` 참고 |

### 단계 2 — `list_exceptions` → JS-level 원인 탐색 (#267 구현 후 사용 가능)

```
list_exceptions
```

`crashDetectedAt` 직전 timestamp의 exception을 확인한다:

| 상황 | 해석 |
|---|---|
| `crashDetectedAt` 직전에 SDK throw exception 있음 | **JS-level crash** — JS가 던진 예외가 native bridge를 통해 앱을 crash시킨 경우. exception 메시지·스택이 근본 원인 |
| exception 없음 (또는 완전히 다른 시점) | **native-level crash 가능성** — JS 예외 없이 native bridge가 crash. OS-level crash 추출(§3)로 넘어감 |

### 단계 3 — `list_console_messages` → 보조 신호

```
list_console_messages
```

`[Error]` 레벨 메시지 또는 native bridge가 console로 흘린 경고를 확인한다. exception ring buffer에 없는 맥락 로그가 여기에 있을 수 있다.

### 결정 트리 요약

```
list_pages
  └─ crashDetectedAt 있음?
        ├─ YES → list_exceptions
        │         ├─ 직전 JS exception 있음? → JS-level crash (원인: exception 메시지/스택)
        │         │                             → list_console_messages로 보조 확인
        │         └─ JS exception 없음       → native bridge crash 의심
        │                                     → §3 (Console.app) 또는 §4 (폰 내장)
        └─ NO  → crash 아님 → dogfood-relay-loop.md "자주 깨지는 경우"
```

---

## 3. OS-level crash 추출 — Mac + USB

native bridge crash 또는 JS exception만으로 원인을 특정하지 못할 때 `.ips` crash report를 확인한다.

### 준비

1. 폰을 Mac에 USB 케이블로 연결한다.
2. 폰 화면에 "이 컴퓨터를 신뢰하시겠습니까?" 팝업이 뜨면 **신뢰**를 탭한다 (1회만 필요).

### Console.app 절차

1. Mac에서 **Console.app**(응용 프로그램 → 유틸리티 → Console.app) 을 연다.
2. 좌측 사이드바에서 연결된 폰(기기 이름)을 선택한다.
3. 상단 탭에서 **"Crash Reports"** 를 선택한다.
4. 목록에서 `Toss` 또는 `toss` 관련 항목을 찾는다. 파일 이름은 `Toss-<timestamp>.ips` 형태.
5. 가장 최근 timestamp 항목을 **더블클릭**하면 JSON 형식으로 열린다.

### `.ips` 파일에서 읽어야 할 필드

| 필드 | 경로 | 읽는 이유 |
|---|---|---|
| `reason` | 최상위 | dyld fault, signal fault 등 OS 수준 종료 사유 |
| `exception.type` | 최상위 `exception` | ObjC exception 종류 (예: `NSInvalidArgumentException`) |
| `exception.message` | `exception.message` | exception 상세 메시지 |
| `asi` | 최상위 `asi` | application-specific information — 마지막 NSException의 reason string 등이 여기에 남는 경우 많음 |
| crashed thread stack | `threads[*]` 중 `crashed: true`인 항목의 `frames` | native stack frame. 심볼화된 경우 함수명이 보임 |
| `bundleVersion` | `app.bundleVersion` | crash 시점의 앱 버전 |

### 필드 읽기 예시 (실제 값은 가상)

```json
{
  "reason": "EXC_CRASH (SIGABRT)",
  "exception": {
    "type": "NSInvalidArgumentException",
    "message": "*** setObjectForKey: object cannot be nil (key: orientation)"
  },
  "asi": {
    "com.viva.toss": [
      "*** Terminating app due to uncaught exception 'NSInvalidArgumentException'"
    ]
  },
  "threads": [
    {
      "id": 0,
      "crashed": true,
      "frames": [
        { "imageOffset": 8192, "symbol": "abort_with_payload" },
        { "imageOffset": 4096, "symbol": "-[__NSDictionaryM setObjectForKey:]" }
      ]
    }
  ]
}
```

이 예시에서는 ObjC 딕셔너리에 `nil` 값을 넣으려 해 `NSInvalidArgumentException`이 발생했음을 읽을 수 있다 — SDK 인자 검증 이전에 bridge 쪽에서 `nil`을 unwrap하려 한 패턴.

---

## 4. 폰만으로 — Mac 없이

Mac이 없을 때 폰 자체에서 `.ips`를 추출한다.

1. **Settings** (설정) → **Privacy & Security** → **Analytics & Improvements** → **Analytics Data** 탭을 연다.
2. 목록에서 `Toss-` 로 시작하는 항목을 시간순으로 정렬, 가장 최신 항목을 탭한다.
3. 우측 상단 공유 버튼 → **AirDrop**, 이메일, 또는 "파일에 저장"으로 `.ips` 파일을 추출한다.

내용은 Console.app에서 보이는 것과 동일하다. 텍스트 편집기로 열면 JSON 구조로 읽을 수 있다.

> **주의**: Analytics Data는 정책에 따라 기기 내에 최대 몇 주 보관된다. crash 직후 빠르게 추출하는 것이 좋다.

---

## 5. Redact 절차 — 공유 전 필수

`.ips` 파일을 그대로 이슈·슬랙·이메일에 첨부하면 안 된다. query string에 다음이 포함될 수 있다:

- `relay=wss://...` — trycloudflare.com 터널 URL (공개 시 제3자가 relay에 attach 가능)
- `at=<TOTP>` — TOTP 인증 코드 (30초 TTL이지만 로그엔 영구히 남음)
- `_deploymentId=<uuid>` — dogfood 배포 식별자

### redact-crash-log.sh 스크립트

[`scripts/redact-crash-log.sh`](../scripts/redact-crash-log.sh) — stdin에서 `.ips` 파일을 읽어 위 값들을 `<REDACTED>` 플레이스홀더로 치환하고 stdout으로 출력한다:

```bash
scripts/redact-crash-log.sh < my-crash.ips > my-crash.redacted.ips
```

스크립트가 없는 환경에서는 다음 한 줄 `sed`로도 동일하게 처리할 수 있다:

```bash
sed -E \
  -e 's|relay=wss://[^&"]*|relay=<REDACTED>|g' \
  -e 's|at=[A-Z0-9]{6,8}|at=<REDACTED_TOTP>|g' \
  -e 's|_deploymentId=[a-f0-9-]{36}|_deploymentId=<UUID>|g' \
  my-crash.ips > my-crash.redacted.ips
```

### 추가로 확인할 것

- **계정 식별자**: `.ips` `userID` 필드 또는 query string에 사용자 계정 id가 있을 수 있다. 공개 이슈에 올릴 때는 이 값도 `<ACCOUNT_ID>`로 교체한다.
- **디바이스 식별자**: `crashReporterKey`, `deviceIdentifierForVendor` 필드가 있을 수 있다. 내부 공유는 괜찮으나 공개 이슈는 redact.

---

## 6. 분석 예시 — `setDeviceOrientation('landscape')` 가상 사례

이 시나리오는 2026-05-28 사례를 단순화한 가상 예시다. 실제 값이 아님.

### 상황

개발자가 `setDeviceOrientation` 에 SDK가 허용하지 않는 인자(`'landscape'` 대신 `'landscape-primary'`가 올바른 값)를 전달. 토스 앱이 crash.

### 각 계층에서 무엇이 보이는가

#### MCP `list_exceptions` (JS layer)

```json
{
  "timestamp": "2026-05-28T10:23:01.042Z",
  "exception": {
    "text": "Error: Invalid orientation value: 'landscape'. Expected one of: portrait, landscape-primary, landscape-secondary",
    "stackTrace": {
      "callFrames": [
        { "functionName": "setDeviceOrientation", "url": "https://<bundle>.trycloudflare.com/index.js", "lineNumber": 412 },
        { "functionName": "handleOrientationToggle", "url": "...", "lineNumber": 88 }
      ]
    }
  }
}
```

SDK가 JS-level에서 `Error`를 throw. 이 exception이 catch되지 않고 native bridge를 통해 전파됨.

#### MCP `list_pages.crashDetectedAt` (page layer)

```json
{
  "id": "page-001",
  "title": "aitc-sdk-example",
  "crashDetectedAt": "2026-05-28T10:23:01.500Z"
}
```

exception throw(10:23:01.042) → 약 460ms 후 page crash(10:23:01.500). 타임스탬프 순서가 JS exception → native crash 흐름을 확정.

#### MCP `list_console_messages` (console layer)

```json
{ "level": "error", "text": "[SDK] setDeviceOrientation failed: unsupported value", "timestamp": "2026-05-28T10:23:01.038Z" }
```

SDK가 throw 직전 console.error로 남긴 경고. `list_exceptions`보다 4ms 일찍 기록됨 — "console 경고 → throw → native crash" 순서를 보여줌.

#### iOS Console.app `exception.type` (OS layer)

```json
{
  "exception": {
    "type": "NSInvalidArgumentException",
    "message": "*** -[SDKBridge handleMessage:]: unrecognized orientation 'landscape'"
  },
  "asi": {
    "com.viva.toss": [
      "*** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: 'unrecognized orientation'"
    ]
  }
}
```

native bridge가 JS에서 전달된 `'landscape'` 문자열을 ObjC side에서 unwrap하려다 `NSInvalidArgumentException`으로 abort.

### 결론

이 사례는 **JS-level에서 SDK가 먼저 throw → catch 누락 → native bridge가 undefined/invalid 값을 unwrap → NSInvalidArgumentException → SIGABRT** 4-step 경로다.

root-cause prevention은 call_sdk arg validation (#270) 및 SDK-level 인자 검증 강화(#264)가 담당한다.

---

## 7. 참고 cross-link

| 이슈 | 내용 | 관계 |
|---|---|---|
| [#264](https://github.com/apps-in-toss-community/devtools/issues/264) | call_sdk arg validation — 인자 검증으로 crash 예방 | root-cause prevention |
| [#265](https://github.com/apps-in-toss-community/devtools/issues/265) | `list_pages.crashDetectedAt` — page-level crash 감지 | 이 문서 §2 단계 1 |
| [#267](https://github.com/apps-in-toss-community/devtools/issues/267) | `list_exceptions` — JS Runtime.exceptionThrown ring buffer | 이 문서 §2 단계 2 |
| [#270](https://github.com/apps-in-toss-community/devtools/issues/270) | call_sdk validation 구현 | §6 예방 계층 |
| [`docs/dogfood-relay-loop.md`](./dogfood-relay-loop.md) | relay 루프 운영 가이드 (tunnel/attach 복구 포함) | crash 아닌 연결 문제 트러블슈팅 |
| [`scripts/redact-crash-log.sh`](../scripts/redact-crash-log.sh) | `.ips` redact 스크립트 | 이 문서 §5 |

---

커뮤니티 오픈소스 프로젝트입니다.
