import { t } from '../../i18n/index.js';
import { GoogleAdMob, loadFullScreenAd, showFullScreenAd } from '../../mock/ads/index.js';
import { aitState } from '../../mock/state.js';
import { h, monitoringNotice } from '../helpers.js';

function recordEvent(type: string) {
  aitState.patch('ads', { lastEvent: { type, timestamp: Date.now() } });
}

function recordError(message: string) {
  recordEvent(`error: ${message}`);
}

function statusRow(label: string, value: string): HTMLElement {
  return h(
    'div',
    { className: 'ait-row' },
    h('label', {}, label),
    h('span', { style: 'font-family:SF Mono,Menlo,monospace;font-size:11px;color:#aaa' }, value),
  );
}

function lastEventLine(): HTMLElement {
  const last = aitState.state.ads.lastEvent;
  if (!last) {
    return h(
      'div',
      { className: 'ait-log-entry' },
      h('span', { style: 'color:#555' }, t('ads.empty.events')),
    );
  }
  const time = new Date(last.timestamp).toLocaleTimeString();
  const isError = last.type.startsWith('error:');
  return h(
    'div',
    { className: 'ait-log-entry' },
    h('span', { className: 'ait-log-type', style: isError ? 'color:#e74c3c' : '' }, last.type),
    h('span', { className: 'ait-log-time' }, time),
  );
}

function adSection(
  title: string,
  onLoad: () => void,
  onShow: () => void,
  disabled: boolean,
): HTMLElement {
  const loadBtn = h('button', { className: 'ait-btn ait-btn-sm' }, t('ads.btn.load'));
  const showBtn = h('button', { className: 'ait-btn ait-btn-sm' }, t('ads.btn.show'));
  if (disabled) {
    loadBtn.disabled = true;
    showBtn.disabled = true;
  }
  loadBtn.addEventListener('click', onLoad);
  showBtn.addEventListener('click', onShow);

  return h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, title),
    h('div', { className: 'ait-btn-row' }, loadBtn, showBtn),
  );
}

export function renderAdsTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  const forceNoFillCb = h('input', { type: 'checkbox', className: 'ait-checkbox' });
  forceNoFillCb.checked = s.ads.forceNoFill;
  if (disabled) forceNoFillCb.disabled = true;
  forceNoFillCb.addEventListener('change', () => {
    aitState.patch('ads', { forceNoFill: forceNoFillCb.checked });
  });

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('ads.section.state')),
      statusRow(t('ads.row.isLoaded'), String(s.ads.isLoaded)),
      h('div', { className: 'ait-row' }, h('label', {}, t('ads.row.forceNoFill')), forceNoFillCb),
      lastEventLine(),
    ),
    adSection(
      t('ads.section.googleAdMob'),
      () => {
        GoogleAdMob.loadAppsInTossAdMob({
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err.message),
        });
      },
      () => {
        GoogleAdMob.showAppsInTossAdMob({
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err.message),
        });
      },
      disabled,
    ),
    adSection(
      t('ads.section.tossAds'),
      () => {
        // TossAds has no load/show event API in the SDK; surface initialize lifecycle
        // through the same event log so the tab reads consistently with the others.
        if (aitState.state.ads.forceNoFill) {
          recordError('No fill');
          return;
        }
        aitState.patch('ads', { isLoaded: true });
        recordEvent('loaded');
      },
      () => {
        if (!aitState.state.ads.isLoaded) {
          recordError('Ad not loaded');
          return;
        }
        recordEvent('show');
        setTimeout(() => {
          recordEvent('dismissed');
          aitState.patch('ads', { isLoaded: false });
        }, 1500);
      },
      disabled,
    ),
    adSection(
      t('ads.section.fullScreenAd'),
      () => {
        loadFullScreenAd({
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err.message),
        });
      },
      () => {
        showFullScreenAd({
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err.message),
        });
      },
      disabled,
    ),
  );

  return container;
}
