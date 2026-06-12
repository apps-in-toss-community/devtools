/**
 * Machine-level telemetry consent store — #542
 *
 * Persists consent to `~/.ait-devtools/telemetry.json` (Node.js side only).
 * This eliminates repeated consent prompts when the dev origin rotates
 * (quick-tunnel host changes per session, localhost port varies).
 *
 * Design invariants:
 *  - localStorage keys in src/telemetry/state.ts are LOCKED — this module does
 *    NOT replace them. It adds a machine-level overlay that takes precedence
 *    when a dev server is running.
 *  - Tier 0 / Tier 1 consent semantics are unchanged — only the storage
 *    location and lifetime change.
 *  - No PII. The file stores: consent enum + decided_at ISO timestamp +
 *    policy_version + anon_id (pseudonymous UUID).
 *  - anon_id is promoted to machine level so the same identity is used across
 *    all dev origins (prevents counting the same developer multiple times).
 *
 * Node.js-only: imported exclusively from the unplugin (server-side).
 * Never imported from panel/browser code.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConsentState } from './state.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface MachineTelemetryState {
  consent: ConsentState;
  /** ISO 8601 timestamp of the decision (or first-write). */
  decided_at: string;
  /** Policy version string at decision time. */
  policy_version: string;
  /**
   * Machine-level anon_id (UUID v4). Created once and never overwritten.
   * Promoted from per-origin localStorage to here so all dev origins share
   * a single pseudonymous identity.
   */
  anon_id: string | null;
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

/** Resolved directory: `~/.ait-devtools`. */
export function machineStateDir(homeOverride?: string): string {
  return join(homeOverride ?? homedir(), '.ait-devtools');
}

/** Resolved file: `~/.ait-devtools/telemetry.json`. */
export function machineStateFile(homeOverride?: string): string {
  return join(machineStateDir(homeOverride), 'telemetry.json');
}

// ---------------------------------------------------------------------------
// Dependency injection surface (injectable for tests)
// ---------------------------------------------------------------------------

export interface MachineStateFsDep {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, data: string, options?: { mode?: number }): void;
}

export interface MachineStateDeps {
  fs?: MachineStateFsDep;
  homeDir?: string;
  now?: () => string;
  randomUUID?: () => string;
  /**
   * Override for the TTY consent prompt. When provided, `ensureMachineConsent`
   * calls this instead of the real `promptTtyConsent` — useful in tests where
   * `process.stdin.isTTY` cannot be spied on.
   */
  promptConsent?: () => Promise<ConsentState>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function newUUID(): string {
  return crypto.randomUUID();
}

/**
 * Returns a minimal MachineStateFsDep using real `node:fs` synchronous APIs.
 * Resolved lazily to avoid pulling node:fs into non-Node environments.
 */
async function realFs(): Promise<MachineStateFsDep> {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  return { existsSync, mkdirSync, readFileSync, writeFileSync };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Reads the machine-level telemetry state.
 * Returns `null` when the file is absent or cannot be parsed.
 *
 * NODE-ONLY. Never call from browser/panel code.
 */
export async function readMachineState(
  deps?: MachineStateDeps,
): Promise<MachineTelemetryState | null> {
  const fs = deps?.fs ?? (await realFs());
  const filePath = machineStateFile(deps?.homeDir);

  if (!fs.existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'consent' in parsed &&
      typeof (parsed as { consent: unknown }).consent === 'string' &&
      ['granted', 'denied', 'undecided'].includes((parsed as { consent: string }).consent)
    ) {
      return parsed as MachineTelemetryState;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Writes (or patches) the machine-level telemetry state file.
 * Creates `~/.ait-devtools/` if it does not yet exist.
 *
 * NODE-ONLY. Never call from browser/panel code.
 */
export async function writeMachineState(
  patch: Partial<MachineTelemetryState>,
  deps?: MachineStateDeps,
): Promise<void> {
  const fs = deps?.fs ?? (await realFs());
  const dir = machineStateDir(deps?.homeDir);
  const filePath = machineStateFile(deps?.homeDir);
  const now = deps?.now ?? isoNow;
  const uuid = deps?.randomUUID ?? newUUID;

  // Ensure directory exists.
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Merge with existing state (if any).
  let existing: MachineTelemetryState | null = null;
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      existing = JSON.parse(raw) as MachineTelemetryState;
    } catch {
      // Corrupt file — overwrite.
    }
  }

  const base: MachineTelemetryState = existing ?? {
    consent: 'undecided',
    decided_at: now(),
    policy_version: '',
    anon_id: null,
  };

  const next: MachineTelemetryState = {
    ...base,
    ...patch,
    // Never overwrite an existing anon_id — generate one if creating fresh.
    anon_id: existing?.anon_id ?? patch.anon_id ?? uuid(),
    decided_at: now(),
  };

  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// TTY consent prompt (dev server only)
// ---------------------------------------------------------------------------

/**
 * Prompts the user in the terminal (stdin/stdout TTY) to accept or deny
 * telemetry consent — called once per machine on the first `pnpm dev` run.
 *
 * Returns the chosen `ConsentState`, or `'undecided'` when:
 *  - The TTY is not interactive (CI, headless, piped stdin).
 *  - The prompt times out.
 *  - An error occurs.
 *
 * NODE-ONLY. Called from the unplugin `configureServer` hook.
 */
export async function promptTtyConsent(): Promise<ConsentState> {
  // Guard: require an interactive terminal on both ends.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'undecided';
  }

  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const question = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  process.stdout.write(
    '\n[@ait-co/devtools] 익명 사용 통계를 보내도 될까요?\n' +
      '  버전·날짜만 수집하고 PII는 없습니다. 언제든 Environment 탭에서 끌 수 있어요.\n' +
      '  자세히: https://docs.aitc.dev/privacy\n' +
      '  (y) 네, 보낼게요  (n) 아니요  (무응답 시 보류 — 다음 기동 때 다시 물어요)\n',
  );

  let answer = '';
  try {
    // 30-second timeout — if the user ignores the prompt, default to 'undecided'.
    answer = await Promise.race([
      question('  > '),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 30_000)),
    ]);
  } catch {
    // readline error — stay undecided.
  } finally {
    rl.close();
  }

