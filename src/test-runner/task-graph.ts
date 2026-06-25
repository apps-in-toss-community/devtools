/**
 * Synthesises a Vitest task graph from a relay `RunReport`.
 *
 * The page-side runtime (`runtime.ts`) only knows how to collect a flat list
 * of `TestResult { name: 'suite > sub > test', status, duration, error }`.
 * Vitest's reporters/watch/UI ecosystem, however, expect a populated task
 * graph (`File` → `Suite` → `Test`) plus `TaskResultPack`/`TaskEventPack`
 * tuples reported through `vitest.state`.
 *
 * This module bridges the two: it rebuilds the nested suite/test tree from the
 * ` > `-joined names, assigns Vitest-compatible stable ids via the official
 * `@vitest/runner/utils` helpers (NEVER hand-rolled — ids must match Vitest's
 * own scheme so reruns and reporter lookups line up), and emits the result
 * packs Vitest consumes.
 *
 * Pure functions only — no CDP, no Node IO. This keeps the synthesis unit
 * testable with a plain `RunReport` input (no phone/relay needed).
 *
 * Implementation note: like Vitest's own `createFileTask`, we build structural
 * task objects and fill only the fields reporters read (id/name/type/mode/meta/
 * result/tasks/suite/file). Runtime-only fields on `Test` (context/timeout/
 * annotations/artifacts) are never read off a reported task, so we satisfy the
 * type at a single explicit boundary rather than fabricating fake values.
 */

import type {
  File,
  Suite,
  Task,
  TaskEventPack,
  TaskResult,
  TaskResultPack,
  TaskState,
  Test,
} from '@vitest/runner';
import { calculateSuiteHash, createFileTask, generateHash } from '@vitest/runner/utils';
import type { RunReport, TestResult } from './runtime.js';

/** Separator the page runtime uses to join suite path + test name. */
const NAME_SEPARATOR = ' > ';

/**
 * Maps a page-runtime status to a Vitest {@link TaskState}.
 * `skip` collapses to Vitest's `skip` run-mode; `pass`/`fail` are terminal.
 */
function toTaskState(status: TestResult['status']): TaskState {
  switch (status) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'skip':
      return 'skip';
  }
}

/**
 * Builds a {@link TaskResult} for a finished test. Suites and files only carry
 * a result on collection/hook error (we leave those undefined — the page never
 * reports suite-level errors separately).
 */
function toTaskResult(t: TestResult): TaskResult {
  const result: TaskResult = {
    state: toTaskState(t.status),
    duration: t.duration,
  };
  if (t.status === 'fail') {
    // SECRET-HANDLING: `error` is the matcher message only — rpc.ts already
    // strips the expression/value before it reaches us. Pass it through as the
    // single error object Vitest reporters render.
    result.errors = [{ message: t.error ?? 'Test failed', name: 'AssertionError' }];
  }
  return result;
}

/**
 * Creates a structural suite task under `parent`. Mirrors the partial-object
 * pattern Vitest uses in `createFileTask`; ids are assigned by
 * `calculateSuiteHash` afterwards.
 */
function makeSuite(parent: Suite, file: File, name: string): Suite {
  const suite: Suite = {
    id: '',
    type: 'suite',
    name,
    fullName: '',
    mode: 'run',
    meta: {},
    file,
    suite: parent,
    tasks: [],
  };
  return suite;
}

/**
 * Finds-or-creates a child suite named `name` under `parent`.
 * The caller recomputes ids once the whole file tree is built.
 */
function ensureSuite(parent: Suite, file: File, name: string): Suite {
  const existing = parent.tasks.find((t): t is Suite => t.type === 'suite' && t.name === name);
  if (existing) return existing;
  const suite = makeSuite(parent, file, name);
  parent.tasks.push(suite);
  return suite;
}

/**
 * Creates a structural test task and appends it to `parent`.
 *
 * `Test` carries runtime-only required fields (context/timeout/annotations/
 * artifacts) that are never read off a *reported* task — reporters consume
 * id/name/type/mode/result/suite/file. We satisfy the type at this one cast
 * boundary instead of fabricating fake runtime values.
 */
