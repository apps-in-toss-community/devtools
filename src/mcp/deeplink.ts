/**
 * URL of the AITC Sandbox launcher PWA.
 *
 * Declared here (not imported from `src/unplugin/tunnel.ts`) to respect the
 * mcp → unplugin layering boundary. unplugin/tunnel.ts declares its own copy
 * for the same reason — keep the two in sync when the URL changes.
 */
const LAUNCHER_URL = 'https://devtools.aitc.dev/launcher/';

/**
 * Optional metadata that enriches the launcher deep-link (#498).
 *
 * These fields are added as query params so the launcher PWA can display
 * a recognizable identity (name, icon) without the user having to configure
 * anything extra.
 */
export interface LauncherAttachUrlOpts {
  /**
   * Human-readable app name shown in the partner nav bar (`name=` param).
   * Blank / whitespace-only values are not added.
   */
  name?: string;
  /**
   * Absolute `https://` icon URL for the partner nav bar icon slot (`icon=`
   * param). Non-https or falsy values are not added.
   */
  icon?: string;
  /**
   * When `true`, adds `selfdebug=1` to the launcher URL so the launcher PWA
   * registers its own document as a CDP target (issue #531/#543).
   *
   * **Single-attach model**: attaching the launcher self-target causes any
   * currently-attached mini-app target to be evicted. This is intentional —
   * `selfdebug` is a "launcher diagnostics mode" for inspecting the launcher's
   * own DOM/console/safe-area, not simultaneous dual-attach.
   *
   * When `false` or omitted (default), the param is not added and the output
   * is byte-identical to the previous behaviour.
   */
  selfdebug?: boolean;
}

/**
 * Builds a launcher PWA deep-link for env-2 MCP-attach (issue #378).
 *
 * The launcher at {@link LAUNCHER_URL} renders tunnelUrl in a full-viewport
 * iframe. `&debug=1&relay=<wssUrl>` is forwarded onto the iframe src so the
 * framed page's in-app debug gate (Layer C) is satisfied and a Chii target.js
 * is injected. `&at=<totpCode>` is added only when a code is provided (same
 * conditional as {@link buildDeepLinkAttachUrl}).
 *
 * When `opts.name` is given (non-blank), it is added as `&name=` so the
 * launcher partner bar shows the app name instead of the generic default (#498).
 * When `opts.icon` is an absolute https:// URL, it is added as `&icon=` so the
 * launcher can render an icon next to the title (#498).
 *
 * Unlike `buildDeepLinkAttachUrl` (which splices onto a non-special scheme URL
 * via raw string manipulation), this function uses WHATWG `encodeURIComponent`
 * because the target is a standard `https:` URL.
 *
 * SECRET-HANDLING: `totpCode` (when provided) is placed into the `at=` param
 * only — never logged or returned separately. Callers must NOT log the result
 * of this function to stdout/stderr.
 *
 * @param tunnelUrl - The `https://*.trycloudflare.com` app tunnel URL
 *   (`AIT_TUNNEL_BASE_URL`). This is the URL the launcher frames.
 * @param wssUrl - The `wss://` relay URL the framed page will attach to.
 * @param totpCode - Optional current TOTP code (6 digits). When provided, it
 *   is appended as `at=<totpCode>`. Must be computed at call time — it rotates
 *   every 30 s. Omit when TOTP is disabled.
 * @param opts - Optional app identity hints: `name`, `icon`, and `selfdebug`
 *   (#498, #543).
 * @returns The launcher deep-link URL with `?url=<enc>&debug=1&relay=<enc>
 *   [&at=<code>][&name=<enc>][&icon=<enc>][&selfdebug=1]` params.
 */
