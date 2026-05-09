import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUserPreset, listUserPresets, saveUserPreset } from '../mock/preset-store.js';

function clearPresetKeys() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('__ait_preset:')) localStorage.removeItem(key);
  }
}

describe('preset-store (user presets)', () => {
  beforeEach(() => {
    clearPresetKeys();
  });

  it('saveUserPreset: label로부터 slug id를 만들고 storage에 기록한다', () => {
    const preset = saveUserPreset('My Test Preset', { networkStatus: 'OFFLINE' });
    expect(preset.id).toBe('my-test-preset');
    expect(preset.label).toBe('My Test Preset');
    expect(preset.state.networkStatus).toBe('OFFLINE');

    const stored = localStorage.getItem(`__ait_preset:${preset.id}`);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? '{}');
    expect(parsed.id).toBe('my-test-preset');
  });

  it('saveUserPreset: 동일 label은 -2, -3 suffix로 unique id 생성', () => {
    const a = saveUserPreset('Foo', {});
    const b = saveUserPreset('Foo', {});
    const c = saveUserPreset('Foo', {});
    expect(a.id).toBe('foo');
    expect(b.id).toBe('foo-2');
    expect(c.id).toBe('foo-3');
  });

  it('saveUserPreset: 빈 label은 throw', () => {
    expect(() => saveUserPreset('', {})).toThrow(/empty/i);
    expect(() => saveUserPreset('   ', {})).toThrow(/empty/i);
  });

  it('saveUserPreset: 특수문자만 있는 label도 fallback id를 만든다', () => {
    const preset = saveUserPreset('!@#$%', { networkStatus: 'WIFI' });
    expect(preset.id).toBe('preset');
    expect(preset.label).toBe('!@#$%');
  });

  it('listUserPresets: label 기준 정렬', () => {
    saveUserPreset('Charlie', {});
    saveUserPreset('Alpha', {});
    saveUserPreset('Bravo', {});
    const all = listUserPresets();
    expect(all.map((p) => p.label)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('listUserPresets: 손상된 entry는 무시한다', () => {
    saveUserPreset('Good', { networkStatus: 'WIFI' });
    localStorage.setItem('__ait_preset:bad', 'not-json');
    localStorage.setItem('__ait_preset:bad2', JSON.stringify({ no: 'id' }));
    const all = listUserPresets();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('Good');
  });

  it('listUserPresets: __ait_preset: 외 키는 무시', () => {
    saveUserPreset('Mine', {});
    localStorage.setItem('__ait_storage:other', 'whatever');
    localStorage.setItem('__ait_btn_pos', '{}');
    const all = listUserPresets();
    expect(all).toHaveLength(1);
  });

  it('deleteUserPreset: id로 삭제', () => {
    const preset = saveUserPreset('To Delete', {});
    expect(listUserPresets()).toHaveLength(1);
    deleteUserPreset(preset.id);
    expect(listUserPresets()).toHaveLength(0);
  });

  it('deleteUserPreset: 존재하지 않는 id는 noop', () => {
    expect(() => deleteUserPreset('nonexistent')).not.toThrow();
  });

  it('round-trip: state 그대로 보존', () => {
    saveUserPreset('Round trip', {
      networkStatus: '3G',
      permissions: { camera: 'denied' },
      auth: { isLoggedIn: false },
    });
    const [restored] = listUserPresets();
    expect(restored.state.networkStatus).toBe('3G');
    expect(restored.state.permissions?.camera).toBe('denied');
    expect(restored.state.auth?.isLoggedIn).toBe(false);
  });

  it('description은 저장/복원된다', () => {
    saveUserPreset('With desc', { networkStatus: 'WIFI' }, 'A short description');
    const [p] = listUserPresets();
    expect(p.description).toBe('A short description');
  });

  it('빈 description은 저장하지 않는다', () => {
    saveUserPreset('No desc', {}, '');
    const [p] = listUserPresets();
    expect(p.description).toBeUndefined();
  });

  it('listUserPresets: localStorage가 throw해도 빈 배열을 반환한다', () => {
    // Simulate access throwing (e.g., disabled storage)
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('disabled');
      },
    });
    try {
      expect(listUserPresets()).toEqual([]);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('preset-store: id collision suffix wraps reasonably', () => {
  beforeEach(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('__ait_preset:')) localStorage.removeItem(key);
    }
  });

  it('많은 충돌도 지원', () => {
    const labels = Array.from({ length: 5 }, () => 'Same');
    const ids = labels.map((l) => saveUserPreset(l, {}).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('same');
    expect(ids[1]).toBe('same-2');
  });
});

// Silence the "Preset dropped unknown key" console.warn in this file's storage-only tests:
// none of these use applyPreset, so this is just a defensive guard for any future addition.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