function appendTest(parent: Suite, file: File, t: TestResult, name: string): void {
  const test = {
    id: '',
    type: 'test',
    name,
    fullName: '',
    mode: t.status === 'skip' ? 'skip' : 'run',
    meta: {},
    file,
    suite: parent,
    result: toTaskResult(t),
    annotations: [],
    // `Test` has runtime-only required fields (context/timeout/artifacts)
    // populated by Vitest at execution time and never read off a *reported*
    // task. We satisfy the type via `unknown` (not `any`) at this single
    // boundary, mirroring how Vitest's own createFileTask builds a partial
    // structural task object.
  } as unknown as Test;
  parent.tasks.push(test);
}

/**
 * Rebuilds a single `File` task graph from one file's flat `RunReport`.
 *
 * @param filepath    Absolute path to the test file.
 * @param root        Project root (used for the file id hash).
 * @param projectName Vitest project name (or undefined for the default project).
 * @param pool        Pool name to stamp on the file task (our relay pool name).
 * @param report      The page-runtime report for this file.
 */
export function synthesizeFileTask(
  filepath: string,
  root: string,
  projectName: string | undefined,
  pool: string,
  report: RunReport,
): File {
  // createFileTask assigns the canonical stable file id (generateFileHash on the
  // root-relative path + projectName) and self-references file.file = file.
  const file = createFileTask(filepath, root, projectName, pool);

  for (const t of report.tests) {
    const segments = t.name.split(NAME_SEPARATOR);
    const testName = segments.pop() ?? t.name;
    let parent: Suite = file;
    for (const suiteName of segments) {
      parent = ensureSuite(parent, file, suiteName);
    }
    appendTest(parent, file, t, testName);
  }

  // Assign Vitest-stable position-based ids to every suite/test under the file
  // (file id stays as createFileTask set it).
  calculateSuiteHash(file);

  // Surface a file-level error result when the whole file failed to run with no
  // collected tests (bundle/inject error path surfaces as a synthetic file).
  if (report.tests.length === 0 && report.failed > 0) {
    file.result = { state: 'fail', errors: [{ message: 'File failed to run', name: 'Error' }] };
  }

  return file;
}

/**
 * Flattens a File task subtree into the {@link TaskResultPack} tuples Vitest's
 * `state.updateTasks` consumes: `[id, result, meta]`.
 *
 * Includes every task (file, suites, tests). Suites/files without a result
 * report `undefined` in the result slot — Vitest tolerates that.
 */
export function toTaskResultPacks(file: File): TaskResultPack[] {
  const packs: TaskResultPack[] = [];
  // Note: a File task also has `type: 'suite'` (File extends Suite) — the suite
  // branch covers both, so we never need a separate 'file' check.
  const walk = (task: Task): void => {
    packs.push([task.id, task.result, task.meta]);
    if (task.type === 'suite') {
      for (const child of task.tasks) walk(child);
    }
  };
  walk(file);
  return packs;
}

/**
 * Builds the {@link TaskEventPack} sequence reporters expect: a `suite-prepare`
 * before a suite's children, `test-prepare`/`test-finished` per test, and a
 * `suite-finished` after. This drives reporter progress output.
 */
export function toTaskEventPacks(file: File): TaskEventPack[] {
  const events: TaskEventPack[] = [];
  // A File task also has `type: 'suite'`. Emit suite-prepare/finished for the
  // file and every nested suite; test-prepare/finished for each test.
  const isFile = (task: Task): boolean => task.type === 'suite' && task.file === task;
  const walk = (task: Task): void => {
    if (task.type === 'test') {
      events.push([task.id, 'test-prepare', undefined]);
      events.push([task.id, 'test-finished', undefined]);
      return;
    }
    // Don't emit suite events for the file root itself — reporters track the
    // module separately; only inner suites get suite-prepare/finished.
    const emitSuiteEvents = task.type === 'suite' && !isFile(task);
    if (emitSuiteEvents) {
      events.push([task.id, 'suite-prepare', undefined]);
    }
    for (const child of task.tasks) walk(child);
    if (emitSuiteEvents) {
      events.push([task.id, 'suite-finished', undefined]);
    }
  };
  walk(file);
  return events;
}

/**
 * Deterministic synthetic id for a file that failed before any task graph could
 * be built (bundle/inject error). Uses the same `generateHash` Vitest uses, on
 * the root-relative path + projectName, matching `generateFileHash` semantics so
 * the id is stable across runs and won't collide with real file ids.
 */
export function syntheticFileId(relativePath: string, projectName: string | undefined): string {
  return generateHash(`${relativePath}${projectName ?? ''}`);
}
