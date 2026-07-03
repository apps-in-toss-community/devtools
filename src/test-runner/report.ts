/**
 * Runner-agnostic report serialisation for env3 test runs (devtools#696).
 *
 * Both env3 execution paths — the Vitest custom pool (`pool.ts`) and the
 * standalone `devtools-test` CLI (`cli.ts`) — call the same core
 * `runTestFilesOverRelay` and so produce the same {@link RelayRunReport}. This
 * module is the single, runner-neutral place that turns that in-memory report
 * into a stable on-disk artifact so a 2.x run and a 3.0 run can be diffed
 * cell-by-cell after the fact.
 *
 * The serialised schema is deliberately MINIMAL and secret-free:
 *
 *   - file paths are stored RELATIVE to `projectRoot` (no absolute `/Users/...`
 *     leakage — see {@link RunnerAgnosticReport.files});
 *   - the cell metadata (sdkLine/platform) is baked INTO the body, not only the
 *     filename, so a moved artifact never loses its provenance;
 *   - NO relay wss / scheme / TOTP / relayUrl fields exist in the schema at all
 *     (enforced by the type + this comment) — error strings are the matcher
 *     message only, inherited from rpc.ts which already strips expression/value.
 *
 * react-free — depends only on the type-level `RelayRunReport` and `node:fs` /
 * `node:path`. Safe to bundle without pulling the chii/cloudflared graph.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AitCaptureLine } from './capture.js';
import type { RelayRunReport } from './relay-worker.js';
import type { TestResult } from './runtime.js';

/** The cell axes a report is stamped with — the test-matrix coordinates. */
export interface ReportCellMeta {
  /** SDK line under test (e.g. `'2.x'` / `'3.x'`). */
  sdkLine: string;
  /** Platform under test (e.g. `'ios'` / `'android'` / `'mock'`). */
  platform: string;
  /**
   * Project root the run was launched from. Used ONLY to relativise file paths
   * out of the serialised report — never stored in the output. SECRET-HANDLING:
   * absolute project paths must not leak into artifacts.
   */
  projectRoot: string;
}

/** Per-file slice of a {@link RunnerAgnosticReport}. */
export interface RunnerAgnosticFileReport {
  /**
   * Test file path, RELATIVE to `projectRoot`. Never absolute — `path.relative`
   * strips the machine-specific prefix so the artifact is portable and leaks no
   * local filesystem layout.
   */
  file: string;
  /** Whole-file bundle/inject error (matcher message only), when the file failed. */
  error?: string;
  /** In-page run duration (ms) for this file, when it ran. */
  duration?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  /** Per-test results, when the file ran. Error strings are matcher messages only. */
  tests?: TestResult[];
  /**
   * Present + `'manual'` only when this file ran under `--manual-blocking`
   * (devtools#741) — human-attended, real native envelopes. Absent (never
   * `false`) for unattended files: absence-means-unattended is the contract,
   * mirroring `FileResult.mode` in relay-worker.ts. A manual-stamped record
   * must never be diffed against an unattended one as if equivalent.
   */
  mode?: 'manual';
}

/**
 * The runner-neutral, secret-free report written to disk. There are
 * intentionally NO wss/scheme/TOTP/relayUrl fields on this type — the absence is
 * load-bearing (SECRET-HANDLING) and must not be "completed" by a future edit.
 */
export interface RunnerAgnosticReport {
  /** Cell axes this run belongs to — baked into the body for portability. */
  cell: { sdkLine: string; platform: string };
  /** ISO timestamp of when the run started (from the core report). */
  startedAt: string;
  /** Total wall-clock ms (bundling + sequential injection). */
  duration: number;
  /** Flattened totals across all files. */
  totals: RelayRunReport['totals'];
  /** Per-file results with projectRoot-relative paths. */
  files: RunnerAgnosticFileReport[];
}

/**
 * Converts an absolute (or already-relative) file path to a projectRoot-relative
 * one. `path.relative` returns `''` when the paths are equal — guard that to the
 * basename so the field is never empty.
 *
 * SECRET-HANDLING: this is the single choke point that strips absolute project
 * paths from the artifact.
 */
function relativise(projectRoot: string, file: string): string {
  const rel = path.relative(projectRoot, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    // Outside the project root (or equal) — fall back to the basename rather
    // than emitting an absolute or `../../..` traversal path.
    return path.basename(file);
  }
  return rel;
}

/**
 * Serialises a {@link RelayRunReport} into the runner-agnostic, secret-free
 * on-disk shape. Pure — no IO; testable with a plain report + meta.
 *
 * @param report - The core relay run report.
 * @param meta   - Cell axes + projectRoot (projectRoot is consumed, not stored).
 */
export function serializeRelayReport(
  report: RelayRunReport,
  meta: ReportCellMeta,
): RunnerAgnosticReport {
  return {
    cell: { sdkLine: meta.sdkLine, platform: meta.platform },
    startedAt: report.startedAt,
    duration: report.duration,
    totals: report.totals,
    files: report.files.map((f): RunnerAgnosticFileReport => {
      const file = relativise(meta.projectRoot, f.file);
      const modeField = f.mode === 'manual' ? ({ mode: 'manual' } as const) : {};
      if ('error' in f.result) {
        // Matcher/inject error message only — rpc.ts already stripped the
        // expression/value upstream.
        return { file, error: f.result.error, ...modeField };
      }
      return {
        file,
        duration: f.result.duration,
        passed: f.result.passed,
        failed: f.result.failed,
        skipped: f.result.skipped,
        tests: f.result.tests,
        ...modeField,
      };
    }),
  };
}

