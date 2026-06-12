---
'@ait-co/devtools': patch
---

feat(telemetry): 동의 상태 머신 레벨 영속화 (#542) — origin 회전마다 toast 재노출 제거

quick-tunnel host·localhost 포트가 세션마다 바뀔 때마다 같은 개발자에게 텔레메트리 동의 toast가 반복 노출되던 문제를 해결한다.

- `~/.ait-devtools/telemetry.json`에 동의 상태를 머신 레벨로 저장 (consent enum + decided_at + policy_version + anon_id)
- `pnpm dev` 첫 기동 시 TTY 프롬프트로 1회 묻고 머신 파일에 영속화. 비-TTY(CI/headless)는 조용히 undecided 유지
- Vite dev server에 `/api/ait-devtools/telemetry-consent` endpoint 추가 — 패널이 GET해서 machine consent를 읽고 toast 스킵, 환경 탭 토글 변경 시 POST로 기록
- anon_id도 머신 레벨로 승격해 origin별 여러 명 집계 방지
- 비-dev 표면(GitHub Pages 배포 fixture/launcher) 동작 무변경 — fetch 실패 시 기존 localStorage 경로로 투명하게 fallback
- `src/telemetry/state.ts`의 localStorage 키 LOCKED 불변식 유지, Tier 0/1 수집 정책 의미 불변
