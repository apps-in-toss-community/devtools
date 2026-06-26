---
"@ait-co/devtools": patch
---

의존성 최신화 — web-framework-2x alias를 2.10.0 exact pin으로 올림 (2.10.1 upstream type regression 회피)

`web-framework@2.10.1`은 `@apps-in-toss/web-bridge@2.10.1`이 `@apps-in-toss/native-modules`의 미빌드 raw `.ts` subpath를 import하는 upstream type regression이 있어 `tsc -p tsconfig.2x.json`이 실패한다. 2.10.0은 그 import가 없어 clean하다.

- `@apps-in-toss/web-framework-2x`: `npm:…@2.9.3` → `npm:…@2.10.0` (exact pin, 2.10.1 회피)
- `@types/react`: `^19.2.14` → `^19.2.17`
- `react` / `react-dom`: `^19.2.6` → `^19.2.7` (devDependencies only)
- `@biomejs/biome`: `2.4.15` → `2.5.1` (biome.json schema migration 포함)
- `@playwright/test`: `^1.59.1` → `^1.61.1`
- `ajv`: `^8.18.0` → `^8.20.0`
- `tsx`: `^4.21.0` → `^4.22.4`
- `unplugin`: `^3.0.0` → `^3.2.0`
- `vite`: `^8.0.8` → `^8.0.16`
- `ws`: `^8.18.0` → `^8.21.0`
- `sharp`: `^0.34.5` → `^0.35.2`
- `@vitejs/plugin-react`: `^5.1.0` → `^6.0.3` (major 5→6 bump)

`tsdown`은 0.21.7을 유지한다 — 0.22.3은 rolldown-plugin-dts 0.26으로 올라가면서 트랜지티브 CJS .d.ts(postcss via web-framework) 처리를 warning에서 error로 격상시켜 빌드가 실패한다.

런타임 동작 변화 없음. 모든 검증 게이트(build·typecheck·test·lint·check:mcp-react-free·check:debug-surface-absent·check:dashboard-html-fresh) 통과.
