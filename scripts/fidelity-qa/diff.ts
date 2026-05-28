/**
 * diff.ts — Compare mock vs relay probe results
 *
 * Labels:
 *   MATCH             — values are deeply equal
 *   EXPECTED_MISMATCH — mismatch listed in whitelist.json (known, acceptable)
 *   UNEXPECTED        — mismatch not in whitelist (potential regression, exit 1)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiffLabel, DiffResult, ProbeResult } from './types.js';

const __dir = dirname(fileURLToPath(import.meta.url));

interface WhitelistEntry {
  id: string;
  reason: string;
}

type Whitelist = WhitelistEntry[];

function loadWhitelist(): Whitelist {
  try {
    const raw = readFileSync(join(__dir, 'whitelist.json'), 'utf-8');
    return JSON.parse(raw) as Whitelist;
  } catch {
    return [];
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keysA = Object.keys(ao);
  const keysB = Object.keys(bo);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqual(ao[k], bo[k]));
}

export function diffResults(mockResults: ProbeResult[], relayResults: ProbeResult[]): DiffResult[] {
  const whitelist = loadWhitelist();
  const relayMap = new Map(relayResults.map((r) => [r.id, r]));

  return mockResults.map((mock): DiffResult => {
    const relay = relayMap.get(mock.id);
    const relayValue = relay?.value ?? null;
    const isEqual = relay ? deepEqual(mock.value, relayValue) : false;

    let label: DiffLabel;
    let whitelistReason: string | undefined;

    if (isEqual) {
      label = 'MATCH';
    } else {
      const entry = whitelist.find((w) => w.id === mock.id);
      if (entry) {
        label = 'EXPECTED_MISMATCH';
        whitelistReason = entry.reason;
      } else {
        label = 'UNEXPECTED';
      }
    }

    return {
      id: mock.id,
      domain: mock.domain,
      mockValue: mock.value,
      relayValue,
      label,
      whitelistReason,
    };
  });
}

export function hasUnexpected(diffs: DiffResult[]): boolean {
  return diffs.some((d) => d.label === 'UNEXPECTED');
}
