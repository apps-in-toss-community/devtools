/**
 * Tests for createDebugServer — specifically the build_attach_url tool whose
 * response now includes an ASCII QR string.
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

// Stub qrcode-terminal so tests are deterministic and don't need a real terminal.
vi.mock('qrcode-terminal', () => ({
  default: {
    generate: (input: string, _opts: unknown, cb?: (out: string) => void) => {
      cb?.(`<QR:${input}>`);
    },
  },
}));

// ---- Minimal fakes --------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return [];
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

/** Connects a createDebugServer instance via InMemoryTransport and returns a ready Client. */
async function makeClient(getTunnelStatus: () => TunnelStatus): Promise<Client> {
  const server = createDebugServer({
    connection: new FakeCdpConnection(),
    aitSource: new FakeAitSource(),
    getTunnelStatus,
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

describe('build_attach_url — response includes ASCII QR', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('response text contains the attachUrl JSON and a QR string', async () => {
    const client = await makeClient(() => tunnelUp);

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

    // JSON portion: must contain attachUrl and relayUrl keys
    const jsonPart = text.split('\n\n')[0];
    expect(jsonPart).toBeDefined();
    const parsed = JSON.parse(jsonPart!);
    expect(parsed).toHaveProperty('attachUrl');
    expect(parsed).toHaveProperty('relayUrl');
    expect(parsed.relayUrl).toBe('wss://abc123.trycloudflare.com');
    // attachUrl must contain the relay and debug flag
    expect(parsed.attachUrl).toContain('debug=1');
    expect(parsed.attachUrl).toContain('relay=');

    // QR portion: stub produces <QR:…> so the text after '\n\n' starts with <QR:
    const qrPart = text.split('\n\n').slice(1).join('\n\n');
    expect(qrPart).toContain('<QR:');
    // QR encodes the full attachUrl (not just the relayUrl)
    expect(qrPart).toContain(parsed.attachUrl);
  });

  it('response text is a single text content block (not split into two blocks)', async () => {
    const client = await makeClient(() => tunnelUp);

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=xyz' },
    });

    const content = getContent(result);
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
  });

  it('returns isError when scheme_url is missing', async () => {
    const client = await makeClient(() => tunnelUp);

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = getContent(result);
    expect(content[0]!.text).toMatch(/scheme_url/);
  });

  it('returns isError when tunnel is not up', async () => {
    const client = await makeClient(() => ({ up: false, wssUrl: null }));

    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=xyz' },
    });

    expect(result.isError).toBe(true);
    const content = getContent(result);
    expect(content[0]!.text).toMatch(/tunnel/i);
  });
});
