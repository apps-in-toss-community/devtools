/**
 * Relay runner — runs probes via an attached device's CDP session
 *
 * Current state: stub. Full CDP Runtime.evaluate implementation is tracked
 * in devtools#261 (relay runner implementation).
 *
 * This runner is activated when:
 *   - --runner=relay or --runner=both AND
 *   - WSS_URL environment variable is set (wss://... relay WebSocket URL)
 *
 * When WSS_URL is absent the CLI silently downgrades to mock-only so CI
 * can always run without a real device. See index.ts parseArgs().
 *
 * Design pointer: see umbrella meta/four-environments-fidelity.md §1.1 (환경 3·4)
 * and src/mcp/ for the CDP relay infrastructure.
 *
 * Scenario parity diff whitelist entries for relay-side differences:
 *   - scenario-parity.measureSafeArea.source      → "relay" vs "mock"
 *   - scenario-parity.measureSafeArea.sdkInsets   → real device values vs mock defaults
 *   - scenario-parity.measureSafeArea.userAgent   → real device UA vs desktop Chrome UA
 *   - scenario-parity.callSdkGetOpEnv.environment → "dev"/"production" vs "sandbox"
 *
 * Follow-up: devtools#261 relay runner implementation
 */

import type { Probe, ProbeResult } from '../types.js';

export async function runRelayProbes(
  _probes: Probe[],
  _options: { includeWrites: boolean },
): Promise<ProbeResult[]> {
  const wssUrl = process.env.WSS_URL;

  if (!wssUrl) {
    // Should not reach here — parseArgs() downgrades runner to mock when WSS_URL absent.
    // Guard here for direct imports.
    throw new Error(
      'Relay runner requires WSS_URL environment variable (wss://... relay WebSocket URL). ' +
        'Set WSS_URL=wss://... or use --runner=mock for CI mode.',
    );
  }

  // Full CDP relay implementation tracked in devtools#261.
  // When WSS_URL is present but implementation is not yet done, we surface a
  // clear stub error rather than silently passing.
  throw new Error(
    `Relay runner is not yet fully implemented (devtools#261). ` +
      `WSS_URL is set to: ${wssUrl.slice(0, 30)}... ` +
      'Use --runner=mock for now.',
  );
}
