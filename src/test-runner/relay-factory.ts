/**
 * Relay connection factory for the Vitest custom pool (devtools#696).
 *
 * The Vitest pool (`pool.ts`) takes a {@link RelayConnectionFactory} that knows
 * how to `open()` a live CDP relay connection (boot relay → QR → phone scan →
 * cell inject → enableDomains) and `close()` it. Before this module that exact
 * assembly lived only inside the `devtools-test` CLI's `main()`; the standalone
 * CLI and the Vitest pool would otherwise each hand-roll it and drift.
 *
 * This is the single source of that assembly. `cli.ts` is refactored to call
 * `createRelayConnectionFactory(...).open()`, and `definePhoneVitestConfig`
 * (config.ts) exposes it so a downstream `vitest.config.ts` can wire the pool:
 *
 *   import { createRelayConnectionFactory } from '@ait-co/devtools/test-runner';
 *   const connection = createRelayConnectionFactory({ schemeUrl, cell });
 *   export default defineConfig({ test: definePhoneVitestConfig({ connection }) });
 *
 * The heavy boot graph (chii relay, cloudflared, ws, debug-server) is pulled via
 * DYNAMIC import inside `open()` — so merely importing this module (or the
 * `@ait-co/devtools/test-runner` barrel) does NOT statically drag that graph in.
 *
 * SECRET-HANDLING: relay wss URLs, scheme URLs, and the TOTP secret/code are
 * never logged. `open()` reads the project-local `.ait_relay` secret read-only
 * (never mints) and the minted TOTP code rides only inside the QR `at=` param.
 *
 * Node-only. react-free (CdpConnection + lazily-imported MCP boot helpers only).
 */

import type { AttachDeps } from '../mcp/attach-orchestrator.js';
import type { CdpConnection } from '../mcp/cdp-connection.js';
import type { RelayConnectionFactory } from './pool.js';

// NOTE: every value import below is a DYNAMIC import inside `open()`. This module
// keeps ONLY type-level static imports so that re-exporting it from the
// `@ait-co/devtools/test-runner` barrel (config.ts) does NOT statically drag the
// heavy MCP graph (cell.ts → attach-orchestrator.ts → tools.ts → server-lock,
// plus chii/cloudflared via debug-server) onto that Node-config entry.

/** Options for {@link createRelayConnectionFactory}. */
export interface RelayConnectionFactoryOptions {
  /**
   * intoss-private:// scheme URL from `ait deploy --scheme-only` (env3). The
   * phone cold-loads the candidate bundle this URL points at. SECRET-HANDLING:
   * never logged.
   */
  schemeUrl: string;
  /**
   * Project root for the `.ait_relay` secret lookup (read-only). Defaults to
   * `process.cwd()`.
   */
  projectRoot?: string;
  /**
   * Attach wait timeout in ms — how long `open()` waits for the phone to scan
   * the QR and attach. Defaults to 600 000 (10 min) to give time for a manual
   * scan. (The per-file evaluate timeout is separate, passed via the pool's
   * `run` options.)
   */
  timeoutMs?: number;
  /** Disable browser auto-open of the QR dashboard (text QR only). */
  headless?: boolean;
  /**
   * Cell axes injected as `__AIT_CELL__` before the first test bundle runs, so
   * sdk-example's capture picks up the correct sdkLine/platform. Optional — when
   * omitted no cell is injected. The values are not secrets.
   */
  cell?: { sdkLine: string; platform: string };
  /**
   * Receives the QR/attach render content (text chunks) from
   * `renderAndMaybeWait`, so a caller (the `devtools-test` CLI) can decide
   * whether to print them — e.g. suppress on non-interactive stdout. When this
   * hook is omitted, `open()` prints the chunks to stdout itself (standalone
   * default).
   *
   * SECRET-HANDLING: these chunks contain the QR payload (which encodes the
   * relay wss + TOTP `at=` code) and the attach JSON block. The hook owns the
   * stdout decision — when a non-interactive caller is detected it MUST suppress
   * the whole chunk (not just `attachUrl`), since `relayUrl` rides in the same
   * block.
   */
  onQrContent?: (textChunks: string[]) => void;
}

