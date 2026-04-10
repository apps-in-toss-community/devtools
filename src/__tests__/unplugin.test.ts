import { describe, it, expect, afterEach, vi } from 'vitest';
import aitDevtoolsPlugin from '../unplugin/index.js';

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
const MOCK_ID = '@ait-co/devtools/mock';

type RawHooks = {
  resolveId: (id: string) => string | null | undefined;
  transformInclude: (id: string) => boolean;
  transform: (code: string, id: string) => string | null | undefined;
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
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
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

describe('unplugin: dev mode + forceEnable:true', () => {
  it('mock alias가 여전히 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ forceEnable: true });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });
});

describe('unplugin: dev mode + panel:false', () => {
  it('mock alias는 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ panel: false });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
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

describe('unplugin: production + forceEnable:true', () => {
  it('mock alias는 비활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ forceEnable: true });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('패널 주입은 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ forceEnable: true });
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: production + forceEnable:true + mock:true', () => {
  it('mock alias가 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ forceEnable: true, mock: true });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });

  it('패널 주입이 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ forceEnable: true, mock: true });
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: production + forceEnable:true + mock:true + panel:false', () => {
  it('mock alias가 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ forceEnable: true, mock: true, panel: false });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });

  it('패널 주입이 비활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks({ forceEnable: true, mock: true, panel: false });
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: dev mode + mock:true (explicit)', () => {
  it('mock alias가 활성화되어야 한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks({ mock: true });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
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
    expect(hooks.resolveId('@apps-in-toss/web-bridge')).toBe(MOCK_ID);
  });

  it('@apps-in-toss/web-analytics도 mock으로 alias된다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    expect(hooks.resolveId('@apps-in-toss/web-analytics')).toBe(MOCK_ID);
  });
});

describe('unplugin: transform', () => {
  it('진입점 파일에 패널 import를 prepend한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    const result = hooks.transform('console.log("hello");', 'src/main.tsx');
    expect(result).toBe("import '@ait-co/devtools/panel';\nconsole.log(\"hello\");");
  });

  it('이미 패널 import가 있으면 스킵한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    const code = "import '@ait-co/devtools/panel';\nconsole.log('hello');";
    const result = hooks.transform(code, 'src/main.tsx');
    expect(result).toBeNull();
  });

  it('shouldPanel이 false이면 null을 반환한다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const hooks = getRawHooks();
    const result = hooks.transform('console.log("hello");', 'src/main.tsx');
    expect(result).toBeNull();
  });

  it('node_modules 내 파일은 스킵한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    const result = hooks.transform('console.log("hello");', 'node_modules/some-lib/main.js');
    expect(result).toBeNull();
  });

  it('app 패턴이 포함된 파일도 패널을 주입한다', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const hooks = getRawHooks();
    const result = hooks.transform('console.log("hello");', 'src/App.tsx');
    expect(result).toBe("import '@ait-co/devtools/panel';\nconsole.log(\"hello\");");
  });
});
