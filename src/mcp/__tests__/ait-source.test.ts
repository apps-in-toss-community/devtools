import { describe, expect, it, vi } from 'vitest';
import { type AitCommandSender, ChiiAitSource } from '../ait-chii-source.js';
import { type FetchLike, HttpAitSource } from '../ait-http-source.js';

/** Records the methods sent and returns canned raw results (no websocket). */
class FakeCommandSender implements AitCommandSender {
  readonly sent: string[] = [];
  constructor(private readonly results: Record<string, unknown>) {}
  sendCommand(method: string): Promise<unknown> {
    this.sent.push(method);
    if (!(method in this.results)) {
      return Promise.reject(new Error(`unexpected method ${method}`));
    }
    return Promise.resolve(this.results[method]);
  }
}

describe('ChiiAitSource (debug mode, over Chii channel)', () => {
  it('forwards AIT.getSdkCallHistory and narrows the trace', async () => {
    const sender = new FakeCommandSender({
      'AIT.getSdkCallHistory': {
        calls: [
          { method: 'getOperationalEnvironment', args: [], timestamp: 1, status: 'resolved' },
        ],
      },
    });
    const source = new ChiiAitSource(sender);
    const history = await source.get('AIT.getSdkCallHistory');
    expect(sender.sent).toEqual(['AIT.getSdkCallHistory']);
    expect(history.calls).toHaveLength(1);
  });

  it('returns an empty trace when the in-app side omits calls', async () => {
    const source = new ChiiAitSource(new FakeCommandSender({ 'AIT.getSdkCallHistory': {} }));
    expect(await source.get('AIT.getSdkCallHistory')).toEqual({ calls: [] });
  });

  it('passes through the mock-state record verbatim', async () => {
    const source = new ChiiAitSource(
      new FakeCommandSender({ 'AIT.getMockState': { environment: 'toss', foo: 1 } }),
    );
    expect(await source.get('AIT.getMockState')).toEqual({ environment: 'toss', foo: 1 });
  });

  it('defaults missing operational-environment fields', async () => {
    const source = new ChiiAitSource(
      new FakeCommandSender({ 'AIT.getOperationalEnvironment': {} }),
    );
    expect(await source.get('AIT.getOperationalEnvironment')).toEqual({
      environment: 'unknown',
      sdkVersion: null,
    });
  });
});

function fakeFetch(impl: (url: string) => ReturnType<FetchLike>): FetchLike {
  return vi.fn(impl);
}

function okJson(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  });
}

describe('HttpAitSource (dev mode, over HTTP mock-state endpoint)', () => {
  const endpoint = 'http://localhost:5173/api/ait-devtools/state';

  it('AIT.getMockState returns the dev server state snapshot', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() => okJson({ environment: 'sandbox', appVersion: '5.240.0' })),
    });
    const state = await source.get('AIT.getMockState');
    expect(state.environment).toBe('sandbox');
  });

  it('AIT.getOperationalEnvironment derives from environment + appVersion', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() => okJson({ environment: 'sandbox', appVersion: '5.240.0' })),
    });
    expect(await source.get('AIT.getOperationalEnvironment')).toEqual({
      environment: 'sandbox',
      sdkVersion: '5.240.0',
    });
  });

  it('AIT.getSdkCallHistory is empty in dev mode (no trace recorded)', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() => okJson({ environment: 'sandbox' })),
    });
    expect(await source.get('AIT.getSdkCallHistory')).toEqual({ calls: [] });
  });

  it('throws a helpful message when the dev server is unreachable', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve(null),
        }),
      ),
    });
    await expect(source.get('AIT.getMockState')).rejects.toThrow(/mcp: true/);
  });
});
