import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetSlotRegistry } from '../mock/ads/index.js';
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
    _resetSlotRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('4개 섹션(GoogleAdMob/TossAds/TossAds 배너/FullScreenAd)을 렌더한다', () => {
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

  it('TossAds Load(initialize) → loaded 이벤트 + isLoaded=true', () => {
    const root = renderAdsTab();
    loadBtn(root, 'TossAds').click();
    expect(aitState.state.ads.isLoaded).toBe(true);
    expect(aitState.state.ads.lastEvent?.type).toBe('loaded');
  });

  it('TossAds Show → dismissed 시퀀스', async () => {
    aitState.patch('ads', { isLoaded: true });
    const root = renderAdsTab();
    showBtn(root, 'TossAds').click();
    expect(aitState.state.ads.lastEvent?.type).toBe('show');
    await vi.advanceTimersByTimeAsync(1500);
    expect(aitState.state.ads.lastEvent?.type).toBe('dismissed');
    expect(aitState.state.ads.isLoaded).toBe(false);
  });

  it('TossAds Load + Show → dismissed 시퀀스 (end-to-end)', async () => {
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

  describe('TossAds 배너 인터랙티브 섹션', () => {
    function bannerSection(root: HTMLElement): HTMLElement {
      // ko locale에서는 'TossAds 배너', en에서는 'TossAds Banner'
      const el = Array.from(root.querySelectorAll('.ait-section-title')).find(
        (e) => e.textContent?.includes('Banner') || e.textContent?.includes('배너'),
      )?.parentElement;
      if (!el) throw new Error('TossAds banner section not found');
      return el as HTMLElement;
    }

    function getBtn(section: HTMLElement, text: string): HTMLButtonElement {
      return Array.from(section.querySelectorAll('button')).find(
        (b) => b.textContent === text,
      ) as HTMLButtonElement;
    }

    it('Render 버튼이 존재한다', () => {
      const root = renderAdsTab();
      const section = bannerSection(root);
      expect(getBtn(section, 'Render')).toBeTruthy();
    });

    it('Render → placeholder가 mount 대상에 삽입된다', async () => {
      const root = renderAdsTab();
      const section = bannerSection(root);
      const mountTarget = section.querySelector('div[style]') as HTMLElement;
      getBtn(section, 'Render').click();
      expect(mountTarget.children.length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(200);
    });

    it('Render → onAdRendered/onAdImpression lastEvent 기록', async () => {
      const root = renderAdsTab();
      const section = bannerSection(root);
      getBtn(section, 'Render').click();
      await vi.advanceTimersByTimeAsync(200);
      // lastEvent는 onAdRendered 또는 onAdImpression 중 마지막
      expect(aitState.state.ads.lastEvent?.type).toMatch(/onAdRendered|onAdImpression/);
    });

    it('No-fill → onNoFill/onAdFailedToRender lastEvent 기록', async () => {
      const root = renderAdsTab();
      const section = bannerSection(root);
      getBtn(section, 'No-fill').click();
      await vi.advanceTimersByTimeAsync(200);
      // recordEvent가 onNoFill → onAdFailedToRender 순으로 호출되므로
      // lastEvent는 onAdFailedToRender (마지막 호출)
      expect(aitState.state.ads.lastEvent?.type).toMatch(/onNoFill|onAdFailedToRender/);
    });

    it('Destroy → placeholder 제거 + "banner:destroyed" lastEvent', async () => {
      const root = renderAdsTab();
      const section = bannerSection(root);
      const mountTarget = section.querySelector('div[style]') as HTMLElement;
      getBtn(section, 'Render').click();
      await vi.advanceTimersByTimeAsync(200);
      expect(mountTarget.children.length).toBeGreaterThan(0);

      getBtn(section, 'Destroy').click();
      expect(mountTarget.children).toHaveLength(0);
      expect(aitState.state.ads.lastEvent?.type).toBe('banner:destroyed');
    });

    it('Destroy(배너 없음) → "No banner to destroy" error', () => {
      const root = renderAdsTab();
      const section = bannerSection(root);
      getBtn(section, 'Destroy').click();
      expect(aitState.state.ads.lastEvent?.type).toBe('error: No banner to destroy');
    });

    it('panelEditable=false → Render/No-fill/Click/Destroy 모두 disabled', () => {
      aitState.update({ panelEditable: false });
      const root = renderAdsTab();
      const section = bannerSection(root);
      for (const btn of Array.from(section.querySelectorAll('button')) as HTMLButtonElement[]) {
        expect(btn.disabled).toBe(true);
      }
    });
  });

  describe('Reward 파라미터', () => {
    it('rewardUnitType/rewardAmount 입력 필드가 초기값으로 렌더된다', () => {
      const root = renderAdsTab();
      const inputs = Array.from(
        root.querySelectorAll('input[type="text"], input:not([type])'),
      ) as HTMLInputElement[];
      const unitTypeInput = inputs.find((i) => i.value === 'coins');
      const amountInput = inputs.find((i) => i.value === '10');
      expect(unitTypeInput).toBeTruthy();
      expect(amountInput).toBeTruthy();
    });

    it('rewardUnitType 입력 변경 → state 반영', () => {
      const root = renderAdsTab();
      const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
      const unitTypeInput = inputs.find((i) => i.value === 'coins')!;
      unitTypeInput.value = 'gems';
      unitTypeInput.dispatchEvent(new Event('change'));
      expect(aitState.state.ads.rewardUnitType).toBe('gems');
    });

    it('rewardAmount 입력 변경 → state 반영', () => {
      const root = renderAdsTab();
      const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
      const amountInput = inputs.find((i) => i.value === '10')!;
      amountInput.value = '99';
      amountInput.dispatchEvent(new Event('change'));
      expect(aitState.state.ads.rewardAmount).toBe(99);
    });
  });
});
