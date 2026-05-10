/**
 * 알림 동의 mock
 *
 * SDK는 callback-style: `requestNotificationAgreement(params)`이 즉시 cancel 함수를
 * 반환하고, 결과는 `params.onEvent`로 전달된다. mock도 같은 모양을 흉내내며,
 * 기본은 `'newAgreement'` (사용자가 처음 동의한 케이스). localStorage
 * `__ait_storage:notificationAgreement`에 마지막 결과를 남겨 다른 mock과 섞이지
 * 않게 한다.
 */

type NotificationAgreementResult = 'newAgreement' | 'alreadyAgreed' | 'agreementRejected';

interface RequestNotificationAgreementOptions {
  options: { templateCode: string };
  onEvent: (result: { type: NotificationAgreementResult }) => void;
  onError: (error: unknown) => void | Promise<void>;
}

const STORAGE_KEY = '__ait_storage:notificationAgreement';

export function requestNotificationAgreement(
  params: RequestNotificationAgreementOptions,
): () => void {
  let cancelled = false;

  Promise.resolve().then(async () => {
    if (cancelled) return;
    const previous = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })();

    const type: NotificationAgreementResult =
      previous === 'agreed' ? 'alreadyAgreed' : 'newAgreement';

    try {
      localStorage.setItem(STORAGE_KEY, 'agreed');
    } catch {
      /* localStorage unavailable — ignore */
    }

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
}