/**
 * Writes the serialised report to `<dir>/<sdkLine>.<platform>.json`, creating
 * `dir` if needed. Returns the absolute path(s) written.
 *
 * The cell-suffixed filename keeps 2.x and 3.0 (and per-platform) runs as
 * distinct artifacts in the same directory; the same cell metadata is also baked
 * into the body so a renamed/moved file still carries its provenance.
 *
 * Manual-run provenance (devtools#741): when `report.files` contains ANY
 * `mode: 'manual'` entry (i.e. this run included `--manual-blocking` files),
 * the manual-tagged files are written to a SEPARATE
 * `<dir>/<sdkLine>.<platform>.manual.json` artifact instead of the standard
 * one — the standard `<sdkLine>.<platform>.json` filename is reserved for the
 * regular (unattended) files only, so a manual run's presence never mutates
 * what the unattended-baseline filename means. If ALL files in the run are
 * regular, only the standard artifact is written (today's behavior,
 * unchanged). If a run mixes both (regular files + `--manual-blocking`
 * scheduled last), BOTH artifacts are written — the manual one ALONGSIDE, not
 * replacing, the standard one.
 *
 * SECRET-HANDLING: the written body contains no relay/secret fields (the schema
 * has none). `dir`/`projectRoot` are local filesystem paths, never logged here.
 *
 * @param report - The core relay run report.
 * @param dir    - Output directory (created recursively if missing).
 * @param meta   - Cell axes + projectRoot.
 * @returns The absolute path(s) written, in order: standard first (if any
 *   regular files ran), then manual (if any manual files ran). At least one
 *   path is always returned when `report.files` is non-empty.
 */
export async function writeReportArtifact(
  report: RelayRunReport,
  dir: string,
  meta: ReportCellMeta,
): Promise<string[]> {
  const serialised = serializeRelayReport(report, meta);
  await mkdir(dir, { recursive: true });

  const regularFiles = serialised.files.filter((f) => f.mode !== 'manual');
  const manualFiles = serialised.files.filter((f) => f.mode === 'manual');

  const written: string[] = [];

  // Standard artifact: written whenever there are regular files, OR when the
  // whole run is empty (preserves the pre-#741 "always write one file"
  // behavior for a run with zero files, e.g. an empty glob match).
  if (regularFiles.length > 0 || serialised.files.length === 0) {
    const outFile = path.join(dir, `${meta.sdkLine}.${meta.platform}.json`);
    await writeFile(
      outFile,
      `${JSON.stringify({ ...serialised, files: regularFiles }, null, 2)}\n`,
      'utf8',
    );
    written.push(outFile);
  }

  if (manualFiles.length > 0) {
    const manualOutFile = path.join(dir, `${meta.sdkLine}.${meta.platform}.manual.json`);
    await writeFile(
      manualOutFile,
      `${JSON.stringify({ ...serialised, files: manualFiles }, null, 2)}\n`,
      'utf8',
    );
    written.push(manualOutFile);
  }

  return written;
}

/**
 * Writes harvested `__AIT_CAPTURE__` lines to per-category files under `dir`,
 * named `<category>.<sdkLine>.<platform>.json` — the SAME convention
 * sdk-example's env1 `flushCapture` uses on the filesystem, so env1 and env3
 * capture artifacts line up for diffing.
 *
 * Each line's `json` payload is an opaque JSON array of capture records. Lines
 * sharing a category are concatenated into one array, in harvest order.
 *
 * SECRET-HANDLING: only allowlist-prefixed capture lines reach here (the parser
 * dropped wss/scheme noise); the `json` payload is written verbatim but is a
 * capture record array, not a relay/secret.
 *
 * @param captures - Parsed capture lines (from `RelayRunReport.captures`).
 * @param dir      - Output directory (created recursively if missing).
 * @param cell     - Cell axes for the filename suffix.
 * @returns The absolute paths written (one per category), in category order.
 */
export async function writeCaptureArtifacts(
  captures: ReadonlyArray<AitCaptureLine>,
  dir: string,
  cell: { sdkLine: string; platform: string },
): Promise<string[]> {
  if (captures.length === 0) return [];

  // Group payloads by category, preserving harvest order. Each payload is an
  // opaque JSON array string; concatenate parsed arrays under the same category.
  const byCategory = new Map<string, unknown[]>();
  for (const { category, json } of captures) {
    let merged = byCategory.get(category);
    if (!merged) {
      merged = [];
      byCategory.set(category, merged);
    }
    // The parser already validated `json` parses; an array payload is expected.
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      merged.push(...parsed);
    } else {
      merged.push(parsed);
    }
  }

  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [category, records] of byCategory) {
    const outFile = path.join(dir, `${category}.${cell.sdkLine}.${cell.platform}.json`);
    await writeFile(outFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    written.push(outFile);
  }
  return written;
}
