/**
 * Relay runner — runs probes via an attached device's CDP session
 *
 * TODO (follow-up issue): implement CDP Runtime.evaluate calls via the
 * Debugging MCP (devtools MCP server, `mcp__ait-devtools__*` tools).
 *
 * The relay runner requires:
 *   1. A real device attached via `pnpm qa:fidelity --runner=relay` (or `both`)
 *   2. The devtools MCP server running and a page attached
 *   3. A CDP Runtime.evaluate call per probe, executed in the page context
 *
 * Design pointer: see umbrella meta/four-environments-fidelity.md §1.1 (환경 3·4)
 * and src/mcp/ for the CDP relay infrastructure.
 *
 * Follow-up: devtools#261 relay runner implementation
 */

import type { Probe, ProbeResult } from '../types.js';

export async function runRelayProbes(
  _probes: Probe[],
  _options: { includeWrites: boolean },
): Promise<ProbeResult[]> {
  throw new Error(
    'Relay runner is not yet implemented. ' +
      'It requires an attached device via the devtools Debugging MCP (CDP relay). ' +
      'See follow-up: devtools#261 relay runner implementation.',
  );
}
