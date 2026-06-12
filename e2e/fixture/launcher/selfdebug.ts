// Launcher self-target opt-in (issue #531) — no DOM, no library imports so
// this module is unit-testable under vitest (jsdom) without the launcher's
// heavy top-level imports (same pattern as entry.ts / letterbox.ts).
//
// When the launcher URL carries `selfdebug=1` together with the standard
// debug params (`relay=<wss>`, `at=<totp>`), the launcher DOCUMENT ITSELF is
// registered as a Chii CDP target — not the mini-app iframe.
//
// Design notes:
//   - Opt-in ONLY. Without `selfdebug=1` this module is a no-op: zero extra
//     code runs and the existing behaviour is byte-identical.
//   - Single-attach model (last-attach-wins): once the launcher self-target
//     connects to the relay, any previously-connected mini-app target is
//     evicted. This is intentional — self-debug is a "launcher diagnostics
//     mode" and does NOT imply simultaneous attachment to the mini-app target.
//   - Registration happens at launcher boot (before any mini-app is launched),
//     so it is useful for diagnosing the launcher document itself — geometry,
//     styles, safe-area insets, service-worker state, etc.
//   - The relay and TOTP parameters are the same ones used by the existing
//     debug flow (forwarded from the launcher deep-link to the mini-app iframe).
//     No new secret surface is introduced.
//   - SECRET-HANDLING: relay host and TOTP code are NEVER logged to the
//     console, surfaced in the UI, or sent via postMessage. They ride only
//     inside the derived target.js script URL (the intended transport, same
//     exposure grade as the existing attach path).

/** Parameters parsed from the launcher URL for self-debug mode. */
export interface SelfDebugParams {
  /** The validated `wss:` relay URL. */
  readonly relayUrl: string;
  /** The TOTP code from the `at=` query param, or empty string if absent. */
  readonly atCode: string;
}

/** Result of {@link parseSelfDebugParams}. */
export type SelfDebugParseResult =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly params: SelfDebugParams };

/**
 * Parses the launcher URL search string and determines whether self-debug
 * mode is requested.
 *
 * Self-debug is active when ALL of the following are present:
 *   1. `selfdebug=1`        — explicit opt-in
 *   2. `relay=<wss-url>`    — valid `wss:` relay WebSocket URL
 *
 * `at=<totp-code>` is optional (TOTP disabled if absent). When present it is
 * forwarded into the target.js script URL (TOTP path-prefix transport — same
 * mechanism as {@link deriveTargetScriptUrl} in `src/in-app/attach.ts`).
 *
 * Pure function — no DOM, no side effects.
 *
 * @param searchStr - The URL search string to inspect (e.g. `location.search`).
 */
export function parseSelfDebugParams(searchStr: string): SelfDebugParseResult {
  const params = new URLSearchParams(searchStr);

  // C1 — explicit opt-in
  if (params.get('selfdebug') !== '1') {
    return { enabled: false };
  }

  // C2 — relay URL must be a valid `wss:` URL
  const relayRaw = params.get('relay') ?? '';
  if (relayRaw === '') {
    return { enabled: false };
  }
  let relayUrl: URL;
  try {
    relayUrl = new URL(relayRaw);
  } catch {
    return { enabled: false };
  }
  if (relayUrl.protocol !== 'wss:') {
    return { enabled: false };
  }

  // `at=` is optional — forward as-is (empty string = TOTP disabled)
  const atCode = params.get('at') ?? '';

  return { enabled: true, params: { relayUrl: relayUrl.href, atCode } };
}

/**
 * Derives the Chii `target.js` script URL from a relay `wss:` URL and an
 * optional TOTP code.
 *
 * Mirrors {@link deriveTargetScriptUrl} from `src/in-app/attach.ts`:
 *   - `wss:` → `https:`
 *   - pathname → `/target.js` (or `/at/<code>/target.js` with TOTP)
 *   - search and hash are stripped
 *
 * Pure function — no DOM, no side effects.
 *
 * SECRET-HANDLING: `atCode` rides only in the returned URL. It is never logged.
 */
