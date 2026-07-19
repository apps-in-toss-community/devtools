/**
 * IAP (인앱결제) mock
 */

import type { IapProductListItem, IapSubscriptionInfoResult } from '@apps-in-toss/web-framework';
import { createMockProxy } from '../proxy.js';
import { aitState } from '../state.js';

// orderCounter는 모듈 레벨 상태로 reset()에 의해 초기화되지 않는다.
// 테스트에서는 orderId를 stringContaining('mock-order-')로 검증하여 카운터 값에 의존하지 않는다.
let orderCounter = 0;

function generateOrderId(): string {
  return `mock-order-${++orderCounter}-${Date.now()}`;
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
    processProductGrant: (params: {
      orderId: string;
      subscriptionId?: string;
    }) => boolean | Promise<boolean>;
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
  const product = aitState.state.iap.products.find((p) => p.sku === sku);
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
  processProductGrant: (params: {
    orderId: string;
    subscriptionId?: string;
  }) => boolean | Promise<boolean>,
  onEvent: (event: { type: 'success'; data: IapOrderResult }) => void | Promise<void>,
  onError: (error: unknown) => void | Promise<void>,
): Promise<void> {
  const nextResult = aitState.state.iap.nextResult;

  // 비동기 시뮬레이션 (실제로는 결제 UI가 뜨는 시간)
  await new Promise((r) => setTimeout(r, 300));

  if (nextResult !== 'success') {
    onError({ code: nextResult });
    return;
  }

  const result = buildOrderResult(sku);

  try {
    const granted = await processProductGrant({ orderId: result.orderId });
    if (!granted) {
      onError({ code: 'PRODUCT_NOT_GRANTED_BY_PARTNER' });
      return;
    }
  } catch (e) {
    onError(e);
    return;
  }

  // 주문 완료 기록
  aitState.patch('iap', {
    completedOrders: [
      ...aitState.state.iap.completedOrders,
      {
        orderId: result.orderId,
        sku,
        status: 'COMPLETED' as const,
        date: new Date().toISOString(),
      },
    ],
  });

  await onEvent({ type: 'success', data: result });
}

