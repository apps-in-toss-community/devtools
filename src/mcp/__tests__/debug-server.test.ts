/**
 * Tests for createDebugServer:
 *   - build_attach_url tool (QR, wait_for_attach)
 *   - Dynamic tool registration (issue #208):
 *     - listChanged capability declaration
 *     - Two-tier tools/list (bootstrap only vs. full)
 *     - startAttachWatcher: 0→N transition emits sendToolListChanged exactly once
 *
 * Uses MCP SDK InMemoryTransport + Client so the full request/response path
 * (including the async QR generation) is exercised without a real phone or
 * cloudflared binary.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import { createDebugServer, startAttachWatcher } from '../debug-server.js';
import type { McpEnvironment } from '../environment.js';
import type { TunnelStatus } from '../tools.js';
import { BOOTSTRAP_TOOL_NAMES, DEBUG_TOOL_DEFINITIONS } from '../tools.js';

// Stub `qrcode` so tests are deterministic and don't need a real QR matrix.
// The stub produces a 1x1 module matrix so the half-block loop runs but is cheap.
// Also stubs `toFile` for the PNG-write path.
vi.mock('qrcode', () => ({
  default: {
    create: (_input: string) => ({
      modules: {
        size: 1,
        data: new Uint8Array([1]),
      },
    }),
    toFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Stub node:fs for the HTML writeFileSync path.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, writeFileSync: vi.fn() };
});

// Stub node:child_process so tests never open a real browser.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawnSync: vi.fn().mockReturnValue({ status: 0, stderr: '', error: null }),
  };
});

// Mock canOpenBrowser → false so existing tests exercise the text-QR path.
// Tests that explicitly test the browser-open path override this per-test.
vi.mock('../tools.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tools.js')>();
  return { ...original, canOpenBrowser: vi.fn().mockReturnValue(false) };
});

// ---- Minimal fakes --------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
  private _targets: CdpTarget[];

  constructor(targets: CdpTarget[] = []) {
    this._targets = targets;
  }

  setTargets(targets: CdpTarget[]): void {
    this._targets = targets;
  }

  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this._targets;
  }
  getBufferedEvents<E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_method: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.reject(new Error('no canned result'));
  }
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_method: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

interface MakeClientOptions {
  getTunnelStatus: () => TunnelStatus;
  connection?: FakeCdpConnection;
  /** Override default 90s wait timeout — useful for timeout-path tests. */
  waitForAttachTimeoutMs?: number;
  /** Inject a fake QrHttpServer for open_in_browser path tests. */
  qrHttpServer?: import('../qr-http-server.js').QrHttpServer;
  /**
   * Pin the env reported by `getEnvironment()` for this server. Defaults to
   * `'relay-dev'` because this test file exercises relay-only tools (build_attach_url).
   * Set to `'mock'` for env-mismatch tests, `'relay-live'` for LIVE guard tests.
   */
  env?: McpEnvironment;
  /**
   * Hex-encoded TOTP secret for build_attach_url auto-splice tests.
   * When provided, the server will splice `at=<code>` into attachUrl.
   */
  totpSecret?: string;
}

