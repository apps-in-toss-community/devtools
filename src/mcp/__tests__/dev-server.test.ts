/**
 * Tests for createDevServer (issue #305 — dev/debug tool-surface unification).
 *
 * Verifies that:
 *   - `list_pages` shim returns the Vite dev URL with devMode: true.
 *   - `get_debug_status` probes the state endpoint and returns mode metadata.
 *   - `measure_safe_area` reads safeAreaInsets from mock state.
 *   - `call_sdk("getOperationalEnvironment")` returns a mock-backed result.
 *   - `call_sdk` for unsupported methods returns ok:false with an informative error.
 *   - CDP-only tools (evaluate, take_screenshot, etc.) return tier-filter errors
 *     instead of "Unknown tool".
 *   - AIT.* tools continue to work.
 *   - issue #322: list_pages / get_debug_status / measure_safe_area / call_sdk
 *     responses are wrapped in ToolEnvelope {ok, data, meta} when compat mode off.
 *   - issue #322: AIT_MCP_COMPAT=chrome-devtools bypasses the envelope.
 *   - issue #323: start_attach appears in tools/list and returns a tier-filter
 *     error (with debug-mode hand-off hint) on call.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import { createDevServer } from '../server.js';

// ---- Fake AIT source -------------------------------------------------------

class FakeAitSource implements AitSource {
  private readonly mockState: Record<string, unknown>;

  constructor(overrides: Record<string, unknown> = {}) {
    this.mockState = {
      environment: 'sandbox',
      appVersion: '2.5.0',
      safeAreaInsets: { top: 44, bottom: 34, left: 0, right: 0 },
      sdkCallLog: [],
      ...overrides,
    };
  }

  get<M extends AitMethodName>(method: M): Promise<AitMethodMap[M]> {
    switch (method) {
      case 'AIT.getMockState':
        return Promise.resolve(this.mockState as AitMethodMap[M]);
      case 'AIT.getOperationalEnvironment':
        return Promise.resolve({
          environment: (this.mockState.environment as string) ?? 'sandbox',
          sdkVersion: (this.mockState.appVersion as string) ?? null,
        } as AitMethodMap[M]);
      case 'AIT.getSdkCallHistory':
        return Promise.resolve({ calls: [] } as unknown as AitMethodMap[M]);
      default:
        return Promise.reject(new Error(`Unknown method: ${String(method)}`));
    }
  }
}

// ---- Helper: wire server + client via InMemoryTransport --------------------

async function setupDevClient(aitSource?: AitSource): Promise<{
  client: Client;
  cleanup: () => Promise<void>;
}> {
  process.env.AIT_DEVTOOLS_URL = 'http://localhost:5173';

  const server = createDevServer({ aitSource: aitSource ?? new FakeAitSource() });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Parse the JSON text from the first content block of a tool result. */
function parseContent(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

// ---- Tool list -------------------------------------------------------------

describe('createDevServer — tools/list', () => {
  it('exposes list_pages, get_debug_status, measure_safe_area, call_sdk', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('list_pages');
      expect(names).toContain('get_debug_status');
      expect(names).toContain('measure_safe_area');
      expect(names).toContain('call_sdk');
    } finally {
      await cleanup();
    }
  });

  it('exposes CDP-only tier-filter stubs (evaluate, take_screenshot, etc.)', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('evaluate');
      expect(names).toContain('take_screenshot');
      expect(names).toContain('get_dom_document');
      expect(names).toContain('take_snapshot');
      expect(names).toContain('list_console_messages');
      expect(names).toContain('list_network_requests');
      expect(names).toContain('list_exceptions');
    } finally {
      await cleanup();
    }
  });

  it('exposes AIT.* tools', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('AIT.getMockState');
      expect(names).toContain('AIT.getOperationalEnvironment');
      expect(names).toContain('AIT.getSdkCallHistory');
    } finally {
      await cleanup();
    }
  });

  // issue #323 — Option B: Tier B tool must appear in dev-mode tools/list
  it('exposes start_attach (Tier B stub) so agents do not hit Unknown tool', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('start_attach');
    } finally {
      await cleanup();
    }
  });
});

// ---- list_pages shim -------------------------------------------------------

