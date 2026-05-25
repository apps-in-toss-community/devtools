import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.js';
import { setIosSwipeGestureEnabled } from '../mock/navigation/index.js';
import { aitState } from '../mock/state.js';
import { renderEnvironmentTab } from '../panel/tabs/environment.js';

describe('renderEnvironmentTab — Navigation 섹션', () => {
  beforeEach(() => {
    aitState.reset();
    // locale은 모듈 전역이라 다른 테스트가 바꿀 수 있다 — 결정성을 위해 ko로 고정.
    setLocale('ko');
  });

  it('Navigation 섹션과 iOS swipe-back 행을 렌더한다', () => {
    const root = renderEnvironmentTab();
    const text = root.textContent ?? '';
    expect(text).toContain('Navigation');
    expect(text).toContain('iOS swipe-back');
  });

  it('미호출(null) 상태에서는 "미호출"을 표시한다', () => {
    expect(aitState.state.navigation.iosSwipeGestureEnabled).toBeNull();
    const root = renderEnvironmentTab();
    expect(root.textContent).toContain('미호출');
  });

  it('setIosSwipeGestureEnabled(false) 호출 후 재렌더하면 "disabled"를 표시한다', async () => {
    await setIosSwipeGestureEnabled({ isEnabled: false });
    const root = renderEnvironmentTab();
    const text = root.textContent ?? '';
    expect(text).toContain('disabled');
    expect(text).not.toContain('미호출');
  });

  it('setIosSwipeGestureEnabled(true) 호출 후 재렌더하면 "enabled"를 표시한다', async () => {
    await setIosSwipeGestureEnabled({ isEnabled: true });
    const root = renderEnvironmentTab();
    expect(root.textContent).toContain('enabled');
  });

  it('Environment(toss/sandbox) select가 노출되고 기본값 sandbox가 선택돼 있다', () => {
    const root = renderEnvironmentTab();
    const select = Array.from(root.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'sandbox'),
    );
    expect(select).toBeTruthy();
    expect(select?.value).toBe('sandbox');
  });
});
