/**
 * 듀얼라인 타입 호환성 검증의 공용 유틸리티 타입
 *
 * `__typecheck.ts`(3.0-beta 라인)와 `__typecheck-2x.ts`(2.x stable 라인)가
 * 같은 assert 본체를 공유하되, 라인별로 존재 유무가 갈리는 심볼만
 * `AssertIfPresent`로 capability-gate한다.
 */

/**
 * never의 distributive 단락을 tuple-wrap으로 막아 시그니처 비호환을 false로 만든다.
 *
 * 검사 방향: [TMock] extends [TOriginal] — "Mock이 SDK 계약(Original)의 서브타입인가".
 * 함수 타입 관계:
 *   - Mock 파라미터가 Original보다 넓으면(관대): Orig_params extends Mock_params → OK
 *   - Mock 리턴이 Original보다 좁으면(구체적): Mock_ret extends Orig_ret → OK
 * 이것이 "Mock을 SDK 대신 쓸 수 있다"는 타입 안전 대체 가능성의 표준 방향이다.
 * 구 `Assert<T,U> = T extends U`는 distributive 단락으로 never를 방치했으나,
 * `Expect<AssertCompat<A, B>>`로 감싸면 false → TS2344 컴파일 에러가 된다.
 */
export type AssertCompat<TMock, TOriginal> = [TMock] extends [TOriginal] ? true : false;

/** T가 true가 아니면(=false) TS2344 컴파일 에러를 강제한다. */
export type Expect<T extends true> = T;

/**
 * Original 네임스페이스에 K가 export로 있으면 호환 검증, 없으면(다른 SDK 라인)
 * skip→true. K는 `keyof TMockNS`로 제약돼 mock 쪽 키 오타는 컴파일 타임에 차단된다.
 *
 * 검사 방향: Mock[K] extends SDK[K] — Mock이 SDK 계약을 만족하는가.
 * tuple-wrap으로 distributive 단락을 막아 시그니처 비호환을 false로 만든다.
 * 결과를 `Expect<AssertIfPresent<...>>`로 감싸면 false → TS2344 에러로 승격된다.
 */
export type AssertIfPresent<TMockNS, TOrigNS, K extends keyof TMockNS> = K extends keyof TOrigNS
  ? [TMockNS[K]] extends [TOrigNS[K]]
    ? true
    : false
  : true;
