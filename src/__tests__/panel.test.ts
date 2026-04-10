import { describe, it, expect, vi, beforeAll, afterEach, type Mock } from 'vitest';
import { aitState } from '../mock/state.js';
import type { TabId } from '../panel/tabs/index.js';

// We mock createTabRenderers to control which tabs throw.
// This lets us test the real production error boundary code in panel/index.ts.

const tabSpies: Record<TabId, Mock<() => HTMLElement>> = {
  env: vi.fn(() => document.createElement('div')),
  permissions: vi.fn(() => document.createElement('div')),
  location: vi.fn(() => document.createElement('div')),
  device: vi.fn(() => document.createElement('div')),
  iap: vi.fn(() => document.createElement('div')),
  events: vi.fn(() => document.createElement('div')),
  analytics: vi.fn(() => document.createElement('div')),
  storage: vi.fn(() => document.createElement('div')),
};

vi.mock('../panel/tabs/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../panel/tabs/index.js')>();
  return {
    ...original,
    createTabRenderers: () => ({ ...tabSpies }),
  };
});

describe('Panel error boundary', () => {
  // Ensure panel is mounted before any test runs.
  // The module caches across tests, so mount() runs once and DOM is shared.
  beforeAll(async () => {
    const { mount } = await import('../panel/index.js');
    if (!document.querySelector('.ait-panel-toggle')) {
      mount();
    }
  });

  afterEach(() => {
    // Tab spies are module-scoped (not covered by restoreMocks), so reset manually.
    for (const spy of Object.values(tabSpies)) {
      spy.mockImplementation(() => document.createElement('div'));
    }
  });

  it('탭 렌더링 에러 시 에러 메시지를 표시하고 다른 탭에 영향을 주지 않는다', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Make env tab (default tab) throw and trigger re-render
    tabSpies.env.mockImplementation(() => { throw new Error('env tab exploded'); });
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'env' } }));

    const panelBody = document.querySelector('.ait-panel-body');
    expect(panelBody).not.toBeNull();

    // Error boundary should have caught it and rendered the error div
    const errorDiv = panelBody!.querySelector('.ait-panel-tab-error');
    expect(errorDiv).not.toBeNull();
    expect(errorDiv!.textContent).toContain('Error rendering "env" tab.');
    expect(consoleError).toHaveBeenCalledWith(
      '[@ait-co/devtools] Error rendering tab "env":',
      expect.any(Error),
    );

    // Switch to a non-broken tab — it should render fine
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'permissions' } }));
    expect(panelBody!.querySelector('.ait-panel-tab-error')).toBeNull();
    expect(panelBody!.children.length).toBeGreaterThan(0);
  });

  it('subscribe 콜백에서 탭 렌더링 에러가 전파되지 않는다', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Switch to storage tab and open panel (storage refreshes on state change).
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'storage' } }));

    // Now make the storage renderer throw
    tabSpies.storage.mockImplementation(() => { throw new Error('storage exploded'); });

    // aitState.update triggers subscribe → refreshPanel (storage tab) → throws → caught
    expect(() => aitState.update({ platform: 'android' })).not.toThrow();

    expect(consoleError).toHaveBeenCalledWith(
      '[@ait-co/devtools] Error rendering tab "storage":',
      expect.any(Error),
    );

    // Panel should show error message, not crash
    const panelBody = document.querySelector('.ait-panel-body');
    expect(panelBody!.querySelector('.ait-panel-tab-error')).not.toBeNull();
  });
});
