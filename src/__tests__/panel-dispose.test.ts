import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aitState } from '../mock/state.js';
import { disposePanel, mount } from '../panel/index.js';

// These tests assert disposePanel()'s contract: tear down all DOM + listeners
// + injected styles, and leave the module ready for a clean re-mount.
// They share a module instance with panel.test.ts, so each test starts by
// disposing whatever was left behind and ends the same way.

function panelStyleEl(): HTMLStyleElement | null {
  for (const el of Array.from(document.head.querySelectorAll('style'))) {
    if (el.textContent?.includes('.ait-panel-toggle')) return el;
  }
  return null;
}

describe('disposePanel', () => {
  beforeEach(() => {
    disposePanel();
  });

  afterEach(() => {
    disposePanel();
  });

  it('removes toggle, panel, and injected styles from the DOM', () => {
    mount();
    expect(document.querySelector('.ait-panel-toggle')).not.toBeNull();
    expect(document.querySelector('.ait-panel')).not.toBeNull();
    expect(panelStyleEl()).not.toBeNull();

    disposePanel();

    expect(document.querySelector('.ait-panel-toggle')).toBeNull();
    expect(document.querySelector('.ait-panel')).toBeNull();
    expect(panelStyleEl()).toBeNull();
  });

  it('is a no-op before mount (does not throw)', () => {
    expect(() => disposePanel()).not.toThrow();
    expect(document.querySelector('.ait-panel-toggle')).toBeNull();
  });

  it('is idempotent — calling twice does not throw', () => {
    mount();
    disposePanel();
    expect(() => disposePanel()).not.toThrow();
    expect(document.querySelector('.ait-panel-toggle')).toBeNull();
  });

  it('allows re-mount after dispose (clean state, single style element)', () => {
    mount();
    disposePanel();
    mount();

    expect(document.querySelectorAll('.ait-panel-toggle')).toHaveLength(1);
    expect(document.querySelectorAll('.ait-panel')).toHaveLength(1);
    // Re-mount must not pile up duplicate <style> tags
    const styles = Array.from(document.head.querySelectorAll('style')).filter((el) =>
      el.textContent?.includes('.ait-panel-toggle'),
    );
    expect(styles).toHaveLength(1);
  });

  it('detaches __ait:panel-switch-tab listener after dispose', () => {
    mount();
    disposePanel();

    // After dispose, dispatching the event must not re-create panel DOM.
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'storage' } }));
    expect(document.querySelector('.ait-panel')).toBeNull();
  });

  it('unsubscribes from aitState — no panel re-render after dispose', () => {
    mount();
    disposePanel();

    // aitState.update would have triggered a refresh on the previous mount; with
    // dispose it must be a no-op (no DOM mutation, no throw from stale refs).
    expect(() => aitState.update({ platform: 'android' })).not.toThrow();
    expect(document.querySelector('.ait-panel')).toBeNull();
  });
});
