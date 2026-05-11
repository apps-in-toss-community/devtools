import { aitState } from '../../mock/state.js';
import { h, monitoringNotice } from '../helpers.js';

type NotificationResult = 'newAgreement' | 'alreadyAgreed' | 'agreementRejected';

const RESULTS: Array<{ value: NotificationResult; label: string }> = [
  { value: 'newAgreement', label: 'newAgreement (first-time agree)' },
  { value: 'alreadyAgreed', label: 'alreadyAgreed (already opted-in)' },
  { value: 'agreementRejected', label: 'agreementRejected (user declined)' },
];

function radioRow(
  name: string,
  current: NotificationResult,
  option: { value: NotificationResult; label: string },
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
  return h('label', { className: 'ait-row' }, input, h('span', {}, option.label));
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
      h('div', { className: 'ait-section-title' }, 'requestNotificationAgreement'),
      ...RESULTS.map((opt) =>
        radioRow('ait-notification-result', s.notification.nextResult, opt, disabled),
      ),
    ),
  );
  return container;
}
