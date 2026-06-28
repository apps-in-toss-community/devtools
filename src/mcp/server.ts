/**
 * @ait-co/devtools dev-mode MCP server (stdio).
 *
 * Exposes the live browser mock state from a running Vite dev server to AI
 * coding agents via the Model Context Protocol (MCP).
 *
 * Architecture:
 *   Browser (aitState) → Vite dev server endpoint (/api/ait-devtools/state)
 *                      ← HTTP GET ← this stdio MCP server ← AI agent
 *
 * The Vite endpoint is registered by the unplugin when `mcp: true` is set in
 * the plugin options (see `src/unplugin/index.ts`).
 *
 * Phase 3 tool-surface alignment: dev mode and debug mode now expose the same
 * `AIT.*` tools (`AIT.getMockState`, `AIT.getOperationalEnvironment`,
 * `AIT.getSdkCallHistory`). In dev mode they are backed by the HTTP mock-state
 * endpoint (see `HttpAitSource`); in debug mode by the Chii channel. So an AI
 * sees a coherent tool whether attached to a phone (debug) or a dev browser
 * (dev). `devtools_get_mock_state` (the original devtools#130 name) is kept as a
 * backward-compatible alias of `AIT.getMockState`.
 *
 * Issue #305 (M2-1) — dev/debug tool-surface unification:
 * dev-mode now also exposes `list_pages`, `get_debug_status`, `measure_safe_area`,
 * and `call_sdk` so the docs/qa/scenarios.md acceptance sequence
 * `list_pages → measure_safe_area → call_sdk` works in dev mode without
 * "Unknown tool" failures.
 *
 * - `list_pages`       — shim: returns the Vite dev URL as a single-entry array.
 * - `get_debug_status`  — dumps dev-mode server state (endpoint URL, last fetch
 *                        error, reachability, mode/environment metadata).
 * - `measure_safe_area`— reads safeAreaInsets from the mock state snapshot
 *                        (source: 'mock-vite').
 * - `call_sdk`         — reads mock state and builds a mock-equivalent result
 *                        using window.__ait.state for supported methods; returns
 *                        an explicit tier-filter error for methods that require
 *                        a live CDP bridge.
 * - CDP-only tools (`evaluate`, `take_screenshot`, `get_dom_document`,
 *                   `take_snapshot`, `list_console_messages`,
 *                   `list_network_requests`, `list_exceptions`) — return an
 *                   explicit tier-filter error explaining that CDP is unavailable
 *                   in dev-mode and pointing to `--mode=local` or `--mode=debug`.
 *
 * This module is reached via the `devtools-mcp --mode=dev` CLI entry (see
 * `cli.ts`); the default (no flag) bin mode is the debug-mode CDP/Chii server.
 *
 * Usage (in your MCP client config, e.g. Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "ait-devtools": {
 *         "command": "pnpm",
 *         "args": ["exec", "devtools-mcp", "--mode=dev"],
 *         "env": { "AIT_DEVTOOLS_URL": "http://localhost:5173" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HttpAitSource } from './ait-http-source.js';
import type { AitSource } from './ait-source.js';
import { wrapEnvelope } from './envelope.js';
import { mcpError, tierRejectionError } from './errors.js';
import {
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  isAitToolName,
  type ToolAvailability,
} from './tools.js';

/** Error message prefix for CDP-dependent tools called in dev-mode. */
const CDP_UNAVAILABLE_IN_DEV_MODE =
  'dev-mode에서는 CDP 연결이 없어 이 도구를 사용할 수 없습니다. ' +
  '실기기 또는 로컬 Chromium에 붙이려면 `devtools-mcp --mode=local` 또는 ' +
  '`devtools-mcp` (debug 모드 기본)로 전환하세요.';

/**
 * Tool descriptors served by the dev-mode server.
 *
 * All dev-mode tools are Tier C (both envs) per RFC #277 — the dev-mode server
 * itself is the mock-side embodiment of those Tier C tools. `availableIn` is
 * declared so the surface stays consistent with the debug-mode registry.
 *
 * Issue #305: CDP-only tools are also listed with explicit descriptions so
 * agents do not get "Unknown tool" failures — they get a clear tier-filter
 * error message instead.
 */