export const IAP = createMockProxy('IAP', {
  // 반환되는 cancel 함수는 mock에서는 no-op이다 (실제 SDK는 결제 UI를 닫음)
  createOneTimePurchaseOrder(params: IapCreateOneTimePurchaseOrderOptions): () => void {
    const sku = params.options.sku ?? params.options.productId ?? '';
    handlePurchase(sku, params.options.processProductGrant, params.onEvent, params.onError).catch(
      (e) => console.error('[@ait-co/devtools] IAP unexpected error:', e),
    );
    return () => {};
  },

  createSubscriptionPurchaseOrder(params: CreateSubscriptionPurchaseOrderOptions): () => void {
    handlePurchase(
      params.options.sku,
      params.options.processProductGrant,
      params.onEvent,
      params.onError,
    ).catch((e) => console.error('[@ait-co/devtools] IAP unexpected error:', e));
    return () => {};
  },

  async getProductItemList(): Promise<{ products: IapProductListItem[] }> {
    return {
      products: aitState.state.iap.products.map((p) => ({
        ...p,
        ...(p.type === 'SUBSCRIPTION' ? { renewalCycle: p.renewalCycle ?? 'MONTHLY' } : {}),
      })) as IapProductListItem[],
    };
  },

  // 실기기(2.x×iOS) capture는 getPendingOrders가 { orders }뿐 아니라 { orders, orderIds }
  // 2개 키로 resolve됨을 보였다(devtools#770) — 선언된 SDK 타입엔 orderIds가 없으므로
  // 시그니처는 그대로 두고 런타임 반환값만 캐스트한다.
  async getPendingOrders(): Promise<{
    orders: Array<{ orderId: string; sku: string; paymentCompletedDate: string }>;
  }> {
    const orders = [...aitState.state.iap.pendingOrders];
    return {
      orders,
      orderIds: orders.map((o) => o.orderId),
    } as unknown as {
      orders: Array<{ orderId: string; sku: string; paymentCompletedDate: string }>;
    };
  },

  // 실기기(2.x×iOS) capture는 getCompletedOrRefundedOrders가 nextKey 없이
  // { hasNext, orders } 2개 키로 resolve됨을 보였다(devtools#770).
  async getCompletedOrRefundedOrders(): Promise<{
    hasNext: boolean;
    nextKey?: string | null;
    orders: Array<{ orderId: string; sku: string; status: 'COMPLETED' | 'REFUNDED'; date: string }>;
  }> {
    return {
      hasNext: false,
      orders: [...aitState.state.iap.completedOrders],
    };
  },

  async completeProductGrant(args: { params: { orderId: string } }): Promise<boolean> {
    // pending → completed 전이
    const idx = aitState.state.iap.pendingOrders.findIndex(
      (o) => o.orderId === args.params.orderId,
    );
    if (idx !== -1) {
      const order = aitState.state.iap.pendingOrders[idx];
      const pendingOrders = aitState.state.iap.pendingOrders.filter((_, i) => i !== idx);
      const completedOrders = [
        ...aitState.state.iap.completedOrders,
        {
          orderId: order.orderId,
          sku: order.sku,
          status: 'COMPLETED' as const,
          date: new Date().toISOString(),
        },
      ];
      aitState.patch('iap', { pendingOrders, completedOrders });
    }
    return true;
  },

  // 실기기(2.x×iOS) capture는 (프로비저닝된 구독이 없는 상태에서) getSubscriptionInfo가
  // { subscription } 없이 빈 객체 {}로 resolve됨을 보였다(devtools#770). 선언된 SDK
  // 타입은 subscription을 필수로 요구하므로 시그니처는 그대로 두고 런타임 반환값만
  // 실측과 동치시킨다.
  async getSubscriptionInfo(_args: {
    params: { orderId: string };
  }): Promise<{ subscription: IapSubscriptionInfoResult }> {
    return {} as unknown as { subscription: IapSubscriptionInfoResult };
  },
});

// --- TossPay ---

// 실기기(2.x×iOS) capture는 checkoutPayment의 valueKeys가 { success, reason } 2개
// 키로 실측됐다(devtools#770, nextResult='fail' 경로 capture). 이전 mock은 성공 시
// { success: true } 1개 키만 반환해 env1↔env3 valueKeys가 어긋났다 — success 값은
// 패널의 TossPay 시뮬레이터 dial(payment.nextResult)을 계속 따르되, reason은 항상
// 포함해 실기기와 key set을 동치시킨다.
export async function checkoutPayment(options: {
  params: { payToken: string };
}): Promise<{ success: boolean; reason?: string }> {
  const { nextResult, failReason } = aitState.state.payment;
  console.log('[@ait-co/devtools] checkoutPayment:', options.params.payToken);

  await new Promise((r) => setTimeout(r, 300));

  if (nextResult === 'success') {
    return { success: true, reason: 'mock' };
  }
  return { success: false, reason: failReason || 'Mock payment failed' };
}

export const requestTossPayPaysBilling = Object.assign(
  // requestTossPayPaysBilling도 checkoutPayment와 동일한 실측(devtools#770) — 항상
  // { success, reason } 2개 키로 resolve된다.
  async function requestTossPayPaysBilling(options: {
    params: { wrappedToken: string };
  }): Promise<{ success: boolean; reason?: string } | undefined> {
    const { nextResult, failReason } = aitState.state.payment;
    console.log('[@ait-co/devtools] requestTossPayPaysBilling:', options.params.wrappedToken);

    await new Promise((r) => setTimeout(r, 300));

    if (nextResult === 'success') {
      return { success: true, reason: 'mock' };
    }
    return { success: false, reason: failReason || 'Mock billing auth failed' };
  },
  { isSupported: () => true },
);