describe('list_pages shim', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });
  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  // issue #322 — envelope applied
  it('result is wrapped in ToolEnvelope {ok, data, meta} when compat off', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'list_pages', arguments: {} });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      expect(raw.ok).toBe(true);
      expect(raw.data).toBeDefined();
      const meta = raw.meta as Record<string, unknown>;
      expect(meta.tool).toBe('list_pages');
      expect(meta.env).toBe('mock');
      expect(meta.attached).toBe(true);
      expect(meta.contentType).toBe('json');
    } finally {
      await cleanup();
    }
  });

  // issue #322 — compat mode bypasses envelope
  it('returns raw payload (no envelope) when AIT_MCP_COMPAT=chrome-devtools', async () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'list_pages', arguments: {} });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      // Raw list_pages payload: pages, tunnel, devMode — NOT ok/meta.
      expect(raw.pages).toBeDefined();
      expect(raw.devMode).toBe(true);
      expect('ok' in raw).toBe(false);
      expect('meta' in raw).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('data.devMode is true with the Vite dev URL as a single-entry page', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'list_pages', arguments: {} });
      expect(result.isError).toBeFalsy();
      const envelope = parseContent(result) as Record<string, unknown>;
      const data = envelope.data as Record<string, unknown>;
      expect(data.devMode).toBe(true);
      expect(data.singleAttachModel).toBe(true);
      expect(data.tunnel).toMatchObject({ up: false });
      expect(Array.isArray(data.pages)).toBe(true);
      expect((data.pages as unknown[]).length).toBe(1);
      expect((data.pages as Array<{ url: string }>)[0]?.url).toBe('http://localhost:5173');
    } finally {
      await cleanup();
    }
  });
});

// ---- get_debug_status -------------------------------------------------------

describe('get_debug_status', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });
  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  // issue #322 — envelope applied
  it('result is wrapped in ToolEnvelope when compat off', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'get_debug_status', arguments: {} });
      const raw = parseContent(result) as Record<string, unknown>;
      expect(raw.ok).toBe(true);
      expect(raw.data).toBeDefined();
      const meta = raw.meta as Record<string, unknown>;
      expect(meta.tool).toBe('get_debug_status');
      expect(meta.env).toBe('mock');
      expect(meta.contentType).toBe('json');
    } finally {
      await cleanup();
    }
  });

  // issue #322 — compat mode bypasses envelope
  it('returns raw payload when AIT_MCP_COMPAT=chrome-devtools', async () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'get_debug_status', arguments: {} });
      const raw = parseContent(result) as Record<string, unknown>;
      expect(raw.mode).toBe('dev');
      expect('ok' in raw).toBe(false);
      expect('meta' in raw).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('data.mode is "dev" with endpoint metadata', async () => {
    // Since there is no real server, we expect reachable: false.
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'get_debug_status', arguments: {} });
      const raw = parseContent(result) as Record<string, unknown>;
      // When envelope is on, data is nested; compat off (default).
      const data = (raw.data ?? raw) as Record<string, unknown>;
      expect(data.mode).toBe('dev');
      expect(String(data.mcpStateEndpoint)).toContain('/api/ait-devtools/state');
      expect(data.environment).toMatchObject({ kind: 'mock' });
      expect(typeof data.mockStateEndpointReachable).toBe('boolean');
    } finally {
      await cleanup();
    }
  });
});

// ---- measure_safe_area -----------------------------------------------------

describe('measure_safe_area shim', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });
  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  // issue #322 — envelope applied
  it('result is wrapped in ToolEnvelope when compat off', async () => {
    const source = new FakeAitSource({
      safeAreaInsets: { top: 54, bottom: 34, left: 0, right: 0 },
    });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      expect(raw.ok).toBe(true);
      expect(raw.data).toBeDefined();
      const meta = raw.meta as Record<string, unknown>;
      expect(meta.tool).toBe('measure_safe_area');
      expect(meta.env).toBe('mock');
      expect(meta.contentType).toBe('json');
    } finally {
      await cleanup();
    }
  });

  // issue #322 — compat mode bypasses envelope
  it('returns raw payload when AIT_MCP_COMPAT=chrome-devtools', async () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    const source = new FakeAitSource({
      safeAreaInsets: { top: 44, bottom: 34, left: 0, right: 0 },
    });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      expect(raw.source).toBe('mock-vite');
      expect('ok' in raw).toBe(false);
      expect('meta' in raw).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('data.source is "mock-vite" and reads sdkInsets from mock state', async () => {
    const source = new FakeAitSource({
      safeAreaInsets: { top: 54, bottom: 34, left: 0, right: 0 },
    });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      const data = (raw.data ?? raw) as Record<string, unknown>;
      expect(data.source).toBe('mock-vite');
      expect(data.sdkInsetsSource).toBe('window.__ait');
      expect(data.sdkInsets).toMatchObject({ top: 54, bottom: 34, left: 0, right: 0 });
    } finally {
      await cleanup();
    }
  });

  it('data.sdkInsetsError when safeAreaInsets is absent from mock state', async () => {
    const source = new FakeAitSource({ safeAreaInsets: undefined });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      const data = (raw.data ?? raw) as Record<string, unknown>;
      expect(data.source).toBe('mock-vite');
      expect(data.sdkInsets).toBeNull();
      expect(typeof data.sdkInsetsError).toBe('string');
    } finally {
      await cleanup();
    }
  });
});

