/**
 * 듀얼라인 타입 호환성 검증의 공용 유틸리티 타입
 *
 * `__typecheck.ts`(3.0-beta 라인)와 `__typecheck-2x.ts`(2.x stable 라인)가
 * 같은 assert 본체를 공유하되, 라인별로 존재 유무가 갈리는 심볼만
 * `AssertIfPresent`로 capability-gate한다.
 */

/** Mock 타입이 Original 타입에 할당 가능하면 통과, 아니면 컴파일 에러 */
export type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;

/**
 * Original 네임스페이스에 K가 export로 있으면 호환 검증, 없으면(다른 SDK 라인)
 * skip→true. K는 `keyof TMockNS`로 제약돼 mock 쪽 키 오타는 컴파일 타임에 차단된다.
 */
export type AssertIfPresent<TMockNS, TOrigNS, K extends keyof TMockNS> = K extends keyof TOrigNS
  ? TMockNS[K] extends TOrigNS[K]
    ? true
    : never
  : true;
