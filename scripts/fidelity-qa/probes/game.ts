/**
 * Game domain probes (read-only)
 */

import { getGameCenterGameProfile } from '../../../src/mock/game/index.js';
import type { Probe } from '../types.js';

export const gameProbes: Probe[] = [
  {
    id: 'game.getGameCenterGameProfileNull',
    domain: 'game',
    async run() {
      // Default state is null (no profile set)
      return await getGameCenterGameProfile();
    },
  },
];
