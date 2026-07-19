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
      // devtools#780: getTossShareLink는 scheme 없는 bare path를 reject한다 — 이 probe는
      // 정상 호출 shape를 관측하는 것이 목적이라 유효 입력(scheme 포함)을 쓴다.
      return await getTossShareLink('intoss://test-path');
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
