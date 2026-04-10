import { aitState } from '../../mock/state.js';
import type { PermissionName, PermissionStatus } from '../../mock/types.js';
import { h, selectRow, monitoringNotice } from '../helpers.js';

export function renderPermissionsTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');
  const names: PermissionName[] = ['camera', 'photos', 'geolocation', 'clipboard', 'contacts', 'microphone'];
  const statuses: PermissionStatus[] = ['allowed', 'denied', 'notDetermined'];

  if (disabled) container.appendChild(monitoringNotice());

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Device Permissions'),
      ...names.map(name =>
        selectRow(name, statuses, s.permissions[name], v => {
          aitState.patch('permissions', { [name]: v as PermissionStatus });
        }, disabled),
      ),
    ),
  );
  return container;
}