export function buildLauncherAttachUrl(
  tunnelUrl: string,
  wssUrl: string,
  totpCode?: string,
  opts?: LauncherAttachUrlOpts,
): string {
  let url =
    `${LAUNCHER_URL}?url=${encodeURIComponent(tunnelUrl)}` +
    `&debug=1&relay=${encodeURIComponent(wssUrl)}`;
  if (totpCode !== undefined && totpCode !== '') {
    url += `&at=${encodeURIComponent(totpCode)}`;
  }
  // App identity hints (#498): add non-blank name and valid https icon.
  if (opts?.name !== undefined && opts.name.trim() !== '') {
    url += `&name=${encodeURIComponent(opts.name.trim())}`;
  }
  if (opts?.icon !== undefined) {
    let iconParsed: URL;
    try {
      iconParsed = new URL(opts.icon);
    } catch {
      iconParsed = null as unknown as URL;
    }
    if (iconParsed?.protocol === 'https:') {
      url += `&icon=${encodeURIComponent(opts.icon)}`;
    }
  }
  // Self-debug opt-in (#543): add selfdebug=1 only when explicitly requested.
  // Without this flag the output is byte-identical to the previous behaviour.
  if (opts?.selfdebug === true) {
    url += '&selfdebug=1';
  }
  return url;
}

/**
 * Build a self-attaching dog-food deep-link.
 *
 * `ait deploy --scheme-only` prints an `intoss-private://…?_deploymentId=<uuid>`
 * URL that opens a dog-food bundle on a phone. The in-app debug gate
 * (`src/in-app/gate.ts`) auto-attaches when the entry URL also carries
 * `debug=1` and `relay=<wss-url>`. This helper splices those params (plus
 * `at=<code>` when TOTP is enabled) into the scheme URL; rendering the result
 * as a QR code and scanning it with the phone camera opens the mini-app and
 * attaches it to the live Chii relay. QR is the single entry path — it needs
 * no USB cable, platform CLI, or driver, and works the same on iOS/Android.
 *
 * The Toss app propagates extra query params from the entry deep link into the
 * mini-app WebView's `location.search` (confirmed behavior), so the gate reads
 * them at attach time.
 *
 * TOTP `at=` param:
 *   When a TOTP secret is active, `buildDeepLinkAttachUrl` accepts an optional
 *   `totpCode` argument and splices `at=<code>` alongside `debug` and `relay`.
 *   The code must be computed by the caller at call time — do NOT pre-compute
 *   and cache it, because the 30-second window expires quickly. The in-app gate
 *   (`src/in-app/gate.ts` Layer C) validates this code against the baked secret.
 *
 * Why not `URL`/`URLSearchParams`: `intoss-private:` is a non-special scheme.
 * The WHATWG `URL` parser treats such schemes opaquely (no host/path/query
 * decomposition you can rely on across runtimes), so query manipulation via
 * `url.searchParams` is not portable here. We splice the query string directly
 * on the raw string instead, which keeps the scheme, authority, path, and any
 * pre-existing params (notably `_deploymentId`) byte-for-byte intact.
 */

/**
 * Suspicious/generic authority values that indicate a malformed or placeholder
 * scheme URL. These are host strings that will almost certainly cause the Toss
 * app to fail with "bundle not found" silently.
 *
 * The expected form from `ait deploy --scheme-only` is:
 *   intoss-private://<appName>?_deploymentId=<uuid>
 * where `<appName>` is a non-generic string like `aitc-sdk-example`.
 */
const SUSPICIOUS_AUTHORITIES = new Set<string>(['', 'web', 'localhost', '127.0.0.1', 'app']);

/**
 * Validates the authority (host) portion of a scheme URL.
 *
 * Returns a warning message if the authority is missing or looks like a
 * placeholder, or `null` if the authority looks valid.
 *
 * Expected form: `intoss-private://<appName>?_deploymentId=<uuid>`
 * The authority must be a non-empty, non-generic app name (e.g. `aitc-sdk-example`).
 */