// ---- call_sdk shim ---------------------------------------------------------

describe('call_sdk shim', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });
  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  // issue #322 — envelope applied
  it('result is wrapped in ToolEnvelope when compat off', async () => {
    const source = new FakeAitSource({ environment: 'sandbox', appVersion: '2.5.0' });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'getOperationalEnvironment', args: [] },
      });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      expect(raw.ok).toBe(true);
      expect(raw.data).toBeDefined();
      const meta = raw.meta as Record<string, unknown>;
      expect(meta.tool).toBe('call_sdk');
      expect(meta.env).toBe('mock');
      expect(meta.contentType).toBe('json');
    } finally {
      await cleanup();
    }
  });

  // issue #322 — compat mode bypasses envelope
  it('returns raw payload when AIT_MCP_COMPAT=chrome-devtools', async () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    const source = new FakeAitSource({ environment: 'sandbox' });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'getOperationalEnvironment', args: [] },
      });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      // Raw call_sdk payload has ok/value at top level — NOT wrapped in meta.
      expect(raw.ok).toBe(true);
      expect('meta' in raw).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('getOperationalEnvironment returns ok: true with scalar value (via data)', async () => {
    const source = new FakeAitSource({ environment: 'sandbox', appVersion: '2.5.0' });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'getOperationalEnvironment', args: [] },
      });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      const data = raw.data as Record<string, unknown>;
      expect(data.ok).toBe(true);
      // value is a scalar string, not an object — aligns with relay/--target=local schema
      expect(data.value).toBe('sandbox');
    } finally {
      await cleanup();
    }
  });

  it('unsupported method returns data.ok: false with dev-mode-unsupported error', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'navigate', args: [] },
      });
      expect(result.isError).toBeFalsy();
      const raw = parseContent(result) as Record<string, unknown>;
      const data = raw.data as Record<string, unknown>;
      expect(data.ok).toBe(false);
      expect(String(data.error)).toMatch(/dev-mode-unsupported/);
    } finally {
      await cleanup();
    }
  });

  it('returns isError when name arg is missing', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

// ---- CDP-only tier-filter stubs --------------------------------------------

describe('CDP-only tools return tier-filter error (not Unknown tool)', () => {
  const CDP_ONLY = [
    'evaluate',
    'take_screenshot',
    'get_dom_document',
    'take_snapshot',
    'list_console_messages',
    'list_network_requests',
    'list_exceptions',
  ];

  for (const toolName of CDP_ONLY) {
    it(`${toolName} returns isError: true with dev-mode hint`, async () => {
      const { client, cleanup } = await setupDevClient();
      try {
        const result = await client.callTool({
          name: toolName,
          arguments: { expression: 'true', limit: 10 },
        });
        expect(result.isError).toBe(true);
        const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        // Should mention CDP unavailability and mode-switch hint.
        expect(text).toMatch(/dev-mode/);
        expect(text).not.toMatch(/알 수 없는 tool/);
      } finally {
        await cleanup();
      }
    });
  }
});

// ---- Tier B tool (start_attach) — issue #323 ---------------------------

describe('start_attach — Tier B recovery guidance (issue #323)', () => {
  it('returns isError: true with relay/debug mode hand-off hint', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://my-app?_deploymentId=abc' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      // Should mention relay requirement and mode-switch hint.
      expect(text).toMatch(/relay/);
      expect(text).toMatch(/--mode=debug/i);
      expect(text).not.toMatch(/알 수 없는 tool/);
    } finally {
      await cleanup();
    }
  });

  it('error message includes start_attach tool name', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://my-app?_deploymentId=abc' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('start_attach');
    } finally {
      await cleanup();
    }
  });
});

// ---- AIT.* tools still work ------------------------------------------------

describe('AIT.* tools — HTTP mock-state backed', () => {
  it('AIT.getMockState returns mock state', async () => {
    const source = new FakeAitSource({ environment: 'dev' });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'AIT.getMockState', arguments: {} });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      expect(parsed.environment).toBe('dev');
    } finally {
      await cleanup();
    }
  });

  it('devtools_get_mock_state alias works', async () => {
    const source = new FakeAitSource({ environment: 'dev' });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'devtools_get_mock_state', arguments: {} });
      expect(result.isError).toBeFalsy();
    } finally {
      await cleanup();
    }
  });
});
