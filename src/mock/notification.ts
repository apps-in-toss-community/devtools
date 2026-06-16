/**
 * 알림 동의 mock
 *
 * SDK는 callback-style: `requestNotificationAgreement(params)`이 즉시 cancel 함수를
 * 반환하고, 결과는 `params.onEvent`로 전달된다. mock도 같은 모양을 흉내내며,
 * 결과는 panel(Notifications 탭)이 토글한 `aitState.state.notification.nextResult`를
 * 그대로 사용한다.
 *
 * `agreementRejected`도 정상 결과의 한 종류이므로 `onEvent`로 전달한다.
 * `onError`는 `onEvent` 호출 자체가 throw할 때만 들어간다 (실제 SDK도 reject를
 * error가 아닌 event type으로 표현한다).
 */

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
  let cancelled = false;

  Promise.resolve().then(async () => {
    if (cancelled) return;
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

  return () => {
    cancelled = true;
  };
};
export const requestNotificationAgreement: ((
  params: RequestNotificationAgreementOptions,
) => () => void) & { isSupported: () => boolean } = Object.assign(
  _requestNotificationAgreementImpl,
  { isSupported: () => true },
);
