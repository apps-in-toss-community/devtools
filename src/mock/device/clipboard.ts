/**
 * Clipboard mock
 * mock/web 모드 지원
 */

import { checkPermission, withPermission } from '../permissions.js';
import { aitState } from '../state.js';

const _getClipboardText = async (): Promise<string> => {
  checkPermission('clipboard', 'getClipboardText');
  const mode = aitState.state.deviceModes.clipboard;
  if (mode === 'mock') return aitState.state.mockData.clipboardText;
  // web mode (default)
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
};
export const getClipboardText = withPermission(_getClipboardText, 'clipboard');

const _setClipboardText = async (text: string): Promise<void> => {
  checkPermission('clipboard', 'setClipboardText');
  const mode = aitState.state.deviceModes.clipboard;
  if (mode === 'mock') {
    aitState.patch('mockData', { clipboardText: text });
    return;
  }
  // web mode (default)
  await navigator.clipboard.writeText(text);
};
export const setClipboardText = withPermission(_setClipboardText, 'clipboard');
