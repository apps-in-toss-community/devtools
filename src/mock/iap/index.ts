/**
 * IAP (인앱결제) mock
 */

import { aitState } from '../state.js';
import { createMockProxy } from '../proxy.js';

let orderCounter = 0;

function generateOrderId(): string {
  return `mock-order-${++orderCounter}-${Date.now()}`;
}

/** 테스트에서 orderCounter를 초기화할 때 사용 */
export function resetOrderCounter(): void {
  orderCounter = 0;
}

interface IapCreateOneTimePurchaseOrderOptions {
  options: {
    sku?: string;
    productId?: string;
    processProductGrant: (params: { orderId: string }) => boolean | Promise<boolean>;
  };
  onEvent: (event: { type: 'success'; data: IapOrderResult }) => void | Promise<void>;
  onError: (error: unknown) => void | Promise<void>;
}

interface CreateSubscriptionPurchaseOrderOptions {
  options: {
    sku: string;
    offerId?: string | null;
    processProductGrant: (params: { orderId: string; subscriptionId?: string }) => boolean | Promise<boolean>;
  };
  onEvent: (event: { type: 'success'; data: IapOrderResult }) => void | Promise<void>;
  onError: (error: unknown) => void | Promise<void>;
}

interface IapOrderResult {
  orderId: string;
  displayName: string;
  displayAmount: string;
  amount: number;
  currency: string;
  fraction: number;
  miniAppIconUrl: string | null;
}

function buildOrderResult(sku: string): IapOrderResult {
  const product = aitState.state.iap.products.find(p => p.sku === sku);
  const amountStr = product?.displayAmount?.replace(/[^0-9]/g, '') ?? '1000';
  return {
    orderId: generateOrderId(),
    displayName: product?.displayName ?? 'Mock Product',
    displayAmount: product?.displayAmount ?? '1,000원',
    amount: parseInt(amountStr, 10) || 1000,
    currency: 'KRW',
    fraction: 0,
    miniAppIconUrl: product?.iconUrl || null,
  };
}

async function handlePurchase(
  sku: string,
  processProductGrant: (params: { orderId: string; subscriptionId?: string }) => boolean | Promise<boolean>,
  onEvent: (event: { type: 'success'; data: IapOrderResult }) => void | Promise<void>,
  onError: (error: unknown) => void | Promise<void>,
): Promise<() => void> {
  const nextResult = aitState.state.iap.nextResult;

  // 비동기 시뮬레이션 (실제로는 결제 UI가 뜨는 시간)
  await new Promise(r => setTimeout(r, 300));

  if (nextResult !== 'success') {
    onError({ code: nextResult });
    return () => {};
  }

  const result = buildOrderResult(sku);

  try {
    const granted = await processProductGrant({ orderId: result.orderId });
    if (!granted) {
      onError({ code: 'PRODUCT_NOT_GRANTED_BY_PARTNER' });
      return () => {};
    }
  } catch (e) {
    onError(e);
    return () => {};
  }

  // 주문 완료 기록
  aitState.patch('iap', {
    completedOrders: [...aitState.state.iap.completedOrders, {
      orderId: result.orderId,
      sku,
      status: 'COMPLETED' as const,
      date: new Date().toISOString(),
    }],
  });

  await onEvent({ type: 'success', data: result });
  return () => {};
}

export const IAP = createMockProxy('IAP', {
  createOneTimePurchaseOrder(params: IapCreateOneTimePurchaseOrderOptions): () => void {
    const sku = params.options.sku ?? params.options.productId ?? '';
    handlePurchase(sku, params.options.processProductGrant, params.onEvent, params.onError);
    return () => {};
  },

  createSubscriptionPurchaseOrder(params: CreateSubscriptionPurchaseOrderOptions): () => void {
    handlePurchase(params.options.sku, params.options.processProductGrant, params.onEvent, params.onError);
    return () => {};
  },

  async getProductItemList(): Promise<{ products: unknown[] }> {
    return {
      products: aitState.state.iap.products.map(p => ({
        ...p,
        ...(p.type === 'SUBSCRIPTION' ? { renewalCycle: p.renewalCycle ?? 'MONTHLY' } : {}),
      })),
    };
  },

  async getPendingOrders(): Promise<{ orders: Array<{ orderId: string; sku: string; paymentCompletedDate: string }> }> {
    return { orders: [...aitState.state.iap.pendingOrders] };
  },

  async getCompletedOrRefundedOrders(): Promise<{
    hasNext: boolean;
    nextKey?: string | null;
    orders: Array<{ orderId: string; sku: string; status: 'COMPLETED' | 'REFUNDED'; date: string }>;
  }> {
    return {
      hasNext: false,
      nextKey: null,
      orders: [...aitState.state.iap.completedOrders],
    };
  },

  async completeProductGrant(args: { params: { orderId: string } }): Promise<boolean> {
    // pending → completed 전이
    const idx = aitState.state.iap.pendingOrders.findIndex(o => o.orderId === args.params.orderId);
    if (idx !== -1) {
      const order = aitState.state.iap.pendingOrders[idx];
      const pendingOrders = aitState.state.iap.pendingOrders.filter((_, i) => i !== idx);
      const completedOrders = [...aitState.state.iap.completedOrders, {
        orderId: order.orderId,
        sku: order.sku,
        status: 'COMPLETED' as const,
        date: new Date().toISOString(),
      }];
      aitState.patch('iap', { pendingOrders, completedOrders });
    }
    return true;
  },

  async getSubscriptionInfo(_args: { params: { orderId: string } }) {
    return {
      subscription: {
        catalogId: 1,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isAutoRenew: true,
        gracePeriodExpiresAt: null,
        isAccessible: true,
      },
    };
  },
});

// --- TossPay ---

export function checkoutPayment(options: { params: { payToken: string } }): Promise<{ success: boolean; reason?: string }> {
  const { nextResult, failReason } = aitState.state.payment;
  console.log('[ait-devtools] checkoutPayment:', options.params.payToken);

  return new Promise(resolve => {
    setTimeout(() => {
      if (nextResult === 'success') {
        resolve({ success: true });
      } else {
        resolve({ success: false, reason: failReason || 'Mock payment failed' });
      }
    }, 300);
  });
}