/** Connects a createDebugServer instance via InMemoryTransport and returns a ready Client. */
async function makeClient({
  getTunnelStatus,
  connection,
  waitForAttachTimeoutMs,
  qrHttpServer,
  env = 'relay-dev',
  totpSecret,
}: MakeClientOptions): Promise<Client> {
  const server = createDebugServer({
    connection: connection ?? new FakeCdpConnection(),
    aitSource: new FakeAitSource(),
    getTunnelStatus,
    waitForAttachTimeoutMs,
    qrHttpServer,
    getEnvironment: () => env,
    getEnvironmentReason: () => `test-pinned-${env}`,
    ...(totpSecret !== undefined ? { totpSecret } : {}),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

/** Extracts the content array from a callTool result as typed text blocks. */
function getContent(result: Awaited<ReturnType<Client['callTool']>>) {
  return result.content as Array<{ type: string; text?: string }>;
}

// ---- Tests ----------------------------------------------------------------

describe('build_attach_url — response includes unicode QR', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('response text starts with the do-not-reprint instruction', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=test-uuid-1234',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = getContent(result);
    const text = content[0]!.text!;
    expect(text).toContain('do NOT re-print the QR below in your reply');
  });

  it('response text contains the attachUrl JSON and a QR string without ANSI escapes', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=test-uuid-1234',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = getContent(result);
    expect(content).toHaveLength(1);

    const block = content[0];
    expect(block).toBeDefined();
    expect(block!.type).toBe('text');

    const text = block!.text!;

    // JSON portion: must contain attachUrl and relayUrl keys.
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    expect(jsonMatch).toBeTruthy();
    const parsed = JSON.parse(jsonMatch![0]!);
    expect(parsed).toHaveProperty('attachUrl');
    expect(parsed).toHaveProperty('relayUrl');
    expect(parsed.relayUrl).toBe('wss://abc123.trycloudflare.com');
    // attachUrl must contain the relay and debug flag
    expect(parsed.attachUrl).toContain('debug=1');
    expect(parsed.attachUrl).toContain('relay=');

    // No ANSI escape codes (0x1b) in the response
    expect(text.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });

  it('response text is a single text content block (not split into two blocks)', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=xyz' },
    });

    const content = getContent(result);
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
  });

  it('returns isError when scheme_url is missing', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = getContent(result);
    expect(content[0]!.text).toMatch(/scheme_url/);
  });

  it('returns isError when tunnel is not up', async () => {
    const client = await makeClient({ getTunnelStatus: () => ({ up: false, wssUrl: null }) });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=xyz' },
    });

    expect(result.isError).toBe(true);
    const content = getContent(result);
    // 터널 미가동 에러는 한국어 "cloudflared 터널이 안 떠 있습니다" 메시지를 포함한다.
    expect(content[0]!.text).toContain('터널');
  });
});

