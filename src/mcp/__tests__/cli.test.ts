import { describe, expect, it } from 'vitest';
import { parseMode } from '../cli.js';

describe('parseMode', () => {
  it('defaults to debug mode with no flag', () => {
    expect(parseMode([])).toBe('debug');
  });

  it('parses --mode=dev', () => {
    expect(parseMode(['--mode=dev'])).toBe('dev');
  });

  it('parses --mode dev (space-separated)', () => {
    expect(parseMode(['--mode', 'dev'])).toBe('dev');
  });

  it('parses --mode=debug explicitly', () => {
    expect(parseMode(['--mode=debug'])).toBe('debug');
  });

  it('throws on an unknown mode', () => {
    expect(() => parseMode(['--mode=bogus'])).toThrow(/Unknown --mode/);
  });

  it('throws on a dangling --mode with no value', () => {
    expect(() => parseMode(['--mode'])).toThrow(/--mode requires a value/);
  });
});
