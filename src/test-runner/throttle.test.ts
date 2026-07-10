/**
 * Unit tests for the shared `APP_BRIDGE_THROTTLED` detection predicate
 * (devtools#767).
 *
 * SECRET-HANDLING: all fixtures are synthetic native-bridge error shapes —
 * no real relay/wss/TOTP values appear anywhere in this file.
 */

import { describe, expect, it } from 'vitest';
import { isThrottledError, THROTTLED_ERROR_CODE, THROTTLED_MESSAGE_SUBSTRING } from './throttle.js';

describe('isThrottledError', () => {
  it('detects the 2.x native envelope by `code` (devtools#767 exact shape)', () => {
    const nativeEnvelope = {
      name: 'AppBridgeError',
      code: 'APP_BRIDGE_THROTTLED',
      userInfo: {},
      moduleName: 'clipboard',
      __isError: true,
    };
    expect(isThrottledError(nativeEnvelope)).toBe(true);
  });

  it('detects via message substring even without a `code` field', () => {
    expect(isThrottledError({ message: 'Too many app bridge calls from getClipboardText.' })).toBe(
      true,
    );
  });

  it('detects a plain string message', () => {
    expect(isThrottledError('Too many app bridge calls from openCamera.')).toBe(true);
  });

  it('detects a real Error whose message contains the substring', () => {
    expect(isThrottledError(new Error('Too many app bridge calls from fetchContacts.'))).toBe(true);
  });

  it('code takes priority — matches even if message does not contain the substring', () => {
    expect(isThrottledError({ code: 'APP_BRIDGE_THROTTLED', message: 'unrelated text' })).toBe(
      true,
    );
  });

  it('returns false for null/undefined', () => {
    expect(isThrottledError(null)).toBe(false);
    expect(isThrottledError(undefined)).toBe(false);
  });

  it('returns false for an unrelated Error', () => {
    expect(isThrottledError(new Error('some assertion failed'))).toBe(false);
  });

  it('returns false for an unrelated string', () => {
    expect(isThrottledError('boom')).toBe(false);
  });

  it('returns false for an object with a mismatched code and no message substring', () => {
    expect(isThrottledError({ code: 'SOME_OTHER_CODE', message: 'nope' })).toBe(false);
  });

  it('returns false for a plain object with no code/message fields', () => {
    expect(isThrottledError({})).toBe(false);
  });

  it('returns false for primitives that are neither string nor object', () => {
    expect(isThrottledError(42)).toBe(false);
    expect(isThrottledError(true)).toBe(false);
  });

  it('exports the exact native code/message-substring constants used by both consumers', () => {
    // These constants are consumed independently by cell.ts's generated
    // page-side expression (which cannot statically import this module) —
    // pinning their literal values here guards against silent drift.
    expect(THROTTLED_ERROR_CODE).toBe('APP_BRIDGE_THROTTLED');
    expect(THROTTLED_MESSAGE_SUBSTRING).toBe('Too many app bridge calls');
  });
});