describe('build_attach_url — wait_for_attach', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };
  // URL includes the deploymentId so the isMatchingPage filter passes.
  const fakeTarget: CdpTarget = {
    id: 'target-1',
    title: 'Test',
    url: 'intoss-private://miniapp?_deploymentId=wait-test',
  };

  it('returns attach page info when a target is already present', async () => {
    // Pre-populate connection with a target so polling resolves on the first poll.
    const connection = new FakeCdpConnection([fakeTarget]);
    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=wait-test',
        wait_for_attach: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // Should contain the pages result JSON with target info
    expect(text).toContain('target-1');
    expect(text).toContain('pages');
  });

  it('returns isError with list_pages hint after timeout when no page attaches', async () => {
    // Use a tiny timeout (50ms) so the test finishes quickly without fake timers
    // (fake timers conflict with MCP SDK's own request timeout mechanism).
    const connection = new FakeCdpConnection([]); // never gets a target
    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
      waitForAttachTimeoutMs: 50,
    });

    const result = await client.callTool(
      {
        name: 'build_attach_url',
        arguments: {
          scheme_url: 'intoss-private://miniapp?_deploymentId=timeout-test',
          wait_for_attach: true,
        },
      },
      undefined,
      // Give the MCP client enough timeout for our 50ms server-side wait + overhead
      { timeout: 5000 },
    );

    expect(result.isError).toBe(true);
    const text = getContent(result)[0]!.text!;
    expect(text).toContain('list_pages');
  });

  it('response includes QR and do-not-reprint instruction even when wait_for_attach is true and attach succeeds', async () => {
    // Use a target whose URL matches the deploymentId in scheme_url.
    const qrTarget: CdpTarget = {
      id: 'target-qr',
      title: 'Test',
      url: 'intoss-private://miniapp?_deploymentId=wait-qr-test',
    };
    const connection = new FakeCdpConnection([qrTarget]);
    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=wait-qr-test',
        wait_for_attach: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    expect(text).toContain('do NOT re-print the QR below in your reply');
    // No ANSI escape codes (0x1b)
    expect(text.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });

  it('does not call enableDomains during wait_for_attach polling', async () => {
    // enableDomains being called would imply an attach check via CDP domain
    // negotiation, which is wrong — listTargets is a buffered read.
    // Target URL must match the deploymentId so polling resolves immediately.
    const spyTarget: CdpTarget = {
      id: 'target-spy',
      title: 'Test',
      url: 'intoss-private://miniapp?_deploymentId=spy-test',
    };
    const connection = new FakeCdpConnection([spyTarget]);
    const enableDomainsSpy = vi.spyOn(connection, 'enableDomains');
    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
    });

    await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=spy-test',
        wait_for_attach: true,
      },
    });

    expect(enableDomainsSpy).not.toHaveBeenCalled();
  });

  // ---- deploymentId matching (#276) ----------------------------------------

  it('waits past a stale page and resolves only when a matching deploymentId page attaches', async () => {
    // Simulates the regression: a page from a previous session is already
    // attached (URL contains "old-deployment-id"), and a new QR carries
    // "new-deployment-fake-id". The polling loop must NOT break on the stale
    // page and must wait until the new page appears.
    const staleTarget: CdpTarget = {
      id: 'stale-target',
      title: 'Stale',
      url: 'intoss-private://miniapp?_deploymentId=old-deployment-id',
    };
    const freshTarget: CdpTarget = {
      id: 'fresh-target',
      title: 'Fresh',
      url: 'intoss-private://miniapp?_deploymentId=new-deployment-fake-id',
    };

    const connection = new FakeCdpConnection([staleTarget]); // stale page pre-attached

    // After 60ms the "phone" attaches a new page with the correct deploymentId.
    const attachTimer = setTimeout(() => {
      connection.setTargets([staleTarget, freshTarget]);
    }, 60);

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
      waitForAttachTimeoutMs: 2000,
    });

    try {
      const result = await client.callTool(
        {
          name: 'build_attach_url',
          arguments: {
            scheme_url: 'intoss-private://miniapp?_deploymentId=new-deployment-fake-id',
            wait_for_attach: true,
          },
        },
        undefined,
        { timeout: 5000 },
      );

      expect(result.isError).toBeFalsy();
      const text = getContent(result)[0]!.text!;
      // The result must reference the fresh target, not stale.
      expect(text).toContain('fresh-target');
    } finally {
      clearTimeout(attachTimer);
    }
  });

  it('timeout error includes expected deploymentId and observed page URLs when only stale pages are present', async () => {
    // The connection has a page from a previous session; the expected deploymentId
    // never appears within the timeout window → error message must be diagnostic.
    const staleTarget: CdpTarget = {
      id: 'stale-2',
      title: 'Stale 2',
      url: 'intoss-private://miniapp?_deploymentId=old-session-fake-id',
    };
    const connection = new FakeCdpConnection([staleTarget]);

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
      waitForAttachTimeoutMs: 50,
    });

    const result = await client.callTool(
      {
        name: 'build_attach_url',
        arguments: {
          scheme_url: 'intoss-private://miniapp?_deploymentId=expected-fake-id',
          wait_for_attach: true,
        },
      },
      undefined,
      { timeout: 5000 },
    );

    expect(result.isError).toBe(true);
    const text = getContent(result)[0]!.text!;
    // Must mention the expected deploymentId so the agent knows what to look for.
    expect(text).toContain('expected-fake-id');
    // Must list the observed stale URL so the agent can diagnose the mismatch.
    expect(text).toContain('old-session-fake-id');
    // Standard retry hint must still be present.
    expect(text).toContain('list_pages');
  });

  it('falls back to presence-only matching when scheme_url has no _deploymentId', async () => {
    // When deploymentId cannot be parsed (null fallback), any attached page satisfies.
    const anyTarget: CdpTarget = {
      id: 'any-target',
      title: 'Any',
      url: 'https://example.com/some-page',
    };
    const connection = new FakeCdpConnection([anyTarget]);

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      connection,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        // No _deploymentId query param — tests the null-fallback path.
        scheme_url: 'intoss-private://miniapp',
        wait_for_attach: true,
      },
    });

    // With null deploymentId, presence-only: any page satisfies → must succeed.
    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    expect(text).toContain('any-target');
  });
});

// ---------------------------------------------------------------------------
// Dynamic tool registration (issue #208)
// ---------------------------------------------------------------------------

