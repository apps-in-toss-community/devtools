---
"@ait-co/devtools": patch
---

fix(mcp): get_diagnostics의 mcpVersion이 여전히 null이던 잔여 결함 수정 (#361)

#363가 머지됐지만 실기기 relay 데몬에서 `mcpVersion`은 여전히 `null`이었다. 원인은 빌드 타임 resolve(`tsdown.config.ts`)와 런타임 fallback(`tools.ts`) 둘 다 `@modelcontextprotocol/sdk`의 베어 메인 엔트리를 `require.resolve`했기 때문 — SDK는 `.`도 `./package.json`도 `exports`에 노출하지 않아 `MODULE_NOT_FOUND`로 throw, 빌드 define에 `null`이 구워지고 fallback도 throw해 항상 `null`로 떨어졌다. exports에 실제로 노출된 서브패스(`./server/mcp.js`)로 resolve한 뒤 패키지 루트로 marker-walk하도록 양쪽을 고쳐, 번들에 SDK 버전(`1.29.0`)이 정상 주입된다.
