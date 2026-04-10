/**
 * Network Status mock (mode-aware helper)
 * navigation 모듈에서 사용. circular dep 방지를 위해 device에 위치.
 */

import { aitState, type NetworkStatus } from '../state.js';

/**
 * Web mode: uses navigator.connection.effectiveType (4g/3g/2g) and navigator.onLine.
 * Limitations: WIFI, 5G, WWAN cannot be detected via the Network Information API.
 * Falls back to state-based value when effectiveType is unavailable.
 */
export function getNetworkStatusByMode(): NetworkStatus | null {
  const mode = aitState.state.deviceModes.network;
  if (mode === 'mock') return null; // use default state-based logic
  if (mode === 'web') {
    if (!navigator.onLine) return 'OFFLINE';
    const conn = (navigator as unknown as Record<string, unknown>).connection as { effectiveType?: string } | undefined;
    if (conn?.effectiveType) {
      const mapping: Record<string, NetworkStatus> = { '4g': '4G', '3g': '3G', '2g': '2G', 'slow-2g': '2G' };
      return mapping[conn.effectiveType] ?? 'UNKNOWN';
    }
    return aitState.state.networkStatus;
  }
  // prompt mode: not supported for network, fall back to mock
  return null;
}
