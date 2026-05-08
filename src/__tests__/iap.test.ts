import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkoutPayment, IAP } from '../mock/iap/index.js';
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
      expect(text).not.toContain('…short-id-12');
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
    it('성공 시 { success: true }를 반환한다', async () => {
      const promise = checkoutPayment({ params: { payToken: 'token-1' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(await promise).toEqual({ success: true });
    });

    it('실패 시 reason을 포함한다', async () => {
      aitState.patch('payment', { nextResult: 'fail', failReason: 'Insufficient funds' });
      const promise = checkoutPayment({ params: { payToken: 'token-2' } });
      await vi.advanceTimersByTimeAsync(300);
      expect(await promise).toEqual({ success: false, reason: 'Insufficient funds' });
    });
  });
});
