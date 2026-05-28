/**
 * SafeAreaInsets domain probes
 */

import { getSafeAreaInsets, SafeAreaInsets } from '../../../src/mock/navigation/index.js';
import { aitState } from '../../../src/mock/state.js';
import type { Probe } from '../types.js';

export const safeAreaProbes: Probe[] = [
  {
    id: 'safe-area.SafeAreaInsetsGet',
    domain: 'safe-area',
    async run() {
      return SafeAreaInsets.get();
    },
  },
  {
    id: 'safe-area.getSafeAreaInsets',
    domain: 'safe-area',
    async run() {
      return getSafeAreaInsets();
    },
  },
  {
    id: 'safe-area.SafeAreaInsetsSubscribeFirstEmit',
    domain: 'safe-area',
    async run() {
      return await new Promise<unknown>((resolve) => {
        const unsub = SafeAreaInsets.subscribe({
          onEvent: (data) => {
            unsub();
            resolve(data);
          },
        });
        // Trigger a state notification to get the first emit
        aitState.patch('safeAreaInsets', { ...aitState.state.safeAreaInsets });
      });
    },
  },
];
