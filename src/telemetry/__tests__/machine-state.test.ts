import { describe, expect, it } from 'vitest';
import {
  ensureMachineConsent,
  type MachineStateDeps,
  type MachineStateFsDep,
  type MachineTelemetryState,
  machineStateDir,
  machineStateFile,
  readMachineState,
  writeMachineState,
} from '../machine-state.js';

// ---------------------------------------------------------------------------
// Helpers: in-memory fake fs
// ---------------------------------------------------------------------------

function makeFakeFs(): MachineStateFsDep & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    existsSync: (path) => store.has(path),
    mkdirSync: (_path, _opts) => {
      /* no-op for directories in our fake */
    },
    readFileSync: (path) => {
      const v = store.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    writeFileSync: (path, data) => {
      store.set(path, data);
    },
  };
}

const FIXED_HOME = '/fake-home';
const FIXED_NOW = '2026-06-12T00:00:00.000Z';
const FIXED_UUID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

function deps(fs: MachineStateFsDep): MachineStateDeps {
  return { fs, homeDir: FIXED_HOME, now: () => FIXED_NOW, randomUUID: () => FIXED_UUID };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
describe('machineStateDir / machineStateFile', () => {
  it('uses FIXED_HOME when homeDir is overridden', () => {
    expect(machineStateDir(FIXED_HOME)).toBe(`${FIXED_HOME}/.ait-devtools`);
    expect(machineStateFile(FIXED_HOME)).toBe(`${FIXED_HOME}/.ait-devtools/telemetry.json`);
  });
});

// ---------------------------------------------------------------------------
// readMachineState
// ---------------------------------------------------------------------------
describe('readMachineState', () => {
  it('returns null when file does not exist', async () => {
    const fs = makeFakeFs();
    expect(await readMachineState(deps(fs))).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    const fs = makeFakeFs();
    fs.store.set(machineStateFile(FIXED_HOME), '{bad json}');
    expect(await readMachineState(deps(fs))).toBeNull();
  });

  it('returns null when consent field is missing', async () => {
    const fs = makeFakeFs();
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify({ decided_at: '2026-06-12' }));
    expect(await readMachineState(deps(fs))).toBeNull();
  });

  it('returns null when consent value is invalid', async () => {
    const fs = makeFakeFs();
    fs.store.set(
      machineStateFile(FIXED_HOME),
      JSON.stringify({ consent: 'yes', decided_at: FIXED_NOW }),
    );
    expect(await readMachineState(deps(fs))).toBeNull();
  });

  it('parses a valid granted file', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'granted',
      decided_at: FIXED_NOW,
      policy_version: '2026-05-18',
      anon_id: FIXED_UUID,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));
    expect(await readMachineState(deps(fs))).toEqual(state);
  });

  it('parses a valid undecided file', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'undecided',
      decided_at: FIXED_NOW,
      policy_version: '',
      anon_id: null,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));
    expect(await readMachineState(deps(fs))).toMatchObject({ consent: 'undecided' });
  });
});

// ---------------------------------------------------------------------------
// writeMachineState
// ---------------------------------------------------------------------------
describe('writeMachineState', () => {
  it('creates the directory and file when absent', async () => {
    const fs = makeFakeFs();
    await writeMachineState({ consent: 'granted', policy_version: '2026-05-18' }, deps(fs));
    const file = machineStateFile(FIXED_HOME);
    expect(fs.store.has(file)).toBe(true);
    const written = JSON.parse(fs.store.get(file) as string) as MachineTelemetryState;
    expect(written.consent).toBe('granted');
    expect(written.anon_id).toBe(FIXED_UUID);
    expect(written.decided_at).toBe(FIXED_NOW);
  });

  it('merges with existing state and preserves anon_id', async () => {
    const fs = makeFakeFs();
    const existingId = 'original-uuid-1111-2222-333333333333';
    const existing: MachineTelemetryState = {
      consent: 'granted',
      decided_at: '2026-01-01T00:00:00.000Z',
      policy_version: '2026-05-18',
      anon_id: existingId,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(existing));

    await writeMachineState({ consent: 'denied' }, deps(fs));

    const written = JSON.parse(
      fs.store.get(machineStateFile(FIXED_HOME)) as string,
    ) as MachineTelemetryState;
    expect(written.consent).toBe('denied');
    // anon_id must NOT be overwritten
    expect(written.anon_id).toBe(existingId);
    expect(written.decided_at).toBe(FIXED_NOW);
  });

  it('generates a fresh anon_id on first write', async () => {
    const fs = makeFakeFs();
    await writeMachineState({ consent: 'undecided', policy_version: '' }, deps(fs));
    const written = JSON.parse(
      fs.store.get(machineStateFile(FIXED_HOME)) as string,
    ) as MachineTelemetryState;
    expect(written.anon_id).toBe(FIXED_UUID);
  });
});

