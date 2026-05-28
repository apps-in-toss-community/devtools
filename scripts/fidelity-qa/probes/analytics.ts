/**
 * Analytics domain probes (read-only: check API surface exists and is callable)
 */

import { Analytics, eventLog } from '../../../src/mock/analytics/index.js';
import type { Probe } from '../types.js';

export const analyticsProbes: Probe[] = [
  {
    id: 'analytics.screenExists',
    domain: 'analytics',
    async run() {
      return typeof Analytics.screen === 'function';
    },
  },
  {
    id: 'analytics.impressionExists',
    domain: 'analytics',
    async run() {
      return typeof Analytics.impression === 'function';
    },
  },
  {
    id: 'analytics.clickExists',
    domain: 'analytics',
    async run() {
      return typeof Analytics.click === 'function';
    },
  },
  {
    id: 'analytics.eventLogExists',
    domain: 'analytics',
    async run() {
      return typeof eventLog === 'function';
    },
  },
];