const DEV_TOOL_DEFINITIONS = [
  /* ------------------------------------------------------------------ */
  /* AIT.* tools — HTTP mock-state backed                                */
  /* ------------------------------------------------------------------ */
  {
    name: 'AIT.getMockState',
    description:
      'Returns the devtools mock state snapshot (window.__ait) from the running browser session — ' +
      'environment, permissions, location, auth, network, IAP, and more. Read-only. ' +
      'Requires the Vite dev server running with the @ait-co/devtools unplugin option `mcp: true`. ' +
      'Same tool as in debug mode, where the in-app side reports it over the AIT domain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'AIT.getOperationalEnvironment',
    description:
      'Returns the operational environment + SDK/app version derived from the dev mock state. ' +
      'Read-only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'AIT.getSdkCallHistory',
    description:
      'Returns the SDK call trace. In dev mode the HTTP mock-state endpoint records no trace, so ' +
      'this returns an empty list; in debug mode it is populated over the AIT domain. Read-only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'devtools_get_mock_state',
    description:
      'Backward-compatible alias of AIT.getMockState (the original devtools#130 name). Returns the ' +
      'current AIT DevTools mock state snapshot. Read-only. Prefer AIT.getMockState in new configs.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  /* ------------------------------------------------------------------ */
  /* Unified surface — dev-mode shims (issue #305)                       */
  /* ------------------------------------------------------------------ */
  {
    name: 'list_pages',
    description:
      'dev-mode: returns the Vite dev server URL as a single-entry page list. ' +
      'No CDP relay is involved — `tunnel.up` is always false and `devMode: true` marks ' +
      'this as a shim result. Call this first to confirm the dev server is reachable. ' +
      'In debug mode (`devtools-mcp` / `--mode=local`) this returns real attached pages.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'get_debug_status',
    description:
      'dev-mode: reports the current dev session state — Vite endpoint URL, last fetch ' +
      'timestamp/error, mock state endpoint reachability, mode ("dev"), and environment metadata — ' +
      'in one call. Use this any time to confirm what the dev server is doing or when its ' +
      'connection is suspect. In debug mode this returns tunnel/relay/attach status instead.',
    inputSchema: {
      type: 'object',
      properties: {
        recent_errors_limit: {
          type: 'number',
          description: 'Ignored in dev-mode (no error ring buffer). Present for schema parity.',
        },
      },
      required: [],
    },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'measure_safe_area',
    description:
      'dev-mode: reads safe-area insets from the mock state snapshot via the Vite endpoint. ' +
      'Returns `{ source: "mock-vite", sdkInsets, sdkInsetsSource: "window.__ait", ... }`. ' +
      'Values reflect what the DevTools panel reports at the time of the last state push. ' +
      'In debug mode this runs a Runtime.evaluate CDP probe on the attached page.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'call_sdk',
    description:
      'dev-mode: calls a mock SDK method via the Vite mock state endpoint. ' +
      'Supported methods read from window.__ait mock state (e.g. getOperationalEnvironment). ' +
      'Returns the same `{ok, value}` / `{ok, error}` envelope as debug mode. ' +
      'In debug mode this calls the real SDK via window.__sdkCall over CDP.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Mock SDK method name to call (e.g. "getOperationalEnvironment").',
        },
        args: {
          type: 'array',
          description: 'Arguments (ignored in dev-mode mock path; present for schema parity).',
          items: {},
        },
      },
      required: ['name'],
    },
    availableIn: 'both' as ToolAvailability,
  },
  /* ------------------------------------------------------------------ */
  /* Tier B tool — tier-filter stub (issue #323)                         */
  /*                                                                      */
  /* start_attach is relay-only (Tier B per RFC #277). Listing it        */
  /* here in dev-mode ensures agents don't hit "Unknown tool" and get a  */
  /* clear hand-off hint toward --mode=debug (station 2 → 3 seam).      */
  /* ------------------------------------------------------------------ */
  {
    name: 'start_attach',
    description:
      'Switches into a relay mode (if given), builds a self-attaching deep-link QR for a real device, ' +
      'and waits for the phone to attach — all in one call. ' +
      'NOT available in dev-mode — requires a live cloudflared relay (Tier B, relay-only). ' +
      'To use this tool: restart the MCP server with `--mode=debug` (or omit --mode) and set ' +
      'MCP_ENV=relay, then call start_attach to generate the QR for phone scanning. ' +
      'See: https://docs.aitc.dev/guides/debug-relay',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['local-browser', 'relay-sandbox', 'relay-staging'],
          description: 'Optional relay mode to switch into before attaching.',
        },
        scheme_url: {
          type: 'string',
          description:
            'The intoss-private:// URL from `ait deploy --scheme-only` (env 3/relay-staging).',
        },
        wait_timeout_seconds: {
          type: 'number',
          description:
            'Maximum seconds to wait for a page to attach (default 60, range 1–600). ' +
            'Invalid inputs fall back to default.',
        },
      },
      required: [],
    },
    availableIn: 'relay' as ToolAvailability,
  },
  /* ------------------------------------------------------------------ */
  /* CDP-only tools — tier-filter stubs so agents see a clear error      */
  /* instead of "Unknown tool" (issue #305)                              */
  /* ------------------------------------------------------------------ */
  {
    name: 'evaluate',
    description:
      'Evaluates an arbitrary JavaScript expression via CDP Runtime.evaluate. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug` for CDP access.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate.' },
      },
      required: ['expression'],
    },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'take_screenshot',
    description:
      'Captures a PNG screenshot via CDP Page.captureScreenshot. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'get_dom_document',
    description:
      'Returns the DOM tree via CDP DOM.getDocument. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'take_snapshot',
    description:
      'Captures a serialized page snapshot via CDP DOMSnapshot.captureSnapshot. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'list_console_messages',
    description:
      'Lists console messages captured via CDP Runtime.consoleAPICalled. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'list_network_requests',
    description:
      'Lists network requests captured via CDP Network events. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'list_exceptions',
    description:
      'Lists JS exceptions captured via CDP Runtime.exceptionThrown. ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum exceptions to return.' },
      },
      required: [],
    },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'run_tests',
    description:
      'Runs mini-app test files on the attached page over CDP (Runtime.evaluate). ' +
      'NOT available in dev-mode (no CDP connection). ' +
      'Switch to `--mode=local` or `--mode=debug`.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns or file paths to run.',
        },
        projectRoot: { type: 'string', description: 'Glob base directory.' },
        timeout_ms: { type: 'number', description: 'Per-file evaluate timeout in ms.' },
        // confirm removed (#665) — relay-live and LIVE guard removed.
      },
      required: ['files'],
    },
    availableIn: 'both' as ToolAvailability,
  },
] as const;

