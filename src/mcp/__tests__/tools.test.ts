import { describe, expect, it } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
  ConsoleApiCalledEvent,
  NetworkRequestWillBeSentEvent,
  NetworkResponseReceivedEvent,
} from '../cdp-connection.js';
import {
  getDomDocument,
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  isAitToolName,
  isDebugToolName,
  listConsoleMessages,
  listNetworkRequests,
  listPages,
  normalizeConsoleMessage,
  type TunnelStatus,
  takeScreenshot,
  takeSnapshot,
} from '../tools.js';

/** Canned `send` results keyed by CDP command method. */
type CommandResults = {
  [M in CdpCommandName]?: CdpCommandMap[M]['result'];
};

/**
 * Fake CDP connection injected into the tool layer. Emits canned CDP events and
 * canned command results so the tools are verifiable without the phone
 * roundtrip (which is phone-gated). This is the spec's "CI-verifiable subset
 * uses an injectable CDP connection mocked in tests".
 */
class FakeCdpConnection implements CdpConnection {
  private readonly targets: CdpTarget[];
  private readonly buffers: {
    [E in CdpEventName]: CdpEventMap[E][];
  };
  private readonly commandResults: CommandResults;

  constructor(init: {
    targets?: CdpTarget[];
    console?: ConsoleApiCalledEvent[];
    requests?: NetworkRequestWillBeSentEvent[];
    responses?: NetworkResponseReceivedEvent[];
    commandResults?: CommandResults;
  }) {
    this.targets = init.targets ?? [];
    this.buffers = {
      'Runtime.consoleAPICalled': init.console ?? [],
      'Network.requestWillBeSent': init.requests ?? [],
      'Network.responseReceived': init.responses ?? [],
    };
    this.commandResults = init.commandResults ?? {};
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

  send<M extends CdpCommandName>(method: M): Promise<CdpCommandMap[M]['result']> {
    const result = this.commandResults[method];
    if (result === undefined) {
      return Promise.reject(new Error(`No canned result for ${method}`));
    }
    return Promise.resolve(result);
  }
}

/** Fake AIT source returning canned `AIT.*` responses (no phone, no dev server). */
class FakeAitSource implements AitSource {
  constructor(private readonly responses: Partial<AitMethodMap>) {}

  get<M extends AitMethodName>(method: M): Promise<AitMethodMap[M]> {
    const value = this.responses[method];
    if (value === undefined) {
      return Promise.reject(new Error(`No canned AIT response for ${method}`));
    }
    return Promise.resolve(value as AitMethodMap[M]);
  }
}

describe('isDebugToolName', () => {
  it('recognizes the Phase 1 + 2 + 3 tools', () => {
    expect(isDebugToolName('list_console_messages')).toBe(true);
    expect(isDebugToolName('list_network_requests')).toBe(true);
    expect(isDebugToolName('list_pages')).toBe(true);
    expect(isDebugToolName('get_dom_document')).toBe(true);
    expect(isDebugToolName('take_snapshot')).toBe(true);
    expect(isDebugToolName('take_screenshot')).toBe(true);
    expect(isDebugToolName('AIT.getSdkCallHistory')).toBe(true);
    expect(isDebugToolName('AIT.getMockState')).toBe(true);
    expect(isDebugToolName('AIT.getOperationalEnvironment')).toBe(true);
  });

  it('rejects unknown / deferred-phase tools', () => {
    expect(isDebugToolName('evaluate_script')).toBe(false);
    expect(isDebugToolName('list_things')).toBe(false);
  });
});

describe('isAitToolName', () => {
  it('recognizes only the AIT.* tools', () => {
    expect(isAitToolName('AIT.getSdkCallHistory')).toBe(true);
    expect(isAitToolName('AIT.getMockState')).toBe(true);
    expect(isAitToolName('AIT.getOperationalEnvironment')).toBe(true);
    expect(isAitToolName('list_console_messages')).toBe(false);
    expect(isAitToolName('take_screenshot')).toBe(false);
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

describe('getDomDocument (Phase 2)', () => {
  it('returns the canned DOM.getDocument result', async () => {
    const connection = new FakeCdpConnection({
      commandResults: {
        'DOM.getDocument': {
          root: {
            nodeId: 1,
            nodeType: 9,
            nodeName: '#document',
            documentURL: 'https://example/storage',
            children: [{ nodeId: 2, nodeType: 1, nodeName: 'HTML', localName: 'html' }],
          },
        },
      },
    });
    const doc = await getDomDocument(connection);
    expect(doc.root.nodeName).toBe('#document');
    expect(doc.root.children?.[0]?.localName).toBe('html');
  });

  it('rejects when no page is attached (no canned result)', async () => {
    await expect(getDomDocument(new FakeCdpConnection({}))).rejects.toThrow(/No canned result/);
  });
});

describe('takeSnapshot (Phase 2)', () => {
  it('returns the canned DOMSnapshot.captureSnapshot result', async () => {
    const connection = new FakeCdpConnection({
      commandResults: {
        'DOMSnapshot.captureSnapshot': { documents: [{ nodes: {} }], strings: ['--sat', '0px'] },
      },
    });
    const snapshot = await takeSnapshot(connection);
    expect(snapshot.strings).toEqual(['--sat', '0px']);
    expect(snapshot.documents).toHaveLength(1);
  });
});

describe('takeScreenshot (Phase 2)', () => {
  it('wraps the base64 PNG into data + dataUri + mimeType', async () => {
    const connection = new FakeCdpConnection({
      commandResults: { 'Page.captureScreenshot': { data: 'iVBORw0KGgo=' } },
    });
    const shot = await takeScreenshot(connection);
    expect(shot.data).toBe('iVBORw0KGgo=');
    expect(shot.dataUri).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(shot.mimeType).toBe('image/png');
  });
});

describe('AIT.* tools (Phase 3)', () => {
  it('getSdkCallHistory returns the canned trace', async () => {
    const source = new FakeAitSource({
      'AIT.getSdkCallHistory': {
        calls: [
          {
            method: 'saveBase64Data',
            args: ['data:…'],
            timestamp: 5,
            status: 'rejected',
            error: 'permission denied',
            fidelity: 'partial' as const,
          },
        ],
      },
    });
    const history = await getSdkCallHistory(source);
    expect(history.calls).toHaveLength(1);
    expect(history.calls[0]?.method).toBe('saveBase64Data');
    expect(history.calls[0]?.status).toBe('rejected');
  });

  it('getMockState returns the opaque state record', async () => {
    const source = new FakeAitSource({
      'AIT.getMockState': { environment: 'sandbox', permissions: { camera: 'granted' } },
    });
    const state = await getMockState(source);
    expect(state.environment).toBe('sandbox');
  });

  it('getOperationalEnvironment returns environment + sdkVersion', async () => {
    const source = new FakeAitSource({
      'AIT.getOperationalEnvironment': { environment: 'toss', sdkVersion: '2.5.0' },
    });
    const env = await getOperationalEnvironment(source);
    expect(env).toEqual({ environment: 'toss', sdkVersion: '2.5.0' });
  });

  it('rejects when the source has no canned response', async () => {
    await expect(getMockState(new FakeAitSource({}))).rejects.toThrow(/No canned AIT response/);
  });
});
