---
'@ait-co/devtools': patch
---

`web-framework-2x` alias를 `2.10.0` → `2.10.7`(2.x 최신) exact pin으로 갱신 — devDep-only 변경이지만 pin이 곧 "이 버전까지 2.x 호환을 검증했다"는 claim이라 peer-compat-claim surface에 대해 patch changeset을 남긴다(#638 선례와 동일 원칙).

`2.10.1`의 upstream type regression(`@apps-in-toss/web-bridge@2.10.1`이 `@apps-in-toss/native-modules`의 미빌드 raw `.ts` subpath를 import해 `tsc`가 `spec/MiniAppModule.brick.ts`의 `CodegenTypes`(RN 0.80+ export, 트랜지티브 RN 0.72.6엔 부재)에서 실패)는 **2.10.2에서 이미 해소**됐다. `2.10.0`으로의 회피 핀은 더 이상 필요 없다 — 검증한 버전 매트릭스:

| 버전 | `tsc -p tsconfig.2x.json` |
|---|---|
| 2.10.0 | clean |
| 2.10.1 | **FAIL** (`CodegenTypes` not exported) |
| 2.10.2 | clean |
| 2.10.4 | clean |
| 2.10.7 | clean (최신, 이번 pin 대상) |

`ci.yml`의 lockstep 가드를 `2.10.7`로, `CLAUDE.md`의 alias pin 정책 문단과 `__typecheck-2x.ts` 헤더 주석의 버전 언급도 함께 갱신. `__typecheck-2x.ts`의 `getConsentedUserData` 등 기존 assertion은 2.10.7 기준으로도 그대로 유효(신규 표면 변경 없음, 전체 typecheck clean으로 확인).

런타임 동작 변화 없음. 검증: `pnpm build`·`pnpm typecheck`(4개 라인)·`pnpm test`(113 files / 2565 tests)·`pnpm lint`·`check:mcp-react-free`·`check:debug-surface-absent` 모두 EXIT:0.
