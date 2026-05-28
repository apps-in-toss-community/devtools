/**
 * All fidelity QA probes
 *
 * Probes are grouped by domain to match the existing src/mock/ subdirectory structure.
 */

import type { Probe } from '../types.js';
import { adsProbes } from './ads.js';
import { analyticsProbes } from './analytics.js';
import { authProbes } from './auth.js';
import { browserContextProbes } from './browser-context.js';
import { deviceProbes } from './device.js';
import { environmentProbes } from './environment.js';
import { gameProbes } from './game.js';
import { iapProbes } from './iap.js';
import { navigationProbes } from './navigation.js';
import { partnerProbes } from './partner.js';
import { permissionsProbes } from './permissions.js';
import { safeAreaProbes } from './safe-area.js';
import { storageProbes } from './storage.js';

export const PROBES: Probe[] = [
  ...environmentProbes,
  ...deviceProbes,
  ...safeAreaProbes,
  ...navigationProbes,
  ...storageProbes,
  ...permissionsProbes,
  ...browserContextProbes,
  ...authProbes,
  ...analyticsProbes,
  ...iapProbes,
  ...gameProbes,
  ...partnerProbes,
  ...adsProbes,
];

export type { Probe };
