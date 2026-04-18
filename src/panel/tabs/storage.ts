import { aitState } from '../../mock/state.js';
import { h, monitoringNotice } from '../helpers.js';

export function renderStorageTab(refreshPanel: () => void): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());
  const prefix = '__ait_storage:';
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      entries.push([key.slice(prefix.length), localStorage.getItem(key) ?? '']);
    }
  }

  const clearBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Clear All');
  if (disabled) clearBtn.disabled = true;
  clearBtn.addEventListener('click', () => {
    for (const [key] of entries) {
      localStorage.removeItem(prefix + key);
    }
    refreshPanel();
  });

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h(
        'div',
        { className: 'ait-row' },
        h('div', { className: 'ait-section-title' }, `Storage (${entries.length} items)`),
        clearBtn,
      ),
      entries.length === 0
        ? h('div', { style: 'color:#555;font-size:12px' }, 'No items in storage')
        : h(
            'div',
            {},
            ...entries.map(([key, value]) =>
              h(
                'div',
                { className: 'ait-storage-row' },
                h('span', { className: 'ait-storage-key' }, key),
                h(
                  'span',
                  { className: 'ait-storage-value' },
                  value.length > 100 ? `${value.slice(0, 100)}...` : value,
                ),
              ),
            ),
          ),
    ),
  );
  return container;
}
