/**
 * Storage mock
 * localStorage에 `__ait_storage:` prefix로 저장하여 앱 자체 localStorage와 분리
 *
 * 실기기(2.x×iOS) capture는 `setItem`/`removeItem`/`clearItems` 세 메서드가
 * `undefined`가 아니라 `null`로 resolve됨을 보였다(devtools#770). 원본 SDK 타입
 * 선언은 여전히 `Promise<void>`이므로 시그니처는 그대로 두고, 런타임 반환값만
 * `null`로 캐스트해 실측과 동치시킨다 — Analytics·setClipboardText와 같은 처리(#775).
 * `getItem`은 이미 `string | null`이라 실측과 일치하므로 손대지 않는다.
 */

import { createMockProxy } from '../proxy.js';

export const Storage = createMockProxy('Storage', {
  getItem: async (key: string): Promise<string | null> => {
    return localStorage.getItem(`__ait_storage:${key}`);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    localStorage.setItem(`__ait_storage:${key}`, value);
    // biome-ignore lint/suspicious/noConfusingVoidType: 원본 SDK 시그니처(Promise<void>) 유지 + 실측(null) 캐스트
    return null as unknown as void;
  },
  removeItem: async (key: string): Promise<void> => {
    localStorage.removeItem(`__ait_storage:${key}`);
    // biome-ignore lint/suspicious/noConfusingVoidType: 원본 SDK 시그니처(Promise<void>) 유지 + 실측(null) 캐스트
    return null as unknown as void;
  },
  clearItems: async (): Promise<void> => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('__ait_storage:'));
    for (const k of keys) {
      localStorage.removeItem(k);
    }
    // biome-ignore lint/suspicious/noConfusingVoidType: 원본 SDK 시그니처(Promise<void>) 유지 + 실측(null) 캐스트
    return null as unknown as void;
  },
});
