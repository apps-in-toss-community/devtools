---
"@ait-co/devtools": patch
---

test: 4-scenario QA checklist + fidelity-qa parity snapshot (#291)

- docs/qa/scenarios.md: 4 시나리오 수동 QA 체크리스트 (진입 절차/검증 명령/예상 응답/실패 처리/acceptance 매트릭스)
- scripts/fidelity-qa/probes/scenario-parity.ts: list_pages / measure_safe_area / call_sdk(getOperationalEnvironment) 3종 schema parity probe 추가
- --scenario-parity CLI 플래그로 활성화; WSS_URL 없으면 CI-safe mock-only 자동 downgrade
- whitelist.json에 3종 scenario-parity probe의 의도된 diff (source, sdkInsetsSource, userAgent, environment) 등록
