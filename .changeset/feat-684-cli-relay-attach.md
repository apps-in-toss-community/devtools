---
"@ait-co/devtools": patch
---

feat(test-runner): devtools-test CLI standalone relay attach 배선 (#684 PR3)

`devtools-test` bin의 `main()` stub를 완전 구현으로 교체한다. 이제 MCP 데몬 없이
CLI 단독으로 env3(실기기 토스 WebView)에서 `.ait.test` 슈트를 실행할 수 있다.

- `src/test-runner/cli.ts` — main() 9단계 구현: parseArgs → discoverTestFiles →
  loadRelaySecretReadOnly → bootRelayFamily → AttachDeps 조립(qrHttpServer 미주입) →
  prepareAttach → renderAndMaybeWait(text QR + 폰 대기) → injectGlobals(__AIT_CELL__) →
  runWithConnection → family.stop(). CLI는 daemon이 아니므로 lock/router/SSE 불필요.
- `src/test-runner/cell.ts` (신규) — `injectGlobals(conn, globals)`: attach 직후
  첫 번들 inject 전에 `Runtime.evaluate`로 globalThis에 cell 객체를 박는 일반 helper.
  devtools는 `__AIT_CELL__` 모양을 모르고 일반 `Record<string, unknown>`만 다룬다.
- 새 CLI 플래그: `--scheme-url`, `--cell-sdk-line`, `--cell-platform`, `--headless`,
  `--project-root` (AIT_CELL_PLATFORM env fallback 지원).
- install-graph 불변식 유지: dist/test-runner/cli.js에 react/react-dom 0건.
  qrHttpServer 미주입 → text QR(qrcode-terminal) 경로를 renderAndMaybeWait이 처리.
  esbuild lazy import 유지.

sdk-example의 `test:env3` 스크립트는 이 PR에 포함하지 않는다 — devtools PR3 머지 후
sdk-example repo 별도 PR에서 추가한다(cross-repo 분리).
