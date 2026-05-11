import { aitState } from '../../mock/state.js';
import type { NetworkStatus, OperationalEnvironment, PlatformOS } from '../../mock/types.js';
import { TELEMETRY_ENDPOINT } from '../../telemetry/index.js';
import { deleteMyData, readConsentState, setConsentViaToggle } from '../../telemetry/state.js';
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
    buildTelemetrySection(),
  );
  return container;
}

function buildTelemetrySection(): HTMLElement {
  const consent = readConsentState();
  const isGranted = consent === 'granted';

  // Status label
  const statusLabel = h(
    'span',
    {
      style: `font-size:12px;font-weight:600;color:${isGranted ? '#4ade80' : '#888'}`,
    },
    isGranted ? 'On' : 'Off',
  );

  // Toggle button
  const toggleBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm', style: 'font-size:11px' },
    isGranted ? 'Turn off' : 'Turn on',
  );
  toggleBtn.addEventListener('click', () => {
    setConsentViaToggle(!isGranted);
    // Re-render the environment tab
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'env' } }));
  });

  const statusRow = h(
    'div',
    { className: 'ait-row' },
    h('label', {}, 'Telemetry'),
    h('span', { style: 'display:flex;align-items:center;gap:8px' }, statusLabel, toggleBtn),
  );

  // anon_id display (truncated to 8 chars + ellipsis, click-to-copy)
  const anonId = localStorage.getItem('__ait_telemetry:anon_id') ?? '(not yet set)';
  const truncatedId = anonId.length > 8 ? `${anonId.slice(0, 8)}…` : anonId;

  const anonIdEl = h(
    'span',
    {
      style: "font-family:'SF Mono','Menlo',monospace;font-size:11px;color:#95e6cb;cursor:pointer",
      title: 'Click to copy full anon_id',
    },
    `anon_id: ${truncatedId}`,
  );
  anonIdEl.addEventListener('click', () => {
    navigator.clipboard.writeText(anonId).catch(() => {
      /* clipboard unavailable — silently ignore */
    });
  });

  // "내 데이터 삭제" button
  const deleteBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm ait-btn-danger' },
    '내 데이터 삭제',
  );
  const deleteStatus = h('span', { style: 'font-size:11px;color:#aaa' });

  deleteBtn.addEventListener('click', () => {
    deleteBtn.disabled = true;
    deleteStatus.textContent = '삭제 중…';
    deleteMyData(TELEMETRY_ENDPOINT)
      .then((ok) => {
        deleteStatus.textContent = ok ? '삭제 완료' : '삭제 실패 (다시 시도해주세요)';
        deleteBtn.disabled = false;
      })
      .catch(() => {
        deleteStatus.textContent = '삭제 실패';
        deleteBtn.disabled = false;
      });
  });

  // Privacy link
  const privacyLink = h('a', {
    href: 'https://docs.aitc.dev/privacy',
    target: '_blank',
    rel: 'noopener noreferrer',
    style: 'font-size:11px;color:#666;text-decoration:none',
  });
  privacyLink.textContent = '개인정보 처리방침';

  return h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, 'Telemetry'),
    statusRow,
    h('div', { style: 'margin-bottom:6px' }, anonIdEl),
    h(
      'div',
      { className: 'ait-btn-row', style: 'align-items:center;gap:8px;margin-top:6px' },
      deleteBtn,
      deleteStatus,
    ),
    h('div', { style: 'margin-top:8px' }, privacyLink),
  );
}
