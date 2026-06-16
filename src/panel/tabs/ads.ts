import { t } from '../../i18n/index.js';
import { GoogleAdMob, loadFullScreenAd, showFullScreenAd, TossAds } from '../../mock/ads/index.js';
import { aitState } from '../../mock/state.js';
import { h, inputRow, monitoringNotice } from '../helpers.js';

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

/** TossAds 배너 인터랙티브 섹션 — Render/No-fill/Click/Destroy 버튼 */
function tossAdsBannerSection(disabled: boolean): HTMLElement {
  // 패널 내부 더미 mount 대상
  const mountTarget = h('div', {
    style: 'min-height:60px;background:#111;border-radius:4px;margin-bottom:6px;overflow:hidden;',
  });

  const renderBtn = h('button', { className: 'ait-btn ait-btn-sm' }, t('ads.btn.render'));
  const noFillBtn = h('button', { className: 'ait-btn ait-btn-sm' }, t('ads.btn.noFill'));
  const clickBtn = h('button', { className: 'ait-btn ait-btn-sm' }, t('ads.btn.click'));
  const destroyBtn = h('button', { className: 'ait-btn ait-btn-sm' }, t('ads.btn.destroy'));

  if (disabled) {
    renderBtn.disabled = true;
    noFillBtn.disabled = true;
    clickBtn.disabled = true;
    destroyBtn.disabled = true;
  }

  // 가장 최근 attachBanner 반환 handle 보존 (panel 내부 추적)
  let currentHandle: { destroy: () => void } | null = null;

  renderBtn.addEventListener('click', () => {
    // 기존 슬롯 정리 후 새로 Render
    currentHandle?.destroy();
    currentHandle = null;
    mountTarget.innerHTML = '';

    const handle = TossAds.attachBanner('mock-banner-group', mountTarget, {
      theme: 'auto',
      variant: 'card',
      callbacks: {
        onAdRendered: (p) => recordEvent(`onAdRendered(${p.slotId})`),
        onAdImpression: (p) => recordEvent(`onAdImpression(${p.slotId})`),
        onAdClicked: (p) => recordEvent(`onAdClicked(${p.slotId})`),
        onAdFailedToRender: (p) => recordEvent(`error: onAdFailedToRender(${p.slotId})`),
        onNoFill: (p) => recordEvent(`error: onNoFill(${p.slotId})`),
      },
    });
    currentHandle = handle;
  });

  noFillBtn.addEventListener('click', () => {
    // 기존 슬롯 정리
    currentHandle?.destroy();
    currentHandle = null;
    mountTarget.innerHTML = '';

    // no-fill 경로: 패널 상의 forceNoFill 상태와 무관하게 즉시 no-fill 콜백을 발화한다.
    // (forceNoFill을 일시 toggle하면 attachBanner 내부 setTimeout이 복원 후 실행돼
    //  실제 forceNoFill 상태를 읽어 기본 경로가 돌아가는 race condition이 생긴다.)
    const slotId = `mock-slot-no-fill-${Date.now()}`;
    recordEvent(`error: onNoFill(${slotId})`);
    recordEvent(`error: onAdFailedToRender(${slotId})`);
  });

  clickBtn.addEventListener('click', () => {
    recordEvent('banner:clicked');
  });

  destroyBtn.addEventListener('click', () => {
    if (currentHandle) {
      currentHandle.destroy();
      currentHandle = null;
      mountTarget.innerHTML = '';
      recordEvent('banner:destroyed');
    } else {
      recordError('No banner to destroy');
    }
  });

  return h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, t('ads.section.tossAdsBanner')),
    mountTarget,
    h('div', { className: 'ait-btn-row' }, renderBtn, noFillBtn, clickBtn, destroyBtn),
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
      inputRow(
        t('ads.row.rewardUnitType'),
        s.ads.rewardUnitType,
        (v) => aitState.patch('ads', { rewardUnitType: v }),
        disabled,
      ),
      inputRow(
        t('ads.row.rewardAmount'),
        String(s.ads.rewardAmount),
        (v) => {
          const n = Number(v);
          if (!Number.isNaN(n)) aitState.patch('ads', { rewardAmount: n });
        },
        disabled,
      ),
      lastEventLine(),
    ),
    adSection(
      t('ads.section.googleAdMob'),
      () => {
        GoogleAdMob.loadAppsInTossAdMob({
          options: { adGroupId: 'mock-group' },
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err instanceof Error ? err.message : String(err)),
        });
      },
      () => {
        GoogleAdMob.showAppsInTossAdMob({
          options: { adGroupId: 'mock-group' },
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err instanceof Error ? err.message : String(err)),
        });
      },
      disabled,
    ),
    adSection(
      t('ads.section.tossAds'),
      () => {
        // TossAds initialize: live state를 읽어 forceNoFill 분기
        TossAds.initialize({
          callbacks: {
            onInitialized: () => {
              aitState.patch('ads', { isLoaded: true });
              recordEvent('loaded');
            },
            onInitializationFailed: (err) =>
              recordError(err instanceof Error ? err.message : String(err)),
          },
        });
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
    tossAdsBannerSection(disabled),
    adSection(
      t('ads.section.fullScreenAd'),
      () => {
        loadFullScreenAd({
          options: { adGroupId: 'mock-fullscreen-group' },
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err instanceof Error ? err.message : String(err)),
        });
      },
      () => {
        showFullScreenAd({
          options: { adGroupId: 'mock-fullscreen-group' },
          onEvent: (e) => recordEvent(e.type),
          onError: (err) => recordError(err instanceof Error ? err.message : String(err)),
        });
      },
      disabled,
    ),
  );

  return container;
}