/**
 * Builds a {@link RelayConnectionFactory} that opens a standalone env3 relay
 * connection.
 *
 * `open()` performs the full attach lifecycle and BLOCKS for tens of seconds (up
 * to `timeoutMs`) while a human scans the rendered QR with their phone — there
 * is no way around the manual scan for env3. It resolves with the live
 * `CdpConnection` once a matching page attaches; `close()` tears the relay
 * family down.
 *
 * The factory holds the booted relay family in a closure so `close()` can stop
 * it. A second `open()` on the same factory boots a fresh family (the previous
 * one should have been `close()`d first).
 */
export function createRelayConnectionFactory(
  opts: RelayConnectionFactoryOptions,
): RelayConnectionFactory {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const headless = opts.headless === true;

  // Captured so close() can stop the family that open() booted.
  let family: { connection: CdpConnection; stop(): void } | undefined;

  return {
    async open(): Promise<CdpConnection> {
      // Dynamic imports: keep the chii/cloudflared/debug-server graph OFF the
      // static import graph of this module (and the test-runner config barrel).
      const { prepareAttach, renderAndMaybeWait } = await import('../mcp/attach-orchestrator.js');
      const { injectDebugIndicator, injectGlobals } = await import('./cell.js');
      const { loadRelaySecretReadOnly } = await import('../mcp/relay-secret-store.js');
      const { bootRelayFamily, buildRelayVerifyAuth } = await import('../mcp/debug-server.js');

      // Load the project-local .ait_relay secret into AIT_DEBUG_TOTP_SECRET
      // BEFORE booting the relay so assertRelayAuthConfigured()/buildRelayVerifyAuth()
      // at the boot site see it. Read-only — never mints. SECRET-HANDLING: the
      // value is never logged here.
      await loadRelaySecretReadOnly({ projectRoot });

      const booted = await bootRelayFamily({ verifyAuth: buildRelayVerifyAuth() });
      family = booted;

      // Assemble AttachDeps with no dashboard/SSE (CLI/pool is not the daemon).
      const attachDeps: AttachDeps = {
        getTunnelStatus: booted.getTunnelStatus ?? (() => ({ up: false, wssUrl: null })),
        getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
        qrHttpServer: undefined,
        onAttachUrlBuilt: undefined,
        canOpenBrowser: () => !headless,
      };

      const prep = await prepareAttach(
        attachDeps,
        'relay-dev',
        { scheme_url: opts.schemeUrl },
        booted.connection,
      );
      if (!prep.ok) {
        const errText = prep.error.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        booted.stop();
        family = undefined;
        throw new Error(`createRelayConnectionFactory: attach preparation failed:\n${errText}`);
      }

      // Render the QR + wait for the phone to attach. SECRET-HANDLING: this
      // function never logs scheme/wss/TOTP values.
      const waitResult = await renderAndMaybeWait(
        attachDeps,
        prep,
        true,
        timeoutMs,
        booted.connection,
      );
      if (waitResult.isError) {
        const errText = waitResult.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        booted.stop();
        family = undefined;
        throw new Error(`createRelayConnectionFactory: attach timed out or failed:\n${errText}`);
      }

      // Surface the QR/attach render content. The caller (CLI) decides whether
      // to print it (e.g. suppress on non-interactive stdout); without a hook we
      // print it ourselves so a standalone `open()` still shows the QR.
      const qrChunks = waitResult.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text);
      if (opts.onQrContent) {
        opts.onQrContent(qrChunks);
      } else {
        for (const chunk of qrChunks) process.stdout.write(`${chunk}\n`);
      }

      // Debugger attached — show the on-phone "Debugger Connected" badge.
      await injectDebugIndicator(booted.connection);

      // Inject the cell globals before any test bundle runs (session-global).
      if (opts.cell !== undefined) {
        await injectGlobals(booted.connection, { __AIT_CELL__: opts.cell });
      }

      // Open the CDP client websocket + enable domains so the first run's
      // Runtime.evaluate and console stream are live. enableDomains is
      // idempotent; runTestFilesOverRelay also calls it defensively.
      await booted.connection.enableDomains();

      return booted.connection;
    },

    async close(_connection: CdpConnection): Promise<void> {
      // family.stop() is synchronous best-effort: closes the CDP connection and
      // shuts down the relay + cloudflared child.
      family?.stop();
      family = undefined;
    },
  };
}
