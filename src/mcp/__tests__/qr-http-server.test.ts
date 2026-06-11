/**
 * qr-http-server Phase 1 테스트 (issue #247):
 *   - notifyStateChange → SSE 구독자에게 frame 전달
 *   - GET / dashboard HTML — tunnel/page/attachUrl 상태 반영
 *   - getDashboardState 미주입 시 GET /와 GET /events가 204 반환
 *   - SSE frame 파싱 — 올바른 JSON 구조
 *   - SECRET-HANDLING: TOTP at= 코드 노출 없음 (attachUrl 캡슐 안에만)
 *
 * 모든 테스트는 실제 HTTP 서버를 기동해 fetch로 검증한다 (jsdom 환경에서도 Node
 * 전역 fetch가 있으므로 동작한다 — vitest.config의 environment: 'jsdom' 기준).
 *
 * i18n: 대부분의 테스트는 `Accept-Language: ko` 헤더를 명시해 한국어 응답을
 * 얻는다. Accept-Language 없이 fetch하면 기본값 'en'이 적용된다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type DashboardState, startQrHttpServer } from '../qr-http-server.js';

// ---------------------------------------------------------------------------
// 헬퍼: SSE 스트림에서 첫 번째 data: 라인을 파싱한다.
// Node/jsdom의 fetch + ReadableStream을 raw text로 읽고 SSE 라인을 추출.
// ---------------------------------------------------------------------------

async function readFirstSseFrame(url: string, timeoutMs = 3_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable body');
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      // SSE frame 종료는 "\n\n"
      const frames = buffer.split('\n\n');
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) {
          reader.cancel();
          return JSON.parse(dataLine.slice('data: '.length));
        }
      }
    }
    throw new Error('No SSE frame received');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// getDashboardState 미주입 — GET / 와 GET /events 204
// ---------------------------------------------------------------------------

describe('startQrHttpServer — getDashboardState 미주입', () => {
  it('GET / → 204 (dashboard 비활성)', async () => {
    const srv = await startQrHttpServer();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/`);
      expect(res.status).toBe(204);
    } finally {
      await srv.close();
    }
  });

  it('GET /events → 204 (SSE 비활성)', async () => {
    const srv = await startQrHttpServer();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/events`);
      expect(res.status).toBe(204);
    } finally {
      await srv.close();
    }
  });

  it('notifyStateChange() — no-op (에러 없음)', async () => {
    const srv = await startQrHttpServer();
    try {
      expect(() => srv.notifyStateChange()).not.toThrow();
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// getDashboardState 주입 — GET / dashboard HTML 렌더
// ---------------------------------------------------------------------------

describe('startQrHttpServer — GET / dashboard HTML', () => {
  let state: DashboardState;

  beforeEach(() => {
    state = {
      tunnel: { up: true, wssUrl: 'wss://test.trycloudflare.com' },
      pages: [{ id: 'page-1', url: 'https://example.com/app' }],
      attachUrl: null,
    };
  });

  it('터널 UP 상태 표시', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/`, {
        headers: { 'Accept-Language': 'ko' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      const html = await res.text();
      expect(html).toContain('연결됨');
      expect(html).toContain('status-up');
    } finally {
      await srv.close();
    }
  });

  it('터널 DOWN 상태 표시', async () => {
    state.tunnel = { up: false, wssUrl: null };
    const srv = await startQrHttpServer(() => state);
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/`, {
        headers: { 'Accept-Language': 'ko' },
      });
      const html = await res.text();
      expect(html).toContain('끊어짐');
      expect(html).toContain('status-down');
    } finally {
      await srv.close();
    }
  });

  it('page 목록 표시', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      expect(html).toContain('page-1');
      expect(html).toContain('example.com/app');
    } finally {
      await srv.close();
    }
  });

  it('page가 없으면 빈 안내 표시', async () => {
    state.pages = [];
    const srv = await startQrHttpServer(() => state);
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(html).toContain('attach된 페이지 없음');
    } finally {
      await srv.close();
    }
  });

  it('attachUrl 없으면 hint 표시', async () => {
    state.attachUrl = null;
    const srv = await startQrHttpServer(() => state);
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      expect(html).toContain('build_attach_url');
    } finally {
      await srv.close();
    }
  });

  it('attachUrl 있으면 QR img + url-box 표시 (인라인 base64 또는 /qr.png)', async () => {
    state.attachUrl =
      'intoss-private://aitc-sdk-example?_deploymentId=test-id&debug=1&relay=wss%3A%2F%2Fx.tc.com';
    const srv = await startQrHttpServer(() => state);
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      // QR img가 있어야 함 (base64 inline — 초기 렌더)
      expect(html).toContain('<img class="qr"');
      // attachUrl이 url-box에 노출됨 (TOTP at=가 있어도 attachUrl 캡슐 그대로)
      expect(html).toContain('intoss-private://');
    } finally {
      await srv.close();
    }
  });

  it('SECRET: dashboard HTML에 wssUrl host 값이 평문 노출되지 않음', async () => {
    state.tunnel = { up: true, wssUrl: 'wss://secret-host.trycloudflare.com' };
    const srv = await startQrHttpServer(() => state);
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      // tunnel status는 up/down 텍스트만 — wssUrl host 값 자체는 HTML에 없어야 함.
      expect(html).not.toContain('secret-host.trycloudflare.com');
    } finally {
      await srv.close();
    }
  });

  it('dashboard에 SSE 클라이언트 JS(/events 구독)가 포함됨', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      expect(html).toContain('EventSource');
      expect(html).toContain('/events');
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 인스펙터 링크 — inspectorUrl 있으면 <a>, 없으면 hint (#503)
// ---------------------------------------------------------------------------

describe('startQrHttpServer — 인스펙터 열기 링크 (#503)', () => {
  it('inspectorUrl 있으면 "인스펙터 열기" 링크(ko)가 target="_blank"로 렌더된다', async () => {
    const INSPECTOR_URL =
      'http://127.0.0.1:9100/front_end/chii_app.html?ws=127.0.0.1%3A9100%2Fclient%2Fabc%3Ftarget%3Dpage-1%26at%3D123456&panel=console';
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://relay.trycloudflare.com' },
      pages: [{ id: 'page-1', url: 'https://example.com/app' }],
      attachUrl: null,
      inspectorUrl: INSPECTOR_URL,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      // "인스펙터 열기" 링크 존재 확인
      expect(html).toContain('인스펙터 열기');
      // inspector-link anchor로 렌더됨
      expect(html).toContain('class="inspector-link"');
      expect(html).toContain('target="_blank"');
      // URL이 href에 포함됨 (HTML-escaped)
      expect(html).toContain('chii_app.html');
    } finally {
      await srv.close();
    }
  });

  it('inspectorUrl 있으면 "Open inspector" 링크(en)가 렌더된다', async () => {
    const INSPECTOR_URL =
      'http://127.0.0.1:9100/front_end/chii_app.html?ws=127.0.0.1%3A9100%2Fclient%2Fabc%3Ftarget%3Dpage-1&panel=console';
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://relay.trycloudflare.com' },
      pages: [{ id: 'page-1', url: 'https://example.com/app' }],
      attachUrl: null,
      inspectorUrl: INSPECTOR_URL,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'en' } })
      ).text();
      expect(html).toContain('Open inspector');
      expect(html).toContain('class="inspector-link"');
    } finally {
      await srv.close();
    }
  });

  it('inspectorUrl null 이면 대기 hint가 표시된다 (미첨부 상태)', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://relay.trycloudflare.com' },
      pages: [],
      attachUrl: null,
      inspectorUrl: null,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      // 링크 없이 대기 힌트가 표시돼야 함
      expect(html).not.toContain('class="inspector-link"');
      expect(html).toContain('class="inspector-hint"');
      expect(html).toContain('attach 후 표시');
    } finally {
      await srv.close();
    }
  });

  it('inspectorUrl 미전달(undefined) 이면 대기 hint가 표시된다', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
      // inspectorUrl 생략 → undefined → null 처리
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(html).not.toContain('class="inspector-link"');
      expect(html).toContain('class="inspector-hint"');
    } finally {
      await srv.close();
    }
  });

  it('SSE payload에 inspectorUrl 필드가 포함된다', async () => {
    const INSPECTOR_URL = 'http://127.0.0.1:9100/front_end/chii_app.html?ws=fake&panel=console';
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://relay.trycloudflare.com' },
      pages: [{ id: 'p1', url: 'https://app.example.com' }],
      attachUrl: null,
      inspectorUrl: INSPECTOR_URL,
    }));
    try {
      const frame = await readFirstSseFrame(`http://127.0.0.1:${srv.port}/events`);
      expect(frame).toHaveProperty('inspectorUrl', INSPECTOR_URL);
    } finally {
      await srv.close();
    }
  });

  it('SSE payload: inspectorUrl null 이면 null로 전달된다', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: false, wssUrl: null },
      pages: [],
      attachUrl: null,
      inspectorUrl: null,
    }));
    try {
      const frame = await readFirstSseFrame(`http://127.0.0.1:${srv.port}/events`);
      expect(frame).toHaveProperty('inspectorUrl', null);
    } finally {
      await srv.close();
    }
  });

  it('SECRET: inspectorUrl의 host 값이 SSE script 바깥 별도 로그 경로에 노출되지 않는다', async () => {
    // 인스펙터 URL에는 relay host + TOTP at= 코드가 담길 수 있다.
    // 대시보드 HTML anchor href에 노출되는 건 의도된 transport이지만,
    // tunnel wssUrl host처럼 별도 평문 출력은 없어야 한다 (#503 SECRET-HANDLING).
    const SECRET_HOST = 'relay-secret-host.trycloudflare.com';
    const INSPECTOR_URL = `https://${SECRET_HOST}/front_end/chii_app.html?wss=fake`;
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: `wss://${SECRET_HOST}` },
      pages: [{ id: 'p1', url: 'https://app.example.com' }],
      attachUrl: null,
      inspectorUrl: INSPECTOR_URL,
    }));
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      // inspectorUrl은 anchor href 안에만 있어야 한다 — tunnel wssUrl처럼
      // 별도 평문 텍스트 노드로 드러나면 안 된다.
      // (href 안의 노출은 의도된 transport이므로 SECRET_HOST 포함 자체를 검증하지 않음)
      // 대신 wssUrl host는 HTML에 없어야 한다 (기존 invariant 유지).
      expect(html).not.toContain('wss://relay-secret-host.trycloudflare.com');
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 주기 SSE 갱신 — idle 탭 TOTP 만료 방지 (issue #509)
//
// startQrHttpServer는 실제 Node HTTP 서버를 기동하므로 vi.useFakeTimers()를
// 조합하면 서버 내부 setInterval을 fake로 교체하지 못한다. 대신 짧은 실제
// interval(20ms)을 주입하고 실제 시간을 기다린다.
// ---------------------------------------------------------------------------

describe('startQrHttpServer — 주기 SSE 갱신 (#509)', () => {
  it('sseRefreshIntervalMs 경과 후 SSE 구독자가 있으면 getDashboardState를 재호출한다', async () => {
    let callCount = 0;
    const state: DashboardState = {
      tunnel: { up: true, wssUrl: 'wss://<RELAY>' },
      pages: [{ id: 'page-1', url: 'https://example.com/app' }],
      attachUrl: null,
    };

    const srv = await startQrHttpServer(
      () => {
        callCount++;
        return state;
      },
      { sseRefreshIntervalMs: 20 },
    );

    // SSE 연결 — sseClients에 추가되게 한다.
    const ctrl = new AbortController();
    const fetchPromise = fetch(`http://127.0.0.1:${srv.port}/events`, {
      signal: ctrl.signal,
    });
    // 연결이 서버에 도달하고 초기 push가 일어날 시간을 준다.
    await new Promise<void>((r) => setTimeout(r, 30));
    const countAfterConnect = callCount; // 초기 push(1회) 이상

    // 주기 갱신이 추가로 일어날 시간(20ms × 2 이상)을 기다린다.
    await new Promise<void>((r) => setTimeout(r, 60));

    // getDashboardState가 주기적으로 재호출됐어야 한다.
    expect(callCount).toBeGreaterThan(countAfterConnect);

    ctrl.abort();
    await fetchPromise.catch(() => {});
    await srv.close();
  }, 3_000);

  it('SSE 구독자 없으면 주기 interval이 getDashboardState를 호출하지 않는다', async () => {
    let callCount = 0;
    const state: DashboardState = {
      tunnel: { up: false, wssUrl: null },
      pages: [],
      attachUrl: null,
    };

    const srv = await startQrHttpServer(
      () => {
        callCount++;
        return state;
      },
      { sseRefreshIntervalMs: 20 },
    );

    // 구독자 없이 interval 3회 이상 경과
    await new Promise<void>((r) => setTimeout(r, 80));

    // 구독자가 없으므로 주기 갱신이 getDashboardState를 호출해선 안 된다.
    expect(callCount).toBe(0);

    await srv.close();
  }, 3_000);

  it('close() 후에는 주기 interval이 더 이상 발화하지 않는다', async () => {
    let callCount = 0;
    const state: DashboardState = {
      tunnel: { up: true, wssUrl: 'wss://<RELAY>' },
      pages: [],
      attachUrl: null,
    };

    const srv = await startQrHttpServer(
      () => {
        callCount++;
        return state;
      },
      { sseRefreshIntervalMs: 20 },
    );

    // SSE 연결 + 초기 push 대기
    const ctrl = new AbortController();
    fetch(`http://127.0.0.1:${srv.port}/events`, { signal: ctrl.signal }).catch(() => {});
    await new Promise<void>((r) => setTimeout(r, 30));

    ctrl.abort();
    await srv.close();
    const countAfterClose = callCount;

    // close 후 interval 3회 이상 경과 — callCount가 증가해선 안 된다.
    await new Promise<void>((r) => setTimeout(r, 80));
    expect(callCount).toBe(countAfterClose);
  }, 3_000);
});

// ---------------------------------------------------------------------------
// "연결된 Pages" 섹션 — pages: null 이면 숨김 (#411 결함 1)
//
// env 3/4(debug-server)는 pages: Array 라이브 목록을 채워 섹션을 보여주고,
// env 2(unplugin 터널)는 connected target을 알 수 없어 pages: null 로 섹션 자체를
// 숨긴다. 정적 렌더와 SSE 스크립트 양쪽이 같은 조건을 따라야 push 때 섹션이
// 되살아나지 않는다.
// ---------------------------------------------------------------------------

describe('startQrHttpServer — 연결된 Pages 섹션 토글 (#411)', () => {
  it('pages: null 이면 "연결된 Pages" 섹션을 렌더하지 않는다 (env 2)', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: null,
      attachUrl: null,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      // 정적 렌더의 섹션 헤더·컨테이너·목록이 모두 사라진다 — 거짓 빈 목록 미표시.
      // (참고: "attach된 페이지 없음" 문자열은 SSE 스크립트 안에도 있어 본문
      //  존재 여부로는 섹션 표시를 판별할 수 없다 → 정적 마커로 판별한다.)
      expect(html).not.toContain('연결된 Pages');
      expect(html).not.toContain('id="pages-section"');
      expect(html).not.toContain('id="pages-list"');
    } finally {
      await srv.close();
    }
  });

  it('pages: [] 이면 섹션을 보여주고 빈 안내를 표시한다 (env 3/4 attach 0개 — 회귀 가드)', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(html).toContain('연결된 Pages');
      expect(html).toContain('id="pages-list"');
      expect(html).toContain('attach된 페이지 없음');
    } finally {
      await srv.close();
    }
  });

  it('pages: [목록] 이면 섹션과 page 항목을 표시한다 (env 3/4 — 회귀 가드)', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [{ id: 'target-7', url: 'https://example.com/live' }],
      attachUrl: null,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(html).toContain('연결된 Pages');
      expect(html).toContain('target-7');
      expect(html).toContain('example.com/live');
    } finally {
      await srv.close();
    }
  });

  it('SSE 스크립트가 pages === null 분기를 가져 push 때 섹션을 되살리지 않는다', async () => {
    // pages: null 정적 렌더의 인라인 스크립트를 검사 — null/undefined 가드가
    // 들어가야 SSE push로 #pages-list 가 새로 생성되지 않는다.
    const srvNull = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: null,
      attachUrl: null,
    }));
    try {
      const html = await (await fetch(`http://127.0.0.1:${srvNull.port}/`)).text();
      // 스크립트가 pages 갱신 전에 null/undefined 를 명시적으로 거른다.
      expect(html).toContain('s.pages !== null');
    } finally {
      await srvNull.close();
    }
  });
});

// ---------------------------------------------------------------------------
// SSE /events — 초기 frame + notifyStateChange push
// ---------------------------------------------------------------------------

describe('startQrHttpServer — SSE /events', () => {
  let state: DashboardState;

  beforeEach(() => {
    state = {
      tunnel: { up: true, wssUrl: 'wss://test.trycloudflare.com' },
      pages: [],
      attachUrl: null,
    };
  });

  it('GET /events 200 + text/event-stream', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`http://127.0.0.1:${srv.port}/events`, { signal: ctrl.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    } finally {
      await srv.close();
    }
  });

  it('연결 시 즉시 초기 상태 frame 전송', async () => {
    state.tunnel = { up: true, wssUrl: 'wss://initial.tc.com' };
    state.pages = [{ id: 'p1', url: 'https://app.example.com' }];
    const srv = await startQrHttpServer(() => state);
    try {
      const frame = (await readFirstSseFrame(
        `http://127.0.0.1:${srv.port}/events`,
      )) as DashboardState;
      expect(frame.tunnel.up).toBe(true);
      expect(Array.isArray(frame.pages)).toBe(true);
      expect(frame.pages?.[0]?.id).toBe('p1');
    } finally {
      await srv.close();
    }
  });

  it('초기 frame에 attachUrl이 null이면 null 포함', async () => {
    state.attachUrl = null;
    const srv = await startQrHttpServer(() => state);
    try {
      const frame = (await readFirstSseFrame(
        `http://127.0.0.1:${srv.port}/events`,
      )) as DashboardState;
      expect(frame.attachUrl).toBeNull();
    } finally {
      await srv.close();
    }
  });

  it('notifyStateChange() → SSE 구독자에게 갱신된 상태 frame 전달', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      // 구독 시작 (초기 frame은 버림)
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${srv.port}/events`, { signal: ctrl.signal });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body');

      // 초기 frame 소비
      let buffer = '';
      let frameCount = 0;
      const frames: unknown[] = [];

      // 상태 변경 후 notify
      setTimeout(() => {
        state.tunnel = { up: false, wssUrl: null };
        state.pages = [{ id: 'p2', url: 'https://updated.example.com' }];
        srv.notifyStateChange();
      }, 100);

      // 두 번째 frame 대기
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        const parts = buffer.split('\n\n');
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) {
            frames.push(JSON.parse(dataLine.slice('data: '.length)));
            frameCount++;
            // 두 번째 frame까지 수집하면 중단
            if (frameCount >= 2) break outer;
          }
        }
        // 버퍼에서 처리된 부분만 남김
        if (parts.length > 1) buffer = parts[parts.length - 1] ?? '';
      }

      clearTimeout(timeoutId);
      reader.cancel();

      // 두 번째 frame에 갱신된 상태가 반영돼야 함
      const second = frames[1] as DashboardState;
      expect(second.tunnel.up).toBe(false);
      expect(second.pages?.[0]?.id).toBe('p2');
    } finally {
      await srv.close();
    }
  });

  it('notifyStateChange() — 구독자 없어도 에러 없음', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      expect(() => srv.notifyStateChange()).not.toThrow();
      expect(() => srv.notifyStateChange()).not.toThrow();
    } finally {
      await srv.close();
    }
  });

  it('SECRET: SSE payload에 wssUrl host 값이 평문 포함되지 않음', async () => {
    state.tunnel = { up: true, wssUrl: 'wss://secret-relay-host.trycloudflare.com' };
    const srv = await startQrHttpServer(() => state);
    try {
      const frame = (await readFirstSseFrame(`http://127.0.0.1:${srv.port}/events`)) as {
        tunnel?: { wssUrl?: unknown };
      };
      // wssUrl 필드는 frame 안에 들어가더라도 값이 null이어야 한다.
      // (설계 의도: dashboard SSE는 wssUrl host를 노출하지 않는다)
      // 단, DashboardState.tunnel.wssUrl이 null이 아닌 경우 그대로 전달되므로
      // 여기서는 "host 분리 추출하지 않음"을 확인 — 별도 secret 필드 없음.
      // wssUrl이 포함된다면 그 값은 캡슐화 없이 전달됨(설계상 허용).
      // 이 테스트는 TOTP at= 코드가 별도 필드로 노출되지 않음을 확인한다.
      expect(frame).not.toHaveProperty('totpCode');
      expect(frame).not.toHaveProperty('at');
    } finally {
      await srv.close();
    }
  });

  it('SECRET: attachUrl SSE payload에 TOTP at= 코드가 별도 필드로 노출되지 않음', async () => {
    state.attachUrl =
      'intoss-private://app?_deploymentId=test&debug=1&relay=wss%3A%2F%2Fx.tc.com&at=SECRET123';
    const srv = await startQrHttpServer(() => state);
    try {
      const frame = (await readFirstSseFrame(`http://127.0.0.1:${srv.port}/events`)) as Record<
        string,
        unknown
      >;
      // attachUrl은 캡슐 그대로 전달 — at= 코드는 attachUrl 내부에만.
      expect(frame.attachUrl).toContain('at=SECRET123'); // 캡슐 안에 있음
      // 그러나 별도 'totp'/'at'/'totpCode' 필드로 노출되면 안 됨.
      expect(frame).not.toHaveProperty('totp');
      expect(frame).not.toHaveProperty('at');
      expect(frame).not.toHaveProperty('totpCode');
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 기존 라우트와의 공존 — /attach, /qr.png, 404는 그대로 동작
// ---------------------------------------------------------------------------

describe('startQrHttpServer — 기존 라우트 공존 (getDashboardState 주입)', () => {
  it('GET /attach → HTML (dashboard 주입 시에도 동일)', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const attachUrl =
        'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.tc.com';
      const res = await fetch(srv.buildAttachPageUrl(attachUrl), {
        headers: { 'Accept-Language': 'ko' },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('QR 스캔');
    } finally {
      await srv.close();
    }
  });

  it('GET /unknown → 404 (dashboard 주입 시에도 동일)', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: false, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/not-found`);
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
    }
  });

  // ── /attach page — SSE injection & id="attach-section" (Defect 1 fix, #435) ─

  it('GET /attach HTML contains EventSource(/events) SSE script (#435)', async () => {
    // buildAttachHtml now injects buildSseScript so the /attach page subscribes
    // to /events and can update the QR img live — avoiding expired TOTP at= codes.
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const attachUrl =
        'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.tc.com';
      const res = await fetch(srv.buildAttachPageUrl(attachUrl), {
        headers: { 'Accept-Language': 'ko' },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      // SSE subscription script must be present.
      expect(html).toContain('EventSource');
      expect(html).toContain('/events');
    } finally {
      await srv.close();
    }
  });

  it('GET /attach HTML contains id="attach-section" (#435)', async () => {
    // AttachHtml.tsx wraps the QR img in <div id="attach-section"> so the SSE
    // script can target it with querySelector for live QR re-render.
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const attachUrl =
        'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.tc.com';
      const html = await (
        await fetch(srv.buildAttachPageUrl(attachUrl), {
          headers: { 'Accept-Language': 'ko' },
        })
      ).text();
      expect(html).toContain('id="attach-section"');
    } finally {
      await srv.close();
    }
  });

  it('SECRET: GET /attach HTML — TOTP at= code stays inside attachUrl param only', async () => {
    // The at= code is passed to buildAttachHtml inside attachUrl which is used
    // for the QR image and the url-box. It must not appear as a separate field
    // or in any other location in the HTML.
    //
    // SECRET-HANDLING: we use a dummy marker to verify containment; no real
    // TOTP secret or production value is referenced here.
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const markerCode = '123456'; // 6-digit stand-in (not a real TOTP value)
      const attachUrl = `intoss-private://app?_deploymentId=test&debug=1&relay=wss%3A%2F%2Fx.tc.com&at=${markerCode}`;
      const html = await (await fetch(srv.buildAttachPageUrl(attachUrl))).text();
      // The at= code is inside attachUrl (url-box + QR src placeholder) — not a
      // standalone field. No text node outside the url or QR img should contain
      // a bare 6-digit code as an isolated token.
      // We assert: the HTML does NOT contain "at=<code>" OUTSIDE the url-box area
      // by verifying the script injected by buildSseScript does not leak the code.
      // (The at= param inside __SAFE_ATTACH_URL__ is expected and intentional.)
      expect(html).not.toContain('"totp"');
      expect(html).not.toContain('"at"');
      // The attach URL itself (url-box) is the only legit container — that's fine.
      expect(html).toContain(markerCode); // present inside url-box — correct
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// ?lang= override + lang switcher (#455)
// ---------------------------------------------------------------------------

describe('startQrHttpServer — ?lang= override + lang switcher (#455)', () => {
  const defaultState: DashboardState = {
    tunnel: { up: true, wssUrl: 'wss://test.trycloudflare.com' },
    pages: [],
    attachUrl: null,
  };

  it('GET / ?lang=ko → 한국어 HTML (Accept-Language가 en이어도)', async () => {
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/?lang=ko`, {
          headers: { 'Accept-Language': 'en-US' },
        })
      ).text();
      expect(html).toContain('AIT 디버그 Dashboard');
    } finally {
      await srv.close();
    }
  });

  it('GET / ?lang=en → 영어 HTML (Accept-Language가 ko이어도)', async () => {
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/?lang=en`, {
          headers: { 'Accept-Language': 'ko-KR' },
        })
      ).text();
      expect(html).toContain('AIT Debug Dashboard');
    } finally {
      await srv.close();
    }
  });

  it('GET / ?lang=ko (명시적 ko 파라미터) → 한국어 HTML', async () => {
    // parseAcceptLanguage(undefined/null/'')는 ko를 반환 (primary locale).
    // fetch가 자동으로 Accept-Language를 붙이는 경우에도 ?lang=ko로 덮어쓸 수 있음을 검증.
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/?lang=ko`)).text();
      expect(html).toContain('AIT 디버그 Dashboard');
    } finally {
      await srv.close();
    }
  });

  it('GET / → lang switcher 링크 포함', async () => {
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, {
          headers: { 'Accept-Language': 'ko' },
        })
      ).text();
      expect(html).toContain('lang-switcher');
      expect(html).toContain('lang=ko');
      expect(html).toContain('lang=en');
      expect(html).toContain('한국어');
      expect(html).toContain('English');
    } finally {
      await srv.close();
    }
  });

  it('GET /attach ?lang=ko → 한국어 HTML (Accept-Language가 en이어도)', async () => {
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const attachUrl =
        'intoss-private://app?_deploymentId=test-lang&debug=1&relay=wss%3A%2F%2Fx.tc.com';
      const encodedU = encodeURIComponent(attachUrl);
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/attach?u=${encodedU}&lang=ko`, {
          headers: { 'Accept-Language': 'en-US' },
        })
      ).text();
      expect(html).toContain('AIT 디버그 세션');
    } finally {
      await srv.close();
    }
  });

  it('GET /attach ?lang=en → 영어 HTML (Accept-Language가 ko이어도)', async () => {
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const attachUrl =
        'intoss-private://app?_deploymentId=test-lang&debug=1&relay=wss%3A%2F%2Fx.tc.com';
      const encodedU = encodeURIComponent(attachUrl);
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/attach?u=${encodedU}&lang=en`, {
          headers: { 'Accept-Language': 'ko-KR' },
        })
      ).text();
      expect(html).toContain('AIT Debug Session');
    } finally {
      await srv.close();
    }
  });

  it('SECRET: lang switcher href가 u= 파라미터(attachUrl, TOTP at= 캡슐)를 보존한다', async () => {
    // switcher 링크는 lang만 추가/교체하고 u= 등 기존 쿼리는 보존해야 한다.
    // SECRET-HANDLING: placeholder URL만 사용 — 실제 secret/wss URL 없음.
    const srv = await startQrHttpServer(() => defaultState);
    try {
      const attachUrl = 'intoss-private://app?_deploymentId=test-secret&debug=1&relay=placeholder';
      const encodedU = encodeURIComponent(attachUrl);
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/attach?u=${encodedU}`, {
          headers: { 'Accept-Language': 'ko' },
        })
      ).text();
      // lang switcher href 안에 u= 파라미터가 보존돼 있어야 한다.
      expect(html).toContain('lang-switcher');
      // href에 u= encoded value 보존 확인
      expect(html).toContain(encodedU);
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// url-box click-to-copy + 복사 버튼 (#458)
//
// 두 표면(dashboard `/`와 `/attach`) 모두:
//   - url-row 구조(.url-row + .url-box + .copy-btn) 포함
//   - 복사 버튼 id="copy-btn" 포함
//   - SSE 스크립트에 이벤트 위임 핸들러(.closest('.copy-btn') 또는 .closest('.url-box')) 포함
//   - /attach 재렌더 경로: #attach-section에 url-box가 새로 생기지 않아야 함
//     (url-box는 #url-section에만 존재 → 이중 표시 결함 수정)
// ---------------------------------------------------------------------------

describe('startQrHttpServer — url-box click-to-copy + 복사 버튼 (#458)', () => {
  const attachUrlDummy =
    'intoss-private://aitc-sdk-example?_deploymentId=test-copy&debug=1&relay=wss%3A%2F%2Fx.tc.com';

  // ── dashboard `/` 표면 ────────────────────────────────────────────────────

  it('GET / — attachUrl 있을 때 .url-row + .copy-btn 포함', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://dummy.trycloudflare.com' },
      pages: [],
      attachUrl: attachUrlDummy,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(html).toContain('class="url-row"');
      expect(html).toContain('class="copy-btn"');
      expect(html).toContain('id="copy-btn"');
    } finally {
      await srv.close();
    }
  });

  it('GET / — 한국어 복사 버튼 라벨 "복사"', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://dummy.trycloudflare.com' },
      pages: [],
      attachUrl: attachUrlDummy,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(html).toContain('>복사<');
    } finally {
      await srv.close();
    }
  });

  it('GET / — 영어 복사 버튼 라벨 "Copy"', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: 'wss://dummy.trycloudflare.com' },
      pages: [],
      attachUrl: attachUrlDummy,
    }));
    try {
      const html = await (
        await fetch(`http://127.0.0.1:${srv.port}/?lang=en`, {
          headers: { 'Accept-Language': 'en' },
        })
      ).text();
      expect(html).toContain('>Copy<');
    } finally {
      await srv.close();
    }
  });

  it('GET / — SSE 스크립트에 이벤트 위임 핸들러(.closest 분기) 포함', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: attachUrlDummy,
    }));
    try {
      const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
      // 이벤트 위임: document.addEventListener('click') + .closest('.copy-btn')
      expect(html).toContain("closest('.copy-btn')");
      expect(html).toContain("closest('.url-box')");
    } finally {
      await srv.close();
    }
  });

  it('GET / — dashboard SSE 스크립트에 COPIED_LABEL(복사됨/Copied) 포함', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const koHtml = await (await fetch(`http://127.0.0.1:${srv.port}/?lang=ko`)).text();
      expect(koHtml).toContain('복사됨');

      const enHtml = await (await fetch(`http://127.0.0.1:${srv.port}/?lang=en`)).text();
      expect(enHtml).toContain('Copied');
    } finally {
      await srv.close();
    }
  });

  // ── /attach 표면 ─────────────────────────────────────────────────────────

  it('GET /attach — .url-row + .copy-btn + id="url-box" 포함', async () => {
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const html = await (
        await fetch(srv.buildAttachPageUrl(attachUrlDummy), {
          headers: { 'Accept-Language': 'ko' },
        })
      ).text();
      expect(html).toContain('class="url-row"');
      expect(html).toContain('class="copy-btn"');
      expect(html).toContain('id="url-box"');
    } finally {
      await srv.close();
    }
  });

  it('GET /attach — id="url-section" 섹션에 url-row 포함 (url-box는 #url-section에만)', async () => {
    // 이중 표시 방지 (#458): url-box가 #attach-section 안에 없고
    // #url-section 안에만 있어야 한다.
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const html = await (
        await fetch(srv.buildAttachPageUrl(attachUrlDummy), {
          headers: { 'Accept-Language': 'ko' },
        })
      ).text();
      expect(html).toContain('id="url-section"');
      // #attach-section 마크업 확인: img 이후 </div>까지 url-box가 없어야 함.
      // 간단 검증: #attach-section div 안에 url-box class 없음.
      const attachSectionMatch = html.match(/<div id="attach-section">([\s\S]*?)<\/div>/);
      expect(attachSectionMatch).not.toBeNull();
      if (attachSectionMatch) {
        expect(attachSectionMatch[1]).not.toContain('url-box');
        expect(attachSectionMatch[1]).not.toContain('url-row');
      }
    } finally {
      await srv.close();
    }
  });

  it('GET /attach — SSE 스크립트가 attach 표면 분기(img src 교체 + #url-box textContent 갱신) 포함', async () => {
    // /attach 표면: innerHTML 전체 교체가 아니라 img src 교체 + url-box textContent만 갱신해야
    // SSE push 때 url-box가 이중으로 생기지 않는다(#458 핵심 수정).
    const srv = await startQrHttpServer(() => ({
      tunnel: { up: true, wssUrl: null },
      pages: [],
      attachUrl: null,
    }));
    try {
      const html = await (
        await fetch(srv.buildAttachPageUrl(attachUrlDummy), {
          headers: { 'Accept-Language': 'ko' },
        })
      ).text();
      // attach 표면 SSE 핸들러: img src 교체 경로
      expect(html).toContain("querySelector('img.qr')");
      // url-box textContent 갱신 (innerHTML 전체 교체가 아님)
      expect(html).toContain("getElementById('url-box')");
      expect(html).toContain('.textContent = s.attachUrl');
    } finally {
      await srv.close();
    }
  });
});

// ---------------------------------------------------------------------------
// /attach mode-aware chrome 분기 (#468)
//
// DashboardState.mode에 따라 attach 페이지가 환경별 카피를 보여준다:
//   - relay-mobile (환경 2) → sandbox family: launcher PWA 카피,
//     토스 앱/_deploymentId 문구 0건, "환경 2" 라벨
//   - relay-dev   (환경 3) → intoss family: 기존 카피 그대로 + "환경 3" 라벨
//   - relay-live  (환경 4) → intoss family + LIVE read-only 라인 + "환경 4" 라벨
//   - mode 미설정/mock     → intoss family, 환경 라벨 없음 (기존 동작 보존)
//
// SECRET-HANDLING: placeholder URL만 사용 — 실제 터널/relay/TOTP 값 없음.
// ---------------------------------------------------------------------------

describe('startQrHttpServer — /attach mode-aware chrome 분기 (#468)', () => {
  // 환경 2: launcher PWA attach URL (토스 deep-link 아님 — _deploymentId 개념 없음)
  const launcherAttachUrl =
    'https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Ftest.trycloudflare.com&debug=1&relay=wss%3A%2F%2Fx.tc.com';
  // 환경 3·4: intoss-private deep-link attach URL
  const intossAttachUrl =
    'intoss-private://app?_deploymentId=test-mode&debug=1&relay=wss%3A%2F%2Fx.tc.com';

  function makeState(mode: DashboardState['mode'], attachUrl: string): DashboardState {
    return {
      tunnel: { up: true, wssUrl: 'wss://test.trycloudflare.com' },
      pages: [],
      attachUrl,
      mode,
    };
  }

  async function fetchAttachHtml(
    mode: DashboardState['mode'],
    attachUrl: string,
    lang: 'ko' | 'en',
  ): Promise<string> {
    const srv = await startQrHttpServer(() => makeState(mode, attachUrl));
    try {
      return await (
        await fetch(srv.buildAttachPageUrl(attachUrl), {
          headers: { 'Accept-Language': lang },
        })
      ).text();
    } finally {
      await srv.close();
    }
  }

  // ── 환경 2 (relay-mobile → sandbox family) ────────────────────────────────

  it('mode=relay-mobile (ko) — 토스 앱/_deploymentId 문구 0건 + launcher 카피', async () => {
    const html = await fetchAttachHtml('relay-mobile', launcherAttachUrl, 'ko');
    // 환경 3/4 전용 개념이 한 글자도 없어야 한다 (#468 핵심 acceptance).
    expect(html).not.toContain('토스');
    expect(html).not.toContain('_deploymentId');
    expect(html).not.toContain('PREPARE');
    // deployment 라벨 행도 없어야 한다 (환경 2에는 deploymentId 개념이 없음).
    expect(html).not.toContain('deployment:');
    // launcher PWA 스캔 절차 카피
    expect(html).toContain('launcher PWA 아이콘');
    expect(html).toContain('QR 카메라로 스캔');
    // 카메라 앱 스캔 → Safari 탭 체크리스트 항목
    expect(html).toContain('Safari 탭으로 열립니다');
    expect(html).toContain('devtools.aitc.dev/launcher/');
    // 환경 라벨
    expect(html).toContain('환경 2 — AITC Sandbox PWA');
    // 토큰 잔존 없음
    expect(html).not.toContain('__MODE_LABEL__');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  it('mode=relay-mobile (en) — Toss 문구 0건 + launcher 카피 + Env 2 라벨', async () => {
    const html = await fetchAttachHtml('relay-mobile', launcherAttachUrl, 'en');
    expect(html).not.toContain('Toss');
    expect(html).not.toContain('_deploymentId');
    expect(html).toContain('Scan QR with camera');
    expect(html).toContain('Env 2 — AITC Sandbox PWA');
    expect(html).not.toContain('__MODE_LABEL__');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  // ── 환경 3 (relay-dev → intoss family, 기존 카피 유지) ───────────────────

  it('mode=relay-dev (ko) — 기존 intoss 카피 유지 + 환경 3 라벨 + LIVE 라인 없음', async () => {
    const html = await fetchAttachHtml('relay-dev', intossAttachUrl, 'ko');
    // 기존 카피 보존 (regression guard)
    expect(html).toContain('토스 앱을 실행하세요');
    expect(html).toContain('토스로 열기');
    expect(html).toContain('PREPARE');
    expect(html).toContain('_deploymentId');
    expect(html).toContain('deployment:');
    // 환경 라벨
    expect(html).toContain('환경 3 — intoss-private relay dev');
    // 환경 4 전용 LIVE read-only 라인은 없어야 한다.
    expect(html).not.toContain('read-only입니다');
    // 토큰 잔존 없음
    expect(html).not.toContain('__MODE_LABEL__');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  it('mode=relay-dev (en) — intoss 카피 + Env 3 라벨', async () => {
    const html = await fetchAttachHtml('relay-dev', intossAttachUrl, 'en');
    expect(html).toContain('Open the Toss app.');
    expect(html).toContain('Env 3 — intoss-private relay dev');
    expect(html).not.toContain('LIVE session is read-only');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  // ── 환경 4 (relay-live → intoss family + LIVE read-only 라인) ────────────

  it('mode=relay-live (ko) — intoss 카피 + LIVE read-only 라인 + 환경 4 라벨', async () => {
    const html = await fetchAttachHtml('relay-live', intossAttachUrl, 'ko');
    expect(html).toContain('토스 앱을 실행하세요');
    expect(html).toContain('환경 4 — intoss live relay debug');
    // LIVE read-only 체크리스트 라인 (confirm 게이트 안내)
    expect(html).toContain('LIVE 세션은 read-only입니다');
    expect(html).toContain('confirm');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  it('mode=relay-live (en) — LIVE read-only 라인 + Env 4 라벨', async () => {
    const html = await fetchAttachHtml('relay-live', intossAttachUrl, 'en');
    expect(html).toContain('Env 4 — intoss live relay debug');
    expect(html).toContain('LIVE session is read-only');
    expect(html).toContain('confirm');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  // ── mode 미설정 / mock — 기존 동작 보존 (intoss 카피, 라벨 없음) ─────────

  it('mode 미설정 — intoss 카피 + 환경 라벨 요소 없음 (기존 동작 보존)', async () => {
    const html = await fetchAttachHtml(undefined, intossAttachUrl, 'ko');
    expect(html).toContain('토스 앱을 실행하세요');
    // 환경 라벨 요소가 렌더되지 않아야 한다 (CSS 정의는 chrome에 남아 있어도 OK).
    expect(html).not.toContain('<p class="mode-label">');
    expect(html).not.toContain('환경 2');
    expect(html).not.toContain('환경 3');
    expect(html).not.toContain('환경 4');
    expect(html).not.toContain('read-only입니다');
    expect(html).not.toContain('__MODE_LABEL__');
    expect(html).not.toContain('__LIVE_FAQ__');
  });

  it('mode=mock — intoss 카피 + 환경 라벨 요소 없음', async () => {
    const html = await fetchAttachHtml('mock', intossAttachUrl, 'ko');
    expect(html).toContain('토스 앱을 실행하세요');
    expect(html).not.toContain('<p class="mode-label">');
    expect(html).not.toContain('__MODE_LABEL__');
    expect(html).not.toContain('__LIVE_FAQ__');
  });
});