  const normalized = answer.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes' || normalized === '네' || normalized === 'ㅇ') {
    return 'granted';
  }
  if (normalized === 'n' || normalized === 'no' || normalized === '아니요' || normalized === 'ㄴ') {
    return 'denied';
  }
  // Empty / timeout / unrecognised → undecided (will be asked again next session).
  return 'undecided';
}

// ---------------------------------------------------------------------------
// Bootstrap helper — called from configureServer once dev server is ready
// ---------------------------------------------------------------------------

/**
 * Ensures the machine-level consent state is resolved.
 *
 * Algorithm:
 *  1. Read the machine file.
 *  2. If already decided (granted/denied) → return as-is (no re-prompt).
 *     Exception: granted + stale policy_version → revert to undecided (mirrors
 *     browser-side resolveEffectiveConsent).
 *  3. If undecided or absent → TTY-prompt once. Persist the answer (including
 *     'undecided' — the directory is guaranteed to exist for subsequent writes,
 *     and decided_at is set for potential future reprompt-window logic).
 *
 * Returns the resolved `MachineTelemetryState`. Callers decide what to do with it.
 *
 * NODE-ONLY.
 */
export async function ensureMachineConsent(
  policyVersion: string,
  deps?: MachineStateDeps,
): Promise<MachineTelemetryState> {
  const existing = await readMachineState(deps);

  if (existing?.consent === 'granted' || existing?.consent === 'denied') {
    // Policy-version bump: re-prompt only when previously granted (same logic as
    // browser-side resolveEffectiveConsent — denied stays denied on version change).
    if (existing.consent === 'granted' && existing.policy_version !== policyVersion) {
      await writeMachineState({ consent: 'undecided', policy_version: policyVersion }, deps);
      // Recurse: will now prompt the user.
      return ensureMachineConsent(policyVersion, deps);
    }
    return existing;
  }

  // Undecided or absent → prompt (use injected override in tests).
  const prompt = deps?.promptConsent ?? promptTtyConsent;
  const answer = await prompt();
  await writeMachineState({ consent: answer, policy_version: policyVersion }, deps);

  // Re-read to get the full written state (includes newly generated anon_id).
  return (await readMachineState(deps)) as MachineTelemetryState;
}
