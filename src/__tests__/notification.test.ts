import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestNotificationAgreement } from '../mock/notification.js';
import { aitState } from '../mock/state.js';

/** `requestNotificationAgreement`의 내부 `Promise.resolve().then(async () => …)` 체인을 흘려보낸다. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Notification mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('기존처럼 nextResult를 onEvent로 전달한다', async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    requestNotificationAgreement({ options: { templateCode: 'tmpl' }, onEvent, onError });
    await flush();

    expect(onEvent).toHaveBeenCalledWith({ type: 'newAgreement' });
    expect(onError).not.toHaveBeenCalled();
  });

  describe('실패-모드 다이얼 (devtools#783)', () => {
    it('failureModes.requestNotificationAgreement 미설정 시 기존처럼 onEvent 경로를 탄다', async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      requestNotificationAgreement({ options: { templateCode: 'tmpl' }, onEvent, onError });
      await flush();

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it('failureModes.requestNotificationAgreement 설정 시 2.x native envelope으로 onError한다 (실측: rejected/Error/4000)', async () => {
      aitState.patch('failureModes', { requestNotificationAgreement: '4000' });
      const onEvent = vi.fn();
      const onError = vi.fn();
      requestNotificationAgreement({ options: { templateCode: 'tmpl' }, onEvent, onError });
      await flush();

      expect(onEvent).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Error', code: '4000', __isError: true }),
      );
    });

    it('failureModes.sdkLine이 3.x면 맨 Error로 onError한다', async () => {
      aitState.patch('failureModes', { requestNotificationAgreement: '4000', sdkLine: '3.x' });
      const onError = vi.fn();
      requestNotificationAgreement({
        options: { templateCode: 'tmpl' },
        onEvent: vi.fn(),
        onError,
      });
      await flush();

      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0][0] as Error & { code?: string };
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBeUndefined();
    });
  });
});
