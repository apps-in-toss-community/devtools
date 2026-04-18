/**
 * Analytics mock
 */

import { aitState } from '../state.js';

type Primitive = string | number | boolean | null | undefined | symbol;
type LoggerParams = { log_name?: string } & Record<string, Primitive>;

// Analytics methods return `Promise<void> | undefined` to match the original SDK signature,
// so they cannot use `async` (which always returns a Promise).
export const Analytics = {
  screen: (params?: LoggerParams): Promise<void> | undefined => {
    aitState.logAnalytics({ type: 'screen', params: params ?? {} });
    return Promise.resolve();
  },
  impression: (params?: LoggerParams): Promise<void> | undefined => {
    aitState.logAnalytics({ type: 'impression', params: params ?? {} });
    return Promise.resolve();
  },
  click: (params?: LoggerParams): Promise<void> | undefined => {
    aitState.logAnalytics({ type: 'click', params: params ?? {} });
    return Promise.resolve();
  },
};

export async function eventLog(params: {
  log_name: string;
  log_type: 'debug' | 'info' | 'warn' | 'error' | 'event' | 'screen' | 'impression' | 'click';
  params: Record<string, Primitive>;
}): Promise<void> {
  aitState.logAnalytics({
    type: params.log_type,
    params: { log_name: params.log_name, ...params.params },
  });
}
