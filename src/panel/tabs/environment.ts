import { getLocale, type Locale, setLocale, t } from '../../i18n/index.js';
import { aitState } from '../../mock/state.js';
import type { NetworkStatus, OperationalEnvironment, PlatformOS } from '../../mock/types.js';
import { TELEMETRY_ENDPOINT } from '../../telemetry/index.js';
import {
  deleteMyData,
  isTier0Enabled,
  readConsentState,
  setConsentViaToggle,
  setTier0Enabled,
} from '../../telemetry/state.js';
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
      h('div', { className: 'ait-section-title' }, t('env.section.platform')),
      selectRow(
        t('env.row.os'),
        ['ios', 'android'],
        s.platform,
        (v) => aitState.update({ platform: v as PlatformOS }),
        disabled,
      ),
      inputRow(
        t('env.row.appVersion'),
        s.appVersion,
        (v) => aitState.update({ appVersion: v }),
        disabled,
      ),
      selectRow(
        t('env.row.environment'),
        ['toss', 'sandbox'],
        s.environment,
        (v) => aitState.update({ environment: v as OperationalEnvironment }),
        disabled,
      ),
      inputRow(t('env.row.locale'), s.locale, (v) => aitState.update({ locale: v }), disabled),
    ),
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('env.section.network')),
      selectRow(
        t('env.row.networkStatus'),
        ['WIFI', '4G', '5G', '3G', '2G', 'OFFLINE', 'WWAN', 'UNKNOWN'],
        s.networkStatus,
        (v) => aitState.update({ networkStatus: v as NetworkStatus }),
        disabled,
      ),
    ),
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('env.section.safeArea')),
      inputRow(
        t('env.row.safeArea.top'),
        String(s.safeAreaInsets.top),
        (v) => aitState.patch('safeAreaInsets', { top: Number(v) }),
        disabled,
      ),
      inputRow(
        t('env.row.safeArea.bottom'),
        String(s.safeAreaInsets.bottom),
        (v) => aitState.patch('safeAreaInsets', { bottom: Number(v) }),
        disabled,
      ),
    ),
    buildNavigationSection(),
    buildLanguageSection(),
    buildTelemetrySection(),
  );
  return container;
}

/**
 * Navigation 동작 관측 (read-only) — real(토스 WebView)에서 native bridge로 발화하는
 * no-op API의 마지막 호출값을 보여준다. Environment를 toss로 바꾸면 toss-gated 가드
 * (예: sdk-example `useDisableIosSwipeGestureInToss`)가 돌면서 이 값이 토글되므로,
 * "toss 진입 → 가드 실행 → 관측 가능한 state 변화" 루프를 패널에서 한눈에 확인할 수 있다.
 */
function buildNavigationSection(): HTMLElement {
  const swipe = aitState.state.navigation.iosSwipeGestureEnabled;
  const valueText =
    swipe === null
      ? t('env.value.iosSwipeGesture.unset')
      : swipe
        ? t('env.value.iosSwipeGesture.enabled')
        : t('env.value.iosSwipeGesture.disabled');

  return h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, t('env.section.navigation')),
    h(
      'div',
      { className: 'ait-row' },
      h('label', {}, t('env.row.iosSwipeGesture')),
      h(
        'span',
        {
          style: `font-family:'SF Mono','Menlo',monospace;font-size:12px;color:${
            swipe === null ? '#888' : '#95e6cb'
          }`,
        },
        valueText,
      ),
    ),
    h('div', { style: 'font-size:11px;color:#666;margin-top:4px' }, t('env.hint.iosSwipeGesture')),
  );
}

function buildLanguageSection(): HTMLElement {
  const current = getLocale();
  const select = h('select', { className: 'ait-select' }) as HTMLSelectElement;
  const options: Array<{ value: Locale; labelKey: 'env.language.ko' | 'env.language.en' }> = [
    { value: 'ko', labelKey: 'env.language.ko' },
    { value: 'en', labelKey: 'env.language.en' },
  ];
  for (const opt of options) {
    const option = h('option', { value: opt.value }, t(opt.labelKey));
    if (opt.value === current) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    setLocale(select.value as Locale);
  });

  return h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, t('env.section.language')),
    h('div', { className: 'ait-row' }, h('label', {}, t('env.language.row')), select),
  );
}