/** All tool names served in dev-mode (including tier-filter stubs). */
const DEV_TOOL_NAMES = new Set<string>(DEV_TOOL_DEFINITIONS.map((t) => t.name));

/** CDP-only tools — return a tier-filter error in dev-mode. */
const CDP_ONLY_TOOL_NAMES = new Set<string>([
  'evaluate',
  'take_screenshot',
  'get_dom_document',
  'take_snapshot',
  'list_console_messages',
  'list_network_requests',
  'list_exceptions',
  'run_tests',
]);

/**
 * Tier B tools — relay-only per RFC #277.
 * Listed in dev-mode tool surface (issue #323) so agents get a hand-off hint
 * toward `--mode=debug` instead of "Unknown tool".
 */
const TIER_B_TOOL_NAMES = new Set<string>(['start_attach']);

export interface CreateDevServerDeps {
  /** AIT source for the dev tools. Defaults to an HTTP source over the dev server. */
  aitSource?: AitSource;
}

/**
 * Builds the `list_pages` dev-mode shim response.
 * Returns the Vite dev URL as a single-entry page list with `devMode: true`.
 */
function buildDevListPagesResult(devtoolsUrl: string) {
  return {
    pages: [
      {
        url: devtoolsUrl,
        title: 'dev fixture',
        attached: true,
      },
    ],
    tunnel: { up: false },
    devMode: true,
    singleAttachModel: true,
  };
}

/**
 * Builds the `get_debug_status` dev-mode response.
 * Probes the mock state endpoint reachability and returns server metadata.
 */
