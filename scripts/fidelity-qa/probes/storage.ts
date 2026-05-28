/**
 * Storage domain probes
 * Read-only: probe for unknown key returning null (checks storage is functional)
 * Write cycle: gated behind isWrite = true
 */

import { Storage } from '../../../src/mock/device/storage.js';
import type { Probe } from '../types.js';

const PROBE_KEY = '__fidelity_qa_probe_unknown_key';

export const storageProbes: Probe[] = [
  {
    id: 'storage.getItemUnknownKey',
    domain: 'storage',
    async run() {
      // Reading an unknown key — expected to return null in both mock and relay
      return await Storage.getItem(PROBE_KEY);
    },
  },
  {
    id: 'storage.writeReadDeleteCycle',
    domain: 'storage',
    isWrite: true,
    async run() {
      const key = `__fidelity_qa_probe_${Date.now()}`;
      const value = 'fidelity-qa-test-value';
      await Storage.setItem(key, value);
      const read = await Storage.getItem(key);
      await Storage.removeItem(key);
      const afterDelete = await Storage.getItem(key);
      return {
        writeReadMatch: read === value,
        deletedSuccessfully: afterDelete === null,
      };
    },
  },
];