function buildTelemetrySection(): HTMLElement {
  // --- Tier 0 row ---
  const t0Enabled = isTier0Enabled();
  const t0StatusLabel = h(
    'span',
    {
      style: `font-size:12px;font-weight:600;color:${t0Enabled ? '#4ade80' : '#888'}`,
    },
    t0Enabled ? t('env.telemetry.t0On') : t('env.telemetry.t0Off'),
  );
  const t0ToggleBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm', style: 'font-size:11px' },
    t0Enabled ? t('env.telemetry.t0TurnOff') : t('env.telemetry.t0TurnOn'),
  );
  t0ToggleBtn.addEventListener('click', () => {
    setTier0Enabled(!t0Enabled);
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'env' } }));
  });
  const t0Row = h(
    'div',
    { className: 'ait-row' },
    h('label', {}, t('env.telemetry.t0Row')),
    h('span', { style: 'display:flex;align-items:center;gap:8px' }, t0StatusLabel, t0ToggleBtn),
  );
  const t0Desc = h(
    'div',
    { style: 'font-size:11px;color:#666;margin-bottom:6px' },
    t('env.telemetry.t0Desc'),
  );

  // --- Tier 1 row ---
  const consent = readConsentState();
  const isGranted = consent === 'granted';

  const statusLabel = h(
    'span',
    {
      style: `font-size:12px;font-weight:600;color:${isGranted ? '#4ade80' : '#888'}`,
    },
    isGranted ? t('env.telemetry.on') : t('env.telemetry.off'),
  );

  const toggleBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm', style: 'font-size:11px' },
    isGranted ? t('env.telemetry.turnOff') : t('env.telemetry.turnOn'),
  );
  toggleBtn.addEventListener('click', () => {
    setConsentViaToggle(!isGranted);
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'env' } }));
  });

  const statusRow = h(
    'div',
    { className: 'ait-row' },
    h('label', {}, t('env.telemetry.row')),
    h('span', { style: 'display:flex;align-items:center;gap:8px' }, statusLabel, toggleBtn),
  );

  // anon_id display (truncated to 8 chars + ellipsis, click-to-copy)
  const rawAnonId = localStorage.getItem('__ait_telemetry:anon_id');
  const displayAnonId = rawAnonId ?? t('env.telemetry.anonIdNotSet');
  const truncatedId = displayAnonId.length > 8 ? `${displayAnonId.slice(0, 8)}…` : displayAnonId;

  const anonIdEl = h(
    'span',
    {
      style: "font-family:'SF Mono','Menlo',monospace;font-size:11px;color:#95e6cb;cursor:pointer",
      title: t('env.telemetry.anonIdCopyTitle'),
    },
    t('env.telemetry.anonIdLabel', { value: truncatedId }),
  );
  anonIdEl.addEventListener('click', () => {
    if (!rawAnonId) return;
    navigator.clipboard.writeText(rawAnonId).catch(() => {
      /* clipboard unavailable — silently ignore */
    });
  });

  // Delete my data button
  const deleteBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm ait-btn-danger' },
    t('env.telemetry.deleteBtn'),
  );
  const deleteStatus = h('span', { style: 'font-size:11px;color:#aaa' });

  deleteBtn.addEventListener('click', () => {
    deleteBtn.disabled = true;
    deleteStatus.textContent = t('env.telemetry.deleting');
    deleteMyData(TELEMETRY_ENDPOINT)
      .then((ok) => {
        deleteStatus.textContent = ok
          ? t('env.telemetry.deleted')
          : t('env.telemetry.deleteFailedRetry');
        deleteBtn.disabled = false;
      })
      .catch(() => {
        deleteStatus.textContent = t('env.telemetry.deleteFailed');
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
  privacyLink.textContent = t('env.telemetry.privacyLink');

  return h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, t('env.telemetry.section')),
    t0Row,
    t0Desc,
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
