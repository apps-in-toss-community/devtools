import { aitState } from '../../mock/state.js';
import type { NetworkStatus, OperationalEnvironment, PlatformOS } from '../../mock/types.js';
import { h, inputRow, monitoringNotice, selectRow } from '../helpers.js';

export function renderEnvironmentTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Platform'),
      selectRow(
        'OS',
        ['ios', 'android'],
        s.platform,
        (v) => aitState.update({ platform: v as PlatformOS }),
        disabled,
      ),
      inputRow('App Version', s.appVersion, (v) => aitState.update({ appVersion: v }), disabled),
      selectRow(
        'Environment',
        ['toss', 'sandbox'],
        s.environment,
        (v) => aitState.update({ environment: v as OperationalEnvironment }),
        disabled,
      ),
      inputRow('Locale', s.locale, (v) => aitState.update({ locale: v }), disabled),
    ),
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Network'),
      selectRow(
        'Status',
        ['WIFI', '4G', '5G', '3G', '2G', 'OFFLINE', 'WWAN', 'UNKNOWN'],
        s.networkStatus,
        (v) => aitState.update({ networkStatus: v as NetworkStatus }),
        disabled,
      ),
    ),
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Safe Area Insets'),
      inputRow(
        'Top',
        String(s.safeAreaInsets.top),
        (v) => aitState.patch('safeAreaInsets', { top: Number(v) }),
        disabled,
      ),
      inputRow(
        'Bottom',
        String(s.safeAreaInsets.bottom),
        (v) => aitState.patch('safeAreaInsets', { bottom: Number(v) }),
        disabled,
      ),
    ),
  );
  return container;
}
