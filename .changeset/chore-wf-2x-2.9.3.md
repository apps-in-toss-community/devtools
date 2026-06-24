---
"@ait-co/devtools": patch
---

chore(typecheck): web-framework-2x alias 2.8.0 → 2.9.3 (#638)

`__typecheck-2x.ts`(2.x stable 라인 mock 호환 증명)가 쓰는
`web-framework-2x` devDep alias를 `2.8.0`에서 `2.9.3`(현 web-framework
`latest`)로 올린다. published `latest`의 peer range가 `>=2.6.0 <3.0.0`이라
실 소비자는 2.9.3을 in-range로 pull하므로, 2.x 호환 typecheck도 소비자가
실제 쓰는 버전을 추적해야 한다(version-agnostic 보장, §5.1).

2.8.0 핀은 #583/#588 작성 시점 stable 값이었을 뿐 의도적 floor가 아니다.
`pnpm typecheck` 4개 라인(3.0-beta + 2x + fixture + scripts) 전부 green —
2.8.0→2.9.3 사이 mock이 못 따라가는 시그니처 drift 없음.
