import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import { renderAdsTab } from '../panel/tabs/ads.js';

function getButtons(root: HTMLElement) {
  return Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
}

function findSection(root: HTMLElement, title: string): HTMLElement {
  const titleEl = Array.from(root.querySelectorAll('.ait-section-title')).find(
    (el) => el.textContent === title,
  );
  if (!titleEl) throw new Error(`section not found: ${title}`);
  return titleEl.parentElement as HTMLElement;
}

function loadBtn(root: HTMLElement, section: string): HTMLButtonElement {
  return getButtons(findSection(root, section)).find((b) => b.textContent === 'Load')!;
}

function showBtn(root: HTMLElement, section: string): HTMLButtonElement {
  return getButtons(findSection(root, section)).find((b) => b.textContent === 'Show')!;
}

describe('renderAdsTab', () => {
  beforeEach(() => {
    aitState.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('3개 섹션(GoogleAdMob/TossAds/FullScreenAd)을 렌더한다', () => {
    const root = renderAdsTab();
    const text = root.textContent ?? '';
    expect(text).toContain('GoogleAdMob');
    expect(text).toContain('TossAds');
    expect(text).toContain('FullScreenAd');
  });

  it('초기 상태: isLoaded=false, "No events yet"', () => {
    const root = renderAdsTab();
    const text = root.textContent ?? '';
    expect(text).toContain('isLoaded');
    expect(text).toContain('false');
    expect(text).toContain('No events yet');
  });

  it('GoogleAdMob Load 클릭 → isLoaded=true + lastEvent="loaded"', async () => {
    const root = renderAdsTab();
    loadBtn(root, 'GoogleAdMob').click();
    await vi.advanceTimersByTimeAsync(200);
    expect(aitState.state.ads.isLoaded).toBe(true);
    expect(aitState.state.ads.lastEvent?.type).toBe('loaded');
  });

  it('GoogleAdMob: 로드 안 된 상태에서 Show 클릭 → "Ad not loaded" error', () => {
    const root = renderAdsTab();
    showBtn(root, 'GoogleAdMob').click();
    expect(aitState.state.ads.lastEvent?.type).toBe('error: Ad not loaded');
  });

  it('GoogleAdMob: 로드 후 Show 클릭 → 이벤트 시퀀스 마지막이 dismissed', async () => {
    aitState.patch('ads', { isLoaded: true });
    const root = renderAdsTab();
    showBtn(root, 'GoogleAdMob').click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(aitState.state.ads.lastEvent?.type).toBe('dismissed');
    expect(aitState.state.ads.isLoaded).toBe(false);
  });

  it('Force "no fill" 토글 후 Load → error 이벤트, isLoaded는 false 유지', async () => {
    aitState.patch('ads', { forceNoFill: true });
    const root = renderAdsTab();
    loadBtn(root, 'GoogleAdMob').click();
    await vi.advanceTimersByTimeAsync(200);
    expect(aitState.state.ads.isLoaded).toBe(false);
    expect(aitState.state.ads.lastEvent?.type).toBe('error: No fill');
  });

  it('FullScreenAd Load → isLoaded=true', async () => {
    const root = renderAdsTab();
    loadBtn(root, 'FullScreenAd').click();
    await vi.advanceTimersByTimeAsync(200);
    expect(aitState.state.ads.isLoaded).toBe(true);
  });

  it('TossAds Load → loaded 이벤트, Show → dismissed 시퀀스', async () => {
    const root = renderAdsTab();
    loadBtn(root, 'TossAds').click();
    expect(aitState.state.ads.isLoaded).toBe(true);
    expect(aitState.state.ads.lastEvent?.type).toBe('loaded');
    showBtn(root, 'TossAds').click();
    expect(aitState.state.ads.lastEvent?.type).toBe('show');
    await vi.advanceTimersByTimeAsync(1500);
    expect(aitState.state.ads.lastEvent?.type).toBe('dismissed');
    expect(aitState.state.ads.isLoaded).toBe(false);
  });

  it('panelEditable=false → 모든 버튼/체크박스 disabled', () => {
    aitState.update({ panelEditable: false });
    const root = renderAdsTab();
    expect(root.textContent).toContain('Read-only');
    for (const btn of getButtons(root)) {
      expect(btn.disabled).toBe(true);
    }
    const cb = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });

  it('Force no fill 체크박스 토글 → state.ads.forceNoFill 갱신', () => {
    const root = renderAdsTab();
    const cb = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(aitState.state.ads.forceNoFill).toBe(true);
  });

  // Regression: TossAds Load handler must read forceNoFill from live state, not the
  // render-time snapshot. The button keeps a closure over the rendered tab, so a
  // post-render checkbox toggle must still take effect when the user clicks Load.
  it('TossAds Load: 렌더 후 forceNoFill 토글해도 live state를 반영한다', () => {
    const root = renderAdsTab();
    const cb = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    loadBtn(root, 'TossAds').click();
    expect(aitState.state.ads.isLoaded).toBe(false);
    expect(aitState.state.ads.lastEvent?.type).toBe('error: No fill');
  });
});
