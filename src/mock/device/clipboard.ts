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

// 실기기(2.x×iOS) capture는 setClipboardText가 `undefined`가 아니라
// `{ text: <설정한 문자열> }` 객체로 resolve됨을 보였다(devtools#770,
// returnType: "object", valueKeys: ["text"]). 원본 SDK 타입 선언은 여전히
// `Promise<void>`이므로 시그니처는 그대로 두고, 런타임 반환값만 실측과 동치시킨다.
const _setClipboardText = async (text: string): Promise<void> => {
  checkPermission('clipboard', 'setClipboardText');
  const mode = aitState.state.deviceModes.clipboard;
  if (mode === 'mock') {
    aitState.patch('mockData', { clipboardText: text });
    return { text } as unknown as void;
  }
  // web mode (default)
  await navigator.clipboard.writeText(text);
  return { text } as unknown as void;
};
export const setClipboardText = withPermission(_setClipboardText, 'clipboard');
