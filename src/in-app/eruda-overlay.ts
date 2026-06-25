/**
 * In-app eruda console overlay for the debug attach flow.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 *
 * This module mounts the eruda in-page console (https://github.com/liriliri/eruda)
 * on the phone screen when a debug session attaches. It is the mobile-only
 * counterpart to the Chii `target.js` injection in {@link attach.ts}: Chii is a
 * REMOTE CDP transport (phone → relay → PC DevTools frontend), whereas eruda is
 * a LOCAL in-page view — a floating button + console/network/DOM/storage panels
 * rendered directly on the phone, with no relay or second device. The two are
 * orthogonal and coexist (eruda opens no WebSocket, mounts into its own
 * `#eruda` shadow host — it cannot collide with the relay WS or the Chii DOM).
 *
 * Build-time absence (the security contract): this module lives in the
 * `@ait-co/devtools/in-app` graph. A consumer wraps its
 * `import('@ait-co/devtools/in-app')` call site in `if (__DEBUG_BUILD__) { … }`;
 * a release build folds that constant to `false` and dead-code-eliminates the
 * whole module — so eruda (and its dynamic `import('eruda')` chunk) is simply
 * absent from release bundles, exactly like the Chii target.js injection. The
 * `import('eruda')` here is a dynamic import precisely so the bundler emits it
 * as a separate chunk that the dead branch never pulls in.
 *
 * Runtime gate: `mountEruda()` is called only from `maybeAttach()` AFTER the
 * full Layer B/C gate has passed (`gateResult.attach === true`) — host
 * allowlist, `debug=1`, relay URL, and TOTP. So eruda inherits the same
 * four-layer defence as the Chii injection, byte-for-byte, with no eruda-
 * specific gate of its own.
 *
 * SECRET-HANDLING: this module reads no secret, TOTP code, relay URL, or host
 * value, and logs none. eruda observes only the page it is mounted on.
 */

/** Module-level guard against double mount across repeated `maybeAttach` calls. */
let erudaMounted = false;

/**
 * Mounts the eruda in-page console once.
 *
 * Idempotent: repeated calls after a successful mount are no-ops, mirroring the
 * `attached` guard in {@link attach.ts}. Fail-silent: if the dynamic import or
 * `eruda.init()` throws (eruda absent, or a runtime that rejects it), the Chii
 * debug session is unaffected — eruda is an additive convenience, not a
 * dependency of the relay path.
 *
 * `eruda.init()` mounts eruda's own floating entry button on the phone screen;
 * tapping it opens the console. We do not add a separate button.
 */
export async function mountEruda(): Promise<void> {
  if (erudaMounted || typeof document === 'undefined') {
    return;
  }
  // Set the guard before the await so a synchronous re-entrant call cannot
  // start a second import in flight.
  erudaMounted = true;
  try {
    const eruda = (await import('eruda')).default;
    eruda.init();
  } catch (err) {
    // Reset so a later attach can retry; never break the Chii session.
    erudaMounted = false;
    console.debug('[@ait-co/devtools] eruda console mount skipped:', err);
  }
}
