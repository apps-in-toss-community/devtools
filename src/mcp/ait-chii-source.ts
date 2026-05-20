/**
 * Debug-mode `AitSource` — forwards `AIT.*` methods over the Chii channel.
 *
 * The AIT domain (`AIT.getSdkCallHistory` / `getMockState` /
 * `getOperationalEnvironment`) is non-standard CDP: the in-app side registers a
 * handler for these methods and answers them over the same Chii websocket the
 * CDP commands use. Building the AIT source on `ChiiCdpConnection.sendCommand`
 * means both domains share one transport (spec: "the same MCP server forwards
 * both CDP and AIT domains").
 *
 * The in-app `AIT.*` handler lives downstream in sdk-example. Here we build
 * the MCP-server-side forwarding + the injectable seam; tests inject a fake
 * `AitSource` returning canned responses, so this forwarding layer needs no
 * phone.
 *
 * Node-only (wraps the relay websocket connection).
 */

import type {
  AitMethodMap,
  AitMethodName,
  AitMockState,
  AitOperationalEnvironment,
  AitSdkCallHistory,
  AitSource,
} from './ait-source.js';

/** The slice of `ChiiCdpConnection` this source needs (keeps it testable). */
export interface AitCommandSender {
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrows an `AIT.getSdkCallHistory` response, tolerating a missing array. */
function asSdkCallHistory(raw: unknown): AitSdkCallHistory {
  if (isObject(raw) && Array.isArray(raw.calls)) {
    return { calls: raw.calls as AitSdkCallHistory['calls'] };
  }
  return { calls: [] };
}

/** Narrows an `AIT.getMockState` response to an opaque record. */
function asMockState(raw: unknown): AitMockState {
  return isObject(raw) ? raw : {};
}

/** Narrows an `AIT.getOperationalEnvironment` response. */
function asOperationalEnvironment(raw: unknown): AitOperationalEnvironment {
  const environment =
    isObject(raw) && typeof raw.environment === 'string' ? raw.environment : 'unknown';
  const sdkVersion = isObject(raw) && typeof raw.sdkVersion === 'string' ? raw.sdkVersion : null;
  return { environment, sdkVersion };
}

export class ChiiAitSource implements AitSource {
  constructor(private readonly sender: AitCommandSender) {}

  async get<M extends AitMethodName>(method: M): Promise<AitMethodMap[M]> {
    const raw = await this.sender.sendCommand(method);
    // The map's value type is resolved per-key below; the cast is the single
    // narrowing point (each branch returns the precise shape for `method`).
    switch (method) {
      case 'AIT.getSdkCallHistory':
        return asSdkCallHistory(raw) as AitMethodMap[M];
      case 'AIT.getMockState':
        return asMockState(raw) as AitMethodMap[M];
      case 'AIT.getOperationalEnvironment':
        return asOperationalEnvironment(raw) as AitMethodMap[M];
      default:
        throw new Error(`Unknown AIT method: ${String(method)}`);
    }
  }
}
