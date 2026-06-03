/**
 * Local-PC end-to-end verification for env-2 MCP-attach (issue #378).
 *
 * WHAT THIS TEST COVERS (automated):
 *   1. startChiiRelay({port:0}) starts a real Chii relay on a random port and
 *      returns a valid baseUrl + port. The /targets HTTP endpoint is reachable.
 *   2. buildLauncherAttachUrl() produces a URL whose params are correctly forwarded
 *      by the launcher page into the framed app iframe (browser-side, Playwright).
 *   3. When the launcher is navigated with ?debug=1&relay=<ws> pointing at the
 *      local relay, the iframe src carries those params — the launcher's deep-link
 *      forwarding logic works end-to-end.
 *   4. ChiiCdpConnection.refreshTargets() on the node side returns an empty list
 *      when no phone has attached — the relay is up and responsive.
 *
 * CORRECTION — LOCAL-PC VERIFIABILITY OF THE FULL RELAY LOOP:
 *   The node-side test in src/mcp/__tests__/env2-local-loop.test.ts (added in
 *   issue #378 PR-2) proves that the FULL attach → list_pages → measure_safe_area
 *   chain runs on the local PC without a phone. That test spins a fake Chii relay
 *   (node ws server), registers a stub target, drives ChiiCdpConnection through
 *   enableDomains() → listTargets() → measureSafeArea(), and asserts the returned
 *   SafeAreaMeasurement has the correct shape and source: 'relay-mobile'.
 *
 *   What a phone adds is ONLY real-device WebKit engine fidelity — the actual
 *   env(safe-area-inset-*) pixel values a real iPhone/Android WebKit produces.
 *   This is env-2's stated fidelity ceiling (CLAUDE.md §"실기기 미리보기 — 환경 2",
 *   umbrella CLAUDE.md §1.1 fidelity ladder). It is NOT a gap in the relay/CDP
 *   verification loop. The loop itself is fully local-verifiable.
 *
 * DOCUMENTED RESIDUE IN THIS E2E TEST (browser-side target.js injection):
 *   The items below explain why this Playwright test cannot verify browser-side
 *   target.js injection into the iframe. They are code-policy artifacts of the
 *   production gate wiring — NONE of them binds the node-side relay verification.
 *
 *   A. Layer B1 gate (src/in-app/gate.ts): the in-app attach guard only allows
 *      *.trycloudflare.com and *.private-apps.tossmini.com hostnames. The Playwright
 *      fixture runs on http://localhost:4173 — localhost is explicitly BLOCKED. Even
 *      though main.ts now imports @ait-co/devtools/in-app conditionally and calls
 *      maybeAttach(), the gate rejects the call before injecting target.js.
 *      → In a real env-2 session the fixture is served from a trycloudflare.com tunnel
 *        and this gate is satisfied automatically.
 *      → Node-side: irrelevant — the node CDP client drives the relay directly,
 *        bypassing the in-app gate entirely (see env2-local-loop.test.ts).
 *
 *   B. ws:// vs wss://: the relay listens on ws://127.0.0.1:<port>. Layer C2 of the
 *      gate requires wss: (secure websocket). The relay URL used in this test uses
 *      ws:// since there is no cloudflared tunnel in CI.
 *      → In a real env-2 session the relay is exposed via a second cloudflared tunnel
 *        (tunnel:{cdp:true} in unplugin) so the wssUrl is wss://*.trycloudflare.com.
 *      → Node-side: the real transport works over plain ws://127.0.0.1 — ChiiCdpConnection
 *        derives ws:// from the relayBaseUrl directly. The wss requirement is a
 *        STRING-SHAPE policy of the in-app gate only (see env2-local-loop.test.ts).
 *
 *   C. Cross-origin iframe CDP injection: even if the gate were satisfied, Playwright
 *      running in Chromium cannot inject a Chii target.js script into a cross-origin
 *      iframe (the framed app would be at a different trycloudflare.com subdomain
 *      than the launcher). This is a browser security boundary, not a code bug.
 *      → In a real env-2 session the launcher and the framed app share the same
 *        trycloudflare.com subdomain via a single tunnel URL, so same-origin policy
 *        is satisfied within the launcher iframe.
 *      → Node-side: not applicable — no browser involved.
 *
 * MANUAL VERIFICATION PROCEDURE (env-2 full loop with real WebKit engine numbers):
 *   1. Start the fixture with `AIT_TUNNEL_CDP=1 pnpm exec vite --config
 *      e2e/fixture/vite.config.ts`. The unplugin prints two URLs:
 *        • App tunnel:   https://<A>.trycloudflare.com (set as AIT_TUNNEL_BASE_URL)
 *        • Relay tunnel: wss://<B>.trycloudflare.com  (relay wss, used for relay)
 *   2. Export both env vars and start the MCP server in mobile mode:
 *        AIT_RELAY_BASE_URL=https://<B>.trycloudflare.com \
 *        AIT_TUNNEL_BASE_URL=https://<A>.trycloudflare.com \
 *        npx @ait-co/devtools devtools-mcp
 *      In a new Claude Code session, call start_debug({mode:'mobile'}).
 *   3. Call build_attach_url(). The tool returns a launcher QR.
 *      The QR URL is: https://devtools.aitc.dev/launcher/?url=<A>&debug=1&relay=<B-wss>
 *   4. Install the launcher PWA at https://devtools.aitc.dev/launcher/ on the phone
 *      (one-time). Open the phone camera, scan the QR.
 *   5. The launcher opens, frames https://<A>.trycloudflare.com with
 *      ?debug=1&relay=<B-wss> appended. Layer B1 (*.trycloudflare.com host) and
 *      Layer C1/C2 (debug=1, wss relay) are satisfied. Chii target.js is injected.
 *   6. Call list_pages() — expect one page entry. Call measure_safe_area() to get
 *      real WebKit engine safe-area numbers from the device.
 */

