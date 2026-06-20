import { getLocale, type Locale, setLocale, t } from '../../i18n/index.js';
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
