/**
 * Storage mock
 * localStorage에 `__ait_storage:` prefix로 저장하여 앱 자체 localStorage와 분리
 */

import { createMockProxy } from '../proxy.js';

export const Storage = createMockProxy('Storage', {
  getItem: async (key: string): Promise<string | null> => {
    return localStorage.getItem(`__ait_storage:${key}`);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    localStorage.setItem(`__ait_storage:${key}`, value);
  },
  removeItem: async (key: string): Promise<void> => {
    localStorage.removeItem(`__ait_storage:${key}`);
  },
  clearItems: async (): Promise<void> => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('__ait_storage:'));
    for (const k of keys) {
      localStorage.removeItem(k);
    }
  },
});