export function validateSchemeAuthority(schemeUrl: string): string | null {
  // Extract authority from `scheme://authority[/path][?query][#hash]`.
  // We cannot use the WHATWG URL parser for non-special schemes reliably
  // (see the deeplink.ts module comment), so we parse the raw string.
  const afterScheme = schemeUrl.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, '');
  if (afterScheme === schemeUrl) {
    // No `://` found — not a scheme URL at all.
    return (
      'scheme_url does not look like a scheme URL (expected `intoss-private://<appName>?_deploymentId=<uuid>`). ' +
      'Use the URL printed by `ait deploy --scheme-only`.'
    );
  }

  // authority ends at the first `/`, `?`, `#`, or end of string.
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);

  if (SUSPICIOUS_AUTHORITIES.has(authority.toLowerCase())) {
    const displayAuthority = authority === '' ? '(empty)' : `"${authority}"`;
    return (
      `scheme_url authority ${displayAuthority} looks like a placeholder. ` +
      'Expected an app name like `intoss-private://aitc-sdk-example?_deploymentId=<uuid>`. ' +
      'Use the URL printed by `ait deploy --scheme-only` — it includes the correct app name as the host.'
    );
  }

  return null;
}

/** A param the helper appends. Existing occurrences are replaced, not duplicated. */
type AppendParam = readonly [key: string, value: string];

function stripExisting(query: string, key: string): string {
  if (query === '') return '';
  return query
    .split('&')
    .filter((pair) => pair !== '' && pair.split('=')[0] !== key)
    .join('&');
}

/**
 * Splices `debug=1`, `relay=<wssUrl>`, and (optionally) `at=<totpCode>` into a
 * scheme URL's query string, preserving everything else (scheme, authority,
 * path, hash, and the existing `_deploymentId` param). If any of the spliced
 * params is already present it is replaced so the helper is idempotent.
 *
 * @param schemeUrl - The `intoss-private://…?_deploymentId=<uuid>` URL printed
 *   by `ait deploy --scheme-only`. Must already carry `_deploymentId` (Layer B
 *   of the gate); this helper does not invent one.
 * @param wssUrl - The live relay URL (`wss://…trycloudflare.com`) from the
 *   running debug MCP server's quick tunnel.
 * @param totpCode - Optional current TOTP code (6 digits). When provided, it
 *   is spliced as `at=<totpCode>`. Must be computed at call time — it rotates
 *   every 30 s. Pass `undefined` or omit when TOTP is disabled.
 * @returns The same URL with `debug=1&relay=<encoded wssUrl>[&at=<totpCode>]`
 *   appended.
 * @throws If `wssUrl` is not a `wss:` URL (the gate rejects anything else, so
 *   producing such a link would be a silent dead end).
 */
export function buildDeepLinkAttachUrl(
  schemeUrl: string,
  wssUrl: string,
  totpCode?: string,
): string {
  let relay: URL;
  try {
    relay = new URL(wssUrl);
  } catch {
    throw new Error(`relay URL is not a valid URL: ${wssUrl}`);
  }
  if (relay.protocol !== 'wss:') {
    throw new Error(`relay URL must use the wss: scheme, got ${relay.protocol} (${wssUrl})`);
  }

  const hashIndex = schemeUrl.indexOf('#');
  const hash = hashIndex === -1 ? '' : schemeUrl.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? schemeUrl : schemeUrl.slice(0, hashIndex);

  const queryIndex = beforeHash.indexOf('?');
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  let query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  const appended: AppendParam[] = [
    ['debug', '1'],
    ['relay', wssUrl],
  ];
  // Only splice `at=` when a code is provided (TOTP enabled). Omitting it when
  // TOTP is disabled preserves backward compatibility with gate deployments
  // that do not yet evaluate the `at` param.
  if (totpCode !== undefined && totpCode !== '') {
    appended.push(['at', totpCode]);
  }

  // Always strip the `at` key from the existing query so a stale code from a
  // previous run is removed even when the caller does not provide a fresh code.
  query = stripExisting(query, 'at');

  for (const [key] of appended) {
    query = stripExisting(query, key);
  }
  for (const [key, value] of appended) {
    const pair = `${key}=${encodeURIComponent(value)}`;
    query = query === '' ? pair : `${query}&${pair}`;
  }

  return `${base}?${query}${hash}`;
}
