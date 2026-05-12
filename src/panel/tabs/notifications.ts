import { type StringKey, t } from '../../i18n/index.js';
import { aitState } from '../../mock/state.js';
import type { NotificationAgreementResult } from '../../mock/types.js';
import { h, monitoringNotice } from '../helpers.js';

const RESULTS: Array<{ value: NotificationAgreementResult; labelKey: StringKey }> = [
  { value: 'newAgreement', labelKey: 'notifications.option.newAgreement' },
  { value: 'alreadyAgreed', labelKey: 'notifications.option.alreadyAgreed' },
  { value: 'agreementRejected', labelKey: 'notifications.option.agreementRejected' },
];

function radioRow(
  name: string,
  current: NotificationAgreementResult,
  option: { value: NotificationAgreementResult; labelKey: StringKey },
  disabled: boolean,
): HTMLElement {
  const input = h('input', { type: 'radio', name, value: option.value });
  input.checked = current === option.value;
  if (disabled) input.disabled = true;
  input.addEventListener('change', () => {
    if (input.checked) {
      aitState.patch('notification', { nextResult: option.value });
    }
  });
  return h('label', { className: 'ait-row' }, input, h('span', {}, t(option.labelKey)));
}

export function renderNotificationsTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('notifications.section.title')),
      ...RESULTS.map((opt) =>
        radioRow('ait-notification-result', s.notification.nextResult, opt, disabled),
      ),
    ),
  );
  return container;
}
