/**
 * AttachHtml.tsx — precompiled static chrome for the /attach QR scan page.
 *
 * BUILD-TIME ONLY. See DashboardChrome.tsx for the rationale.
 *
 * Mode families (#468): the scan steps + troubleshooting checklist differ per
 * session mode, so TWO chrome variants are precompiled per locale:
 *   - `sandbox` — env 2 (relay-mobile, AITC Sandbox PWA): launcher PWA flow.
 *     No Toss app / `_deploymentId` concepts — the deployment label row is
 *     omitted entirely.
 *   - `intoss`  — env 3/4 (relay-dev / relay-live): Toss app deep-link flow.
 *     Env 4 appends one LIVE read-only line at runtime via `__LIVE_FAQ__`.
 *
 * Token-fill vs runtime assembly:
 *   - `attachChromeByLocale[locale][family]` (exported from the generated
 *     module): full static HTML rendered at build time. Contains NO
 *     per-request values.
 *   - Per-request tokens (`__QR_DATA_URL__`, `__SAFE_LABEL__`,
 *     `__SAFE_ATTACH_URL__`, `__MODE_LABEL__`, `__LIVE_FAQ__`) are replaced by
 *     qr-http-server.ts at runtime.
 *   - The steps/FAQ list items contain HTML tags (strong/code). They are
 *     rendered as literal HTML in the precompiled chrome. qr-http-server.ts
 *     injects them verbatim via dangerouslySetInnerHTML in the generated module.
 *
 * SECRET-HANDLING: TOTP at= codes ride inside __SAFE_ATTACH_URL__ (intentional
 * transport); no other per-request sensitive values appear here.
 */

/** Copy family of the attach page chrome (#468). */
export type AttachChromeFamily = 'sandbox' | 'intoss';

interface AttachHtmlProps {
  /** ko or en — used in <html lang="…"> */
  lang: string;
  /** Which copy family this chrome carries (env 2 vs env 3/4). */
  family: AttachChromeFamily;
  /** Resolved strings for all static labels on the attach page. */
  strings: {
    title: string;
    /**
     * `deployment: ` label prefix — intoss family only. The sandbox family has
     * no `_deploymentId` concept, so the label row is omitted (#468).
     */
    deploymentPrefix?: string;
    stepsSection: string;
    /**
     * Family-specific scan steps, in order. May contain inline HTML
     * (strong/code) — trusted build-time copy, never user input.
     */
    steps: string[];
    faqSection: string;
    /**
     * Family-specific troubleshooting checklist items, in order. May contain
     * inline HTML (strong/code) — trusted build-time copy, never user input.
     */
    faqItems: string[];
    urlSection: string;
    /** "디버그 툴 열기" section header — inspector button section (#544). */
    inspectorSection: string;
    /** Copy button labels. */
    copy: string;
    /** Lang switcher labels — "한국어" / "English". */
    langKo: string;
    langEn: string;
  };
}

/**
 * Static attach page chrome. All dynamic slots are `__PLACEHOLDER__` strings
 * that qr-http-server.ts fills at runtime:
 *   - `__QR_DATA_URL__`       — base64 data URL for the QR image
 *   - `__SAFE_LABEL__`        — HTML-escaped deploymentId label (intoss family only)
 *   - `__SAFE_ATTACH_URL__`   — HTML-escaped attach URL (TOTP at= inside, intentional)
 *   - `__MODE_LABEL__`        — environment badge (`<p class="mode-label">…</p>`), or ''
 *   - `__LIVE_FAQ__`          — env-4 LIVE read-only `<li>`, or '' (intoss family only)
 *   - `__INSPECTOR_SECTION__` — "디버그 툴 열기" button or waiting hint (#544)
 */
