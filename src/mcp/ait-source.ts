/**
 * Injectable AIT-domain source for the MCP server (Phase 3).
 *
 * The `AIT.*` namespace covers what raw CDP cannot: SDK-call traces, the
 * devtools mock state, and the operational environment. The same MCP server
 * forwards both CDP and AIT domains, but the *transport* differs by mode:
 *
 *   - debug mode — forwarded over the Chii channel as `AIT.*` CDP-shaped
 *     commands (the in-app side implements the handler — a downstream concern).
 *   - dev mode   — backed by the Vite dev server's HTTP mock-state endpoint.
 *
 * Both modes implement this one interface so the AIT.* tools are mode-agnostic
 * and unit-testable with a fake that returns canned AIT responses. No phone and
 * no running dev server are needed in tests.
 */

/** One entry of the SDK-call trace returned by `AIT.getSdkCallHistory`. */
export interface AitSdkCall {
  /** SDK method name, e.g. `getOperationalEnvironment`, `saveBase64Data`. */
  method: string;
  /** Arguments passed to the call, serialized for transport. */
  args: unknown[];
  /** Milliseconds since epoch when the call was made. */
  timestamp: number;
  /** Outcome — resolved value, rejection error message, or still pending. */
  status: 'resolved' | 'rejected' | 'pending';
  /** Serialized resolved value when `status === 'resolved'`. */
  result?: unknown;
  /** Error message when `status === 'rejected'`. */
  error?: string;
}

/** Result of `AIT.getSdkCallHistory`. */
export interface AitSdkCallHistory {
  calls: AitSdkCall[];
}

/**
 * Result of `AIT.getMockState` — the `window.__ait` snapshot in dev mode.
 * The exact shape is the devtools `AitDevtoolsState`; the MCP layer forwards it
 * verbatim, so it is typed as an opaque record here rather than re-declaring
 * the panel's state shape (which would couple the MCP entry to the panel).
 */
export type AitMockState = Record<string, unknown>;

/** Result of `AIT.getOperationalEnvironment`. */
export interface AitOperationalEnvironment {
  /** `getOperationalEnvironment()` return value (e.g. `toss` | `sandbox` | …). */
  environment: string;
  /** Resolved SDK version, when the in-app side can report it. */
  sdkVersion: string | null;
}

/** Map of AIT method → result shape. Keeps the source `get` typed. */
export interface AitMethodMap {
  'AIT.getSdkCallHistory': AitSdkCallHistory;
  'AIT.getMockState': AitMockState;
  'AIT.getOperationalEnvironment': AitOperationalEnvironment;
}

export type AitMethodName = keyof AitMethodMap;

/**
 * Source of AIT-domain responses. Debug mode forwards over Chii; dev mode hits
 * the HTTP mock-state endpoint. Tests inject a fake returning canned values.
 */
export interface AitSource {
  get<M extends AitMethodName>(method: M): Promise<AitMethodMap[M]>;
}
