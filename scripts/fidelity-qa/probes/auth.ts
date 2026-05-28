/**
 * Auth domain probes (read-only)
 */

import {
  getAnonymousKey,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
} from '../../../src/mock/auth/index.js';
import type { Probe } from '../types.js';

export const authProbes: Probe[] = [
  {
    id: 'auth.getIsTossLoginIntegratedService',
    domain: 'auth',
    async run() {
      return await getIsTossLoginIntegratedService();
    },
  },
  {
    id: 'auth.getUserKeyForGame',
    domain: 'auth',
    async run() {
      const result = await getUserKeyForGame();
      // Normalize: return type indicator only (hash value varies)
      if (result === undefined || result === 'INVALID_CATEGORY' || result === 'ERROR') {
        return result;
      }
      return { type: result.type, hasHash: typeof result.hash === 'string' };
    },
  },
  {
    id: 'auth.getAnonymousKey',
    domain: 'auth',
    async run() {
      const result = await getAnonymousKey();
      if (result === undefined || result === 'ERROR') return result;
      return { type: result.type, hasHash: typeof result.hash === 'string' };
    },
  },
];
