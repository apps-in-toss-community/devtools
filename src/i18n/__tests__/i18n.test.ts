import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetLocaleCacheForTests,
  detectLocale,
  getLocale,
  LOCALE_CHANGE_EVENT,
  LOCALE_STORAGE_KEY,
  setLocale,
  t,
} from '../index.js';

function setNavigatorLanguage(value: string): void {
  Object.defineProperty(navigator, 'language', { value, configurable: true });
}

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetLocaleCacheForTests();
  });

  afterEach(() => {
    localStorage.clear();
    _resetLocaleCacheForTests();
  });

  describe('detectLocale', () => {
    it('returns "ko" for ko-KR', () => {
      setNavigatorLanguage('ko-KR');
      expect(detectLocale()).toBe('ko');
    });

    it('returns "ko" for bare "ko"', () => {
      setNavigatorLanguage('ko');
      expect(detectLocale()).toBe('ko');
    });

    it('returns "en" for en-US', () => {
      setNavigatorLanguage('en-US');
      expect(detectLocale()).toBe('en');
    });

    it('falls back to "en" for unsupported locales (ja-JP)', () => {
      setNavigatorLanguage('ja-JP');
      expect(detectLocale()).toBe('en');
    });

    it('does not match "korean" or "kong" as ko (word boundary)', () => {
      setNavigatorLanguage('kong');
      expect(detectLocale()).toBe('en');
    });
  });

  describe('getLocale', () => {
    it('reads previously stored locale from localStorage', () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
      setNavigatorLanguage('ko-KR');
      expect(getLocale()).toBe('en');
    });

    it('falls back to detectLocale when storage empty', () => {
      setNavigatorLanguage('ko-KR');
      expect(getLocale()).toBe('ko');
    });

    it('ignores invalid storage values', () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
      setNavigatorLanguage('en-US');
      expect(getLocale()).toBe('en');
    });
  });

  describe('setLocale', () => {
    it('persists to localStorage', () => {
      setLocale('en');
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
      expect(getLocale()).toBe('en');
    });

    it('dispatches __ait:localechange event', () => {
      let fired = false;
      const handler = () => {
        fired = true;
      };
      window.addEventListener(LOCALE_CHANGE_EVENT, handler);
      try {
        setLocale('ko');
      } finally {
        window.removeEventListener(LOCALE_CHANGE_EVENT, handler);
      }
      expect(fired).toBe(true);
    });
  });

  describe('t', () => {
    it('returns the ko translation when locale=ko', () => {
      setLocale('ko');
      expect(t('panel.title')).toBe('AIT DevTools');
    });

    it('returns the en translation when locale=en', () => {
      setLocale('en');
      expect(t('panel.title')).toBe('AIT DevTools');
    });

    it('falls back to the key when missing', () => {
      setLocale('en');
      // @ts-expect-error — deliberately unknown key
      expect(t('totally.unknown.key')).toBe('totally.unknown.key');
    });

    it('interpolates {name} placeholders', () => {
      setLocale('en');
      expect(t('iap.section.pending', { count: 3 })).toBe('Pending Orders (3)');
    });

    it('leaves unreplaced placeholders intact when vars missing', () => {
      setLocale('en');
      // count not provided
      expect(t('iap.section.pending')).toBe('Pending Orders ({count})');
    });
  });
});
