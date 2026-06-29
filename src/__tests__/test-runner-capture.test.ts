/**
 * Unit tests for the `__AIT_CAPTURE__` console-line parser (devtools#696).
 *
 * `parseCaptureLines` is the allowlist choke point that turns the raw relay
 * console stream into structured capture lines. The security-relevant property
 * is the strict prefix allowlist: wss/scheme/relay noise must NOT survive into a
 * capture artifact (SECRET-HANDLING). These tests pin that, plus the
 * category/JSON split and the no-throw discard of malformed lines.
 *
 * No device/network needed — the parser is pure over plain text lines.
 */

import { describe, expect, it } from 'vitest';
import { type AitCaptureLine, parseCaptureLines } from '../test-runner/capture.js';

/** Helper: wrap raw text strings in the `{ text }` shape the parser reads. */
function lines(...texts: string[]): { text: string }[] {
  return texts.map((text) => ({ text }));
}

describe('parseCaptureLines', () => {
  it('extracts category + opaque json from a well-formed capture line', () => {
    const out = parseCaptureLines(
      lines('__AIT_CAPTURE__ clipboard [{"op":"writeText","arg":"hi"}]'),
    );
    expect(out).toEqual<AitCaptureLine[]>([
      { category: 'clipboard', json: '[{"op":"writeText","arg":"hi"}]' },
    ]);
  });

  it('keeps the json payload verbatim (opaque — not re-serialised)', () => {
    // Odd-but-valid spacing/structure inside the JSON must survive untouched.
    const json = '[ {"a": 1,  "b":  [2,3] } ]';
    const out = parseCaptureLines(lines(`__AIT_CAPTURE__ storage ${json}`));
    expect(out).toHaveLength(1);
    expect(out[0]?.category).toBe('storage');
    expect(out[0]?.json).toBe(json);
  });

  it('preserves multiple capture lines in input order', () => {
    const out = parseCaptureLines(
      lines(
        '__AIT_CAPTURE__ clipboard [1]',
        '__AIT_CAPTURE__ location [2]',
        '__AIT_CAPTURE__ clipboard [3]',
      ),
    );
    expect(out.map((l) => l.category)).toEqual(['clipboard', 'location', 'clipboard']);
    expect(out.map((l) => l.json)).toEqual(['[1]', '[2]', '[3]']);
  });

  it('drops ordinary noise lines that lack the prefix', () => {
    const out = parseCaptureLines(
      lines(
        'just a regular console.log line',
        '[vite] connected.',
        'AIT_CAPTURE__ clipboard [1]', // missing leading __ — not the exact prefix
        '__AIT_CAPTURE clipboard [1]', // prefix without trailing space — not exact
      ),
    );
    expect(out).toEqual([]);
  });

  it('drops wss/scheme/relay noise lines (SECRET-HANDLING — never serialised)', () => {
    const out = parseCaptureLines(
      lines(
        'relay connected wss://FAKE.example/x',
        'attaching to intoss-private://FAKE-app?_deploymentId=000',
        'tunnel up at https://FAKE.trycloudflare.example/',
        '__AIT_CAPTURE__ clipboard [{"ok":true}]',
      ),
    );
    // Only the real capture line passes; no fake secret-bearing text survives.
    expect(out).toEqual<AitCaptureLine[]>([{ category: 'clipboard', json: '[{"ok":true}]' }]);
    // Defensive: nothing in the output carries the fake secret substrings.
    const blob = JSON.stringify(out);
    expect(blob).not.toContain('wss://');
    expect(blob).not.toContain('intoss-private://');
    expect(blob).not.toContain('trycloudflare');
  });

  it('discards a capture line whose payload is broken JSON (no throw)', () => {
    const out = parseCaptureLines(
      lines(
        '__AIT_CAPTURE__ clipboard [not valid json',
        '__AIT_CAPTURE__ storage {bad}',
        '__AIT_CAPTURE__ location [42]',
      ),
    );
    // Only the parseable payload survives.
    expect(out).toEqual<AitCaptureLine[]>([{ category: 'location', json: '[42]' }]);
  });

  it('discards a capture line with no payload separator (category only)', () => {
    const out = parseCaptureLines(lines('__AIT_CAPTURE__ clipboard'));
    expect(out).toEqual([]);
  });

  it('discards a capture line with an empty payload', () => {
    // prefix + 'clipboard' + space + '' → json is empty string.
    const out = parseCaptureLines(lines('__AIT_CAPTURE__ clipboard '));
    expect(out).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCaptureLines([])).toEqual([]);
  });
});
