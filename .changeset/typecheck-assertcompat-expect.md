---
"@ait-co/devtools": patch
---

타입체크 강화: `Assert<never>` 무음 통과 → `AssertCompat+Expect` TS2344 강제 (#592)

`Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never` 패턴은 불일치 시 `type _X = never`를 허용해 시그니처 미스매치를 무음으로 통과시켰다. tuple-wrap `AssertCompat<TMock, TOriginal> = [TMock] extends [TOriginal] ? true : false`와 `Expect<T extends true>`를 도입해 불일치 시 TS2344 컴파일 에러를 강제한다. 강화 과정에서 발견된 실제 미스매치(permissions 파라미터 shape, contactsViral onEvent 타입, eventLog log_type, graniteEvent/tdsEvent SDK 타입 직접 사용)를 수정했다.
