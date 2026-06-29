---
'@ait-co/devtools': patch
---

env3 테스트 러너를 러너-중립 코어로 정리: CLI와 Vitest 풀이 공유하는 relay attach 조립을 `createRelayConnectionFactory`로 단일화하고, `runTestFilesOverRelay`가 실행 전 `enableDomains()`를 한 번 보장하도록 했다. `collectCaptures` 옵션을 켜면 라이브 `Runtime.consoleAPICalled` 리스너로 `__AIT_CAPTURE__` 콘솔 라인을 수집한다(기본 false — build-only 경로는 리스너 비용 0). 수집된 라인과 실행 리포트는 secret-free 스키마로 디스크에 직렬화된다(파일 경로는 projectRoot 상대, relay wss/scheme/TOTP 필드 부재). 모두 additive 변경이라 기존 소비자 영향 없음.
