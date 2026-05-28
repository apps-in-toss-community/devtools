/**
 * Environment domain probes
 * Tests SDK environment/runtime information APIs
 */

import { getIsTossLoginIntegratedService } from '../../../src/mock/auth/index.js';
import {
  env,
  getAppsInTossGlobals,
  getDeviceId,
  getGroupId,
  getLocale,
  getNetworkStatus,
  getOperationalEnvironment,
  getPlatformOS,
  getSchemeUri,
  getServerTime,
  getTossAppVersion,
  isMinVersionSupported,
} from '../../../src/mock/navigation/index.js';
import type { Probe } from '../types.js';

export const environmentProbes: Probe[] = [
  {
    id: 'env.getOperationalEnvironment',
    domain: 'environment',
    async run() {
      return getOperationalEnvironment();
    },
  },
  {
    id: 'env.getPlatformOS',
    domain: 'environment',
    async run() {
      return getPlatformOS();
    },
  },
  {
    id: 'env.getTossAppVersion',
    domain: 'environment',
    async run() {
      return getTossAppVersion();
    },
  },
  {
    id: 'env.getLocale',
    domain: 'environment',
    async run() {
      return getLocale();
    },
  },
  {
    id: 'env.getSchemeUri',
    domain: 'environment',
    async run() {
      return getSchemeUri();
    },
  },
  {
    id: 'env.getDeviceId',
    domain: 'environment',
    async run() {
      return getDeviceId();
    },
  },
  {
    id: 'env.getGroupId',
    domain: 'environment',
    async run() {
      return getGroupId();
    },
  },
  {
    id: 'env.getServerTime',
    domain: 'environment',
    async run() {
      const t = await getServerTime();
      // Normalize: return type indicator, not exact value (varies per run)
      return typeof t === 'number' ? '<timestamp>' : t;
    },
  },
  {
    id: 'env.getAppsInTossGlobals',
    domain: 'environment',
    async run() {
      return getAppsInTossGlobals();
    },
  },
  {
    id: 'env.envGetDeploymentId',
    domain: 'environment',
    async run() {
      return env.getDeploymentId();
    },
  },
  {
    id: 'env.isMinVersionSupported',
    domain: 'environment',
    async run() {
      return isMinVersionSupported({ android: '5.0.0', ios: '5.0.0' });
    },
  },
  {
    id: 'env.getNetworkStatus',
    domain: 'environment',
    async run() {
      return await getNetworkStatus();
    },
  },
  {
    id: 'env.getIsTossLoginIntegratedService',
    domain: 'environment',
    async run() {
      return await getIsTossLoginIntegratedService();
    },
  },
];
