/**
 * Navigation domain probes (read-only navigation state queries)
 */

import { getTossShareLink, requestReview } from '../../../src/mock/navigation/index.js';
import type { Probe } from '../types.js';

export const navigationProbes: Probe[] = [
  {
    id: 'nav.getTossShareLink',
    domain: 'navigation',
    async run() {
      return await getTossShareLink('/test-path');
    },
  },
  {
    id: 'nav.requestReviewIsSupported',
    domain: 'navigation',
    async run() {
      return requestReview.isSupported();
    },
  },
];
