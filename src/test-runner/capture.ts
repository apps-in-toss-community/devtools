/**
 * `__AIT_CAPTURE__` console-line parser (devtools#696).
 *
 * env3 test runs inject sdk-example's `aitCapture.ts`, which — when running in a
 * WebView (no filesystem) — emits one `console.log` line per category in the
 * stable form:
 *
 *   __AIT_CAPTURE__ <category> <json>
 *
 * The relay-worker harvests `Runtime.consoleAPICalled` events as plain text
 * lines (see `relay-worker.ts`) and hands them here. This module's only job is
 * to recognise the allowlisted prefix, split off the category, and keep the
 * remaining JSON string OPAQUE — devtools does NOT own or interpret the
 * `__AIT_CAPTURE__` record shape (that lives in sdk-example). We carry
 * `{ category, json }` through untouched so the 2.x↔3.0 line comparison stays a
 * downstream concern.
 *
 * Why a strict allowlist prefix (SECRET-HANDLING): the raw console stream may
 * also contain wss/scheme/relay noise lines. Only lines that EXACTLY start with
 * `'__AIT_CAPTURE__ '` pass; everything else is discarded, so a stray relay URL
 * can never be serialised into a capture artifact.
 *
 * react-free, dependency-free — safe to import from any test-runner entry
 * without dragging in the chii/cloudflared Node graph.
 */

/**
 * One parsed capture line. `json` is the raw JSON string exactly as the page
 * emitted it (an array of sdk-example capture records). devtools treats it as
 * opaque — it is validated as parseable JSON but never inspected.
 */
export interface AitCaptureLine {
  /** The capture category (first whitespace-delimited token after the prefix). */
  category: string;
  /** The remaining JSON payload, verbatim. Opaque to devtools. */
  json: string;
}

/** The exact console-line prefix sdk-example's `flushCapture` emits. */
const CAPTURE_PREFIX = '__AIT_CAPTURE__ ';

/**
 * Parses raw console line texts into {@link AitCaptureLine}s.
 *
 * Filtering rules (each independently drops a line — never throws):
 *   - the line text must `startsWith(CAPTURE_PREFIX)` exactly (allowlist);
 *   - there must be a non-empty category token (up to the next space);
 *   - the remaining payload must be valid JSON (`JSON.parse` succeeds).
 *
 * Lines that fail any rule (wss/scheme noise, truncated, broken JSON) are
 * silently discarded — capture harvesting is best-effort and must never fail a
 * run or leak a malformed/secret-bearing line.
 *
 * @param raw - Console line objects (only `.text` is read).
 * @returns The captured lines, in input order.
 */
export function parseCaptureLines(raw: ReadonlyArray<{ text: string }>): AitCaptureLine[] {
  const out: AitCaptureLine[] = [];
  for (const { text } of raw) {
    // Allowlist: only the exact `__AIT_CAPTURE__ ` prefix passes. wss/scheme
    // noise lines are dropped here (SECRET-HANDLING).
    if (!text.startsWith(CAPTURE_PREFIX)) continue;

    const body = text.slice(CAPTURE_PREFIX.length);
    const spaceIdx = body.indexOf(' ');
    // No payload separator → malformed; drop.
    if (spaceIdx === -1) continue;

    const category = body.slice(0, spaceIdx);
    const json = body.slice(spaceIdx + 1);
    if (category === '' || json === '') continue;

    // Validate the payload is parseable JSON, but keep it as an OPAQUE string —
    // devtools does not own the record shape. Broken JSON is discarded (no throw).
    try {
      JSON.parse(json);
    } catch {
      continue;
    }

    out.push({ category, json });
  }
  return out;
}
