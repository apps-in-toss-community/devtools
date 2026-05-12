/**
 * Consent toast UI — vanilla DOM, fixed bottom-right.
 *
 * Shows once per "undecided + reprompt window cleared" session.
 * Calls onAccept / onDeny callbacks; caller is responsible for persisting state.
 */

import { t } from '../i18n/index.js';

const TOAST_ID = '__ait-telemetry-toast';

const TOAST_STYLES = `
  #${TOAST_ID} {
    position: fixed;
    z-index: 100001;
    bottom: 80px;
    right: 16px;
    width: 280px;
    background: #1a1a2e;
    border: 1px solid #3a3a5a;
    border-radius: 10px;
    padding: 14px 16px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', sans-serif;
    font-size: 13px;
    color: #e0e0e0;
    box-sizing: border-box;
  }
  #${TOAST_ID} .ait-toast-header {
    font-size: 13px;
    font-weight: 600;
    color: #e0e0e0;
    margin-bottom: 6px;
  }
  #${TOAST_ID} .ait-toast-body {
    font-size: 12px;
    color: #aaa;
    margin-bottom: 12px;
    line-height: 1.5;
  }
  #${TOAST_ID} .ait-toast-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }
  #${TOAST_ID} .ait-toast-btn-primary {
    background: #3182F6;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  #${TOAST_ID} .ait-toast-btn-primary:hover { background: #1b6ef3; }
  #${TOAST_ID} .ait-toast-btn-secondary {
    background: #2a2a4a;
    color: #e0e0e0;
    border: 1px solid #3a3a5a;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  #${TOAST_ID} .ait-toast-btn-secondary:hover { background: #3a3a5a; }
  #${TOAST_ID} .ait-toast-link {
    font-size: 11px;
    color: #666;
    text-decoration: none;
    margin-right: auto;
  }
  #${TOAST_ID} .ait-toast-link:hover { color: #aaa; }
`;

function injectStyles(): void {
  if (document.getElementById(`${TOAST_ID}-style`)) return;
  const style = document.createElement('style');
  style.id = `${TOAST_ID}-style`;
  style.textContent = TOAST_STYLES;
  document.head.appendChild(style);
}

function removeToast(): void {
  document.getElementById(TOAST_ID)?.remove();
  document.getElementById(`${TOAST_ID}-style`)?.remove();
}

export interface ConsentToastOptions {
  onAccept: () => void;
  onDeny: () => void;
}

/**
 * Renders and shows the consent toast.
 * If the toast is already visible, does nothing.
 */
export function showConsentToast({ onAccept, onDeny }: ConsentToastOptions): void {
  if (document.getElementById(TOAST_ID)) return;

  injectStyles();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;

  const header = document.createElement('div');
  header.className = 'ait-toast-header';
  header.textContent = t('toast.consent.title');

  const body = document.createElement('div');
  body.className = 'ait-toast-body';
  body.textContent = t('toast.consent.body');

  const learnMore = document.createElement('a');
  learnMore.className = 'ait-toast-link';
  learnMore.href = 'https://docs.aitc.dev/privacy';
  learnMore.target = '_blank';
  learnMore.rel = 'noopener noreferrer';
  learnMore.textContent = t('toast.consent.learnMore');

  const yesBtn = document.createElement('button');
  yesBtn.className = 'ait-toast-btn-primary';
  yesBtn.textContent = t('toast.consent.accept');
  yesBtn.addEventListener('click', () => {
    removeToast();
    onAccept();
  });

  const noBtn = document.createElement('button');
  noBtn.className = 'ait-toast-btn-secondary';
  noBtn.textContent = t('toast.consent.deny');
  noBtn.addEventListener('click', () => {
    removeToast();
    onDeny();
  });

  const actions = document.createElement('div');
  actions.className = 'ait-toast-actions';
  actions.append(learnMore, noBtn, yesBtn);

  toast.append(header, body, actions);
  document.body.appendChild(toast);
}

export { removeToast };
