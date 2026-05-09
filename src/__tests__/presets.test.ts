import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPreset,
  builtInPresets,
  captureCurrentState,
  type MockPresetState,
  matchesPreset,
} from '../mock/presets.js';
import { aitState } from '../mock/state.js';

describe('Mock state presets', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('builtInPresets: 모든 preset이 id/label/state를 갖는다', () => {
    expect(builtInPresets.length).toBeGreaterThan(0);
    for (const p of builtInPresets) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.state).toBeTypeOf('object');
    }
    const ids = builtInPresets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('applyPreset', () => {
    it('networkStatus를 적용한다', () => {
      applyPreset({ networkStatus: 'OFFLINE' });
      expect(aitState.state.networkStatus).toBe('OFFLINE');
    });

    it('permissions의 정의된 키만 적용하고 나머지는 유지한다', () => {
      applyPreset({ permissions: { camera: 'denied', photos: 'denied' } });
      expect(aitState.state.permissions.camera).toBe('denied');
      expect(aitState.state.permissions.photos).toBe('denied');
      // 미정의 키는 default 값 유지
      expect(aitState.state.permissions.geolocation).toBe('allowed');
    });

    it('auth slice를 부분 적용한다', () => {
      applyPreset({ auth: { isLoggedIn: false } });
      expect(aitState.state.auth.isLoggedIn).toBe(false);
      expect(aitState.state.auth.userKeyHash).toBe('mock-user-hash-abc123');
    });

    it('iap.nextResult를 적용해도 products는 유지된다', () => {
      const productsBefore = aitState.state.iap.products;
      applyPreset({ iap: { nextResult: 'NETWORK_ERROR' } });
      expect(aitState.state.iap.nextResult).toBe('NETWORK_ERROR');
      expect(aitState.state.iap.products).toBe(productsBefore);
    });

    it('forward-compat: 알지 못하는 키는 drop하고 console.warn한다', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      applyPreset({
        permissions: {
          camera: 'denied',
          bogus: 'denied',
        } as unknown as MockPresetState['permissions'],
      });
      expect(aitState.state.permissions.camera).toBe('denied');
      expect(warn).toHaveBeenCalled();
      expect((aitState.state.permissions as Record<string, unknown>).bogus).toBeUndefined();
      warn.mockRestore();
    });

    it('빈 preset state를 적용해도 state가 그대로다', () => {
      const before = aitState.state;
      applyPreset({});
      // shallow keys 동일
      expect(aitState.state.networkStatus).toBe(before.networkStatus);
      expect(aitState.state.permissions).toBe(before.permissions);
    });

    it('listener notify가 일어난다', () => {
      const listener = vi.fn();
      const unsub = aitState.subscribe(listener);
      applyPreset({ networkStatus: 'OFFLINE', permissions: { camera: 'denied' } });
      expect(listener.mock.calls.length).toBeGreaterThan(0);
      unsub();
    });

    it('built-in offline preset은 적용 후 OFFLINE이고 IAP nextResult가 NETWORK_ERROR다', () => {
      const offline = builtInPresets.find((p) => p.id === 'offline');
      expect(offline).toBeDefined();
      applyPreset(offline!.state);
      expect(aitState.state.networkStatus).toBe('OFFLINE');
      expect(aitState.state.iap.nextResult).toBe('NETWORK_ERROR');
    });
  });

  describe('matchesPreset', () => {
    it('적용 직후에는 true를 반환한다', () => {
      const offline = builtInPresets.find((p) => p.id === 'offline')!;
      applyPreset(offline.state);
      expect(matchesPreset(aitState.state, offline.state)).toBe(true);
    });

    it('적용 후 무관한 키를 바꿔도 true를 유지한다 (partial preset)', () => {
      const loggedOut = builtInPresets.find((p) => p.id === 'logged-out')!;
      applyPreset(loggedOut.state);
      // Preset이 정의하지 않는 키를 바꿈
      aitState.update({ locale: 'en-US' });
      expect(matchesPreset(aitState.state, loggedOut.state)).toBe(true);
    });

    it('적용 후 preset 정의 키를 바꾸면 false (dirty)', () => {
      const offline = builtInPresets.find((p) => p.id === 'offline')!;
      applyPreset(offline.state);
      aitState.update({ networkStatus: 'WIFI' });
      expect(matchesPreset(aitState.state, offline.state)).toBe(false);
    });

    it('빈 preset은 항상 true', () => {
      expect(matchesPreset(aitState.state, {})).toBe(true);
    });
  });

  describe('captureCurrentState', () => {
    it('현재 state의 주요 슬라이스를 추출한다', () => {
      aitState.update({ networkStatus: '4G' });
      aitState.patch('permissions', { camera: 'denied' });
      const captured = captureCurrentState(aitState.state);
      expect(captured.networkStatus).toBe('4G');
      expect(captured.permissions?.camera).toBe('denied');
    });

    it('captured state를 다시 적용하면 동일한 슬라이스가 복원된다', () => {
      aitState.update({ networkStatus: '3G' });
      aitState.patch('permissions', { microphone: 'denied' });
      aitState.patch('auth', { isLoggedIn: false });
      const captured = captureCurrentState(aitState.state);

      aitState.reset();
      applyPreset(captured);

      expect(aitState.state.networkStatus).toBe('3G');
      expect(aitState.state.permissions.microphone).toBe('denied');
      expect(aitState.state.auth.isLoggedIn).toBe(false);
    });
  });
});