export function deriveSelfTargetScriptUrl(relayUrl: string, atCode: string): string {
  const u = new URL(relayUrl);
  u.protocol = 'https:';
  u.pathname = atCode !== '' ? `/at/${encodeURIComponent(atCode)}/target.js` : '/target.js';
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** Module-level guard against double-injection within a page lifecycle. */
let selfAttached = false;

/**
 * Resets the `selfAttached` guard to `false`.
 *
 * **Test-only** — exported exclusively so vitest can reset module state between
 * test cases without reloading the module. Do not call this in production code.
 */
export function _resetSelfAttachedForTest(): void {
  selfAttached = false;
}

/**
 * Injects the Chii `target.js` script into the launcher document, registering
 * the launcher document itself as a CDP target on the relay.
 *
 * Called at launcher boot when `parseSelfDebugParams` returns `enabled: true`.
 * Idempotent — safe to call more than once.
 *
 * **Single-attach model (last-attach-wins)**: once this self-target connects,
 * the relay will evict any previously-connected mini-app target. This is
 * intentional — self-debug is a "launcher diagnostics mode" and does not
 * require simultaneous attachment to the mini-app page.
 *
 * **Secret-handling**: the relay host and TOTP code are not logged to the
 * console, not surfaced in the UI, and not sent via postMessage. The `at`
 * code rides only inside the script `src` attribute (same transport as the
 * existing mini-app attach path).
 *
 * @param params - Pre-parsed self-debug parameters from
 *   {@link parseSelfDebugParams}. Passing them explicitly keeps this function
 *   testable without manipulating `window.location`.
 */
export function injectSelfTarget(params: SelfDebugParams): void {
  if (selfAttached) return;
  if (typeof document === 'undefined') return;

  const src = deriveSelfTargetScriptUrl(params.relayUrl, params.atCode);

  // Guard against a script with the same src already in the DOM.
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing !== null) {
    selfAttached = true;
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  (document.head ?? document.documentElement).appendChild(script);

  selfAttached = true;
}

/**
 * Reads `window.location.search` and, when `selfdebug=1` is present with a
 * valid relay URL, injects the Chii `target.js` script into the launcher
 * document.
 *
 * Entry-point used by `Launcher.tsx` on mount. Exported so the caller does not
 * need to import the other symbols.
 *
 * Without `selfdebug=1` this is a cheap string parse that returns immediately
 * — no observable side effects.
 */
export function maybeAttachSelf(): void {
  if (typeof window === 'undefined') return;
  const result = parseSelfDebugParams(window.location.search);
  if (!result.enabled) return;
  injectSelfTarget(result.params);
}

/**
 * Parses self-debug parameters from a raw scanned URL string (the QR payload).
 *
 * This is the companion to {@link parseSelfDebugParams} for the in-app QR scan
 * path (issue #535). In standalone PWA mode the launcher boots via start_url
 * (no query string), so `maybeAttachSelf()` cannot fire on mount. Instead,
 * `showLive()` calls this helper to detect `selfdebug=1` in the scanned
 * launcher URL and inject the self-target on the fly.
 *
 * The raw string is a full launcher URL such as:
 *   `https://devtools.aitc.dev/launcher/?url=https://…&selfdebug=1&relay=wss://…&at=…`
 *
 * Only launcher-style URLs (those containing a `url=` param) are inspected —
 * a direct tunnel URL cannot carry selfdebug params. Returns `{ enabled: false }`
 * for direct tunnel URLs, unparseable strings, or URLs without `selfdebug=1`.
 *
 * Pure function — no DOM, no side effects.
 *
 * @param rawScanned - The raw string from the QR scanner (launcher URL).
 */
export function parseSelfDebugFromScannedUrl(rawScanned: string): SelfDebugParseResult {
  if (!rawScanned) return { enabled: false };
  let parsed: URL;
  try {
    parsed = new URL(rawScanned);
  } catch {
    return { enabled: false };
  }
  // Only launcher-style URLs (with `url=` param) can carry selfdebug params.
  if (!parsed.searchParams.has('url')) return { enabled: false };
  return parseSelfDebugParams(parsed.search);
}
