import { t } from '../../i18n/index.js';
import { aitState } from '../../mock/state.js';
import { h, inputRow, monitoringNotice } from '../helpers.js';

export function renderLocationTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('location.section.current')),
      inputRow(
        t('location.row.latitude'),
        String(s.location.coords.latitude),
        (v) => {
          const coords = { ...s.location.coords, latitude: Number(v) };
          aitState.patch('location', { coords } as Partial<typeof s.location>);
        },
        disabled,
      ),
      inputRow(
        t('location.row.longitude'),
        String(s.location.coords.longitude),
        (v) => {
          const coords = { ...s.location.coords, longitude: Number(v) };
          aitState.patch('location', { coords } as Partial<typeof s.location>);
        },
        disabled,
      ),
      inputRow(
        t('location.row.accuracy'),
        String(s.location.coords.accuracy),
        (v) => {
          const coords = { ...s.location.coords, accuracy: Number(v) };
          aitState.patch('location', { coords } as Partial<typeof s.location>);
        },
        disabled,
      ),
    ),
  );
  return container;
}
