/**
 * Mock runner — runs probes in a jsdom environment
 *
 * Strategy: bootstrap jsdom globals directly using the `jsdom` package
 * (same package vitest uses for its jsdom environment). This avoids spawning
 * a child process while matching the exact jsdom version vitest uses.
 */

import { JSDOM } from 'jsdom';
import { aitState } from '../../../src/mock/state.js';
import type { Probe, ProbeResult } from '../types.js';

/** Safely set a global, using defineProperty when direct assignment would throw. */
function setGlobal(key: string, value: unknown): void {
  try {
    (globalThis as unknown as Record<string, unknown>)[key] = value;
  } catch {
    // Property may have a read-only getter (e.g. navigator, screen on Node 24)
    try {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    } catch {
      // Silently skip properties that can't be overridden at all
    }
  }
}

/** Patch globalThis with a minimal jsdom window so mock imports work */
function setupJsdomGlobals(): void {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  const win = dom.window as unknown as Record<string, unknown>;

  // Patch globals that mock SDK code accesses
  const globals = [
    'window',
    'document',
    'navigator',
    'screen',
    'localStorage',
    'sessionStorage',
    'location',
    'history',
    'CustomEvent',
    'Event',
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
    'crypto',
  ];

  for (const key of globals) {
    if (win[key] !== undefined) {
      setGlobal(key, win[key]);
    }
  }

  // Ensure devicePixelRatio exists (jsdom may not set it)
  const winObj = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (winObj && !winObj.devicePixelRatio) {
    winObj.devicePixelRatio = 1;
  }
  if (!(globalThis as unknown as { devicePixelRatio?: unknown }).devicePixelRatio) {
    setGlobal('devicePixelRatio', 1);
  }
}

let jsdomInitialized = false;

function ensureJsdomGlobals(): void {
  if (!jsdomInitialized) {
    setupJsdomGlobals();
    jsdomInitialized = true;
  }
}

export async function runMockProbes(
  probes: Probe[],
  options: { includeWrites: boolean },
): Promise<ProbeResult[]> {
  ensureJsdomGlobals();

  // Reset aitState to a clean default before running probes
  aitState.reset();

  const results: ProbeResult[] = [];
  const filteredProbes = probes.filter((p) => options.includeWrites || !p.isWrite);

  for (const probe of filteredProbes) {
    try {
      const value = await probe.run();
      results.push({
        id: probe.id,
        domain: probe.domain,
        runner: 'mock',
        value,
      });
    } catch (err) {
      results.push({
        id: probe.id,
        domain: probe.domain,
        runner: 'mock',
        value: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
