---
'@ait-co/devtools': patch
---

CI: `beta` dist-tag 자동 publish 채널 추가. 같은 main 커밋에서 `latest`(web-framework 2.x peer, 기존 흐름 무변경)와 나란히, 3.0 라인 peer(`>=3.0.0-beta <4.0.0`)를 실은 Changesets 스냅샷(`0.0.0-beta-<datetime>-<sha>`)을 `release-beta` job이 pending changeset이 있을 때만 publish한다. 3.0-beta 소비자는 `@ait-co/devtools@beta`로 설치. base가 `0.0.0`이라 어떤 stable range도 만족하지 않고(`latest`로 누출 불가), peer rewrite는 job-local ephemeral checkout에서만 일어나며, publish 직전 artifact shape(version/peer/optional)을 assert한다. `latest` 채널은 2.x로 유지 — GA flip(#370) 아님.