describe('createDebugServer — listChanged capability', () => {
  it('server capabilities include tools.listChanged: true', async () => {
    const client = await makeClient({
      getTunnelStatus: () => ({ up: false, wssUrl: null }),
    });

    // The MCP Client.getServerCapabilities() returns the negotiated capabilities.
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect((caps?.tools as Record<string, unknown>).listChanged).toBe(true);
  });
});

describe('createDebugServer — two-tier tools/list', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };

  it('before attach: only bootstrap tools are listed', async () => {
    // No targets pre-populated → bootstrap tier only.
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));

    // Bootstrap tools must be present.
    for (const n of BOOTSTRAP_TOOL_NAMES) {
      expect(names.has(n), `bootstrap tool "${n}" should be listed`).toBe(true);
    }

    // Attach-dependent tools must NOT be present.
    const attachDependentExpected = DEBUG_TOOL_DEFINITIONS.filter(
      (t) => !BOOTSTRAP_TOOL_NAMES.has(t.name),
    );
    for (const t of attachDependentExpected) {
      expect(
        names.has(t.name),
        `attach-dependent tool "${t.name}" should NOT be listed pre-attach`,
      ).toBe(false);
    }
  });

  it('after attach: full tool list is returned', async () => {
    const target: CdpTarget = { id: 't1', title: 'Page', url: 'https://example.com' };
    const connection = new FakeCdpConnection([target]);
    const client = await makeClient({ getTunnelStatus: () => tunnelUp, connection });

    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));

    // All tools must be present.
    for (const t of DEBUG_TOOL_DEFINITIONS) {
      expect(names.has(t.name), `tool "${t.name}" should be listed post-attach`).toBe(true);
    }
  });

  it('tools/list count pre-attach equals BOOTSTRAP_TOOL_NAMES size', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(BOOTSTRAP_TOOL_NAMES.size);
  });

  it('tools/list count post-attach equals DEBUG_TOOL_DEFINITIONS length', async () => {
    const target: CdpTarget = { id: 't2', title: 'Page', url: 'https://example.com' };
    const connection = new FakeCdpConnection([target]);
    const client = await makeClient({ getTunnelStatus: () => tunnelUp, connection });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(DEBUG_TOOL_DEFINITIONS.length);
  });
});

