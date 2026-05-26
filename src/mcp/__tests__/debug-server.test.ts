/**
 * Tests for createDebugServer — specifically the build_attach_url tool whose
 * response now includes a unicode half-block QR string.
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
import { createDebugServer } from '../debug-server.js';
import type { TunnelStatus } from '../tools.js';

// Stub `qrcode` so tests are deterministic and don't need a real QR matrix.
// The stub produces a 1x1 module matrix so the half-block loop runs but is cheap.
vi.mock('qrcode', () => ({
  default: {
    create: (_input: string) => ({
      modules: {
        size: 1,
        data: new Uint8Array([1]),
      },
    }),
  },
}));

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
}

/** Connects a createDebugServer instance via InMemoryTransport and returns a ready Client. */
async function makeClient({
  getTunnelStatus,
  connection,
  waitForAttachTimeoutMs,
}: MakeClientOptions): Promise<Client> {
  const server = createDebugServer({
    connection: connection ?? new FakeCdpConnection(),
    aitSource: new FakeAitSource(),
    getTunnelStatus,
    waitForAttachTimeoutMs,
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
    expect(content[0]!.text).toMatch(/tunnel/i);
  });
});

describe('build_attach_url — wait_for_attach', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };
  const fakeTarget: CdpTarget = { id: 'target-1', title: 'Test', url: 'https://example.com' };

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
    const connection = new FakeCdpConnection([fakeTarget]);
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
    const connection = new FakeCdpConnection([fakeTarget]);
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
});
