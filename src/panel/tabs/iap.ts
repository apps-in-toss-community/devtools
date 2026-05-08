import { IAP } from '../../mock/iap/index.js';
import { aitState } from '../../mock/state.js';
import type { IapNextResult } from '../../mock/types.js';
import { h, monitoringNotice, selectRow } from '../helpers.js';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

function shortOrderId(orderId: string): string {
  return orderId.length > 12 ? `…${orderId.slice(-10)}` : orderId;
}

export function renderIapTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');
  const results: IapNextResult[] = [
    'success',
    'USER_CANCELED',
    'INVALID_PRODUCT_ID',
    'PAYMENT_PENDING',
    'NETWORK_ERROR',
    'ITEM_ALREADY_OWNED',
    'INTERNAL_ERROR',
  ];

  if (disabled) container.appendChild(monitoringNotice());

  const pendingOrders = s.iap.pendingOrders;
  const pendingSection = h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, `Pending Orders (${pendingOrders.length})`),
  );
  if (pendingOrders.length === 0) {
    pendingSection.appendChild(h('div', { className: 'ait-log-entry' }, '(no pending orders)'));
  } else {
    for (const o of pendingOrders) {
      const completeBtn = h('button', { className: 'ait-btn ait-btn-sm' }, 'Complete');
      if (disabled) completeBtn.disabled = true;
      completeBtn.addEventListener('click', () => {
        IAP.completeProductGrant({ params: { orderId: o.orderId } }).catch((err) =>
          console.error('[@ait-co/devtools] completeProductGrant error:', err),
        );
      });
      pendingSection.appendChild(
        h(
          'div',
          { className: 'ait-log-entry' },
          h('span', { className: 'ait-log-type' }, 'PENDING'),
          `${o.sku} (${shortOrderId(o.orderId)}) · ${formatTimestamp(o.paymentCompletedDate)} `,
          completeBtn,
        ),
      );
    }
  }

  const completedOrders = s.iap.completedOrders;
  const completedSection = h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, `Completed Orders (${completedOrders.length})`),
  );
  if (completedOrders.length === 0) {
    completedSection.appendChild(h('div', { className: 'ait-log-entry' }, '(no completed orders)'));
  } else {
    for (const o of completedOrders) {
      completedSection.appendChild(
        h(
          'div',
          { className: 'ait-log-entry' },
          h('span', { className: 'ait-log-type' }, o.status),
          `${o.sku} (${shortOrderId(o.orderId)}) · ${formatTimestamp(o.date)}`,
        ),
      );
    }
  }

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'IAP Simulator'),
      selectRow(
        'Next Purchase Result',
        results,
        s.iap.nextResult,
        (v) => {
          aitState.patch('iap', { nextResult: v as IapNextResult });
        },
        disabled,
      ),
    ),
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'TossPay'),
      selectRow(
        'Next Payment Result',
        ['success', 'fail'],
        s.payment.nextResult,
        (v) => {
          aitState.patch('payment', { nextResult: v as 'success' | 'fail' });
        },
        disabled,
      ),
    ),
    pendingSection,
    completedSection,
  );
  return container;
}