describe('startAttachWatcher', () => {
  it('emits sendToolListChanged exactly once on 0→N transition', async () => {
    vi.useFakeTimers();
    try {
      const connection = new FakeCdpConnection([]); // starts with no targets
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      // Minimal server stub — only sendToolListChanged is needed.
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;

      const watcher = startAttachWatcher(connection, fakeServer, 100);

      // No transition yet — no emit expected.
      await vi.advanceTimersByTimeAsync(150);
      expect(sendToolListChanged).not.toHaveBeenCalled();

      // Now add a target — next tick should detect 0→N and emit once.
      const target: CdpTarget = { id: 'w1', title: 'Page', url: 'https://example.com' };
      connection.setTargets([target]);
      await vi.advanceTimersByTimeAsync(200);
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);

      // Further ticks should NOT emit again (watcher cleared after first emit).
      await vi.advanceTimersByTimeAsync(500);
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits immediately (once) if already attached when watcher starts', () => {
    vi.useFakeTimers();
    try {
      const target: CdpTarget = { id: 'w2', title: 'Page', url: 'https://example.com' };
      const connection = new FakeCdpConnection([target]); // already attached
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;

      const watcher = startAttachWatcher(connection, fakeServer, 100);
      // Immediate emit on construction.
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() prevents any further emissions after being called', async () => {
    vi.useFakeTimers();
    try {
      const connection = new FakeCdpConnection([]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;

      const watcher = startAttachWatcher(connection, fakeServer, 100);
      watcher.stop();

      // Add target and advance — interval is cleared, so no emit.
      const target: CdpTarget = { id: 'w3', title: 'Page', url: 'https://example.com' };
      connection.setTargets([target]);
      await vi.advanceTimersByTimeAsync(500);
      expect(sendToolListChanged).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls onFirstAttach exactly once on 0→N transition', async () => {
    vi.useFakeTimers();
    try {
      const connection = new FakeCdpConnection([]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onFirstAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onFirstAttach);

      await vi.advanceTimersByTimeAsync(150);
      expect(onFirstAttach).not.toHaveBeenCalled();

      const target: CdpTarget = { id: 'w4', title: 'Page', url: 'https://example.com' };
      connection.setTargets([target]);
      await vi.advanceTimersByTimeAsync(200);
      expect(onFirstAttach).toHaveBeenCalledTimes(1);

      // Further ticks should NOT call onFirstAttach again.
      await vi.advanceTimersByTimeAsync(500);
      expect(onFirstAttach).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls onFirstAttach immediately when already attached', () => {
    vi.useFakeTimers();
    try {
      const target: CdpTarget = { id: 'w5', title: 'Page', url: 'https://example.com' };
      const connection = new FakeCdpConnection([target]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onFirstAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onFirstAttach);
      expect(onFirstAttach).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// build_attach_url — open_in_browser reliability (#288)
// ---------------------------------------------------------------------------

describe('build_attach_url — open_in_browser headless fallback (#288)', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('when open_in_browser=true but canOpenBrowser()=false: response contains headless notice and text QR (no isError)', async () => {
    // canOpenBrowser is already mocked to false in this file's module-level mock.
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=headless-test',
        open_in_browser: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // 헤드리스 환경 안내 메시지가 포함되어야 함
    expect(text).toContain('GUI 환경이 감지되지 않았습니다');
    expect(text).toContain('open_in_browser=false로 자동 폴백');
    // 텍스트 QR 경로로 폴백 — attachUrl, relayUrl이 포함
    expect(text).toContain('attachUrl');
    expect(text).toContain('relayUrl');
  });

  it('when browser open succeeds: openResult.succeeded=true is in JSON', async () => {
    // canOpenBrowser를 true로 override하는 per-test mock
    const toolsMod = await import('../tools.js');
    (toolsMod.canOpenBrowser as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const fakeQrServer = {
      port: 19999,
      buildAttachPageUrl: (url: string) =>
        `http://127.0.0.1:19999/attach?u=${encodeURIComponent(url)}`,
      close: () => Promise.resolve(),
    } as import('../qr-http-server.js').QrHttpServer;

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      qrHttpServer: fakeQrServer,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=browser-ok-test',
        open_in_browser: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // openResult.succeeded: true가 JSON에 있어야 함
    expect(text).toContain('"succeeded": true');
    expect(text).toContain('브라우저에서 QR을 열었습니다');
  });

  it('when browser open fails: openResult.succeeded=false + pngUrl + failureReason in response', async () => {
    // canOpenBrowser를 true로 override + spawnSync 실패
    const toolsMod = await import('../tools.js');
    (toolsMod.canOpenBrowser as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      error: new Error('ENOENT'),
      stderr: '',
      status: null,
    });

    const fakeQrServer = {
      port: 19998,
      buildAttachPageUrl: (url: string) =>
        `http://127.0.0.1:19998/attach?u=${encodeURIComponent(url)}`,
      close: () => Promise.resolve(),
    } as import('../qr-http-server.js').QrHttpServer;

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      qrHttpServer: fakeQrServer,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=browser-fail-test',
        open_in_browser: true,
      },
    });

    // 브라우저 열기 실패해도 isError가 아님 — text QR fallback으로 graceful degrade
    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // openResult.succeeded: false
    expect(text).toContain('"succeeded": false');
    // pngUrl 안내 포함
    expect(text).toContain('PNG로 받기');
    // failureReason 포함
    expect(text).toContain('failureReason');
    // 브라우저 실패 안내 포함
    expect(text).toContain('[open_in_browser]');
  });
});

// ---------------------------------------------------------------------------
// build_attach_url — scheme authority warning (#221)
// ---------------------------------------------------------------------------

describe('build_attach_url — scheme authority warning', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('result text does not contain a warning for a well-formed scheme URL', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=valid-uuid',
        open_in_browser: false,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    expect(text).not.toContain('경고');
    expect(text).not.toContain('placeholder');
  });

  it('result text includes a warning when authority is "web" (generic placeholder)', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://web?_deploymentId=uuid',
        open_in_browser: false,
      },
    });

    // Should succeed but include a warning in the text.
    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    expect(text).toContain('경고');
    // Still produces a valid attach URL (non-fatal).
    expect(text).toContain('attachUrl');
  });

  it('result text includes a warning when authority is empty', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://?_deploymentId=uuid',
        open_in_browser: false,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    expect(text).toContain('경고');
  });
});

