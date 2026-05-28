/**
 * Permissions domain probes
 * Reads current permission status for all known permission names
 */

import { getPermission } from '../../../src/mock/permissions.js';
import type { PermissionName } from '../../../src/mock/types.js';
import type { Probe } from '../types.js';

const PERMISSION_NAMES: PermissionName[] = [
  'clipboard',
  'contacts',
  'photos',
  'geolocation',
  'camera',
  'microphone',
];

export const permissionsProbes: Probe[] = PERMISSION_NAMES.map((name) => ({
  id: `permissions.getPermission.${name}`,
  domain: 'permissions' as const,
  async run() {
    return await getPermission(name);
  },
}));
