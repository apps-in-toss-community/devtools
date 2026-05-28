/**
 * Shared types for fidelity QA
 */

export type ProbeDomain =
  | 'environment'
  | 'device'
  | 'navigation'
  | 'safe-area'
  | 'storage'
  | 'permissions'
  | 'browser-context'
  | 'auth'
  | 'analytics'
  | 'iap'
  | 'game'
  | 'partner'
  | 'ads';

export interface Probe {
  /** Unique probe identifier, e.g. 'env.getOperationalEnvironment' */
  id: string;
  domain: ProbeDomain;
  run(): Promise<unknown>;
  /** If true, this probe mutates state (e.g. Storage write). Skipped unless --include-writes. */
  isWrite?: boolean;
}

export type DiffLabel = 'MATCH' | 'EXPECTED_MISMATCH' | 'UNEXPECTED';

export interface ProbeResult {
  id: string;
  domain: ProbeDomain;
  runner: string;
  value: unknown;
  error?: string;
}

export interface DiffResult {
  id: string;
  domain: ProbeDomain;
  mockValue: unknown;
  relayValue: unknown;
  label: DiffLabel;
  whitelistReason?: string;
}

export interface RunSummary {
  runner: string;
  results: ProbeResult[];
  errors: number;
  durationMs: number;
}