export function AttachHtml({ lang, family, strings }: AttachHtmlProps) {
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
.mode-label {
  font-size: 0.78rem; font-weight: 600; color: #79c0ff;
  background: #161b22; border: 1px solid #30363d; border-radius: 999px;
  padding: 0.25rem 0.75rem; margin: 0;
}
.label { font-size: 0.8rem; opacity: 0.5; font-family: monospace; margin: 0; }
img.qr {
  width: min(90vw, 360px); height: auto;
  image-rendering: pixelated;
  background: #fff; padding: 1rem; border-radius: 12px;
  display: block; margin: 0 auto;
}
section { width: 100%; max-width: 480px; }
.hint { font-size: 0.85rem; opacity: 0.5; margin: 0.25rem 0 0; }
.hint.error { color: #f85149; opacity: 1; font-weight: 600; }
h2 { font-size: 1rem; font-weight: 600; color: #e6edf3; margin: 0 0 0.5rem; }
ol, ul { margin: 0; padding-left: 1.25rem; }
li { margin-bottom: 0.4rem; font-size: 0.9rem; line-height: 1.5; }
.url-row {
  display: flex; align-items: stretch; gap: 0;
  border-radius: 6px; border: 1px solid #30363d; overflow: hidden;
}
.url-box {
  font-family: monospace; font-size: 0.72rem;
  word-break: break-all; opacity: 0.4;
  background: #161b22; padding: 0.75rem 1rem;
  flex: 1; cursor: pointer; border: none; border-radius: 0;
}
.url-box:hover { opacity: 0.6; }
.copy-btn {
  flex-shrink: 0; padding: 0.5rem 0.8rem;
  background: #21262d; border: none; border-left: 1px solid #30363d;
  color: #58a6ff; font-size: 0.75rem; cursor: pointer; white-space: nowrap;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.copy-btn:hover { background: #30363d; }
hr { border: none; border-top: 1px solid #21262d; width: 100%; margin: 0.5rem 0; }
.lang-switcher { display: flex; gap: 0.5rem; font-size: 0.75rem; }
.lang-switcher a { color: #58a6ff; text-decoration: none; opacity: 0.6; }
.lang-switcher a.active { font-weight: 700; text-decoration: underline; opacity: 1; }
.inspector-link {
  display: inline-block; margin-top: 0.5rem;
  padding: 0.45rem 1rem; border-radius: 6px;
  background: #1f6feb; color: #fff; font-size: 0.85rem; font-weight: 600;
  text-decoration: none; text-align: center;
}
.inspector-link:hover { background: #388bfd; }
.inspector-hint { display: inline-block; margin-top: 0.5rem; font-size: 0.8rem; opacity: 0.45; }
`,
          }}
        />
      </head>
      <body>
        <h1>{strings.title}</h1>
        {/* __MODE_LABEL__ — environment badge filled at runtime (mode-aware, #468) */}
        {'__MODE_LABEL__'}
        {/* __LANG_SWITCHER__ is filled at runtime by qr-http-server.ts */}
        {'__LANG_SWITCHER__'}
        {/* __SAFE_LABEL__ filled at runtime — intoss family only (#468: env 2 has no deploymentId) */}
        {family === 'intoss' ? (
          <p className="label">
            {strings.deploymentPrefix}
            __SAFE_LABEL__
          </p>
        ) : null}
        {/* #attach-section: SSE push가 QR img src만 교체. url-box는 #url-section에 분리 관리. */}
        <div id="attach-section">
          {/* __QR_DATA_URL__ filled at runtime */}
          <img className="qr" src="__QR_DATA_URL__" alt="attach QR" />
        </div>

        <section>
          <h2>{strings.stepsSection}</h2>
          <ol>
            {strings.steps.map((step) => (
              <li key={step} dangerouslySetInnerHTML={{ __html: step }} />
            ))}
          </ol>
        </section>

        <hr />

        <section>
          <h2>{strings.faqSection}</h2>
          <ul>
            {strings.faqItems.map((item) => (
              <li key={item} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
            {/* __LIVE_FAQ__ — env-4 read-only line filled at runtime ('' on env 3) */}
            {family === 'intoss' ? '__LIVE_FAQ__' : null}
          </ul>
        </section>

        <hr />

        <section id="url-section">
          <h2>{strings.urlSection}</h2>
          {/* url-row: click-to-copy + 복사 버튼. SSE push는 #url-box textContent만 갱신. */}
          {/* __SAFE_ATTACH_URL__ filled at runtime (TOTP at= inside — intentional transport) */}
          <div className="url-row">
            <p className="url-box" id="url-box">
              __SAFE_ATTACH_URL__
            </p>
            <button className="copy-btn" id="copy-btn" type="button" aria-label={strings.copy}>
              {strings.copy}
            </button>
          </div>
        </section>

        <hr />

        <section id="inspector-section">
          <h2>{strings.inspectorSection}</h2>
          {/* __INSPECTOR_SECTION__ filled at runtime — button or waiting hint (#544) */}
          {'__INSPECTOR_SECTION__'}
        </section>
      </body>
    </html>
  );
}
