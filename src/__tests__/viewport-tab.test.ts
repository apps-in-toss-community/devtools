import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aitState } from '../mock/state.js';
import { renderViewportTab } from '../panel/tabs/viewport.js';
import { _resetViewportInit, disposeViewport } from '../panel/viewport.js';

describe('renderViewportTab', () => {
  beforeEach(() => {
    aitState.reset();
    _resetViewportInit();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('preset=none이면 status에 "fills the window" 메시지를 노출한다', () => {
    aitState.patch('viewport', { preset: 'none' });
    const root = renderViewportTab();
    expect(root.textContent).toContain('No viewport constraint');
  });

  it('preset 선택 시 CSS / physical / safe area / nav bar 행을 출력한다', () => {
    aitState.patch('viewport', { preset: 'iphone-17-pro' });
    const root = renderViewportTab();
    const text = root.textContent ?? '';
    expect(text).toContain('CSS / physical');
    expect(text).toContain('402×874@3x');
    expect(text).toContain('1206×2622');
    expect(text).toContain('Safe area');
    // partner WebView portrait: top = nav bar 54 (실측 모델), 노치 59 아님.
    expect(text).toContain('T54');
    expect(text).toContain('AIT nav bar');
  });

  it('aitNavBar=false이면 status에 nav bar 행이 없다', () => {
    aitState.patch('viewport', { preset: 'iphone-17-pro', aitNavBar: false });
    const root = renderViewportTab();
    expect(root.textContent).not.toContain('AIT nav bar');
  });

  it('Nav bar type select가 노출되고 현재 값(partner)이 선택되어 있다', () => {
    aitState.patch('viewport', { preset: 'iphone-17-pro', aitNavBar: true });
    const root = renderViewportTab();
    expect(root.textContent).toContain('Nav bar type');
    const typeSelect = Array.from(root.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'partner'),
    ) as HTMLSelectElement | undefined;
    expect(typeSelect).not.toBeUndefined();
    expect(typeSelect?.value).toBe('partner');
  });

  it('Nav bar type select 변경 시 patch가 호출되고 status 라벨도 game으로 갱신된다', () => {
    aitState.patch('viewport', { preset: 'iphone-17-pro', aitNavBar: true });
    const root = renderViewportTab();
    const typeSelect = Array.from(root.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'partner'),
    ) as HTMLSelectElement;
    typeSelect.value = 'game';
    typeSelect.dispatchEvent(new Event('change'));
    expect(aitState.state.viewport.aitNavBarType).toBe('game');

    const refreshed = renderViewportTab();
    expect(refreshed.textContent).toContain('· game');
  });

  it('aitNavBar=false이면 Nav bar type select는 disabled', () => {
    aitState.patch('viewport', { preset: 'iphone-17-pro', aitNavBar: false });
    const root = renderViewportTab();
    const typeSelect = Array.from(root.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'partner'),
    ) as HTMLSelectElement;
    expect(typeSelect.disabled).toBe(true);
  });

  it('preset=custom에서 width/height 입력 필드가 노출된다', () => {
    aitState.patch('viewport', { preset: 'custom' });
    const root = renderViewportTab();
    const inputs = root.querySelectorAll('input[type="number"]');
    expect(inputs.length).toBe(2);
  });

  it('landscape iPhone safe area가 양쪽 대칭(left=right=notchInset)으로 표시된다', () => {
    // landscapeSide UI가 제거되었고, iOS landscape는 양쪽 대칭 실측 모델로 전환됨.
    // iphone-17-pro: notchInset=59 → landscape T0 R59 B34 L59
    aitState.patch('viewport', { preset: 'iphone-17-pro', orientation: 'landscape' });
    const root = renderViewportTab();
    const text = root.textContent ?? '';
    expect(text).toContain('T0');
    expect(text).toContain('R59');
    expect(text).toContain('L59');
  });

  it('portrait 모드에선 "Notch side" 행이 보이지 않는다', () => {
    aitState.patch('viewport', { preset: 'iphone-17-pro', orientation: 'portrait' });
    const root = renderViewportTab();
    expect(root.textContent).not.toContain('Notch side');
  });

  it('landscape 모드에서도 "Notch side" 행이 더 이상 보이지 않는다 (양쪽 대칭으로 전환)', () => {
    // landscapeSide select가 제거됨 — CSS env()와 SDK 모두 좌우 대칭 반환(relay 실측 #198/#232).
    aitState.patch('viewport', { preset: 'iphone-17-pro', orientation: 'landscape' });
    const root = renderViewportTab();
    expect(root.textContent).not.toContain('Notch side');
  });

  it('panelEditable=false이면 모든 select/input/checkbox가 disabled', () => {
    aitState.patch('viewport', { preset: 'iphone-17' });
    aitState.update({ panelEditable: false });
    const root = renderViewportTab();
    expect(root.textContent).toContain('Read-only'); // monitoringNotice
    const selects = root.querySelectorAll('select');
    for (const sel of Array.from(selects)) {
      expect((sel as HTMLSelectElement).disabled).toBe(true);
    }
    const checkboxes = root.querySelectorAll('input[type="checkbox"]');
    for (const cb of Array.from(checkboxes)) {
      expect((cb as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('orientation=auto + appOrientation=landscape이면 "landscape (auto)" 표시', () => {
    aitState.patch('viewport', {
      preset: 'iphone-17',
      orientation: 'auto',
      appOrientation: 'landscape',
    });
    const root = renderViewportTab();
    expect(root.textContent).toContain('landscape (auto)');
  });

  it('preset 변경 시 patch가 호출된다', () => {
    aitState.patch('viewport', { preset: 'none' });
    const root = renderViewportTab();
    const presetSel = root.querySelector('select') as HTMLSelectElement;
    presetSel.value = 'iphone-17';
    presetSel.dispatchEvent(new Event('change'));
    expect(aitState.state.viewport.preset).toBe('iphone-17');
  });

  it('custom width input이 4096 초과 값을 클램프한다', () => {
    aitState.patch('viewport', { preset: 'custom', customWidth: 400, customHeight: 800 });
    const root = renderViewportTab();
    const widthInput = root.querySelector('input[type="number"]') as HTMLInputElement;
    widthInput.value = '999999';
    widthInput.dispatchEvent(new Event('change'));
    expect(aitState.state.viewport.customWidth).toBe(4096);
  });

  it('custom width input에 0을 넣으면 무시된다', () => {
    aitState.patch('viewport', { preset: 'custom', customWidth: 400, customHeight: 800 });
    const root = renderViewportTab();
    const widthInput = root.querySelector('input[type="number"]') as HTMLInputElement;
    widthInput.value = '0';
    widthInput.dispatchEvent(new Event('change'));
    expect(aitState.state.viewport.customWidth).toBe(400);
  });
});

describe('provenance badge', () => {
  beforeEach(() => {
    aitState.reset();
    _resetViewportInit();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('measured 프리셋(iphone-15-pro)에는 provenance 뱃지가 없다', () => {
    aitState.patch('viewport', { preset: 'iphone-15-pro' });
    const root = renderViewportTab();
    const badge = root.querySelector('.ait-provenance-badge');
    expect(badge).toBeNull();
  });

  it('extrapolated 프리셋(iphone-17)에는 "(추정치)" 뱃지가 표시된다', () => {
    aitState.patch('viewport', { preset: 'iphone-17' });
    const root = renderViewportTab();
    const badge = root.querySelector('.ait-provenance-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('(추정치)');
  });

  it('placeholder 프리셋(galaxy-s26)에는 "(미측정)" 뱃지가 표시된다', () => {
    aitState.patch('viewport', { preset: 'galaxy-s26' });
    const root = renderViewportTab();
    const badge = root.querySelector('.ait-provenance-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('(미측정)');
  });

  it('panelEditable=false여도 provenance 뱃지가 표시된다', () => {
    aitState.patch('viewport', { preset: 'galaxy-s26' });
    aitState.update({ panelEditable: false });
    const root = renderViewportTab();
    const badge = root.querySelector('.ait-provenance-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('(미측정)');
  });

  it('SafeAreaProvenance 필드가 없는 preset(none/custom)에는 뱃지가 없다', () => {
    aitState.patch('viewport', { preset: 'none' });
    const root = renderViewportTab();
    expect(root.querySelector('.ait-provenance-badge')).toBeNull();
  });
});
