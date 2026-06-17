import { afterEach, describe, expect, it, vi } from 'vitest';
import aitDevtoolsPlugin from '../unplugin/index.js';

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
// `resolveId` now returns the absolute file path of `@ait-co/devtools/mock` so
// bundlers can load it directly; when `import.meta.resolve` fails (e.g. in a
// test environment where the subpath isn't yet published as a dist file) the
// implementation falls back to the bare specifier.
function isMockTarget(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === '@ait-co/devtools/mock' || /\/mock\/index\.(m?js)$/.test(value))
  );
}

type RawHooks = {
  resolveId: (id: string) => string | null | undefined;
  transformInclude: (id: string) => boolean;
  transform: (code: string) => string | null | undefined;
  vite: {
    config: () =>
      | { define?: Record<string, string>; server?: { allowedHosts?: string[] } }
      | undefined;
  };
};

function getRawHooks(options?: Parameters<typeof aitDevtoolsPlugin.raw>[0]): RawHooks {
  const plugin = aitDevtoolsPlugin.raw(options, { framework: 'vite' }) as unknown as RawHooks;
  return plugin;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('unplugin: dev mode (default)', () => {
  it('mock alias가 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(isMockTarget(hooks.resolveId(FRAMEWORK_ID))).toBe(true);
  });

  it('패널 주입이 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: dev mode + mock:false', () => {
  it('mock alias가 비활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ mock: false });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('패널 주입은 여전히 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ mock: false });
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: dev mode + panel:false', () => {
  it('mock alias는 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ panel: false });
    expect(isMockTarget(hooks.resolveId(FRAMEWORK_ID))).toBe(true);
  });

  it('패널 주입이 비활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ panel: false });
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: production default', () => {
  it('mock alias가 비활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks();
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('패널 주입이 비활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks();
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: production — 항상 비활성화 (불변식)', () => {
  it('production(NODE_ENV=production)에서 mock alias는 항상 비활성화된다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks();
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('production에서 mock:true를 명시해도 shouldEnable이 false라 mock alias는 비활성화된다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ mock: true });
    // shouldEnable=false이므로 shouldMock = false && true = false
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('production에서 패널 주입도 항상 비활성화된다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks();
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: dev mode + mock:true (explicit)', () => {
  it('mock alias가 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ mock: true });
    expect(isMockTarget(hooks.resolveId(FRAMEWORK_ID))).toBe(true);
  });
});

describe('unplugin: resolveId', () => {
  it('관련 없는 패키지는 null을 반환한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.resolveId('some-other-package')).toBeNull();
  });

  it('@apps-in-toss/web-bridge도 mock으로 alias된다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(isMockTarget(hooks.resolveId('@apps-in-toss/web-bridge'))).toBe(true);
  });

  it('@apps-in-toss/web-analytics도 mock으로 alias된다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(isMockTarget(hooks.resolveId('@apps-in-toss/web-analytics'))).toBe(true);
  });
});

describe('unplugin: transformInclude - 추가 케이스', () => {
  it('node_modules 내 파일은 제외한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.transformInclude('node_modules/some-lib/main.js')).toBeFalsy();
  });

  it('app 패턴이 포함된 파일도 포함한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.transformInclude('src/App.tsx')).toBeTruthy();
  });
});

describe('unplugin: tunnel - vite.config()', () => {
  it('tunnel이 켜진 dev 모드에서 .trycloudflare.com을 allowedHosts에 추가한다 (+ #580 define)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ tunnel: true });
    expect(hooks.vite.config()).toEqual({
      define: { __WEB_VIEW_TYPE__: '"partner"' },
      server: { allowedHosts: ['.trycloudflare.com'] },
    });
  });

  it('tunnel이 꺼져 있어도 #580 webViewType define은 주입한다 (allowedHosts 없음)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.vite.config()).toEqual({ define: { __WEB_VIEW_TYPE__: '"partner"' } });
  });

  it('production + tunnel:true에서도 define만 주입하고 allowedHosts는 건드리지 않는다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ tunnel: true });
    expect(hooks.vite.config()).toEqual({ define: { __WEB_VIEW_TYPE__: '"partner"' } });
  });
});

describe('unplugin: webViewType define (#580)', () => {
  it("webViewType 미지정 시 'partner'를 주입한다 (web-framework @default)", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.vite.config()?.define).toEqual({ __WEB_VIEW_TYPE__: '"partner"' });
  });

  it("webViewType: 'game' → __WEB_VIEW_TYPE__ define이 '\"game\"'이 된다", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ webViewType: 'game' });
    expect(hooks.vite.config()?.define).toEqual({ __WEB_VIEW_TYPE__: '"game"' });
  });

  it("webViewType: 'partner' (명시) → '\"partner\"'", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ webViewType: 'partner' });
    expect(hooks.vite.config()?.define).toEqual({ __WEB_VIEW_TYPE__: '"partner"' });
  });
});

describe('unplugin: transform', () => {
  it('패널 import를 prepend한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    const result = hooks.transform('console.log("hello");');
    expect(result).toBe('import \'@ait-co/devtools/panel\';\nconsole.log("hello");');
  });

  it('이미 패널 import가 있으면 스킵한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    const code = "import '@ait-co/devtools/panel';\nconsole.log('hello');";
    const result = hooks.transform(code);
    expect(result).toBeNull();
  });

  it('shouldPanel이 false이면 null을 반환한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks();
    const result = hooks.transform('console.log("hello");');
    expect(result).toBeNull();
  });
});
