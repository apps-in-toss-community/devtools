/**
 * 환경 2 로컬 PC 검증 — full attach → list_pages → measure_safe_area 루프
 *
 * WHAT THIS TEST PROVES:
 *   env-2 MCP-attach 관측 루프(attach → list_pages → measure_safe_area) 전체가
 *   로컬 PC에서 실기기 없이 동작한다. 이 테스트는 실제 `createFakeRelay`(노드 ws
 *   서버 + HTTP /targets 엔드포인트)에 연결된 `ChiiCdpConnection`을 구성하고,
 *   `measureSafeArea`가 relay의 `Runtime.evaluate` 응답을 파싱해 `SafeAreaMeasurement`를
 *   반환하는 전체 체인을 검증한다.
 *
 * RESIDUE (폰이 추가하는 것, 이 테스트의 갭이 아님):
 *   실기기 WebKit 엔진이 생성하는 실제 safe-area 수치(`env(safe-area-inset-*)`)는
 *   이 테스트가 확인하지 않는다 — CLAUDE.md §"실기기 미리보기 — 환경 2"가 명시하듯
 *   이것은 환경 2의 구조적 fidelity 천장(device-engine fidelity)이다. 루프 자체의
 *   검증 갭이 아니다. 실기기 WebKit 엔진 fidelity는 실기기에서만 얻을 수 있고,
 *   이 테스트가 확인하는 attach/observe 루프 자체는 완전히 로컬 PC에서 검증된다.
 *
 * PREVIOUS FRAMING CORRECTION (e2e/launcher-cdp.test.ts 헤더):
 *   기존 e2e 테스트는 "full loop에는 phone이 필요하다"고 기술했다. 이 테스트가 그
 *   결론을 수정한다: attach → list_pages → measure_safe_area 루프 자체는 완전히
 *   로컬 PC에서 검증 가능하다. 폰은 device-engine fidelity 수치(실 WebKit이 생성하는
 *   safe-area 픽셀 값)에만 필요하다.
 *
 * NO PRODUCTION CODE CHANGES:
 *   이 테스트는 src/in-app/gate.ts, src/in-app/attach.ts 등 프로덕션 코드를 수정하지
 *   않는다. localhost allowance를 gate에 추가하지 않는다. 모든 검증은 노드 측
 *   ChiiCdpConnection + 가짜 relay 서버를 통한다.
 *
 * SECRET-HANDLING: relay/tunnel URL은 wss-class 민감도다.
 *   이 테스트는 relay URL을 로그에 출력하지 않는다. TOTP·쿠키·키 없음.
 */

import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ChiiCdpConnection } from '../chii-connection.js';
import { measureSafeArea } from '../tools.js';

// ---------------------------------------------------------------------------
// Fake relay with Runtime.evaluate auto-responder
// ---------------------------------------------------------------------------

/**
 * Safe-area payload that the fake relay returns for a `Runtime.evaluate` request.
 *
 * Shape mirrors a real env-2 WebKit device response:
 *   - cssEnv:    top=44 (notch), bottom=34 (home indicator) — iPhone 14 Pro style
 *   - sdkInsets: null (no window.__sdk on a plain stub page — probe returns null)
 *   - sdkInsetsSource: null (no __sdk / __ait available)
 *   - sdkInsetsError: string (probe records the absence)
 *   - innerWidth/innerHeight: 390×844 (logical px, iPhone 14)
 *   - devicePixelRatio: 3
 *   - userAgent: stub value (not a real WebKit UA — this is a node stub)
 *
 * The probe expression in tools.ts returns JSON.stringify(result), so this
 * value must be the JSON-serialised string that `normalizeSafeAreaResult` parses.
 */
const STUB_SAFE_AREA_JSON = JSON.stringify({
  cssEnv: { top: 44, right: 0, bottom: 34, left: 0 },
  sdkInsets: null,
  sdkInsetsSource: null,
  sdkInsetsError: 'neither window.__sdk (relay) nor window.__ait (mock) available',
  navBarHeight: null,
  navBarHeightSource: 'not-exposed-by-sdk',
  innerWidth: 390,
  innerHeight: 844,
  devicePixelRatio: 3,
  userAgent: 'env2-local-loop-stub/1.0',
});

/**
 * A CDP `Runtime.evaluate` response frame.
 * `result.result.value` carries the safe-area JSON string so that
 * `normalizeSafeAreaResult(result.result.value, source)` succeeds.
 */
function makeSafeAreaResponse(id: number): object {
  return {
    id,
    result: {
      result: {
        type: 'string',
        value: STUB_SAFE_AREA_JSON,
      },
    },
  };
}

