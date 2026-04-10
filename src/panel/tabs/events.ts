import { aitState } from '../../mock/state.js';
import { h, selectRow, monitoringNotice } from '../helpers.js';

export function renderEventsTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  const backBtn = h('button', { className: 'ait-btn' }, 'Trigger Back Event');
  backBtn.addEventListener('click', () => aitState.trigger('backEvent'));
  if (disabled) backBtn.disabled = true;

  const homeBtn = h('button', { className: 'ait-btn' }, 'Trigger Home Event');
  homeBtn.addEventListener('click', () => aitState.trigger('homeEvent'));
  if (disabled) homeBtn.disabled = true;

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Navigation Events'),
      h('div', { className: 'ait-row' }, backBtn, homeBtn),
    ),
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Login'),
      selectRow('Logged In', ['true', 'false'], String(aitState.state.auth.isLoggedIn), v => {
        aitState.patch('auth', { isLoggedIn: v === 'true' });
      }, disabled),
      selectRow('Toss Login Integrated', ['true', 'false'], String(aitState.state.auth.isTossLoginIntegrated), v => {
        aitState.patch('auth', { isTossLoginIntegrated: v === 'true' });
      }, disabled),
    ),
  );
  return container;
}
