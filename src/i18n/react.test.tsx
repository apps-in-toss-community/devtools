import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetLocaleCacheForTests, setLocale } from './index.js';
import { useLocale, useT } from './react.js';

function LocaleProbe() {
  const locale = useLocale();
  return <span data-testid="locale">{locale}</span>;
}

function TitleProbe() {
  const t = useT();
  return <span data-testid="title">{t('panel.close')}</span>;
}

function InterpProbe() {
  const t = useT();
  return <span data-testid="interp">{t('panel.tabError', { tab: 'storage' })}</span>;
}

describe('useLocale / useT', () => {
  beforeEach(() => {
    _resetLocaleCacheForTests();
    setLocale('en');
  });

  afterEach(() => {
    _resetLocaleCacheForTests();
  });

  it('renders the current locale and re-renders on setLocale', () => {
    render(<LocaleProbe />);
    expect(screen.getByTestId('locale').textContent).toBe('en');

    act(() => {
      setLocale('ko');
    });
    expect(screen.getByTestId('locale').textContent).toBe('ko');
  });

  it('useT resolves strings and re-renders the subtree on locale change WITHOUT unmount', () => {
    const { container } = render(<TitleProbe />);
    const node = container.querySelector('[data-testid="title"]');
    expect(node?.textContent).toBe('Close');

    act(() => {
      setLocale('ko');
    });
    // ko also ships 'panel.close' = 'Close' (shared dev chrome); assert the same
    // node instance survived (no remount) by identity.
    expect(container.querySelector('[data-testid="title"]')).toBe(node);
  });

  it('useT interpolates {name} placeholders', () => {
    render(<InterpProbe />);
    expect(screen.getByTestId('interp').textContent).toBe('Error rendering "storage" tab.');
  });
});
