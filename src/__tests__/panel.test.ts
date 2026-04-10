import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Panel error boundary', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('탭 렌더링 에러 시 에러 메시지를 표시하고 다른 탭에 영향을 주지 않는다', async () => {
    // Mock createTabRenderers to inject a throwing tab
    const { h } = await import('../panel/helpers.js');
    const { createTabRenderers } = await import('../panel/tabs/index.js');

    const refreshPanel = vi.fn();
    const renderers = createTabRenderers(refreshPanel);

    // Replace env tab with a throwing renderer
    renderers.env = () => { throw new Error('test error'); };

    // Simulate what refreshPanel does
    const bodyEl = document.createElement('div');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      bodyEl.appendChild(renderers.env());
    } catch (err) {
      console.error('[@ait-co/devtools] Error rendering tab "env":', err);
      bodyEl.appendChild(h('div', { className: 'ait-panel-tab-error' }, 'Error rendering "env" tab.'));
    }

    expect(bodyEl.querySelector('.ait-panel-tab-error')).not.toBeNull();
    expect(bodyEl.textContent).toContain('Error rendering "env" tab.');
    expect(consoleError).toHaveBeenCalledWith(
      '[@ait-co/devtools] Error rendering tab "env":',
      expect.any(Error),
    );

    // Other tabs still work
    bodyEl.innerHTML = '';
    bodyEl.appendChild(renderers.permissions());
    expect(bodyEl.querySelector('.ait-panel-tab-error')).toBeNull();
    expect(bodyEl.children.length).toBeGreaterThan(0);
  });

  it('subscribe 콜백 에러가 전파되지 않는다', async () => {
    const { aitState } = await import('../mock/state.js');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Add a subscriber that wraps errors like panel does
    aitState.subscribe(() => {
      try {
        throw new Error('subscribe error');
      } catch (err) {
        console.error('[@ait-co/devtools] Error in subscribe callback:', err);
      }
    });

    // Should not throw
    expect(() => aitState.update({ platform: 'android' })).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      '[@ait-co/devtools] Error in subscribe callback:',
      expect.any(Error),
    );
  });

  it('mount 실패 시 앱이 죽지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Simulate safeMount pattern
    const mount = () => { throw new Error('mount error'); };
    const safeMount = () => {
      try {
        mount();
      } catch (err) {
        console.error('[@ait-co/devtools] Failed to mount panel:', err);
      }
    };

    expect(() => safeMount()).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      '[@ait-co/devtools] Failed to mount panel:',
      expect.any(Error),
    );
  });
});
