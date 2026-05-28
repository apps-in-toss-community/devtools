/**
 * IAP domain probes (read-only: check surface exists and queries return expected shape)
 */

import { IAP } from '../../../src/mock/iap/index.js';
import type { Probe } from '../types.js';

export const iapProbes: Probe[] = [
  {
    id: 'iap.getProductItemListExists',
    domain: 'iap',
    async run() {
      return typeof IAP.getProductItemList === 'function';
    },
  },
  {
    id: 'iap.getPendingOrdersEmpty',
    domain: 'iap',
    async run() {
      const orders = await IAP.getPendingOrders();
      return Array.isArray(orders);
    },
  },
  {
    id: 'iap.getCompletedOrRefundedOrdersEmpty',
    domain: 'iap',
    async run() {
      const orders = await IAP.getCompletedOrRefundedOrders();
      return Array.isArray(orders);
    },
  },
  {
    id: 'iap.getSubscriptionInfoExists',
    domain: 'iap',
    async run() {
      return typeof IAP.getSubscriptionInfo === 'function';
    },
  },
];