// ---------------------------------------------------------------------------
// build_attach_url — open_in_browser (#221)
// ---------------------------------------------------------------------------

describe('build_attach_url — open_in_browser', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('open_in_browser=false falls back to text QR (original behaviour)', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=uuid',
        open_in_browser: false,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // Text QR path: result should contain attachUrl JSON.
    expect(text).toContain('attachUrl');
    expect(text).toContain('relayUrl');
  });

  it('when canOpenBrowser() returns true and qrHttpServer is set, result shows HTTP URL (not raw attachUrl)', async () => {
    const { canOpenBrowser } = await import('../tools.js');
    (canOpenBrowser as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    // spawnSync를 명시적으로 성공으로 세팅 — 이전 테스트에서 오염되지 않도록.
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0, stderr: '', error: null });

    const fakeQrServer: import('../qr-http-server.js').QrHttpServer = {
      port: 19999,
      buildAttachPageUrl: (url) => `http://127.0.0.1:19999/attach?u=${encodeURIComponent(url)}`,
      close: async () => {},
    };

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      qrHttpServer: fakeQrServer,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=uuid',
        open_in_browser: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // Browser HTTP path: result mentions the HTTP URL, not the raw attachUrl.
    expect(text).toContain('http://127.0.0.1:19999/attach');
    expect(text).toContain('relayUrl');
    // SECRET: raw deep-link (debug=1) must NOT be in the plain text result.
    expect(text).not.toContain('debug=1');
  });

  it('when browser open fails, falls back to text QR with HTTP URL fallback message', async () => {
    const { canOpenBrowser } = await import('../tools.js');
    (canOpenBrowser as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    // Make spawnSync return an error for all candidates.
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      error: new Error('spawn ENOENT'),
    });

    const fakeQrServer: import('../qr-http-server.js').QrHttpServer = {
      port: 19999,
      buildAttachPageUrl: (url) => `http://127.0.0.1:19999/attach?u=${encodeURIComponent(url)}`,
      close: async () => {},
    };

    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      qrHttpServer: fakeQrServer,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=uuid',
        open_in_browser: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // Fallback: includes the "브라우저 자동 열기에 실패" note and HTTP URL.
    expect(text).toContain('브라우저 자동 열기에 실패했습니다');
    expect(text).toContain('http://127.0.0.1:19999/attach');
    // text QR fallback: attachUrl JSON should be in the QR path too.
    expect(text).toContain('attachUrl');
  });
});

// ---------------------------------------------------------------------------
// build_attach_url — TOTP auto-splice (#310)
// ---------------------------------------------------------------------------

describe('build_attach_url — TOTP auto-splice', () => {
  /** Dummy 32-byte hex secret — not a real secret value. */
  const DUMMY_SECRET = 'deadbeef'.repeat(8);
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('includes at=<6-digit-code> in attachUrl when totpSecret is set', async () => {
    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      totpSecret: DUMMY_SECRET,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=test-uuid',
        open_in_browser: false,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // attachUrl in the JSON must contain at=<6-digit-code>
    expect(text).toMatch(/at=\d{6}/);
  });

  it('includes totp.enabled=true in the JSON response', async () => {
    const client = await makeClient({
      getTunnelStatus: () => tunnelUp,
      totpSecret: DUMMY_SECRET,
    });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=test-uuid',
        open_in_browser: false,
      },
    });

    const text = getContent(result)[0]!.text!;
    // The totp block must be in the JSON output.
    expect(text).toContain('"enabled": true');
    expect(text).toContain('"ttlSeconds": 30');
    expect(text).toContain('"expiresAt"');
  });

  it('does NOT include at= in attachUrl when totpSecret is not set', async () => {
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=test-uuid',
        open_in_browser: false,
      },
    });

    const text = getContent(result)[0]!.text!;
    expect(text).not.toMatch(/[?&]at=\d/);
    expect(text).not.toContain('"totp"');
  });
});
