/**
 * Per-tab error boundary (critique decision #2).
 *
 * This is a class component because `getDerivedStateFromError` /
 * `componentDidCatch` have no hook equivalent. It wraps ONLY the active tab's
 * subtree (not the whole panel), mirroring the old vanilla `refreshPanel`
 * per-tab `try/catch` scope: a throw inside one tab renders an inline error and
 * leaves the panel chrome (toggle, header, tab bar) intact so the user can
 * switch away to a healthy tab.
 *
 * The fallback markup (`.ait-panel-tab-error` + the `panel.tabError` string) and
 * the `console.error('[@ait-co/devtools] Error rendering tab "<id>":', err)` log
 * are preserved verbatim from the vanilla implementation so the existing unit
 * test (`src/__tests__/panel.test.ts`) and the locale catalog keep working.
 */

import { Component, type ReactNode } from 'react';
import { t } from '../i18n/index.js';

interface Props {
  /** Active tab id — also used as the boundary `key` by the caller so switching tabs resets the error. */
  tab: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: unknown): void {
    console.error(`[@ait-co/devtools] Error rendering tab "${this.props.tab}":`, err);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="ait-panel-tab-error">{t('panel.tabError', { tab: this.props.tab })}</div>
      );
    }
    return this.props.children;
  }
}
