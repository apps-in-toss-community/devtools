/**
 * DashboardChrome.tsx — precompiled static chrome for the debug dashboard.
 *
 * BUILD-TIME ONLY. This file lives under scripts/ and is consumed exclusively
 * by scripts/build-dashboard-html.ts, which calls renderToStaticMarkup() and
 * emits src/mcp/dashboard.generated.ts (plain string exports). It MUST NOT be
 * imported from src/ — that would drag React into the MCP daemon bundle and
 * violate the INSTALL-GRAPH invariant (check-mcp-react-free.sh).
 *
 * Token-fill vs runtime assembly:
 *   - `dashboardChrome` (exported from the generated module): static <head>
 *     containing the shared CSS + a placeholder element, rendered once at build
 *     time. The string contains NO per-request values.
 *   - Per-request dynamic parts (tunnel status, QR, pages-section, `now`)
 *     are assembled in qr-http-server.ts with a lightweight string builder that
 *     fills `__TUNNEL_STATUS__`, `__TUNNEL_CLASS__`, `__ATTACH_SECTION__`,
 *     `__PAGES_SECTION__`, and `__NOW__` placeholders, then appends the inline
 *     <script> block.
 *
 * Locale: each locale's chrome is a separate export — rendered once per locale
 * at build time by build-dashboard-html.ts. qr-http-server.ts selects the right
 * chrome from the generated module using the per-request resolved locale.
 *
 * SECRET-HANDLING:
 *   - No per-request values here — all tokens are placeholders.
 *   - wssUrl must never appear in generated output; the build script asserts this.
 */

interface DashboardChromeProps {
  /** ko or en — used in <html lang="…"> */
  lang: string;
  /** Resolved strings for the static labels (title, section headers, etc.). */
  strings: {
    title: string;
    tunnelSection: string;
    attachSection: string;
    updatedPrefix: string;
  };
}

/**
 * Static dashboard chrome — head/style + skeleton body structure.
 * All dynamic slots are `__PLACEHOLDER__` strings that qr-http-server.ts
 * fills with real per-request values at runtime.
 */
export function DashboardChrome({ lang, strings }: DashboardChromeProps) {
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{strings.title}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0d1117; color: #c9d1d9;
  display: flex; flex-direction: column; align-items: center;
  min-height: 100vh; margin: 0; padding: 2rem 1rem;
  gap: 1.5rem;
}
h1 { font-size: 1.25rem; font-weight: 600; color: #e6edf3; margin: 0; text-align: center; }
.updated { font-size: 0.75rem; opacity: 0.4; font-family: monospace; margin: 0; }
section { width: 100%; max-width: 520px; }
h2 { font-size: 1rem; font-weight: 600; color: #e6edf3; margin: 0 0 0.5rem; }
.status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
.status-up { background: #238636; color: #fff; }
.status-down { background: #6e7681; color: #fff; }
img.qr {
  width: min(80vw, 300px); height: auto;
  image-rendering: pixelated;
  background: #fff; padding: 0.75rem; border-radius: 10px;
  display: block; margin: 0.5rem auto;
}
.url-box {
  font-family: monospace; font-size: 0.7rem;
  word-break: break-all; opacity: 0.45;
  background: #161b22; padding: 0.6rem 0.85rem;
  border-radius: 6px; border: 1px solid #30363d; margin: 0.5rem 0 0;
}
.hint { font-size: 0.85rem; opacity: 0.5; margin: 0.25rem 0 0; }
ul { margin: 0; padding-left: 1.25rem; }
li { margin-bottom: 0.35rem; font-size: 0.85rem; line-height: 1.5; }
li.empty { opacity: 0.4; list-style: none; padding-left: 0; }
.page-id { font-family: monospace; font-size: 0.75rem; opacity: 0.5; margin-right: 0.4rem; }
.page-url { word-break: break-all; }
hr { border: none; border-top: 1px solid #21262d; width: 100%; margin: 0; }
`,
          }}
        />
      </head>
      <body>
        <h1>{strings.title}</h1>
        {/* __NOW__ is filled at runtime by qr-http-server.ts */}
        <p className="updated" id="updated">
          {strings.updatedPrefix}__NOW__
        </p>

        <section>
          <h2>{strings.tunnelSection}</h2>
          {/* __TUNNEL_CLASS__ and __TUNNEL_STATUS__ filled at runtime */}
          <span className="status __TUNNEL_CLASS__" id="tunnel-status">
            __TUNNEL_STATUS__
          </span>
        </section>

        <hr />

        <section>
          <h2>{strings.attachSection}</h2>
          {/* __ATTACH_SECTION__ filled at runtime (img+url-box or hint) */}
          <div id="attach-section">__ATTACH_SECTION__</div>
        </section>

        {/* __PAGES_SECTION__ filled at runtime — empty string when pages===null */}
        {'__PAGES_SECTION__'}
      </body>
    </html>
  );
}
