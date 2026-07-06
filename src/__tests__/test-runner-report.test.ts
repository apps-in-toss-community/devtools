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

  it('carries mode: "stubbed" through to the serialised file entry (devtools#740)', () => {
    const report = makeReport();
    report.files.push({
      file: `${PROJECT_ROOT}/src/ads.manual.ait.test.ts`,
      result: {
        startedAt: '2026-06-29T00:00:00.000Z',
        duration: 5,
        passed: 1,
        failed: 0,
        skipped: 0,
        tests: [{ name: 'stub', status: 'pass', duration: 1 }],
      },
      mode: 'stubbed',
    });
    const out = serializeRelayReport(report, META);
    expect(out.files.at(-1)).toMatchObject({ mode: 'stubbed' });
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

  it('writes <sdkLine>.<platform>.json and returns that path (array of one)', async () => {
    const written = await writeReportArtifact(makeReport(), dir, META);
    expect(written).toHaveLength(1);
    const outPath = written[0] as string;
    expect(path.basename(outPath)).toBe('3.x.ios.json');
    expect(path.dirname(outPath)).toBe(dir);
  });

  it('writes parseable JSON whose body has the baked cell + relative paths', async () => {
    const [outPath] = await writeReportArtifact(makeReport(), dir, META);
    const parsed = JSON.parse(await readFile(outPath as string, 'utf8')) as {
      cell: { sdkLine: string; platform: string };
      files: { file: string }[];
    };
    expect(parsed.cell).toEqual({ sdkLine: '3.x', platform: 'ios' });
    expect(parsed.files[0]?.file).toBe('src/clipboard.ait.test.ts');
  });

  it('produces distinct filenames per cell so 2.x and 3.x do not collide', async () => {
    const [p3] = await writeReportArtifact(makeReport(), dir, META);
    const [p2] = await writeReportArtifact(makeReport(), dir, {
      ...META,
      sdkLine: '2.x',
      platform: 'android',
    });
    expect(path.basename(p3 as string)).toBe('3.x.ios.json');
    expect(path.basename(p2 as string)).toBe('2.x.android.json');
    expect(p3).not.toBe(p2);
  });

  it('does not leak the project root or any secret token into the file', async () => {
    const [outPath] = await writeReportArtifact(makeReport(), dir, META);
    const raw = (await readFile(outPath as string, 'utf8')).toLowerCase();
    expect(raw).not.toContain(PROJECT_ROOT.toLowerCase());
    for (const forbidden of ['wss://', 'intoss-private://', 'trycloudflare', 'totp']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('writes a SEPARATE <sdkLine>.<platform>.manual.json when the run has manual files, alongside (not replacing) the standard report (devtools#741)', async () => {
    const report = makeReport();
    report.files.push({
      file: `${PROJECT_ROOT}/src/camera.manual.ait.test.ts`,
      result: {
        startedAt: '2026-06-29T00:00:00.000Z',
        duration: 90_000,
        passed: 1,
        failed: 0,
        skipped: 0,
        tests: [{ name: 'granted happy path', status: 'pass', duration: 89_000 }],
      },
      mode: 'manual',
    });

    const written = await writeReportArtifact(report, dir, META);
    const names = written.map((p) => path.basename(p)).sort();
    expect(names).toEqual(['3.x.ios.json', '3.x.ios.manual.json']);

    const standard = JSON.parse(
      await readFile(written.find((p) => p.endsWith('3.x.ios.json')) as string, 'utf8'),
    ) as { files: { file: string; mode?: string }[] };
    // Standard artifact stays exactly the regular (unattended) files — the
    // manual file must not pollute the baseline.
    expect(standard.files.map((f) => f.file)).toEqual([
      'src/clipboard.ait.test.ts',
      'src/broken.ait.test.ts',
    ]);
    expect(standard.files.some((f) => f.mode === 'manual')).toBe(false);

    const manual = JSON.parse(
      await readFile(written.find((p) => p.endsWith('.manual.json')) as string, 'utf8'),
    ) as { files: { file: string; mode?: string }[] };
    expect(manual.files).toHaveLength(1);
    expect(manual.files[0]).toMatchObject({
      file: 'src/camera.manual.ait.test.ts',
      mode: 'manual',
    });
  });

  it('writes only the standard artifact when all files are regular (no manual entries)', async () => {
    const written = await writeReportArtifact(makeReport(), dir, META);
    expect(written).toHaveLength(1);
    expect(path.basename(written[0] as string)).toBe('3.x.ios.json');
  });

  it('writes a SEPARATE <sdkLine>.<platform>.stubbed.json for stubbed files, stamped cell.bridgeStub:true (devtools#740)', async () => {
    const report = makeReport();
    report.files.push({
      file: `${PROJECT_ROOT}/src/ads.manual.ait.test.ts`,
      result: {
        startedAt: '2026-06-29T00:00:00.000Z',
        duration: 120,
        passed: 1,
        failed: 0,
        skipped: 0,
        tests: [
          {
            name: 'showFullScreenAd rejects with 1006 when not loaded',
            status: 'pass',
            duration: 5,
          },
        ],
      },
      mode: 'stubbed',
    });

    const written = await writeReportArtifact(report, dir, META);
    const names = written.map((p) => path.basename(p)).sort();
    expect(names).toEqual(['3.x.ios.json', '3.x.ios.stubbed.json']);

    const standard = JSON.parse(
      await readFile(written.find((p) => p.endsWith('3.x.ios.json')) as string, 'utf8'),
    ) as { files: { file: string; mode?: string }[]; cell: { bridgeStub?: boolean } };
    // Standard artifact stays exactly the regular (unattended) files — the
    // stubbed file must not pollute the baseline, and cell.bridgeStub must be
    // ABSENT (never `false`) on the non-stubbed artifact.
    expect(standard.files.some((f) => f.mode === 'stubbed')).toBe(false);
    expect(standard.cell.bridgeStub).toBeUndefined();

    const stubbed = JSON.parse(
      await readFile(written.find((p) => p.endsWith('.stubbed.json')) as string, 'utf8'),
    ) as { files: { file: string; mode?: string }[]; cell: { bridgeStub?: boolean } };
    expect(stubbed.files).toHaveLength(1);
    expect(stubbed.files[0]).toMatchObject({
      file: 'src/ads.manual.ait.test.ts',
      mode: 'stubbed',
    });
    // The mandatory HYBRID-cell provenance stamp (devtools#740) — a stubbed
    // result must never be silently mixed into the real-device baseline.
    expect(stubbed.cell.bridgeStub).toBe(true);
  });

  it('writes three SEPARATE artifacts when a run mixes regular + manual + stubbed files', async () => {
    const report = makeReport();
    report.files.push(
      {
        file: `${PROJECT_ROOT}/src/camera.manual.ait.test.ts`,
        result: {
          startedAt: '2026-06-29T00:00:00.000Z',
          duration: 90_000,
          passed: 1,
          failed: 0,
          skipped: 0,
          tests: [{ name: 'granted happy path', status: 'pass', duration: 89_000 }],
        },
        mode: 'manual',
      },
      {
        file: `${PROJECT_ROOT}/src/ads.manual.ait.test.ts`,
        result: {
          startedAt: '2026-06-29T00:00:00.000Z',
          duration: 100,
          passed: 1,
          failed: 0,
          skipped: 0,
          tests: [{ name: 'showFullScreenAd stub', status: 'pass', duration: 5 }],
        },
        mode: 'stubbed',
      },
    );

    const written = await writeReportArtifact(report, dir, META);
    const names = written.map((p) => path.basename(p)).sort();
    expect(names).toEqual(['3.x.ios.json', '3.x.ios.manual.json', '3.x.ios.stubbed.json']);
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
