/**
 * Unit tests for the Vitest task-graph synthesis (devtools#645).
 *
 * Pure functions — no phone/relay needed. Feeds a plain `RunReport` and asserts
 * the synthesised File/Suite/Test graph has Vitest-stable ids, correct nesting
 * rebuilt from ` > `-joined names, result-state mapping, and that the pack
 * tuples have the shapes `state.updateTasks` consumes.
 */

import type { File, Suite, Task, Test } from '@vitest/runner';
import { describe, expect, it } from 'vitest';
import type { RunReport } from '../test-runner/runtime.js';
import {
  synthesizeFileTask,
  syntheticFileId,
  toTaskEventPacks,
  toTaskResultPacks,
} from '../test-runner/task-graph.js';

const ROOT = '/project';
const POOL = 'ait-relay';

function report(tests: RunReport['tests']): RunReport {
  const passed = tests.filter((t) => t.status === 'pass').length;
  const failed = tests.filter((t) => t.status === 'fail').length;
  const skipped = tests.filter((t) => t.status === 'skip').length;
  return { startedAt: '2024-01-01T00:00:00.000Z', duration: 1, passed, failed, skipped, tests };
}

/** Collect all tasks (file + suites + tests) depth-first. */
function allTasks(file: File): Task[] {
  const out: Task[] = [];
  const walk = (t: Task): void => {
    out.push(t);
    if (t.type === 'suite') for (const c of t.tasks) walk(c);
  };
  walk(file);
  return out;
}

function getTests(file: File): Test[] {
  return allTasks(file).filter((t): t is Test => t.type === 'test');
}

