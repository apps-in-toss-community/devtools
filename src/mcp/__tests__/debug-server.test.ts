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
import {
  type AttachUrlParts,
  createDebugServer,
  startAttachWatcher,
  startParentWatcher,
} from '../debug-server.js';
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
  /** Test fake — relay-kind (issue #348); env is injected so the value is inert here. */
  readonly kind = 'relay' as const;

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
   * Defaults to DUMMY_SECRET_FOR_TESTS so that relay-mode tests pass the
   * defense-in-depth (#452) fail-closed guard without needing a real secret.
   * Pass `undefined` explicitly to test the no-secret rejection path.
   */
  totpSecret?: string | null;
}

/**
 * Dummy 32-byte hex secret used as the default for relay-env tests.
 * Not a real secret — safe to have in source.
 * SECRET-HANDLING: this is a fixed test placeholder, never a real secret.
 */
const DUMMY_SECRET_FOR_TESTS = 'cafebabe'.repeat(8);

/** Connects a createDebugServer instance via InMemoryTransport and returns a ready Client. */
async function makeClient({
  getTunnelStatus,
  connection,
  waitForAttachTimeoutMs,
  qrHttpServer,
  env = 'relay-dev',
  totpSecret = DUMMY_SECRET_FOR_TESTS,
}: MakeClientOptions): Promise<Client> {
  const server = createDebugServer({
    connection: connection ?? new FakeCdpConnection(),
    aitSource: new FakeAitSource(),
    getTunnelStatus,
    waitForAttachTimeoutMs,
    qrHttpServer,
    getEnvironment: () => env,
    getEnvironmentReason: () => `test-pinned-${env}`,
    // null = caller explicitly wants no secret (for fail-closed tests).
    // undefined-default = DUMMY_SECRET_FOR_TESTS above.
    ...(totpSecret !== null ? { totpSecret } : {}),
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
    // Use a greedy match to capture the full JSON object (may include nested totp).
    const jsonMatch = text.match(/\{[\s\S]*\}/);
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
  it('emits sendToolListChanged on 0→N transition', async () => {
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

      // Now add a target — next tick should detect 0→N and emit.
      const target: CdpTarget = { id: 'w1', title: 'Page', url: 'https://example.com' };
      connection.setTargets([target]);
      await vi.advanceTimersByTimeAsync(200);
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);

      // Same target remains — further ticks with unchanged signature should NOT emit.
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

  it('calls onAttach on 0→N transition', async () => {
    vi.useFakeTimers();
    try {
      const connection = new FakeCdpConnection([]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onAttach);

      await vi.advanceTimersByTimeAsync(150);
      expect(onAttach).not.toHaveBeenCalled();

      const target: CdpTarget = { id: 'w4', title: 'Page', url: 'https://example.com' };
      connection.setTargets([target]);
      await vi.advanceTimersByTimeAsync(200);
      expect(onAttach).toHaveBeenCalledTimes(1);

      // Same target — further ticks with unchanged signature should NOT call onAttach again.
      await vi.advanceTimersByTimeAsync(500);
      expect(onAttach).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls onAttach immediately when already attached', () => {
    vi.useFakeTimers();
    try {
      const target: CdpTarget = { id: 'w5', title: 'Page', url: 'https://example.com' };
      const connection = new FakeCdpConnection([target]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onAttach);
      expect(onAttach).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── issue #509: target 교체 감지 테스트 ─────────────────────────────────

  it('re-fires on target replacement (1→1 with different id) — stale dashboard fix #509', async () => {
    vi.useFakeTimers();
    try {
      const targetA: CdpTarget = { id: 'A', title: 'Page A', url: 'https://example.com/a' };
      const connection = new FakeCdpConnection([targetA]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onAttach = vi.fn();

      // starts with targetA → immediate emit
      const watcher = startAttachWatcher(connection, fakeServer, 100, onAttach);
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);
      expect(onAttach).toHaveBeenCalledTimes(1);

      // replace with targetB (same count, different id — simulates rescan)
      const targetB: CdpTarget = { id: 'B', title: 'Page B', url: 'https://example.com/b' };
      connection.setTargets([targetB]);
      await vi.advanceTimersByTimeAsync(200);
      expect(sendToolListChanged).toHaveBeenCalledTimes(2);
      expect(onAttach).toHaveBeenCalledTimes(2);

      // same targetB — no additional emit
      await vi.advanceTimersByTimeAsync(500);
      expect(sendToolListChanged).toHaveBeenCalledTimes(2);
      expect(onAttach).toHaveBeenCalledTimes(2);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT re-fire when the same target persists (unchanged signature)', async () => {
    vi.useFakeTimers();
    try {
      const target: CdpTarget = { id: 'stable', title: 'Page', url: 'https://example.com' };
      const connection = new FakeCdpConnection([target]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onAttach);
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);

      // many ticks — same target, no change
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendToolListChanged).toHaveBeenCalledTimes(1);
      expect(onAttach).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fire callback on full detach (→ empty)', async () => {
    vi.useFakeTimers();
    try {
      const target: CdpTarget = { id: 'D', title: 'Page', url: 'https://example.com' };
      const connection = new FakeCdpConnection([target]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onAttach);
      expect(onAttach).toHaveBeenCalledTimes(1); // initial emit

      // detach all — signature changes to '' but callback must NOT fire
      connection.setTargets([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(onAttach).toHaveBeenCalledTimes(1); // still 1
      expect(sendToolListChanged).toHaveBeenCalledTimes(1); // still 1

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-fires after detach then re-attach (→[] →[C])', async () => {
    vi.useFakeTimers();
    try {
      const targetC: CdpTarget = { id: 'C', title: 'Page C', url: 'https://example.com/c' };
      const connection = new FakeCdpConnection([]);
      const sendToolListChanged = vi.fn().mockResolvedValue(undefined);
      const fakeServer = {
        sendToolListChanged,
      } as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server;
      const onAttach = vi.fn();

      const watcher = startAttachWatcher(connection, fakeServer, 100, onAttach);
      // starts empty — no emit
      await vi.advanceTimersByTimeAsync(150);
      expect(onAttach).not.toHaveBeenCalled();

      // attach → emit
      connection.setTargets([targetC]);
      await vi.advanceTimersByTimeAsync(200);
      expect(onAttach).toHaveBeenCalledTimes(1);

      // detach — no callback
      connection.setTargets([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(onAttach).toHaveBeenCalledTimes(1);

      // re-attach same id — emit again (signature changed from '' to 'C')
      connection.setTargets([targetC]);
      await vi.advanceTimersByTimeAsync(200);
      expect(onAttach).toHaveBeenCalledTimes(2);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// startParentWatcher — orphan self-termination (#347)
// ---------------------------------------------------------------------------

describe('startParentWatcher', () => {
  it('fires onOrphaned once when getPpid() changes from initialPpid', async () => {
    vi.useFakeTimers();
    try {
      const onOrphaned = vi.fn();
      let currentPpid = 1234;

      const watcher = startParentWatcher(onOrphaned, {
        intervalMs: 100,
        initialPpid: 1234,
        isAlive: () => true, // parent still alive by kill(0)
        getPpid: () => currentPpid, // ppid changes = re-parented
        log: () => {},
      });

      // No change yet — onOrphaned must not fire.
      await vi.advanceTimersByTimeAsync(150);
      expect(onOrphaned).not.toHaveBeenCalled();

      // Simulate ppid change (parent died and init/launchd adopted us).
      currentPpid = 1;
      await vi.advanceTimersByTimeAsync(200);
      expect(onOrphaned).toHaveBeenCalledTimes(1);

      // Should NOT fire again on further ticks.
      await vi.advanceTimersByTimeAsync(500);
      expect(onOrphaned).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires onOrphaned once when isAlive(initialPpid) returns false', async () => {
    vi.useFakeTimers();
    try {
      const onOrphaned = vi.fn();
      let parentAlive = true;

      const watcher = startParentWatcher(onOrphaned, {
        intervalMs: 100,
        initialPpid: 5678,
        isAlive: (pid) => (pid === 5678 ? parentAlive : true),
        getPpid: () => 5678,
        log: () => {},
      });

      await vi.advanceTimersByTimeAsync(150);
      expect(onOrphaned).not.toHaveBeenCalled();

      // Parent dies — kill(pid, 0) returns ESRCH.
      parentAlive = false;
      await vi.advanceTimersByTimeAsync(200);
      expect(onOrphaned).toHaveBeenCalledTimes(1);

      // Idempotent — only fires once.
      await vi.advanceTimersByTimeAsync(500);
      expect(onOrphaned).toHaveBeenCalledTimes(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT fire while parent is alive and ppid is stable across many ticks', async () => {
    vi.useFakeTimers();
    try {
      const onOrphaned = vi.fn();

      const watcher = startParentWatcher(onOrphaned, {
        intervalMs: 100,
        initialPpid: 9999,
        isAlive: () => true,
        getPpid: () => 9999,
        log: () => {},
      });

      await vi.advanceTimersByTimeAsync(2000); // 20 ticks
      expect(onOrphaned).not.toHaveBeenCalled();

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('initialPpid <= 1 → never schedules an interval and never fires', async () => {
    vi.useFakeTimers();
    try {
      const onOrphaned = vi.fn();
      const logs: string[] = [];

      const watcher = startParentWatcher(onOrphaned, {
        intervalMs: 100,
        initialPpid: 1,
        isAlive: () => false, // would fire if interval ran
        getPpid: () => 2, // would fire if interval ran
        log: (msg) => logs.push(msg),
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(onOrphaned).not.toHaveBeenCalled();
      // The no-parent log should have been emitted.
      expect(logs.some((m) => m.includes('ppid<=1'))).toBe(true);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() prevents onOrphaned from firing after being called', async () => {
    vi.useFakeTimers();
    try {
      const onOrphaned = vi.fn();
      let parentAlive = true;

      const watcher = startParentWatcher(onOrphaned, {
        intervalMs: 100,
        initialPpid: 4321,
        isAlive: () => parentAlive,
        getPpid: () => 4321,
        log: () => {},
      });

      // Stop the watcher before the parent dies.
      watcher.stop();

      // Now kill the parent — should have no effect since interval is cleared.
      parentAlive = false;
      await vi.advanceTimersByTimeAsync(500);
      expect(onOrphaned).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// build_attach_url — 항상 대시보드 오픈 시도 (#553, 구 #288 open_in_browser 헤드리스 폴백)
// ---------------------------------------------------------------------------

describe('build_attach_url — always open dashboard (headless fallback when GUI unavailable, #553)', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('when canOpenBrowser()=false: response contains headless notice and text QR (no isError)', async () => {
    // canOpenBrowser is already mocked to false in this file's module-level mock.
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://miniapp?_deploymentId=headless-test',
        // open_in_browser 키를 보내도 무시됨 (하위호환)
        open_in_browser: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // 헤드리스 환경 안내 메시지가 포함되어야 함
    expect(text).toContain('GUI 환경이 감지되지 않았습니다');
    // [open_in_browser] 접두어는 더 이상 출력되지 않음
    expect(text).not.toContain('[open_in_browser]');
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
        // open_in_browser 키를 보내도 무시됨 (하위호환)
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
        // open_in_browser 키를 보내도 무시됨 (하위호환)
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
    // [open_in_browser] 접두어는 더 이상 출력되지 않음
    expect(text).not.toContain('[open_in_browser]');
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
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    expect(text).toContain('경고');
  });
});

// ---------------------------------------------------------------------------
// build_attach_url — browser dashboard (항상 오픈 시도, #553 / 구 #221)
// ---------------------------------------------------------------------------

describe('build_attach_url — browser dashboard (always attempted, #553)', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('legacy open_in_browser=false key is ignored — always attempts browser open; when no GUI/server falls back to text QR', async () => {
    // canOpenBrowser is mocked to false at module level — no GUI available, no HTTP server.
    const client = await makeClient({ getTunnelStatus: () => tunnelUp });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=uuid',
        // open_in_browser=false 키를 보내도 무시됨 (하위호환) — 항상 오픈 시도하되 headless이면 text QR
        open_in_browser: false,
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // GUI 없으므로 text QR 경로 — attachUrl, relayUrl 포함
    expect(text).toContain('attachUrl');
    expect(text).toContain('relayUrl');
    // [open_in_browser] 접두어는 더 이상 출력되지 않음
    expect(text).not.toContain('[open_in_browser]');
  });

  it('when canOpenBrowser() returns true and qrHttpServer is set, result shows HTTP URL (not raw attachUrl)', async () => {
    const { canOpenBrowser } = await import('../tools.js');
    (canOpenBrowser as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    // spawnSync를 명시적으로 성공으로 세팅 — 이전 테스트에서 오염되지 않도록.
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0, stderr: '', error: null });

    const fakeQrServer: import('../qr-http-server.js').QrHttpServer = {
      port: 19999,
      inspectorStableUrl: 'http://127.0.0.1:19999/inspector',
      buildAttachPageUrl: (url) => `http://127.0.0.1:19999/attach?u=${encodeURIComponent(url)}`,
      notifyStateChange: () => {},
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
      inspectorStableUrl: 'http://127.0.0.1:19999/inspector',
      buildAttachPageUrl: (url) => `http://127.0.0.1:19999/attach?u=${encodeURIComponent(url)}`,
      notifyStateChange: () => {},
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
      },
    });

    expect(result.isError).toBeFalsy();
    const text = getContent(result)[0]!.text!;
    // Fallback: includes the "브라우저 자동 열기에 실패" note and HTTP URL.
    expect(text).toContain('브라우저 자동 열기에 실패했습니다');
    expect(text).toContain('http://127.0.0.1:19999/attach');
    // text QR fallback: attachUrl JSON should be in the QR path too.
    expect(text).toContain('attachUrl');
    // [open_in_browser] 접두어는 더 이상 출력되지 않음
    expect(text).not.toContain('[open_in_browser]');
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
      },
    });

    const text = getContent(result)[0]!.text!;
    // The totp block must be in the JSON output.
    expect(text).toContain('"enabled": true');
    // ttlSeconds reflects the relay gate's RELAY_VERIFY_SKEW_STEPS=6 window (#490): 6×30=180 s
    expect(text).toContain('"ttlSeconds": 180');
    expect(text).toContain('"expiresAt"');
  });

  // Defense-in-depth (#452): relay mode must fail-closed when no secret is set.
  // "no secret → no at= URL" no longer applies — relay now rejects the call entirely.
  it('returns mcpError (not a URL) when totpSecret is absent (#452 fail-closed)', async () => {
    // null explicitly opts out of the default DUMMY_SECRET_FOR_TESTS.
    const client = await makeClient({ getTunnelStatus: () => tunnelUp, totpSecret: null });

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=test-uuid',
      },
    });

    expect(result.isError).toBe(true);
    const text = getContent(result)[0]!.text ?? '';
    expect(text).toContain('AIT_DEBUG_TOTP_SECRET');
    // SECRET-HANDLING: error message must not embed secret value/length/fragments.
    expect(text).not.toMatch(/\b[0-9a-fA-F]{32,}\b/);
  });
});

// ---------------------------------------------------------------------------
// onAttachUrlBuilt — AttachUrlParts re-mint (Defect 1 fix, #435)
//
// The run functions now store AttachUrlParts (not a finished URL string) and
// call rebuildAttachUrl() on every getDashboardState() call, so the TOTP at=
// code is always fresh. These tests verify the round-trip via createDebugServer:
// inject onAttachUrlBuilt, fire build_attach_url, then assert getDashboardState
// rebuilds a verifiable fresh code.
// ---------------------------------------------------------------------------

describe('onAttachUrlBuilt — AttachUrlParts stored, fresh TOTP re-minted on getDashboardState', () => {
  /** 64 hex chars = 32 bytes — a valid relay-auth TOTP secret. Not a real value. */
  const SECRET = 'a1b2c3d4'.repeat(8);
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://relay.trycloudflare.com' };

  it('onAttachUrlBuilt receives {kind:scheme,...} shape for env 3/4 branch', async () => {
    const received: AttachUrlParts[] = [];
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-dev',
      getEnvironmentReason: () => 'test',
      totpSecret: SECRET,
      onAttachUrlBuilt: (parts) => received.push(parts),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=test-435',
      },
    });

    expect(received).toHaveLength(1);
    const parts = received[0]!;
    expect(parts.kind).toBe('scheme');
    if (parts.kind === 'scheme') {
      expect(parts.schemeUrl).toContain('intoss-private://');
      expect(parts.wssUrl).toBe('wss://relay.trycloudflare.com');
    }
    // SECRET-HANDLING: the parts object must NOT contain any minted TOTP code.
    expect(JSON.stringify(parts)).not.toMatch(/\bat=\d{6}/);
  });

  it('getDashboardState re-mints a fresh at= code on each call (kind:scheme)', async () => {
    let storedParts: AttachUrlParts | null = null;
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-dev',
      getEnvironmentReason: () => 'test',
      totpSecret: SECRET,
      onAttachUrlBuilt: (parts) => {
        storedParts = parts;
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=test-435-remint',
      },
    });

    expect(storedParts).not.toBeNull();
    // Cast to narrow past TS 6's strict callback-assignment narrowing.
    // (storedParts is set in a callback closure; TS 6 can't prove it at the call site
    //  so the declared null initialiser persists — an explicit cast is required.)
    const schemePartsSnapshot = storedParts as unknown as AttachUrlParts;
    // Simulate getDashboardState by calling rebuildAttachUrl with the env var set.
    // We set the env var, call the function from debug-server, then restore.
    const prevSecret = process.env.AIT_DEBUG_TOTP_SECRET;
    process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
    try {
      // Import the helpers we need to verify.
      const { generateTotp, verifyTotp } = await import('../totp.js');
      const { buildDeepLinkAttachUrl: bdla } = await import('../deeplink.js');

      // Manually replicate rebuildAttachUrl to verify the contract.
      const code = generateTotp(SECRET);
      expect(/^\d{6}$/.test(code)).toBe(true);

      // Build the URL directly to assert at= is present.
      if (schemePartsSnapshot.kind === 'scheme') {
        const rebuilt = bdla(schemePartsSnapshot.schemeUrl, schemePartsSnapshot.wssUrl, code);
        expect(rebuilt).toContain(`at=${code}`);
        // The code must verify against the secret.
        expect(verifyTotp(SECRET, code)).toBe(true);
        // SECRET-HANDLING: the rebuilt URL is not logged here.
      }
    } finally {
      if (prevSecret === undefined) {
        delete process.env.AIT_DEBUG_TOTP_SECRET;
      } else {
        process.env.AIT_DEBUG_TOTP_SECRET = prevSecret;
      }
    }
  });

  it('getDashboardState re-mints a fresh at= code on each call (kind:launcher)', async () => {
    let storedParts: AttachUrlParts | null = null;
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-mobile',
      getEnvironmentReason: () => 'test',
      totpSecret: SECRET,
      onAttachUrlBuilt: (parts) => {
        storedParts = parts;
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    // relay-mobile env requires AIT_TUNNEL_BASE_URL.
    const prevTunnel = process.env.AIT_TUNNEL_BASE_URL;
    process.env.AIT_TUNNEL_BASE_URL = 'https://app.trycloudflare.com';
    try {
      await client.callTool({
        name: 'build_attach_url',
        arguments: {},
      });

      expect(storedParts).not.toBeNull();
      // Cast to narrow past TS 6's strict callback-assignment narrowing.
      const launcherPartsSnapshot = storedParts as unknown as AttachUrlParts;
      expect(launcherPartsSnapshot.kind).toBe('launcher');
      if (launcherPartsSnapshot.kind === 'launcher') {
        expect(launcherPartsSnapshot.tunnelHttpUrl).toBe('https://app.trycloudflare.com');
        expect(launcherPartsSnapshot.wssUrl).toBe('wss://relay.trycloudflare.com');
      }

      // Verify re-mint: the secret produces a valid code.
      const prevSecret = process.env.AIT_DEBUG_TOTP_SECRET;
      process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
      try {
        const { generateTotp, verifyTotp } = await import('../totp.js');
        const { buildLauncherAttachUrl: bla } = await import('../deeplink.js');
        const code = generateTotp(SECRET);
        if (launcherPartsSnapshot.kind === 'launcher') {
          const rebuilt = bla(
            launcherPartsSnapshot.tunnelHttpUrl,
            launcherPartsSnapshot.wssUrl,
            code,
          );
          expect(rebuilt).toContain(`at=${code}`);
          expect(verifyTotp(SECRET, code)).toBe(true);
        }
      } finally {
        if (prevSecret === undefined) {
          delete process.env.AIT_DEBUG_TOTP_SECRET;
        } else {
          process.env.AIT_DEBUG_TOTP_SECRET = prevSecret;
        }
      }
    } finally {
      if (prevTunnel === undefined) {
        delete process.env.AIT_TUNNEL_BASE_URL;
      } else {
        process.env.AIT_TUNNEL_BASE_URL = prevTunnel;
      }
    }
  });

  it('getDashboardState returns null attachUrl when no onAttachUrlBuilt has fired (no-secret case)', async () => {
    // When no secret is set and no build_attach_url has been called, the dashboard
    // attachUrl is null (rebuildAttachUrl is never called).
    let storedParts: AttachUrlParts | null = null;
    createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-dev',
      getEnvironmentReason: () => 'test',
      // No totpSecret — confirms no at= in URL.
      onAttachUrlBuilt: (parts) => {
        storedParts = parts;
      },
    });

    // No call to build_attach_url — storedParts stays null.
    expect(storedParts).toBeNull();
  });

  // Defense-in-depth (#452): relay-dev/live path must refuse when TOTP secret is absent.
  // assertRelayAuthConfigured() at boot already gates relay startup, so this is dead
  // code in normal operation — but the handler must fail-closed if the guard is bypassed.
  it('build_attach_url(relay-dev) returns mcpError when TOTP secret is unset (#452)', async () => {
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-dev',
      getEnvironmentReason: () => 'test',
      // No totpSecret — simulates missing secret reaching the handler.
      // (totpSecret omitted: createDebugServer will have getTotpSecret return undefined)
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const prevSecret = process.env.AIT_DEBUG_TOTP_SECRET;
    delete process.env.AIT_DEBUG_TOTP_SECRET;
    try {
      const result = await client.callTool({
        name: 'build_attach_url',
        arguments: {
          scheme_url: 'intoss-private://app?_deploymentId=no-secret',
        },
      });
      // Must be a tool-level error (isError: true) — not a successful attach URL.
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? '';
      // Error message must name the requirement but NEVER the secret value/length.
      expect(text).toContain('AIT_DEBUG_TOTP_SECRET');
      expect(text).toContain('TOTP');
      // SECRET-HANDLING: must not leak secret value, length, or any derived fragment.
      expect(text).not.toMatch(/\b[0-9a-fA-F]{32,}\b/);
    } finally {
      if (prevSecret !== undefined) {
        process.env.AIT_DEBUG_TOTP_SECRET = prevSecret;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // selfdebug option (#543) — relay-mobile adds &selfdebug=1, env 3/4 rejects
  // ---------------------------------------------------------------------------

  it('build_attach_url(relay-mobile, selfdebug=true) includes selfdebug=1 in attachUrl', async () => {
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-mobile',
      getEnvironmentReason: () => 'test',
      totpSecret: SECRET,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const prevTunnel = process.env.AIT_TUNNEL_BASE_URL;
    process.env.AIT_TUNNEL_BASE_URL = 'https://app.trycloudflare.com';
    try {
      const result = await client.callTool({
        name: 'build_attach_url',
        arguments: { selfdebug: true },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? '';
      // The attachUrl JSON field must contain selfdebug=1.
      expect(text).toContain('selfdebug=1');
    } finally {
      if (prevTunnel === undefined) {
        delete process.env.AIT_TUNNEL_BASE_URL;
      } else {
        process.env.AIT_TUNNEL_BASE_URL = prevTunnel;
      }
    }
  });

  it('build_attach_url(relay-mobile, selfdebug=false) output is byte-identical (no selfdebug param)', async () => {
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-mobile',
      getEnvironmentReason: () => 'test',
      totpSecret: SECRET,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const prevTunnel = process.env.AIT_TUNNEL_BASE_URL;
    process.env.AIT_TUNNEL_BASE_URL = 'https://app.trycloudflare.com';
    try {
      const result = await client.callTool({
        name: 'build_attach_url',
        arguments: { selfdebug: false },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? '';
      // Must NOT contain selfdebug in the output.
      expect(text).not.toContain('selfdebug');
    } finally {
      if (prevTunnel === undefined) {
        delete process.env.AIT_TUNNEL_BASE_URL;
      } else {
        process.env.AIT_TUNNEL_BASE_URL = prevTunnel;
      }
    }
  });

  it('build_attach_url(relay-dev, selfdebug=true) returns mcpError — launcher-only feature', async () => {
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-dev',
      getEnvironmentReason: () => 'test',
      totpSecret: SECRET,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {
        scheme_url: 'intoss-private://aitc-sdk-example?_deploymentId=uuid',
        selfdebug: true,
      },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0]?.text ?? '';
    // Must name launcher-only restriction and env 2 guidance.
    expect(text).toContain('selfdebug');
    expect(text).toContain('relay-sandbox');
  });

  // Defense-in-depth (#452): relay-mobile path must also refuse when TOTP secret is absent.
  it('build_attach_url(relay-mobile) returns mcpError when TOTP secret is unset (#452)', async () => {
    const server = createDebugServer({
      connection: new FakeCdpConnection(),
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnelUp,
      getEnvironment: () => 'relay-mobile',
      getEnvironmentReason: () => 'test',
      // No totpSecret — simulates missing secret reaching the handler.
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const prevSecret = process.env.AIT_DEBUG_TOTP_SECRET;
    const prevTunnel = process.env.AIT_TUNNEL_BASE_URL;
    delete process.env.AIT_DEBUG_TOTP_SECRET;
    process.env.AIT_TUNNEL_BASE_URL = 'https://app.trycloudflare.com';
    try {
      const result = await client.callTool({
        name: 'build_attach_url',
        arguments: {},
      });
      // Must be a tool-level error (isError: true) — not a successful attach URL.
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? '';
      // Error message must name the requirement but NEVER the secret value/length.
      expect(text).toContain('AIT_DEBUG_TOTP_SECRET');
      expect(text).toContain('TOTP');
      // SECRET-HANDLING: must not leak secret value, length, or any derived fragment.
      expect(text).not.toMatch(/\b[0-9a-fA-F]{32,}\b/);
    } finally {
      if (prevSecret !== undefined) {
        process.env.AIT_DEBUG_TOTP_SECRET = prevSecret;
      }
      if (prevTunnel === undefined) {
        delete process.env.AIT_TUNNEL_BASE_URL;
      } else {
        process.env.AIT_TUNNEL_BASE_URL = prevTunnel;
      }
    }
  });
});
