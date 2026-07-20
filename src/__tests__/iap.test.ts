import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkoutPayment, IAP, requestTossPayPaysBilling } from '../mock/iap/index.js';
import { aitState } from '../mock/state.js';
import { renderIapTab } from '../panel/tabs/iap.js';

describe('IAP mock', () => {
  beforeEach(() => {
    aitState.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getProductItemList: 상태에 설정된 상품 목록을 반환한다', async () => {
    const result = await IAP.getProductItemList();
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ sku: 'mock-gem-100', type: 'CONSUMABLE' });
  });

  describe('getSubscriptionInfo', () => {
    // 회귀 테스트 (devtools#786): 미프로비저닝 env3 capture(valueKeys=[])를
    // 무조건 기본값으로 굳혔던 회귀를 되돌린다. 선언 타입의 subscription은
    // optional이 아니므로 다이얼 미설정 시 항상 populated 성공 shape여야 한다.
    it('선언된 성공 shape로 resolve된다 — subscription의 필수 필드가 전부 존재', async () => {
      const result = await IAP.getSubscriptionInfo({ params: { orderId: 'order-1' } });
      expect(result.subscription).toBeDefined();
      expect(result.subscription).toMatchObject({
        catalogId: 1,
        status: 'ACTIVE',
        isAutoRenew: true,
        gracePeriodExpiresAt: null,
        isAccessible: true,
      });
      expect(typeof result.subscription.expiresAt).toBe('string');
    });

    // soft-resolve 다이얼 (#789) — env3 run11 2.x/iOS 실측: 미프로비저닝 구독이
    // reject가 아니라 빈 객체 {}(valueKeys=[])로 resolve됨. 다이얼을 켰을 때만
    // 이 shape로 대체되고, 미설정 시 위 테스트처럼 populated 성공 shape를 유지한다.
    describe('soft-resolve 다이얼 (#789)', () => {
      afterEach(() => {
        aitState.patch('failureModes', { softResolve: undefined });
      });

      it('다이얼 on 시 빈 객체 {}로 resolve된다 (실기기 동치)', async () => {
        aitState.patch('failureModes', { softResolve: { getSubscriptionInfo: true } });
        const result = await IAP.getSubscriptionInfo({ params: { orderId: 'order-1' } });
        expect(Object.keys(result as object)).toEqual([]);
      });

      it('softResolve patch는 기존 reject 다이얼 키를 지우지 않는다', async () => {
        aitState.patch('failureModes', { appLogin: 'APP_LOGIN' });
        aitState.patch('failureModes', { softResolve: { getSubscriptionInfo: true } });
        expect(aitState.state.failureModes.appLogin).toBe('APP_LOGIN');
        expect(aitState.state.failureModes.softResolve?.getSubscriptionInfo).toBe(true);
      });
    });
  });

  describe('createOneTimePurchaseOrder', () => {
    it('성공 시 onEvent가 호출되고 cancel 함수를 반환한다', async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      const processProductGrant = vi.fn().mockResolvedValue(true);

      const cancel = IAP.createOneTimePurchaseOrder({
        options: { sku: 'mock-gem-100', processProductGrant },
        onEvent,
        onError,
      });
      expect(typeof cancel).toBe('function');

      await vi.advanceTimersByTimeAsync(300);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          data: expect.objectContaining({ orderId: expect.stringContaining('mock-order-') }),
        }),
      );
      expect(onError).not.toHaveBeenCalled();
    });

    it('nextResult가 실패이면 onError가 호출된다', async () => {
      aitState.patch('iap', { nextResult: 'USER_CANCELED' });

      const onEvent = vi.fn();
      const onError = vi.fn();
      const processProductGrant = vi.fn();

      IAP.createOneTimePurchaseOrder({
        options: { sku: 'mock-gem-100', processProductGrant },
        onEvent,
        onError,
      });

      await vi.advanceTimersByTimeAsync(300);

      expect(onError).toHaveBeenCalledWith({ code: 'USER_CANCELED' });
      expect(onEvent).not.toHaveBeenCalled();
      expect(processProductGrant).not.toHaveBeenCalled();
    });

    it('processProductGrant가 false를 반환하면 onError가 호출된다', async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      const processProductGrant = vi.fn().mockResolvedValue(false);

      IAP.createOneTimePurchaseOrder({
        options: { sku: 'mock-gem-100', processProductGrant },
        onEvent,
        onError,
      });

      await vi.advanceTimersByTimeAsync(300);

      expect(onError).toHaveBeenCalledWith({ code: 'PRODUCT_NOT_GRANTED_BY_PARTNER' });
    });
  });

  it('completeProductGrant: pending 주문을 completed로 이동한다', async () => {
    aitState.patch('iap', {
      pendingOrders: [
        { orderId: 'order-1', sku: 'mock-gem-100', paymentCompletedDate: new Date().toISOString() },
      ],
    });

    const result = await IAP.completeProductGrant({ params: { orderId: 'order-1' } });
    expect(result).toBe(true);
    expect(aitState.state.iap.pendingOrders).toHaveLength(0);
    expect(aitState.state.iap.completedOrders).toContainEqual(
      expect.objectContaining({ orderId: 'order-1', status: 'COMPLETED' }),
    );
  });

  describe('panel orders viewer (renderIapTab)', () => {
    it('pending/completed가 비어있으면 빈 메시지를 노출한다', () => {
      const root = renderIapTab();
      const text = root.textContent ?? '';
      expect(text).toContain('Pending Orders (0)');
      expect(text).toContain('(no pending orders)');
      expect(text).toContain('Completed Orders (0)');
      expect(text).toContain('(no completed orders)');
    });

    it('pending order는 sku와 orderId 일부, Complete 버튼을 노출한다', () => {
      // 13자 이상이어야 shortOrderId가 …suffix 형태로 잘라낸다
      aitState.patch('iap', {
        pendingOrders: [
          {
            orderId: 'mock-order-pending-abcd1234',
            sku: 'mock-gem-100',
            paymentCompletedDate: new Date('2026-05-08T10:00:00Z').toISOString(),
          },
        ],
      });
      const root = renderIapTab();
      const text = root.textContent ?? '';
      expect(text).toContain('Pending Orders (1)');
      expect(text).toContain('mock-gem-100');
      expect(text).toContain('PENDING');
      // shortOrderId가 마지막 10자만 노출 (… prefix + slice(-10))
      expect(text).toContain('…g-abcd1234');
      expect(text).not.toContain('mock-order-pending-abcd1234');

      const buttons = Array.from(root.querySelectorAll('button')).filter(
        (b) => b.textContent === 'Complete',
      );
      expect(buttons).toHaveLength(1);
    });

    it('짧은 orderId(12자 이하)는 truncate 없이 그대로 노출한다', () => {
      aitState.patch('iap', {
        pendingOrders: [
          {
            orderId: 'short-id-12',
            sku: 'mock-gem-100',
            paymentCompletedDate: new Date().toISOString(),
          },
        ],
      });
      const root = renderIapTab();
      const text = root.textContent ?? '';
      expect(text).toContain('short-id-12');
    });

    it('Complete 버튼 클릭 시 mock의 completeProductGrant가 호출되고 state가 이동한다', async () => {
      aitState.patch('iap', {
        pendingOrders: [
          {
            orderId: 'mock-order-complete-1',
            sku: 'mock-gem-100',
            paymentCompletedDate: new Date().toISOString(),
          },
        ],
      });
      const root = renderIapTab();
      const completeBtn = Array.from(root.querySelectorAll('button')).find(
        (b) => b.textContent === 'Complete',
      ) as HTMLButtonElement;
      completeBtn.click();
      // completeProductGrant는 await 없이 sync로 state를 patch하고 Promise를 리턴
      await Promise.resolve();

      expect(aitState.state.iap.pendingOrders).toHaveLength(0);
      expect(aitState.state.iap.completedOrders).toContainEqual(
        expect.objectContaining({ orderId: 'mock-order-complete-1', status: 'COMPLETED' }),
      );
    });

    it('completed order는 sku, status, orderId 일부를 노출한다', () => {
      aitState.patch('iap', {
        completedOrders: [
          {
            orderId: 'mock-order-done-xyz9876',
            sku: 'mock-gem-100',
            status: 'COMPLETED',
            date: new Date().toISOString(),
          },
        ],
      });
      const root = renderIapTab();
      const text = root.textContent ?? '';
      expect(text).toContain('Completed Orders (1)');
      expect(text).toContain('mock-gem-100');
      expect(text).toContain('COMPLETED');
      expect(text).toContain('…ne-xyz9876');
    });

    it('panelEditable=false이면 Complete 버튼이 disabled', () => {
      aitState.patch('iap', {
        pendingOrders: [
          {
            orderId: 'mock-order-readonly-1',
            sku: 'mock-gem-100',
            paymentCompletedDate: new Date().toISOString(),
          },
        ],
      });
      aitState.update({ panelEditable: false });
      const root = renderIapTab();
      const completeBtn = Array.from(root.querySelectorAll('button')).find(
        (b) => b.textContent === 'Complete',
      ) as HTMLButtonElement;
      expect(completeBtn.disabled).toBe(true);
    });
  });

  describe('checkoutPayment', () => {
    // 회귀 테스트 (devtools#786): env3 capture는 전부 결제 실패 레코드였는데
    // (I2-result-success-examined 시나리오조차 실패였다) 그 실패 shape(reason 포함)를
    // 성공 분기에 일반화했던 회귀를 되돌린다. key-set 자체를 단언한다 — 이 버그
    // 클래스는 값이 아니라 key 구성이 어긋나는 것이라 Object.keys로 확인해야 한다.
    it('성공 시 { success: true }만 반환한다 — reason 키 없음', async () => {
      const promise = checkoutPayment({ params: { payToken: 'token-1' } });
      await vi.advanceTimersByTimeAsync(300);
      const result = await promise;
      expect(Object.keys(result)).toEqual(['success']);
      expect(result).toEqual({ success: true });
    });

    it('실패 시 reason을 포함한다', async () => {
      aitState.patch('payment', { nextResult: 'fail', failReason: 'Insufficient funds' });
      const promise = checkoutPayment({ params: { payToken: 'token-2' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(await promise).toEqual({ success: false, reason: 'Insufficient funds' });
    });

    // soft-resolve 다이얼 (#789, payment 범위) — env3 run11 2.x/iOS 실측: 미프로비저닝
    // 결제가 reject가 아니라 리터럴 `false` 키를 담은 { false, reason }
    // (valueKeys=['false','reason'], booleanValues=null)로 resolve됨. 이 shape는 하네스
    // artifact가 아니라 실기기 WebView가 관측한 값으로 확정됐다(sdk-example#303: capture는
    // WebView 안 Object.keys로 계산 → relay 개입 전). 다이얼 미설정 시 위 { success } 계약 유지.
    describe('soft-resolve 다이얼 (#789)', () => {
      afterEach(() => {
        aitState.patch('failureModes', { softResolve: undefined });
      });

      it('다이얼 off 시 { success: true }만 반환한다 (다이얼은 opt-in)', async () => {
        const promise = checkoutPayment({ params: { payToken: 'token-off' } });
        await vi.advanceTimersByTimeAsync(300);
        expect(Object.keys(await promise)).toEqual(['success']);
      });

      it('다이얼 on 시 valueKeys=[false, reason]로 resolve된다 (실기기 동치)', async () => {
        aitState.patch('failureModes', { softResolve: { checkoutPayment: true } });
        // 다이얼 on 경로는 setTimeout 이전에 즉시 반환하므로 타이머 advance 불필요.
        const result = await checkoutPayment({ params: { payToken: 'token-sr' } });
        expect(Object.keys(result as object).sort()).toEqual(['false', 'reason']);
      });
    });
  });

  describe('requestTossPayPaysBilling', () => {
    // 회귀 테스트 (devtools#786): checkoutPayment와 동일한 이유로 성공 분기에
    // reason을 얹었던 회귀를 되돌린다.
    it('성공 시 { success: true }만 반환한다 — reason 키 없음', async () => {
      const promise = requestTossPayPaysBilling({ params: { wrappedToken: 'wrapped-1' } });
      await vi.advanceTimersByTimeAsync(300);
      const result = await promise;
      expect(Object.keys(result ?? {})).toEqual(['success']);
      expect(result).toEqual({ success: true });
    });

    it('실패 시 reason을 포함한다', async () => {
      aitState.patch('payment', { nextResult: 'fail', failReason: 'Billing auth denied' });
      const promise = requestTossPayPaysBilling({ params: { wrappedToken: 'wrapped-2' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(await promise).toEqual({ success: false, reason: 'Billing auth denied' });
    });

    it('isSupported()는 true를 반환한다', () => {
      expect(requestTossPayPaysBilling.isSupported()).toBe(true);
    });

    // soft-resolve 다이얼 (#789, payment 범위) — checkoutPayment와 동일한 근거
    // (env3 run11 2.x/iOS 실측, valueKeys=['false','reason']). 다이얼 미설정 시 { success } 유지.
    describe('soft-resolve 다이얼 (#789)', () => {
      afterEach(() => {
        aitState.patch('failureModes', { softResolve: undefined });
      });

      it('다이얼 off 시 { success: true }만 반환한다 (다이얼은 opt-in)', async () => {
        const promise = requestTossPayPaysBilling({ params: { wrappedToken: 'wrapped-off' } });
        await vi.advanceTimersByTimeAsync(300);
        expect(Object.keys((await promise) ?? {})).toEqual(['success']);
      });

      it('다이얼 on 시 valueKeys=[false, reason]로 resolve된다 (실기기 동치)', async () => {
        aitState.patch('failureModes', { softResolve: { requestTossPayPaysBilling: true } });
        const result = await requestTossPayPaysBilling({ params: { wrappedToken: 'wrapped-sr' } });
        expect(Object.keys((result ?? {}) as object).sort()).toEqual(['false', 'reason']);
      });
    });
  });
});
