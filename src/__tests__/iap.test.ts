import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import { IAP, resetOrderCounter } from '../mock/iap/index.js';

describe('IAP mock', () => {
  beforeEach(() => {
    aitState.reset();
    resetOrderCounter();
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
    it('성공 시 onEvent가 호출된다', async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();
      const processProductGrant = vi.fn().mockResolvedValue(true);

      IAP.createOneTimePurchaseOrder({
        options: { sku: 'mock-gem-100', processProductGrant },
        onEvent,
        onError,
      });

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
      pendingOrders: [{ orderId: 'order-1', sku: 'mock-gem-100', paymentCompletedDate: new Date().toISOString() }],
    });

    const result = await IAP.completeProductGrant({ params: { orderId: 'order-1' } });
    expect(result).toBe(true);
    expect(aitState.state.iap.pendingOrders).toHaveLength(0);
    expect(aitState.state.iap.completedOrders).toContainEqual(
      expect.objectContaining({ orderId: 'order-1', status: 'COMPLETED' }),
    );
  });
});
