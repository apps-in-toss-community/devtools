/**
 * Tests for createDevServer (issue #305 — dev/debug tool-surface unification).
 *
 * Verifies that:
 *   - `list_pages` shim returns the Vite dev URL with devMode: true.
 *   - `get_diagnostics` probes the state endpoint and returns mode metadata.
 *   - `measure_safe_area` reads safeAreaInsets from mock state.
 *   - `call_sdk("getOperationalEnvironment")` returns a mock-backed result.
 *   - `call_sdk` for unsupported methods returns ok:false with an informative error.
 *   - CDP-only tools (evaluate, take_screenshot, etc.) return tier-filter errors
 *     instead of "Unknown tool".
 *   - AIT.* tools continue to work.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
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

// ---- Tool list -------------------------------------------------------------

describe('createDevServer — tools/list', () => {
  it('exposes list_pages, get_diagnostics, measure_safe_area, call_sdk', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('list_pages');
      expect(names).toContain('get_diagnostics');
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
});

// ---- list_pages shim -------------------------------------------------------

describe('list_pages shim', () => {
  it('returns devMode: true with the Vite dev URL as a single-entry page', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'list_pages', arguments: {} });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      const parsed = JSON.parse(text ?? '{}');
      expect(parsed.devMode).toBe(true);
      expect(parsed.singleAttachModel).toBe(true);
      expect(parsed.tunnel).toMatchObject({ up: false });
      expect(Array.isArray(parsed.pages)).toBe(true);
      expect(parsed.pages).toHaveLength(1);
      expect(parsed.pages[0].url).toBe('http://localhost:5173');
    } finally {
      await cleanup();
    }
  });
});

// ---- get_diagnostics -------------------------------------------------------

describe('get_diagnostics', () => {
  it('returns mode: "dev" with endpoint metadata', async () => {
    // Use a source that overrides fetch to avoid real network calls.
    // We inject aitSource only — fetch inside buildDevDiagnostics uses global fetch.
    // Since there is no real server, we expect reachable: false.
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
      // isError may be true or false depending on fetch result — we only check shape.
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      expect(parsed.mode).toBe('dev');
      expect(parsed.mcpStateEndpoint).toContain('/api/ait-devtools/state');
      expect(parsed.environment).toMatchObject({ kind: 'mock' });
      // Either reachable (if lucky) or not — the field must exist.
      expect(typeof parsed.mockStateEndpointReachable).toBe('boolean');
    } finally {
      await cleanup();
    }
  });
});

// ---- measure_safe_area -----------------------------------------------------

describe('measure_safe_area shim', () => {
  it('returns source: "mock-vite" and reads sdkInsets from mock state', async () => {
    const source = new FakeAitSource({
      safeAreaInsets: { top: 54, bottom: 34, left: 0, right: 0 },
    });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      expect(parsed.source).toBe('mock-vite');
      expect(parsed.sdkInsetsSource).toBe('window.__ait');
      expect(parsed.sdkInsets).toMatchObject({ top: 54, bottom: 34, left: 0, right: 0 });
    } finally {
      await cleanup();
    }
  });

  it('returns sdkInsetsError when safeAreaInsets is absent from mock state', async () => {
    const source = new FakeAitSource({ safeAreaInsets: undefined });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      expect(parsed.source).toBe('mock-vite');
      expect(parsed.sdkInsets).toBeNull();
      expect(typeof parsed.sdkInsetsError).toBe('string');
    } finally {
      await cleanup();
    }
  });
});

// ---- call_sdk shim ---------------------------------------------------------

describe('call_sdk shim', () => {
  it('getOperationalEnvironment returns ok: true with mock state values', async () => {
    const source = new FakeAitSource({ environment: 'sandbox', appVersion: '2.5.0' });
    const { client, cleanup } = await setupDevClient(source);
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'getOperationalEnvironment', args: [] },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.value.environment).toBe('sandbox');
    } finally {
      await cleanup();
    }
  });

  it('unsupported method returns ok: false with dev-mode-unsupported error', async () => {
    const { client, cleanup } = await setupDevClient();
    try {
      const result = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'navigate', args: [] },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const parsed = JSON.parse(text);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(/dev-mode-unsupported/);
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
