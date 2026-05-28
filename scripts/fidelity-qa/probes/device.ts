/**
 * Device domain probes
 * Tests device information and capability APIs (read-only)
 */

import { getClipboardText } from '../../../src/mock/device/clipboard.js';
import { Accuracy, getCurrentLocation } from '../../../src/mock/device/location.js';
import { getNetworkStatusByMode } from '../../../src/mock/device/network.js';
import type { Probe } from '../types.js';

export const deviceProbes: Probe[] = [
  {
    id: 'device.getNetworkStatusByMode',
    domain: 'device',
    async run() {
      return getNetworkStatusByMode();
    },
  },
  {
    id: 'device.getCurrentLocation',
    domain: 'device',
    async run() {
      const loc = await getCurrentLocation({ accuracy: Accuracy.High });
      return {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        hasTimestamp: typeof loc.timestamp === 'number',
      };
    },
  },
  {
    id: 'device.getClipboardText',
    domain: 'device',
    async run() {
      return await getClipboardText();
    },
  },
];
