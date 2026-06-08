---
"@ait-co/devtools": patch
---

환경 2 터널 토글을 plugin이 직접 `AIT_TUNNEL` / `AIT_TUNNEL_CDP` env var로 fallback 읽도록 내재화. 소비자 `vite.config.ts`에서 `tunnel: process.env.AIT_TUNNEL_CDP ? { cdp: true } : !!process.env.AIT_TUNNEL` 한 줄이 더 이상 필요 없음. 명시 `tunnel` 옵션(`false` 포함)이 항상 우선(`??` 의미론, non-breaking), 기존 `isDev &&` 가드로 prod 안전성 불변. `resolveTunnelOption(explicit, env)` 순수 함수로 추출해 단위 테스트 추가. (#425)
