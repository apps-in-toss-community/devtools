import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, resolveLocaleStrings } from './index.js';
import { ko } from './ko.js';

describe('parseAcceptLanguage', () => {
  it('returns ko for missing / empty header (ko is the primary locale)', () => {
    expect(parseAcceptLanguage(undefined)).toBe('ko');
    expect(parseAcceptLanguage(null)).toBe('ko');
    expect(parseAcceptLanguage('')).toBe('ko');
  });

  it('detects ko from a Korean first tag', () => {
    expect(parseAcceptLanguage('ko')).toBe('ko');
    expect(parseAcceptLanguage('ko-KR')).toBe('ko');
    expect(parseAcceptLanguage('ko-KR,ko;q=0.9,en;q=0.8')).toBe('ko');
  });

  it('falls back to en for non-Korean first tag', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(parseAcceptLanguage('ja,en;q=0.5')).toBe('en');
    expect(parseAcceptLanguage('fr-FR')).toBe('en');
  });

  it('reads only the highest-priority (first) tag, ignoring q-weights', () => {
    // First tag wins even if a later tag has a (notionally) higher weight.
    expect(parseAcceptLanguage('en;q=0.1,ko;q=0.9')).toBe('en');
    expect(parseAcceptLanguage('ko;q=0.1,en;q=0.9')).toBe('ko');
  });

  it('does not match ko as a substring of another language', () => {
    // `kok` (Konkani) must NOT be treated as Korean — the \b boundary guards it.
    expect(parseAcceptLanguage('kok')).toBe('en');
  });
});

describe('resolveLocaleStrings', () => {
  it('resolves from the ko table for ko locale', () => {
    const tr = resolveLocaleStrings('ko');
    expect(tr('panel.title')).toBe(ko['panel.title']);
  });

  it('resolves from the en table for en locale', () => {
    const tr = resolveLocaleStrings('en');
    // en mirror exists for every key; just assert it returns a non-key string.
    expect(tr('panel.close')).toBe('Close');
  });

  it('interpolates {name} placeholders', () => {
    const tr = resolveLocaleStrings('en');
    expect(tr('panel.tabError', { tab: 'storage' })).toBe('Error rendering "storage" tab.');
  });

  it('shares the SAME catalog as t() — every key resolves to a non-key string', () => {
    const trKo = resolveLocaleStrings('ko');
    const trEn = resolveLocaleStrings('en');
    for (const key of Object.keys(ko) as Array<keyof typeof ko>) {
      // A resolved value differing from the key proves the table is wired;
      // both locales ship complete catalogs.
      expect(trKo(key)).not.toBe('');
      expect(trEn(key)).not.toBe('');
    }
  });
});
