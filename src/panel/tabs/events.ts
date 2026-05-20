import { t } from '../../i18n/index.js';
import { aitState } from '../../mock/state.js';
import { h, monitoringNotice, selectRow } from '../helpers.js';

export function renderEventsTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  const backBtn = h('button', { className: 'ait-btn' }, t('events.btn.triggerBack'));
  backBtn.addEventListener('click', () => aitState.trigger('backEvent'));
  if (disabled) backBtn.disabled = true;

  const homeBtn = h('button', { className: 'ait-btn' }, t('events.btn.triggerHome'));
  homeBtn.addEventListener('click', () => aitState.trigger('homeEvent'));
  if (disabled) homeBtn.disabled = true;

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('events.section.navigation')),
      h('div', { className: 'ait-row' }, backBtn, homeBtn),
    ),
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('events.section.login')),
      selectRow(
        t('events.row.loggedIn'),
        ['true', 'false'],
        String(aitState.state.auth.isLoggedIn),
        (v) => {
          aitState.patch('auth', { isLoggedIn: v === 'true' });
        },
        disabled,
      ),
      selectRow(
        t('events.row.tossLoginIntegrated'),
        ['true', 'false'],
        String(aitState.state.auth.isTossLoginIntegrated),
        (v) => {
          aitState.patch('auth', { isTossLoginIntegrated: v === 'true' });
        },
        disabled,
      ),
    ),
  );
  return container;
}