interface FakeAutoRelay {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Fake Chii relay for the env-2 local loop test.
 *
 * Unlike the plain fake in chii-connection.test.ts, this relay auto-responds
 * to `Runtime.evaluate` commands so that `measureSafeArea` resolves without
 * manual message injection from the test body. Other fire-and-forget enable
 * commands (Runtime.enable, Network.enable, …) are silently ignored.
 *
 * HTTP surface:
 *   GET /targets → { targets: [{ id, title, url }] }
 *
 * WS surface:
 *   Accepts any WS path (including /client/<id>?target=<targetId>).
 *   Reads inbound CDP frames; replies to Runtime.evaluate with safe-area data.
 */
async function createAutoRespondingRelay(): Promise<FakeAutoRelay> {
  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/targets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          targets: [
            {
              id: 'env2-target-1',
              title: 'Env-2 Stub Mini-App',
              url: 'https://stub.trycloudflare.com/',
            },
          ],
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    ws.on('message', (data: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('id' in parsed) ||
        !('method' in parsed)
      ) {
        return;
      }
      const frame = parsed as { id: number; method: string };

      // Auto-respond only to Runtime.evaluate — fire-and-forget enables have no id.
      if (frame.method === 'Runtime.evaluate' && typeof frame.id === 'number') {
        ws.send(JSON.stringify(makeSafeAreaResponse(frame.id)));
      }
      // All other commands (Runtime.enable, Network.enable, DOM.enable, etc.)
      // are fire-and-forget: no response expected.
    });
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('env-2 local-PC full loop — attach → list_pages → measure_safe_area', () => {
  it('full chain: ChiiCdpConnection attaches, lists target, and measureSafeArea returns SafeAreaMeasurement', async () => {
    const relay = await createAutoRespondingRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 5_000,
    });

    try {
      // --- Step 1: attach (refreshTargets + enableDomains) ---
      // refreshTargets() fetches /targets and registers the stub target.
      const beforeEnable = await conn.refreshTargets();
      expect(beforeEnable).toHaveLength(1);
      expect(beforeEnable[0]?.id).toBe('env2-target-1');

      // enableDomains() opens the WS client connection to the fake relay.
      // Fire-and-forget enable commands are sent but not awaited — the fake
      // relay silently discards them.
      await conn.enableDomains();

      // --- Step 2: list_pages ---
      // After enableDomains(), listTargets() (= list_pages) must return the
      // registered target. This is the synchronous cached view.
      const targets = conn.listTargets();
      expect(targets).toHaveLength(1);
      expect(targets[0]?.id).toBe('env2-target-1');
      expect(targets[0]?.title).toBe('Env-2 Stub Mini-App');

      // --- Step 3: measure_safe_area ---
      // measureSafeArea sends Runtime.evaluate over the relay WS connection.
      // The fake relay intercepts the command and replies with STUB_SAFE_AREA_JSON.
      // normalizeSafeAreaResult parses the JSON string and returns a typed object.
      const measurement = await measureSafeArea(conn, 'relay-mobile');

      // Assert the full SafeAreaMeasurement shape — this is exactly what the
      // production env-2 observe loop produces (minus real WebKit numbers).
      expect(measurement.source).toBe('relay-mobile');

      // cssEnv: the stub reflects env-2 iPhone-style insets.
      expect(measurement.cssEnv.top).toBe(44);
      expect(measurement.cssEnv.bottom).toBe(34);
      expect(measurement.cssEnv.right).toBe(0);
      expect(measurement.cssEnv.left).toBe(0);

      // sdkInsets: null — no window.__sdk or window.__ait on the stub page.
      expect(measurement.sdkInsets).toBeNull();
      expect(measurement.sdkInsetsSource).toBeNull();

      // sdkInsetsError: probe records the absence reason.
      expect(measurement.sdkInsetsError).toContain('window.__sdk');

      // Viewport geometry: matches STUB_SAFE_AREA_JSON.
      expect(measurement.innerWidth).toBe(390);
      expect(measurement.innerHeight).toBe(844);
      expect(measurement.devicePixelRatio).toBe(3);

      // userAgent: stub value (not a real WebKit UA — engine fidelity is
      // the one thing that requires a real device; see test header RESIDUE).
      expect(typeof measurement.userAgent).toBe('string');

      // navBarHeight: null (no .ait-navbar element in stub page).
      expect(measurement.navBarHeight).toBeNull();
    } finally {
      conn.close();
      await relay.close();
    }
  }, 10_000); // 10 s timeout — generously covers WS handshake on slow CI

  it('waitForFirstTarget resolves immediately when target is already registered', async () => {
    const relay = await createAutoRespondingRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 5_000,
    });

    try {
      // refreshTargets() registers the target; waitForFirstTarget fast-paths.
      await conn.refreshTargets();
      const targets = await conn.waitForFirstTarget((ts) => ts.length > 0, 2_000);
      expect(targets).toHaveLength(1);
      expect(targets[0]?.id).toBe('env2-target-1');
    } finally {
      conn.close();
      await relay.close();
    }
  });
});
