/**
 * Unit tests for the runner-agnostic report serialiser (devtools#696).
 *
 * `serializeRelayReport`/`writeReportArtifact` turn the in-memory
 * `RelayRunReport` into a stable, secret-free on-disk artifact so a 2.x run and
 * a 3.0 run can be diffed cell-by-cell. The load-bearing properties tested here:
 *
 *   - cell-suffixed filename `<sdkLine>.<platform>.json`;
 *   - file paths are projectRoot-RELATIVE (no absolute `/Users/...` leak);
 *   - the serialised body carries NO relay wss/scheme/TOTP/relayUrl fields;
 *   - the cell metadata is baked into the body (provenance survives a move).
 *
 * No device needed — a hand-built report + a temp dir cover the surface.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelayRunReport } from '../test-runner/relay-worker.js';
import {
  type ReportCellMeta,
  serializeRelayReport,
  writeCaptureArtifacts,
  writeReportArtifact,
} from '../test-runner/report.js';

const PROJECT_ROOT = '/home/proj';

/** A representative passing report rooted under {@link PROJECT_ROOT}. */
function makeReport(): RelayRunReport {
  return {
    startedAt: '2026-06-29T00:00:00.000Z',
    duration: 1234,
    totals: { passed: 2, failed: 1, skipped: 0, total: 3 },
    files: [
      {
        file: `${PROJECT_ROOT}/src/clipboard.ait.test.ts`,
        result: {
          startedAt: '2026-06-29T00:00:00.000Z',
          duration: 50,
          passed: 1,
          failed: 1,
          skipped: 0,
          tests: [
            { name: 'writes', status: 'pass', duration: 10 },
            { name: 'reads', status: 'fail', duration: 12, error: 'expected true' },
          ],
        },
      },
      {
        file: `${PROJECT_ROOT}/src/broken.ait.test.ts`,
        result: { error: 'bundle failed: Could not resolve "x"' },
      },
    ],
    captures: [],
  };
}

const META: ReportCellMeta = { sdkLine: '3.x', platform: 'ios', projectRoot: PROJECT_ROOT };

describe('serializeRelayReport', () => {
  it('bakes the cell metadata into the body (provenance survives a move)', () => {
    const out = serializeRelayReport(makeReport(), META);
    expect(out.cell).toEqual({ sdkLine: '3.x', platform: 'ios' });
  });

  it('relativises file paths against projectRoot (no absolute leak)', () => {
    const out = serializeRelayReport(makeReport(), META);
    expect(out.files.map((f) => f.file)).toEqual([
      'src/clipboard.ait.test.ts',
      'src/broken.ait.test.ts',
    ]);
    for (const f of out.files) {
      expect(path.isAbsolute(f.file)).toBe(false);
      expect(f.file).not.toContain(PROJECT_ROOT);
    }
  });

  it('falls back to the basename for paths outside projectRoot', () => {
    const report = makeReport();
    report.files[0] = {
      file: '/somewhere/else/external.ait.test.ts',
      result: { error: 'x' },
    };
    const out = serializeRelayReport(report, META);
    // Not an absolute path, not a `../../..` traversal — just the basename.
    expect(out.files[0]?.file).toBe('external.ait.test.ts');
  });

  it('carries the per-file pass/fail shape for run results and error for failures', () => {
    const out = serializeRelayReport(makeReport(), META);
    expect(out.files[0]).toMatchObject({ passed: 1, failed: 1, skipped: 0 });
    expect(out.files[0]?.tests).toHaveLength(2);
    expect(out.files[1]).toMatchObject({
      file: 'src/broken.ait.test.ts',
      error: 'bundle failed: Could not resolve "x"',
    });
  });

  it('exposes no relay wss/scheme/TOTP/relayUrl keys anywhere in the body', () => {
    const out = serializeRelayReport(makeReport(), META);
    const blob = JSON.stringify(out).toLowerCase();
    for (const forbidden of [
      'wss',
      'relayurl',
      'scheme',
      'totp',
      'intoss-private',
      'trycloudflare',
    ]) {
      expect(blob).not.toContain(forbidden);
    }
  });
});

describe('writeReportArtifact', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ait-report-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes <sdkLine>.<platform>.json and returns that path', async () => {
    const outPath = await writeReportArtifact(makeReport(), dir, META);
    expect(path.basename(outPath)).toBe('3.x.ios.json');
    expect(path.dirname(outPath)).toBe(dir);
  });

  it('writes parseable JSON whose body has the baked cell + relative paths', async () => {
    const outPath = await writeReportArtifact(makeReport(), dir, META);
    const parsed = JSON.parse(await readFile(outPath, 'utf8')) as {
      cell: { sdkLine: string; platform: string };
      files: { file: string }[];
    };
    expect(parsed.cell).toEqual({ sdkLine: '3.x', platform: 'ios' });
    expect(parsed.files[0]?.file).toBe('src/clipboard.ait.test.ts');
  });

  it('produces distinct filenames per cell so 2.x and 3.x do not collide', async () => {
    const p3 = await writeReportArtifact(makeReport(), dir, META);
    const p2 = await writeReportArtifact(makeReport(), dir, {
      ...META,
      sdkLine: '2.x',
      platform: 'android',
    });
    expect(path.basename(p3)).toBe('3.x.ios.json');
    expect(path.basename(p2)).toBe('2.x.android.json');
    expect(p3).not.toBe(p2);
  });

  it('does not leak the project root or any secret token into the file', async () => {
    const outPath = await writeReportArtifact(makeReport(), dir, META);
    const raw = (await readFile(outPath, 'utf8')).toLowerCase();
    expect(raw).not.toContain(PROJECT_ROOT.toLowerCase());
    for (const forbidden of ['wss://', 'intoss-private://', 'trycloudflare', 'totp']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('writeCaptureArtifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ait-capture-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes one <category>.<sdkLine>.<platform>.json per category', async () => {
    const written = await writeCaptureArtifacts(
      [
        { category: 'clipboard', json: '[{"op":"writeText"}]' },
        { category: 'location', json: '[{"op":"getCurrent"}]' },
      ],
      dir,
      { sdkLine: '3.x', platform: 'ios' },
    );
    expect(written.map((p) => path.basename(p)).sort()).toEqual([
      'clipboard.3.x.ios.json',
      'location.3.x.ios.json',
    ]);
  });

  it('concatenates array payloads sharing a category in harvest order', async () => {
    const written = await writeCaptureArtifacts(
      [
        { category: 'clipboard', json: '[1,2]' },
        { category: 'clipboard', json: '[3]' },
      ],
      dir,
      { sdkLine: '2.x', platform: 'mock' },
    );
    expect(written).toHaveLength(1);
    const records = JSON.parse(await readFile(written[0] as string, 'utf8')) as number[];
    expect(records).toEqual([1, 2, 3]);
  });

  it('writes nothing for an empty capture list', async () => {
    const written = await writeCaptureArtifacts([], dir, { sdkLine: '3.x', platform: 'ios' });
    expect(written).toEqual([]);
  });
});
