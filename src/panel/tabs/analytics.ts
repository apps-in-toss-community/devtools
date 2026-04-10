import { aitState } from '../../mock/state.js';
import { h, monitoringNotice } from '../helpers.js';

export function renderAnalyticsTab(): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());
  const logs = aitState.state.analyticsLog;

  const clearBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Clear');
  if (disabled) clearBtn.disabled = true;
  clearBtn.addEventListener('click', () => {
    aitState.update({ analyticsLog: [] });
  });

  container.append(
    h('div', { className: 'ait-section' },
      h('div', { className: 'ait-row' },
        h('div', { className: 'ait-section-title' }, `Analytics Log (${logs.length})`),
        clearBtn,
      ),
      ...logs.slice(-30).reverse().map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString('ko-KR', { hour12: false });
        return h('div', { className: 'ait-log-entry' },
          h('span', { className: 'ait-log-time' }, time),
          h('span', { className: 'ait-log-type' }, entry.type),
          JSON.stringify(entry.params),
        );
      }),
    ),
  );
  return container;
}