import { expect, test } from '@playwright/test';
import { ChiiCdpConnection } from '../src/mcp/chii-connection.js';
import { startChiiRelay } from '../src/mcp/chii-relay.js';
import { buildLauncherAttachUrl } from '../src/mcp/deeplink.js';

// ---------------------------------------------------------------------------
// Node-side relay lifecycle tests (no browser required)
// ---------------------------------------------------------------------------

test.describe('env-2 relay — node-side lifecycle', () => {
  test('startChiiRelay({port:0}) starts and /targets endpoint is reachable', async () => {
    const relay = await startChiiRelay({ port: 0 });
    try {
      expect(relay.port).toBeGreaterThan(0);
      expect(relay.baseUrl).toBe(`http://127.0.0.1:${relay.port}`);

      // The /targets HTTP endpoint must respond with a JSON body.
      const res = await fetch(`${relay.baseUrl}/targets`);
      expect(res.ok).toBe(true);
      const body: unknown = await res.json();
      // Chii returns { targets: [] } when no phone is attached.
      expect(body).toMatchObject({ targets: expect.any(Array) });
    } finally {
      await relay.close();
    }
  });

  test('ChiiCdpConnection.refreshTargets() returns empty list when no phone attached', async () => {
    // Start a local relay on a random port.
    const relay = await startChiiRelay({ port: 0 });
    try {
      const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

      // refreshTargets() polls the relay's /targets endpoint. With no phone,
      // it should resolve to an empty array (not throw).
      const targets = await conn.refreshTargets();
      expect(Array.isArray(targets)).toBe(true);
      expect(targets).toHaveLength(0);

      // listTargets() is the synchronous cached view — also empty.
      expect(conn.listTargets()).toHaveLength(0);
    } finally {
      await relay.close();
    }
  });

  test('two relays on port:0 get distinct ports', async () => {
    const [a, b] = await Promise.all([startChiiRelay({ port: 0 }), startChiiRelay({ port: 0 })]);
    try {
      expect(a.port).toBeGreaterThan(0);
      expect(b.port).toBeGreaterThan(0);
      expect(a.port).not.toBe(b.port);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});

// ---------------------------------------------------------------------------
// buildLauncherAttachUrl shape tests (pure, no network)
// ---------------------------------------------------------------------------

test.describe('buildLauncherAttachUrl — URL shape', () => {
  const LAUNCHER_BASE = 'https://devtools.aitc.dev/launcher/';

  test('produces a valid launcher URL with url=, debug=1, relay= params', () => {
    const tunnelUrl = 'https://abc.trycloudflare.com';
    const wssUrl = 'wss://relay.trycloudflare.com';
    const out = buildLauncherAttachUrl(tunnelUrl, wssUrl);
    const parsed = new URL(out);

    expect(out.startsWith(LAUNCHER_BASE)).toBe(true);
    expect(parsed.searchParams.get('url')).toBe(tunnelUrl);
    expect(parsed.searchParams.get('debug')).toBe('1');
    expect(parsed.searchParams.get('relay')).toBe(wssUrl);
    expect(parsed.searchParams.has('at')).toBe(false);
  });

  test('appends at= only when totpCode is provided and non-empty', () => {
    const out = buildLauncherAttachUrl('https://t.example.com', 'wss://r.example.com', '123456');
    expect(new URL(out).searchParams.get('at')).toBe('123456');

    const outNoCode = buildLauncherAttachUrl('https://t.example.com', 'wss://r.example.com');
    expect(new URL(outNoCode).searchParams.has('at')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Browser-side launcher deep-link forwarding (Playwright, against preview server)
// ---------------------------------------------------------------------------

test.describe('launcher deep-link forwarding — env-2 CDP params', () => {
  test('launcher forwards ?debug=1&relay= params onto the iframe src', async ({ page }) => {
    // Use a placeholder tunnel URL that the launcher will frame.
    // The launcher validates ?url= as http(s); we use https://example.com.
    const tunnelUrl = 'https://example.com/';

    // Use a ws:// relay URL — this is what a local-PC relay produces (no tunnel).
    // In a real env-2 session this would be wss://*.trycloudflare.com.
    // The gate (Layer C2) requires wss:, so the injected target.js would be
    // blocked on localhost — see the DOCUMENTED MANUAL RESIDUE header comment.
    const wsRelayUrl = `ws://127.0.0.1:12345`; // port intentionally unbound — only tests URL forwarding

    const launcherUrl =
      `/launcher/?url=${encodeURIComponent(tunnelUrl)}` +
      `&debug=1&relay=${encodeURIComponent(wsRelayUrl)}`;

    await page.goto(launcherUrl);

    // The launcher must show the frame (setup hidden) and forward the params.
    await expect(page.getByTestId('launcher-setup')).toBeHidden();
    const frame = page.getByTestId('launcher-frame');
    await expect(frame).toBeVisible();

    // Verify that debug=1 and relay= are forwarded onto the iframe src.
    // This exercises the launcher's param-forwarding logic end-to-end.
    const src = await frame.getAttribute('src');
    expect(src).toBeTruthy();
    const parsed = new URL(src ?? '');
    expect(parsed.searchParams.get('debug')).toBe('1');
    expect(parsed.searchParams.get('relay')).toBe(wsRelayUrl);

    // The launcher's own ?url= is consumed (not re-added to iframe src).
    await expect(page).toHaveURL(/\/launcher\/$/);
  });

  test('buildLauncherAttachUrl → launcher param roundtrip', async ({ page }) => {
    // Build the launcher URL the same way build_attach_url does in relay-mobile mode.
    const tunnelUrl = 'https://example.com/';
    const wssUrl = 'wss://relay-abc.trycloudflare.com';
    const launcherAttachUrl = buildLauncherAttachUrl(tunnelUrl, wssUrl);

    // Navigate to the launcher using the path + search from the synthesized URL.
    const parsed = new URL(launcherAttachUrl);
    await page.goto(`/launcher/${parsed.search}`);

    const frame = page.getByTestId('launcher-frame');
    await expect(frame).toBeVisible();

    const src = await frame.getAttribute('src');
    const frameParsed = new URL(src ?? '');
    expect(frameParsed.searchParams.get('debug')).toBe('1');
    expect(frameParsed.searchParams.get('relay')).toBe(wssUrl);
  });
});