async function buildDevDiagnostics(
  devtoolsUrl: string,
  stateEndpoint: string,
  fetchImpl: (url: string) => Promise<Response>,
): Promise<Record<string, unknown>> {
  let reachable = false;
  let lastFetchError: string | null = null;
  let lastFetchAt: string | null = null;

  try {
    const res = await fetchImpl(stateEndpoint);
    reachable = res.ok;
    lastFetchAt = new Date().toISOString();
    if (!res.ok) {
      lastFetchError = `HTTP ${res.status} ${res.statusText}`;
    }
  } catch (err) {
    lastFetchError = err instanceof Error ? err.message : String(err);
    lastFetchAt = new Date().toISOString();
  }

  return {
    mode: 'dev',
    devtoolsUrl,
    mcpStateEndpoint: stateEndpoint,
    mockStateEndpointReachable: reachable,
    lastFetchAt,
    lastFetchError,
    environment: {
      kind: 'mock',
      reason: 'dev-mode — Vite HTTP endpoint, no CDP connection',
    },
    nextRecommendedAction: reachable
      ? null
      : 'mock state endpoint가 응답하지 않습니다. Vite dev 서버가 `mcp: true` 옵션으로 실행 중인지 확인하고, 필요하면 dev 서버를 재시작하세요.',
  };
}

/**
 * Builds the `measure_safe_area` dev-mode response from mock state.
 * Reads `safeAreaInsets` from the AIT mock state and returns a parity-schema
 * result with `source: 'mock-vite'`.
 */
async function buildDevMeasureSafeArea(aitSource: AitSource): Promise<Record<string, unknown>> {
  const state = await aitSource.get('AIT.getMockState');
  const raw = state as Record<string, unknown>;

  // Extract safeAreaInsets from the mock state.
  const rawInsets = raw.safeAreaInsets;
  let sdkInsets: { top: number; right: number; bottom: number; left: number } | null = null;
  if (rawInsets !== null && typeof rawInsets === 'object' && !Array.isArray(rawInsets)) {
    const r = rawInsets as Record<string, unknown>;
    sdkInsets = {
      top: typeof r.top === 'number' ? r.top : 0,
      right: typeof r.right === 'number' ? r.right : 0,
      bottom: typeof r.bottom === 'number' ? r.bottom : 0,
      left: typeof r.left === 'number' ? r.left : 0,
    };
  }

  return {
    source: 'mock-vite',
    // CSS env() vars are not available from the server side — report zeros.
    cssEnv: { top: 0, right: 0, bottom: 0, left: 0 },
    sdkInsets,
    sdkInsetsSource: sdkInsets !== null ? 'window.__ait' : null,
    ...(sdkInsets === null
      ? { sdkInsetsError: 'window.__ait.state.safeAreaInsets not found in mock state snapshot' }
      : {}),
    // Viewport geometry is not available from server side.
    innerWidth: null,
    innerHeight: null,
    devicePixelRatio: null,
    userAgent: null,
    navBarHeight: null,
    navBarHeightSource: 'not-available-in-dev-mode',
  };
}

/**
 * Builds the `call_sdk` dev-mode response.
 *
 * Supported methods are served from the mock state snapshot. Unsupported
 * methods return `{ ok: false, error: 'dev-mode-unsupported: ...' }` so the
 * agent gets an informative message rather than a generic failure.
 */
async function buildDevCallSdk(
  methodName: string,
  aitSource: AitSource,
): Promise<Record<string, unknown>> {
  switch (methodName) {
    case 'getOperationalEnvironment': {
      const env = await aitSource.get('AIT.getOperationalEnvironment');
      return {
        ok: true,
        value: env.environment,
      };
    }
    default: {
      // For methods not readable from mock state, return a structured error.
      return {
        ok: false,
        error:
          `dev-mode-unsupported: "${methodName}"은 dev-mode에서 직접 호출할 수 없습니다. ` +
          'CDP bridge(window.__sdkCall)가 없으므로 실제 SDK 호출은 `--mode=local` 또는 ' +
          'debug 모드에서만 가능합니다. ' +
          '지원 메서드: getOperationalEnvironment (mock state에서 읽음).',
      };
    }
  }
}

