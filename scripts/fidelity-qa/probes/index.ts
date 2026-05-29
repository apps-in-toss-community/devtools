/**
 * All fidelity QA probes
 *
 * Probes are grouped by domain to match the existing src/mock/ subdirectory structure.
 *
 * SCENARIO_PARITY_PROBES — 4-scenario MCP tool schema parity probes.
 * Activated by --scenario-parity flag in the CLI. These validate that
 * list_pages / measure_safe_area / call_sdk(getOperationalEnvironment)
 * return the same JSON envelope across all four environments.
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
import { scenarioParityProbes } from './scenario-parity.js';
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

/** Scenario parity probes — activated by --scenario-parity flag */
export const SCENARIO_PARITY_PROBES: Probe[] = scenarioParityProbes;

export type { Probe };