describe('synthesizeFileTask', () => {
  it('builds a flat file with top-level tests', () => {
    const file = synthesizeFileTask(
      `${ROOT}/a.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([
        { name: 'adds', status: 'pass', duration: 3 },
        { name: 'subtracts', status: 'pass', duration: 4 },
      ]),
    );
    expect(file.type).toBe('suite');
    expect(file.filepath).toBe(`${ROOT}/a.test.ts`);
    expect(file.pool).toBe(POOL);
    const tests = getTests(file);
    expect(tests.map((t) => t.name)).toEqual(['adds', 'subtracts']);
    // Tests are direct children of the file (no intermediate suite).
    expect(file.tasks.every((t) => t.type === 'test')).toBe(true);
  });

  it('rebuilds nested suites from " > " names', () => {
    const file = synthesizeFileTask(
      `${ROOT}/nested.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([
        { name: 'math > add > positives', status: 'pass', duration: 1 },
        { name: 'math > add > negatives', status: 'fail', duration: 1, error: 'nope' },
        { name: 'math > sub', status: 'pass', duration: 1 },
      ]),
    );
    // file -> suite 'math' -> [suite 'add' -> [test positives, test negatives], test 'sub']
    expect(file.tasks).toHaveLength(1);
    const math = file.tasks[0] as Suite;
    expect(math.type).toBe('suite');
    expect(math.name).toBe('math');
    const names = math.tasks.map((t) => `${t.type}:${t.name}`);
    expect(names).toContain('suite:add');
    expect(names).toContain('test:sub');
    const add = math.tasks.find((t) => t.name === 'add') as Suite;
    expect(add.tasks.map((t) => t.name)).toEqual(['positives', 'negatives']);
  });

  it('shares a suite across tests with the same prefix (no duplicates)', () => {
    const file = synthesizeFileTask(
      `${ROOT}/dedup.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([
        { name: 'group > a', status: 'pass', duration: 1 },
        { name: 'group > b', status: 'pass', duration: 1 },
      ]),
    );
    const suites = allTasks(file).filter((t) => t.type === 'suite' && t.file !== t);
    expect(suites).toHaveLength(1);
    expect((suites[0] as Suite).tasks).toHaveLength(2);
  });

  it('maps pass/fail/skip to TaskResult.state', () => {
    const file = synthesizeFileTask(
      `${ROOT}/states.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([
        { name: 'ok', status: 'pass', duration: 2 },
        { name: 'bad', status: 'fail', duration: 2, error: 'boom' },
        { name: 'later', status: 'skip', duration: 0 },
      ]),
    );
    const byName = new Map(getTests(file).map((t) => [t.name, t]));
    expect(byName.get('ok')?.result?.state).toBe('pass');
    expect(byName.get('bad')?.result?.state).toBe('fail');
    expect(byName.get('bad')?.result?.errors?.[0]?.message).toBe('boom');
    expect(byName.get('later')?.result?.state).toBe('skip');
    expect(byName.get('later')?.mode).toBe('skip');
  });

  it('does NOT leak the secret-bearing nothing — error message is the matcher text only', () => {
    const file = synthesizeFileTask(
      `${ROOT}/err.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([{ name: 'x', status: 'fail', duration: 1, error: 'Expected 1, received 2' }]),
    );
    const t = getTests(file)[0];
    expect(t.result?.errors?.[0]?.message).toBe('Expected 1, received 2');
  });

  it('assigns non-empty Vitest ids to every task, stable across runs', () => {
    const make = () =>
      synthesizeFileTask(
        `${ROOT}/ids.test.ts`,
        ROOT,
        'proj',
        POOL,
        report([
          { name: 'g > a', status: 'pass', duration: 1 },
          { name: 'g > b', status: 'pass', duration: 1 },
        ]),
      );
    const first = make();
    const second = make();
    const ids1 = allTasks(first).map((t) => t.id);
    const ids2 = allTasks(second).map((t) => t.id);
    expect(ids1.every((id) => id.length > 0)).toBe(true);
    // Same input → identical ids (stable, position-derived).
    expect(ids1).toEqual(ids2);
    // All ids unique within a file.
    expect(new Set(ids1).size).toBe(ids1.length);
  });

  it('file id depends on project name', () => {
    const a = synthesizeFileTask(`${ROOT}/p.test.ts`, ROOT, 'one', POOL, report([]));
    const b = synthesizeFileTask(`${ROOT}/p.test.ts`, ROOT, 'two', POOL, report([]));
    expect(a.id).not.toBe(b.id);
  });

  it('marks file failed when no tests collected but failures reported', () => {
    const file = synthesizeFileTask(`${ROOT}/empty.test.ts`, ROOT, undefined, POOL, {
      startedAt: 'now',
      duration: 0,
      passed: 0,
      failed: 1,
      skipped: 0,
      tests: [],
    });
    expect(file.result?.state).toBe('fail');
  });
});

describe('toTaskResultPacks', () => {
  it('emits [id, result, meta] for every task including the file', () => {
    const file = synthesizeFileTask(
      `${ROOT}/p.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([{ name: 's > t', status: 'pass', duration: 1 }]),
    );
    const packs = toTaskResultPacks(file);
    // file + suite 's' + test 't' = 3
    expect(packs).toHaveLength(3);
    for (const [id, , meta] of packs) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(meta).toBeDefined();
    }
    // The test's pack carries a pass result.
    const testTask = getTests(file)[0];
    const testPack = packs.find(([id]) => id === testTask.id);
    expect(testPack?.[1]?.state).toBe('pass');
  });
});

describe('toTaskEventPacks', () => {
  it('emits test-prepare/test-finished per test and suite events for inner suites', () => {
    const file = synthesizeFileTask(
      `${ROOT}/e.test.ts`,
      ROOT,
      undefined,
      POOL,
      report([{ name: 'grp > t', status: 'pass', duration: 1 }]),
    );
    const events = toTaskEventPacks(file);
    const types = events.map(([, ev]) => ev);
    expect(types).toContain('test-prepare');
    expect(types).toContain('test-finished');
    expect(types).toContain('suite-prepare');
    expect(types).toContain('suite-finished');
    // No suite events for the file root itself (reporters track the module).
    const fileEvents = events.filter(([id]) => id === file.id);
    expect(fileEvents).toHaveLength(0);
  });
});

describe('syntheticFileId', () => {
  it('is deterministic and project-name sensitive', () => {
    expect(syntheticFileId('a.test.ts', undefined)).toBe(syntheticFileId('a.test.ts', undefined));
    expect(syntheticFileId('a.test.ts', 'x')).not.toBe(syntheticFileId('a.test.ts', 'y'));
  });
});
