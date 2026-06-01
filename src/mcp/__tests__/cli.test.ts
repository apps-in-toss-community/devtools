import { afterEach, describe, expect, it } from 'vitest';
import { parseForce, parseMode, parseTarget, seedLiveIntentFromEnv } from '../cli.js';
import { getLiveIntent, setLiveIntent } from '../environment.js';

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

describe('parseTarget', () => {
  it('defaults to relay with no flag', () => {
    expect(parseTarget([])).toBe('relay');
  });

  it('parses --target=local', () => {
    expect(parseTarget(['--target=local'])).toBe('local');
  });

  it('parses --target local (space-separated)', () => {
    expect(parseTarget(['--target', 'local'])).toBe('local');
  });

  it('parses --target=relay explicitly', () => {
    expect(parseTarget(['--target=relay'])).toBe('relay');
  });

  it('throws on an unknown target', () => {
    expect(() => parseTarget(['--target=bogus'])).toThrow(/Unknown --target/);
  });

  it('throws on a dangling --target with no value', () => {
    expect(() => parseTarget(['--target'])).toThrow(/--target requires a value/);
  });

  it('ignores --mode when parsing target', () => {
    expect(parseTarget(['--mode=debug', '--target=local'])).toBe('local');
  });
});

describe('parseForce', () => {
  it('returns false with no flags', () => {
    expect(parseForce([])).toBe(false);
  });

  it('returns true for --force', () => {
    expect(parseForce(['--force'])).toBe(true);
  });

  it('returns true for --takeover', () => {
    expect(parseForce(['--takeover'])).toBe(true);
  });

  it('returns true when --force is mixed with other flags', () => {
    expect(parseForce(['--mode=debug', '--force', '--target=relay'])).toBe(true);
  });

  it('returns false when neither flag is present', () => {
    expect(parseForce(['--mode=dev', '--target=local'])).toBe(false);
  });
});

describe('seedLiveIntentFromEnv — MCP_ENV back-compat (issue #348)', () => {
  afterEach(() => setLiveIntent(false));

  it('MCP_ENV=relay-live seeds liveIntent=true', () => {
    setLiveIntent(false);
    seedLiveIntentFromEnv({ MCP_ENV: 'relay-live' });
    expect(getLiveIntent()).toBe(true);
  });

  it('MCP_ENV=relay-dev / relay / mock do NOT arm liveIntent', () => {
    for (const v of ['relay-dev', 'relay', 'mock'] as const) {
      setLiveIntent(false);
      seedLiveIntentFromEnv({ MCP_ENV: v });
      expect(getLiveIntent()).toBe(false);
    }
  });

  it('absent MCP_ENV leaves liveIntent untouched', () => {
    setLiveIntent(false);
    seedLiveIntentFromEnv({});
    expect(getLiveIntent()).toBe(false);
  });
});
