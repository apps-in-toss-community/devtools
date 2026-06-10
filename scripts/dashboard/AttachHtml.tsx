/**
 * AttachHtml.tsx — precompiled static chrome for the /attach QR scan page.
 *
 * BUILD-TIME ONLY. See DashboardChrome.tsx for the rationale.
 *
 * Token-fill vs runtime assembly:
 *   - `attachChrome` (exported from the generated module): full static HTML
 *     rendered at build time. Contains NO per-request values.
 *   - Per-request tokens (`__QR_DATA_URL__`, `__SAFE_LABEL__`,
 *     `__SAFE_ATTACH_URL__`) are replaced by qr-http-server.ts at runtime.
 *   - The FAQ list items contain HTML tags (strong/code). They are rendered as
 *     literal HTML in the precompiled chrome. qr-http-server.ts injects them
 *     verbatim via dangerouslySetInnerHTML in the generated module.
 *
 * SECRET-HANDLING: TOTP at= codes ride inside __SAFE_ATTACH_URL__ (intentional
 * transport); no other per-request sensitive values appear here.
 */

interface AttachHtmlProps {
  /** ko or en — used in <html lang="…"> */
  lang: string;
  /** Resolved strings for all static labels on the attach page. */
  strings: {
    title: string;
    deploymentPrefix: string;
    stepsSection: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    faqSection: string;
    faqAppNotOpen: string;
    faqPrepare: string;
    faqChii: string;
    faqTotp: string;
    urlSection: string;
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
 *   - `__QR_DATA_URL__`    — base64 data URL for the QR image
 *   - `__SAFE_LABEL__`     — HTML-escaped deploymentId label
 *   - `__SAFE_ATTACH_URL__` — HTML-escaped attach URL (TOTP at= inside, intentional)
 */
export function AttachHtml({ lang, strings }: AttachHtmlProps) {
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
.label { font-size: 0.8rem; opacity: 0.5; font-family: monospace; margin: 0; }
img.qr {
  width: min(90vw, 360px); height: auto;
  image-rendering: pixelated;
  background: #fff; padding: 1rem; border-radius: 12px;
  display: block; margin: 0 auto;
}
section { width: 100%; max-width: 480px; }
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
`,
          }}
        />
      </head>
      <body>
        <h1>{strings.title}</h1>
        {/* __LANG_SWITCHER__ is filled at runtime by qr-http-server.ts */}
        {'__LANG_SWITCHER__'}
        {/* __SAFE_LABEL__ filled at runtime */}
        <p className="label">{strings.deploymentPrefix}__SAFE_LABEL__</p>
        {/* #attach-section: SSE push가 QR img src만 교체. url-box는 #url-section에 분리 관리. */}
        <div id="attach-section">
          {/* __QR_DATA_URL__ filled at runtime */}
          <img className="qr" src="__QR_DATA_URL__" alt="attach QR" />
        </div>

        <section>
          <h2>{strings.stepsSection}</h2>
          <ol>
            <li>{strings.step1}</li>
            <li>{strings.step2}</li>
            <li dangerouslySetInnerHTML={{ __html: strings.step3 }} />
            <li>{strings.step4}</li>
          </ol>
        </section>

        <hr />

        <section>
          <h2>{strings.faqSection}</h2>
          <ul>
            <li dangerouslySetInnerHTML={{ __html: strings.faqAppNotOpen }} />
            <li dangerouslySetInnerHTML={{ __html: strings.faqPrepare }} />
            <li dangerouslySetInnerHTML={{ __html: strings.faqChii }} />
            <li dangerouslySetInnerHTML={{ __html: strings.faqTotp }} />
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
      </body>
    </html>
  );
}
