---
'@ait-co/devtools': patch
---

fix(mcp): measure_safe_area source enum에 relay-mobile 추가 + terminology drift 정정 (#524)

- `measure_safe_area` tool description의 source 열거에 `relay-mobile` 4번째 값 추가(실측 확인된 반환값 반영)
- `get_debug_status` description에 start_debug mode→McpEnvironment kind 매핑 cross-ref 추가
- MCP tool description 산문의 `MOCK SDK` → `mock SDK`, `deep link` → `deep-link` 표기 정정
- i18n(ko/en) AITC Sandbox 환경 라벨: `AITC Sandbox PWA` → `AITC Sandbox App (PWA)`, `Env N` → `env N`
- TOTP 시간 표기 통일: 30초 창 + ~3분(±6 step) 소급 허용을 한 문장에 함께 명시(README ko/en + i18n + dashboard)
- 산문 주석의 `dogfood` → `dog-food` (코드 식별자 `RELEASE_CHANNEL=dogfood` 등은 불변)
- README ko: `딥링크` → `deep-link`, `런처 QR`/`런처 PWA` → `launcher QR`/`launcher PWA`
- README en: 산문 `miniapp` → `mini-app`
- dashboard.generated.ts 재생성(i18n 소스 변경 반영)
