import { describe, it, expect, afterEach } from 'vitest';
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
  // process.env.NODE_ENV를 테스트 간 복원
  process.env.NODE_ENV = 'test';
});

describe('unplugin: dev mode (default)', () => {
  it('mock alias가 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks();
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });

  it('패널 주입이 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks();
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: dev mode + mock:false', () => {
  it('mock alias가 비활성화되어야 한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks({ mock: false });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('패널 주입은 여전히 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks({ mock: false });
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: dev mode + panel:false', () => {
  it('mock alias는 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks({ panel: false });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });

  it('패널 주입이 비활성화되어야 한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks({ panel: false });
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: production default', () => {
  it('mock alias가 비활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks();
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('패널 주입이 비활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks();
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: production + forceEnable:true', () => {
  it('mock alias는 비활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks({ forceEnable: true });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBeNull();
  });

  it('패널 주입은 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks({ forceEnable: true });
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: production + forceEnable:true + mock:true', () => {
  it('mock alias가 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks({ forceEnable: true, mock: true });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });

  it('패널 주입이 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks({ forceEnable: true, mock: true });
    expect(hooks.transformInclude('src/main.tsx')).toBeTruthy();
  });
});

describe('unplugin: production + forceEnable:true + mock:true + panel:false', () => {
  it('mock alias가 활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks({ forceEnable: true, mock: true, panel: false });
    expect(hooks.resolveId(FRAMEWORK_ID)).toBe(MOCK_ID);
  });

  it('패널 주입이 비활성화되어야 한다', () => {
    process.env.NODE_ENV = 'production';
    const hooks = getRawHooks({ forceEnable: true, mock: true, panel: false });
    expect(hooks.transformInclude('src/main.tsx')).toBeFalsy();
  });
});

describe('unplugin: resolveId - 다른 패키지는 null 반환', () => {
  it('관련 없는 패키지는 null을 반환한다', () => {
    process.env.NODE_ENV = 'development';
    const hooks = getRawHooks();
    expect(hooks.resolveId('some-other-package')).toBeNull();
  });
});