/** Builds the dev-mode MCP server (does not connect a transport). */
export function createDevServer(deps: CreateDevServerDeps = {}): Server {
  const devtoolsUrl = process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';
  const stateEndpoint = `${devtoolsUrl}/api/ait-devtools/state`;
  const aitSource = deps.aitSource ?? new HttpAitSource({ stateEndpoint });

  const server = new Server(
    { name: 'ait-devtools', version: __VERSION__ },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: DEV_TOOL_DEFINITIONS.map((tool) => ({ ...tool })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!DEV_TOOL_NAMES.has(name)) {
      return mcpError(`알 수 없는 tool: ${name}`);
    }

    // CDP-only tools — tier-filter error with mode-switch hint.
    if (CDP_ONLY_TOOL_NAMES.has(name)) {
      return mcpError(`${name}: ${CDP_UNAVAILABLE_IN_DEV_MODE}`);
    }

    // Tier B tools (relay-only) — return a tier-filter error with a hand-off
    // hint toward --mode=debug so the station 2 → 3 seam is explicit.
    // (issue #323, Option B: list Tier B in dev tools/list + reject on call)
    if (TIER_B_TOOL_NAMES.has(name)) {
      return tierRejectionError(
        name,
        'relay',
        'mock',
        'dev-mode — Vite HTTP endpoint, no CDP/relay connection. ' +
          '`--mode=debug` (または `devtools-mcp` without --mode) + MCP_ENV=relay로 재시작하세요.',
      );
    }

    try {
      // `devtools_get_mock_state` is an alias of `AIT.getMockState`.
      const effective = name === 'devtools_get_mock_state' ? 'AIT.getMockState' : name;

      // AIT.* tools backed by HTTP mock-state endpoint.
      if (isAitToolName(effective)) {
        switch (effective) {
          case 'AIT.getMockState':
            return jsonResult(await getMockState(aitSource));
          case 'AIT.getOperationalEnvironment':
            return jsonResult(await getOperationalEnvironment(aitSource));
          case 'AIT.getSdkCallHistory':
            return jsonResult(await getSdkCallHistory(aitSource));
          default:
            return mcpError(`알 수 없는 tool: ${name}`);
        }
      }

      // Unified-surface tools (issue #305 shims).
      // Responses are wrapped in ToolEnvelope (issue #322) so agents use the
      // same {ok, data, meta} parser regardless of dev vs debug mode.
      switch (name) {
        case 'list_pages':
          return envelopeResult('list_pages', buildDevListPagesResult(devtoolsUrl));

        case 'get_debug_status':
          return envelopeResult(
            'get_debug_status',
            await buildDevDiagnostics(devtoolsUrl, stateEndpoint, (url) => fetch(url)),
          );

        case 'measure_safe_area':
          return envelopeResult('measure_safe_area', await buildDevMeasureSafeArea(aitSource));

        case 'call_sdk': {
          const sdkName = request.params.arguments?.name;
          if (typeof sdkName !== 'string' || sdkName === '') {
            return mcpError(
              'call_sdk: name 인자가 비어 있습니다. 호출할 메서드 이름을 전달하세요.',
            );
          }
          return envelopeResult('call_sdk', await buildDevCallSdk(sdkName, aitSource));
        }

        default:
          return mcpError(`알 수 없는 tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpError(
        `${name} 실패: ${message}\n` +
          'Vite dev 서버가 @ait-co/devtools unplugin `mcp: true` 옵션으로 실행 중인지 확인하세요. ' +
          'AIT_DEVTOOLS_URL 환경변수가 올바르게 설정됐는지도 확인하세요.',
      );
    }
  });

  return server;
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Wraps `value` in a `ToolEnvelope` (when compat mode is off) and returns it
 * as a text content block. In dev-mode `env` is always `'mock'` and
 * `attached` is always `true` (the Vite dev server is the single implicit
 * "attached" page).
 *
 * When `AIT_MCP_COMPAT=chrome-devtools` the envelope is skipped and the raw
 * value is returned — identical to `jsonResult` (0.1.x back-compat).
 */
function envelopeResult(tool: string, value: unknown) {
  const wrapped = wrapEnvelope(value, { tool, env: 'mock', attached: true });
  return { content: [{ type: 'text' as const, text: JSON.stringify(wrapped, null, 2) }] };
}

/** Builds the dev-mode server and connects it over stdio. */
export async function runDevServer(): Promise<void> {
  const server = createDevServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
