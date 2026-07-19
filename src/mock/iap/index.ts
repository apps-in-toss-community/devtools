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

  // 실기기(2.x×iOS) capture는 getSubscriptionInfo가 { subscription } 없이 빈 객체
  // {}로 resolve됨을 보였다(devtools#770, valueKeys=[]). 다만 그 캡처는 **31146에
  // 구독이 프로비저닝되지 않은 상태**에서 얻은 것이다 — 즉 프로비저닝 의존 실패지 이
  // API의 무조건적 계약이 아니다(grantPromotionReward에서 되돌린 것과 같은 실패
  // 양상, devtools#786은 #778에서 이 되돌림만 누락됐던 잔여를 정정한다). 선언 타입
  // `IapSubscriptionInfoResult`의 subscription은 optional이 아니므로, 빈 객체를
  // 기본값으로 굳히면 SDK가 선언한 성공 분기가 mock에서 영구히 도달 불가능해진다.
  // 그래서 기본값은 선언 타입대로 성공 shape로 두고, 미프로비저닝 재현은 실패-모드
  // 다이얼에 붙인다 — devtools#785(game promotion)와 같은 성격의 배선 대상.
  async getSubscriptionInfo(_args: {
    params: { orderId: string };
  }): Promise<{ subscription: IapSubscriptionInfoResult }> {
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

// 실기기(2.x×iOS) capture는 checkoutPayment가 전부 결제 **실패** 레코드였다
// (devtools#770/#786) — I2-result-success-examined 시나리오조차
// valueKeys=['false','reason']로 돌아왔다. env3는 성공 경로 shape를 한 번도
// 보여준 적이 없으므로, 실패 shape(reason 포함)를 성공 분기에 일반화하는 건
// 미측정 셀에 대한 근거 없는 추정이다(startUpdateLocation을 실측 없이 건드리지
// 않은 것과 같은 이유). 게다가 그 일반화로 주장한 key-set 동치도 실제로는
// 달성되지 않는다 — env3의 첫 키는 'success'가 아니라 'false'라 reason을 더해도
// 여전히 어긋난다('false' 키 자체는 하네스 버그가 아니라 실기기 shape로 확정된
// 별개 사안, 여기서 "고치지" 않는다). 그래서 성공 분기는 선언 타입대로
// { success: true }만 반환한다. 실패 분기(reason 포함)는 실측대로 유지.
export async function checkoutPayment(options: {
  params: { payToken: string };
}): Promise<{ success: boolean; reason?: string }> {
  const { nextResult, failReason } = aitState.state.payment;
  console.log('[@ait-co/devtools] checkoutPayment:', options.params.payToken);

  await new Promise((r) => setTimeout(r, 300));

  if (nextResult === 'success') {
    return { success: true };
  }
  return { success: false, reason: failReason || 'Mock payment failed' };
}

export const requestTossPayPaysBilling = Object.assign(
  // requestTossPayPaysBilling도 checkoutPayment와 동일한 사정이다(devtools#770/#786)
  // — result-success-examined·native-billing-cancelled·happy-varied-token 시나리오
  // 전부 실패(valueKeys=['false','reason'])로 돌아왔다. env3가 성공 경로 shape를
  // 보여준 적이 없으므로 성공 분기에 reason을 얹는 건 근거 없는 일반화고, 그마저도
  // 첫 키가 'success'가 아닌 'false'라 주장한 key-set 동치를 달성하지 못한다.
  // 성공 분기는 선언 타입대로 { success: true }만 반환한다.
  async function requestTossPayPaysBilling(options: {
    params: { wrappedToken: string };
  }): Promise<{ success: boolean; reason?: string } | undefined> {
    const { nextResult, failReason } = aitState.state.payment;
    console.log('[@ait-co/devtools] requestTossPayPaysBilling:', options.params.wrappedToken);

    await new Promise((r) => setTimeout(r, 300));

    if (nextResult === 'success') {
      return { success: true };
    }
    return { success: false, reason: failReason || 'Mock billing auth failed' };
  },
  { isSupported: () => true },
);
