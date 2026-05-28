/**
 * Partner domain probes (read-only: check surface exists)
 */

import { partner } from '../../../src/mock/partner/index.js';
import type { Probe } from '../types.js';

export const partnerProbes: Probe[] = [
  {
    id: 'partner.addAccessoryButtonExists',
    domain: 'partner',
    async run() {
      return typeof partner.addAccessoryButton === 'function';
    },
  },
  {
    id: 'partner.removeAccessoryButtonExists',
    domain: 'partner',
    async run() {
      return typeof partner.removeAccessoryButton === 'function';
    },
  },
];
