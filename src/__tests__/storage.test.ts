import { describe, it, expect, beforeEach } from 'vitest';
import { Storage } from '../mock/device/index.js';

describe('Storage mock', () => {
  // Storage는 aitState가 아닌 localStorage를 직접 사용하므로 clearItems()로 초기화
  beforeEach(async () => {
    await Storage.clearItems();
  });

  it('setItem/getItem: 값을 저장하고 읽는다', async () => {
    await Storage.setItem('key1', 'value1');
    const result = await Storage.getItem('key1');
    expect(result).toBe('value1');
  });

  it('getItem: 없는 키는 null을 반환한다', async () => {
    const result = await Storage.getItem('nonexistent');
    expect(result).toBeNull();
  });

  it('removeItem: 특정 키를 삭제한다', async () => {
    await Storage.setItem('key1', 'value1');
    await Storage.removeItem('key1');
    const result = await Storage.getItem('key1');
    expect(result).toBeNull();
  });

  it('clearItems: 모든 ait storage 키를 삭제한다', async () => {
    await Storage.setItem('a', '1');
    await Storage.setItem('b', '2');
    // ait storage 이외의 키는 유지되어야 함
    localStorage.setItem('other', 'kept');

    try {
      await Storage.clearItems();

      expect(await Storage.getItem('a')).toBeNull();
      expect(await Storage.getItem('b')).toBeNull();
      expect(localStorage.getItem('other')).toBe('kept');
    } finally {
      localStorage.removeItem('other');
    }
  });
});
