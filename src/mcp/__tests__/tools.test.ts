import { describe, expect, it } from 'vitest';
import type {
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
  ConsoleApiCalledEvent,
  NetworkRequestWillBeSentEvent,
  NetworkResponseReceivedEvent,
} from '../cdp-connection.js';
import {
  isDebugToolName,
  listConsoleMessages,
  listNetworkRequests,
  listPages,
  normalizeConsoleMessage,
  type TunnelStatus,
} from '../tools.js';

/**
 * Fake CDP connection injected into the tool layer. Emits canned CDP events so
 * the three Phase 1 tools are verifiable without the phone roundtrip (which is
 * phone-gated). This is the spec's "CI-verifiable subset uses an injectable CDP
 * connection mocked in tests".
 */
class FakeCdpConnection implements CdpConnection {
  private readonly targets: CdpTarget[];
  private readonly buffers: {
    [E in CdpEventName]: CdpEventMap[E][];
  };

  constructor(init: {
    targets?: CdpTarget[];
    console?: ConsoleApiCalledEvent[];
    requests?: NetworkRequestWillBeSentEvent[];
    responses?: NetworkResponseReceivedEvent[];
  }) {
    this.targets = init.targets ?? [];
    this.buffers = {
      'Runtime.consoleAPICalled': init.console ?? [],
      'Network.requestWillBeSent': init.requests ?? [],
      'Network.responseReceived': init.responses ?? [],
    };
  }

  enableDomains(): Promise<void> {
    return Promise.resolve();
  }

  listTargets(): CdpTarget[] {
    return this.targets;
  }

  getBufferedEvents<E extends CdpEventName>(event: E): ReadonlyArray<CdpEventMap[E]> {
    return this.buffers[event];
  }

  on(): () => void {
    return () => {};
  }
}

describe('isDebugToolName', () => {
  it('recognizes the three Phase 1 tools', () => {
    expect(isDebugToolName('list_console_messages')).toBe(true);
    expect(isDebugToolName('list_network_requests')).toBe(true);
    expect(isDebugToolName('list_pages')).toBe(true);
  });

  it('rejects unknown / deferred-phase tools', () => {
    expect(isDebugToolName('evaluate_script')).toBe(false);
    expect(isDebugToolName('take_snapshot')).toBe(false);
  });
});

describe('normalizeConsoleMessage', () => {
  it('renders string and structured args into level + text', () => {
    const event: ConsoleApiCalledEvent = {
      type: 'error',
      timestamp: 1_700_000_000_000,
      args: [
        { type: 'string', value: 'swipe-back fired' },
        { type: 'object', subtype: 'error', description: 'Error: history.length === 1' },
        { type: 'number', value: 42 },
      ],
    };
    const message = normalizeConsoleMessage(event);
    expect(message.level).toBe('error');
    expect(message.timestamp).toBe(1_700_000_000_000);
    expect(message.args).toEqual(['swipe-back fired', 'Error: history.length === 1', '42']);
    expect(message.text).toBe('swipe-back fired Error: history.length === 1 42');
  });
});

describe('listConsoleMessages', () => {
  it('normalizes buffered Runtime.consoleAPICalled events oldest-first', () => {
    const connection = new FakeCdpConnection({
      console: [
        { type: 'log', timestamp: 1, args: [{ type: 'string', value: 'first' }] },
        { type: 'warning', timestamp: 2, args: [{ type: 'string', value: 'second' }] },
      ],
    });
    const messages = listConsoleMessages(connection);
    expect(messages).toEqual([
      { level: 'log', text: 'first', timestamp: 1, args: ['first'] },
      { level: 'warning', text: 'second', timestamp: 2, args: ['second'] },
    ]);
  });

  it('returns an empty list when no console events are buffered', () => {
    expect(listConsoleMessages(new FakeCdpConnection({}))).toEqual([]);
  });
});

describe('listNetworkRequests', () => {
  it('joins requestWillBeSent with responseReceived by requestId', () => {
    const connection = new FakeCdpConnection({
      requests: [
        {
          requestId: 'r1',
          request: { url: 'https://api.example/login', method: 'POST' },
          timestamp: 10,
        },
        {
          requestId: 'r2',
          request: { url: 'https://api.example/me', method: 'GET' },
          timestamp: 11,
        },
      ],
      responses: [
        {
          requestId: 'r1',
          response: { url: 'https://api.example/login', status: 200, statusText: 'OK' },
          timestamp: 12,
        },
      ],
    });

    const requests = listNetworkRequests(connection);
    expect(requests).toEqual([
      {
        requestId: 'r1',
        url: 'https://api.example/login',
        method: 'POST',
        status: 200,
        statusText: 'OK',
        startTime: 10,
        endTime: 12,
      },
      {
        requestId: 'r2',
        url: 'https://api.example/me',
        method: 'GET',
        status: null,
        statusText: null,
        startTime: 11,
        endTime: null,
      },
    ]);
  });
});

describe('listPages', () => {
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('reports attached targets plus tunnel status', () => {
    const connection = new FakeCdpConnection({
      targets: [{ id: 't1', title: 'sdk-example', url: 'https://example/storage' }],
    });
    expect(listPages(connection, tunnel)).toEqual({
      pages: [{ id: 't1', title: 'sdk-example', url: 'https://example/storage' }],
      tunnel: { up: true, wssUrl: 'wss://abc123.trycloudflare.com' },
    });
  });

  it('reports an empty page list before any phone attaches', () => {
    const connection = new FakeCdpConnection({});
    expect(listPages(connection, { up: true, wssUrl: 'wss://x.trycloudflare.com' })).toEqual({
      pages: [],
      tunnel: { up: true, wssUrl: 'wss://x.trycloudflare.com' },
    });
  });
});
