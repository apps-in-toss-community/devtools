/**
 * 알림 동의 mock
 *
 * 상류 SDK 타입 선언은 `requestNotificationAgreement(params)`이 callback-style로
 * 즉시 cancel 함수를 반환한다고 선언하지만, 실기기(2.x×iOS) capture는 반환값이
 * 함수가 아니라 **object**임을 보였다(devtools#806 — env3 재캡처, "Expected
 * function, received object" 단언 실패 2건: happy-default cancel 단언 +
 * A1-빈-templateCode 단언, 동일 원인 이중 측정). object의 내부 shape은 이번
 * run에서 미기록(단언이 "function인가"에서 끊겨 뒤 관측이 안 남음).
 *
 * mock은 #775 원칙대로 선언 타입은 상류와 동일하게 두고(`__typecheck.ts`/
 * `__typecheck-2x.ts`가 계속 컴파일되도록) 반환값만 실측 있는 수준까지
 * 캐스트한다 — 1차 착수는 "함수가 아니라 object"까지만, shape은 과잉 발명하지
 * 않는다(#783 "측정 밖 확장 금지"). 다음 재캡처에서 object keys가 잡히면 그때
 * shape을 채운다.
 *
 * 결과는 panel(Notifications 탭)이 토글한
 * `aitState.state.notification.nextResult`를 그대로 사용한다.
 *
 * `agreementRejected`도 정상 결과의 한 종류이므로 `onEvent`로 전달한다.
 * `onError`는 `onEvent` 호출 자체가 throw할 때만 들어간다 (실제 SDK도 reject를
 * error가 아닌 event type으로 표현한다).
 */

import { buildNativeError } from './native-error.js';
import { aitState } from './state.js';
import type { NotificationAgreementResult } from './types.js';

interface RequestNotificationAgreementOptions {
  options: { templateCode: string };
  onEvent: (result: { type: NotificationAgreementResult }) => void;
  onError: (error: unknown) => void | Promise<void>;
}

const _requestNotificationAgreementImpl = (
  params: RequestNotificationAgreementOptions,
): (() => void) => {
  Promise.resolve().then(async () => {
    // 실패-모드 다이얼 (devtools#783): aitState.patch('failureModes',
    // { requestNotificationAgreement: '4000' })로 실기기 실측(env3 run11, 2.x/iOS —
    // happy-force-*/A1-empty-templateCode 시나리오 전부 rejected/`Error`/`4000`)을
    // 재현한다. 미설정 시 기존처럼 onEvent 경로 그대로 (zero behavior change).
    const failureCode = aitState.state.failureModes.requestNotificationAgreement;
    if (failureCode) {
      await params.onError(buildNativeError(failureCode));
      return;
    }

    const type = aitState.state.notification.nextResult;

    console.log(
      '[@ait-co/devtools] requestNotificationAgreement:',
      params.options.templateCode,
      '→',
      type,
    );

    try {
      params.onEvent({ type });
    } catch (e) {
      await params.onError(e);
    }
  });

  // 반환값 shape 정렬 — 위 파일 상단 주석 참조(devtools#806): 함수가 아니라
  // object.
  return {} as unknown as () => void;
};
export const requestNotificationAgreement: ((
  params: RequestNotificationAgreementOptions,
) => () => void) & { isSupported: () => boolean } = Object.assign(
  _requestNotificationAgreementImpl,
  { isSupported: () => true },
);
