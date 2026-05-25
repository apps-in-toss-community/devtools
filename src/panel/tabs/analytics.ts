import { t } from '../../i18n/index.js';
import { aitState } from '../../mock/state.js';
import { h, monitoringNotice } from '../helpers.js';

const FIDELITY_BADGE: Record<string, string> = {
  faithful: '🟢',
  partial: '🟡',
  inert: '🔴',
};

export function renderAnalyticsTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());

  // --- Analytics Log section ---
  const logs = aitState.state.analyticsLog;

  const clearAnalyticsBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm ait-btn-danger' },
    t('analytics.btn.clear'),
  );
  if (disabled) clearAnalyticsBtn.disabled = true;
  clearAnalyticsBtn.addEventListener('click', () => {
    aitState.update({ analyticsLog: [] });
  });

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h(
        'div',
        { className: 'ait-row' },
        h(
          'div',
          { className: 'ait-section-title' },
          t('analytics.section.log', { count: logs.length }),
        ),
        clearAnalyticsBtn,
      ),
      ...logs
        .slice(-30)
        .reverse()
        .map((entry) => {
          const time = new Date(entry.timestamp).toLocaleTimeString();
          return h(
            'div',
            { className: 'ait-log-entry' },
            h('span', { className: 'ait-log-time' }, time),
            h('span', { className: 'ait-log-type' }, entry.type),
            JSON.stringify(entry.params),
          );
        }),
    ),
  );

  // --- SDK Calls section ---
  const calls = aitState.state.sdkCallLog;

  const clearCallsBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm ait-btn-danger' },
    t('analytics.calls.btn.clear'),
  );
  if (disabled) clearCallsBtn.disabled = true;
  clearCallsBtn.addEventListener('click', () => {
    aitState.update({ sdkCallLog: [] });
  });

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h(
        'div',
        { className: 'ait-row' },
        h(
          'div',
          { className: 'ait-section-title' },
          t('analytics.calls.section', { count: calls.length }),
        ),
        clearCallsBtn,
      ),
      calls.length === 0
        ? h('div', { className: 'ait-log-entry ait-log-empty' }, t('analytics.calls.empty'))
        : h(
            'div',
            {},
            ...calls
              .slice(-50)
              .reverse()
              .map((call) => {
                const badge = FIDELITY_BADGE[call.fidelity] ?? '⬜';
                const time = new Date(call.timestamp).toLocaleTimeString();
                const argsStr =
                  call.args.length > 0
                    ? `(${call.args.map((a) => JSON.stringify(a)).join(', ')})`
                    : '()';
                const statusSuffix =
                  call.status === 'rejected'
                    ? ` ✗ ${call.error ?? 'error'}`
                    : call.status === 'pending'
                      ? ' …'
                      : '';

                return h(
                  'div',
                  { className: `ait-log-entry ait-sdk-call ait-sdk-call-${call.fidelity}` },
                  h('span', { className: 'ait-log-badge' }, badge),
                  h('span', { className: 'ait-log-method' }, call.method),
                  h('span', { className: 'ait-log-args' }, argsStr),
                  h('span', { className: 'ait-log-time' }, ` · ${time}`),
                  statusSuffix ? h('span', { className: 'ait-log-status' }, statusSuffix) : '',
                );
              }),
          ),
    ),
  );

  return container;
}
