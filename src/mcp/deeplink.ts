/**
 * Build a self-attaching dogfood deep link.
 *
 * `ait deploy --scheme-only` prints an `intoss-private://…?_deploymentId=<uuid>`
 * URL that opens a dogfood bundle on a phone. The in-app debug gate
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
