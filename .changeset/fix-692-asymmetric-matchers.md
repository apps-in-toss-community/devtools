---
"@ait-co/devtools": patch
---

test-runner `expect`에 asymmetric matcher(`expect.any`/`anything`/`objectContaining`/`arrayContaining`/`stringContaining`/`stringMatching`)를 추가했습니다 (#692). deep-equal 헬퍼(`toMatchObject`/`toEqual`/`toHaveProperty`)가 expected 쪽 marker를 인식해 구조 비교 대신 marker의 `asymmetricMatch`로 매칭하며, `not` 부정도 동작합니다. 실기기에서 `expect.any(String)` 등을 쓰는 `.ait.test` 파일이 `expect.any is not a function`으로 깨지던 문제가 풀립니다.