// ---------------------------------------------------------------------------
// ensureMachineConsent — already decided
// ---------------------------------------------------------------------------
describe('ensureMachineConsent — already decided', () => {
  it('returns existing granted state without prompting', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'granted',
      decided_at: FIXED_NOW,
      policy_version: '2026-05-18',
      anon_id: FIXED_UUID,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));

    const result = await ensureMachineConsent('2026-05-18', deps(fs));
    expect(result.consent).toBe('granted');
  });

  it('returns existing denied state without prompting', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'denied',
      decided_at: FIXED_NOW,
      policy_version: '2026-05-18',
      anon_id: FIXED_UUID,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));

    const result = await ensureMachineConsent('2026-05-18', deps(fs));
    expect(result.consent).toBe('denied');
  });

  it('stays denied even when policy_version changes (no re-prompt)', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'denied',
      decided_at: FIXED_NOW,
      policy_version: 'old-version',
      anon_id: FIXED_UUID,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));

    const result = await ensureMachineConsent('new-version', deps(fs));
    expect(result.consent).toBe('denied');
  });
});

// ---------------------------------------------------------------------------
// ensureMachineConsent — policy version bump re-prompts granted users
// ---------------------------------------------------------------------------

/** Injectable prompt that always returns 'undecided' (simulates non-TTY). */
const noTtyPrompt = async (): Promise<'granted' | 'denied' | 'undecided'> => 'undecided';

describe('ensureMachineConsent — policy version bump', () => {
  it('reverts granted to undecided when policy_version bumped', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'granted',
      decided_at: FIXED_NOW,
      policy_version: 'old-version',
      anon_id: FIXED_UUID,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));

    const result = await ensureMachineConsent('new-version', {
      ...deps(fs),
      promptConsent: noTtyPrompt,
    });
    expect(result.consent).toBe('undecided');
    // anon_id should be preserved
    expect(result.anon_id).toBe(FIXED_UUID);
  });
});

// ---------------------------------------------------------------------------
// ensureMachineConsent — absent / undecided → prompts (injected non-TTY stub)
// ---------------------------------------------------------------------------
describe('ensureMachineConsent — prompts with non-TTY stub', () => {
  it('writes undecided when file is absent and prompt returns undecided', async () => {
    const fs = makeFakeFs();
    const result = await ensureMachineConsent('2026-05-18', {
      ...deps(fs),
      promptConsent: noTtyPrompt,
    });
    expect(result.consent).toBe('undecided');
    expect(result.anon_id).toBe(FIXED_UUID);
  });

  it('writes undecided when file has undecided consent and prompt returns undecided', async () => {
    const fs = makeFakeFs();
    const state: MachineTelemetryState = {
      consent: 'undecided',
      decided_at: FIXED_NOW,
      policy_version: '2026-05-18',
      anon_id: FIXED_UUID,
    };
    fs.store.set(machineStateFile(FIXED_HOME), JSON.stringify(state));

    const result = await ensureMachineConsent('2026-05-18', {
      ...deps(fs),
      promptConsent: noTtyPrompt,
    });
    expect(result.consent).toBe('undecided');
    // Existing anon_id must be preserved
    expect(result.anon_id).toBe(FIXED_UUID);
  });

  it('writes granted when prompt returns granted', async () => {
    const fs = makeFakeFs();
    const result = await ensureMachineConsent('2026-05-18', {
      ...deps(fs),
      promptConsent: async () => 'granted',
    });
    expect(result.consent).toBe('granted');
    expect(result.policy_version).toBe('2026-05-18');
    expect(result.anon_id).toBe(FIXED_UUID);
  });
});
