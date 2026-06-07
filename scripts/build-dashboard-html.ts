/**
 * build-dashboard-html.ts
 *
 * Precompiles the qr-http-server dashboard/attach HTML chrome into plain string
 * exports. Runs OUTSIDE the tsdown pipeline, before `pnpm build`, so that
 * src/mcp/dashboard.generated.ts exists when tsdown bundles the daemon.
 *
 * Pipeline:
 *   JSX templates (scripts/dashboard/*.tsx)
 *     → react-dom/server renderToStaticMarkup()
 *     → placeholder token strings
 *     → src/mcp/dashboard.generated.ts  (committed, plain string exports)
 *
 * INSTALL-GRAPH INVARIANT:
 *   react/react-dom are referenced ONLY in this build script — never in src/.
 *   The generated module exports plain strings; the MCP daemon (cli.ts →
 *   debug-server.ts → qr-http-server.ts) imports only those strings, staying
 *   react-free. check-mcp-react-free.sh mechanically verifies this after build.
 *
 * Locale strategy:
 *   Both 'ko' and 'en' chromes are precompiled and exported as separate named
 *   exports. qr-http-server.ts selects the right one per-request using
 *   parseAcceptLanguage(req.headers['accept-language']).
 *
 * SECRET-HANDLING:
 *   - No per-request values are baked into the generated strings.
 *   - wssUrl MUST NOT appear in any generated output. An assertion below
 *     verifies this (any accidental inclusion would be caught at build time).
 */

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '../src/i18n/index.js';
import { resolveLocaleStrings } from '../src/i18n/index.js';
import { AttachHtml } from './dashboard/AttachHtml.js';
import { DashboardChrome } from './dashboard/DashboardChrome.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../src/mcp/dashboard.generated.ts');

const LOCALES: Locale[] = ['ko', 'en'];

/**
 * Render the dashboard chrome for one locale.
 * Returns a raw HTML string with `__PLACEHOLDER__` tokens intact.
 * renderToStaticMarkup preserves text nodes verbatim — placeholders survive.
 */
function renderDashboardChrome(locale: Locale): string {
  const s = resolveLocaleStrings(locale);
  // The `updatedPrefix` is the static part before the runtime-injected timestamp.
  // ko: "마지막 갱신: " | en: "Last updated: "
  // We split on the "{ts}" placeholder and take the prefix; the suffix is always "".
  const updatedFull = s('dashboard.updated', { ts: '__TS_SPLIT__' });
  const updatedPrefix = updatedFull.split('__TS_SPLIT__')[0] ?? '';

  const markup = renderToStaticMarkup(
    React.createElement(DashboardChrome, {
      lang: locale,
      strings: {
        title: s('dashboard.title'),
        tunnelSection: s('dashboard.tunnel.section'),
        attachSection: s('dashboard.attach.section'),
        updatedPrefix,
      },
    }),
  );
  return `<!DOCTYPE html>\n${markup}`;
}

/**
 * Render the attach page chrome for one locale.
 * The `deployment:` label and step 3 string include inline HTML (strong/code)
 * which renderToStaticMarkup emits verbatim from dangerouslySetInnerHTML.
 * Placeholders (`__QR_DATA_URL__`, `__SAFE_LABEL__`, `__SAFE_ATTACH_URL__`)
 * survive because they are plain text nodes, not HTML.
 *
 * NOTE on step 3 / FAQ HTML:
 *   ko.ts/en.ts strings contain literal HTML tags (strong, code). This is
 *   intentional — the attach page is a build-time precompile that renders
 *   trusted developer-facing copy. No user input ever reaches these strings.
 *
 * The `deploymentPrefix` extraction mirrors the updatedPrefix approach above:
 * "deployment: {label}" → we split on "__LABEL_SPLIT__" and take the prefix.
 */
function renderAttachChrome(locale: Locale): string {
  const s = resolveLocaleStrings(locale);
  const deploymentFull = s('attach.deployment', { label: '__LABEL_SPLIT__' });
  const deploymentPrefix = deploymentFull.split('__LABEL_SPLIT__')[0] ?? '';

  const markup = renderToStaticMarkup(
    React.createElement(AttachHtml, {
      lang: locale,
      strings: {
        title: s('attach.title'),
        deploymentPrefix,
        stepsSection: s('attach.steps.section'),
        step1: s('attach.step1'),
        step2: s('attach.step2'),
        step3: s('attach.step3'),
        step4: s('attach.step4'),
        faqSection: s('attach.faq.section'),
        faqAppNotOpen: s('attach.faq.appNotOpen'),
        faqPrepare: s('attach.faq.prepare'),
        faqChii: s('attach.faq.chii'),
        faqTotp: s('attach.faq.totp'),
        urlSection: s('attach.url.section'),
      },
    }),
  );
  return `<!DOCTYPE html>\n${markup}`;
}

/**
 * Escape a string for safe embedding as a TypeScript template literal.
 * Escapes backticks, backslashes, and `${` sequences.
 */
function escapeTsTemplateLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

async function main(): Promise<void> {
  const sections: string[] = [
    '/**',
    ' * dashboard.generated.ts',
    ' *',
    ' * AUTO-GENERATED by scripts/build-dashboard-html.ts — DO NOT EDIT BY HAND.',
    ' * Regenerate: pnpm build:dashboard-html',
    ' *',
    ' * Exports precompiled HTML chrome strings for each locale. Per-request',
    ' * dynamic values are inserted by qr-http-server.ts at runtime via simple',
    ' * string replacement of __PLACEHOLDER__ tokens.',
    ' *',
    ' * Token map (dashboard chrome):',
    ' *   __TUNNEL_CLASS__    CSS class: "status-up" | "status-down"',
    ' *   __TUNNEL_STATUS__   localised tunnel status label',
    ' *   __ATTACH_SECTION__  QR img+url-box HTML, or hint text',
    ' *   __PAGES_SECTION__   pages <section> block, or empty string',
    ' *   __NOW__             ISO timestamp of current render',
    ' *',
    ' * Token map (attach chrome):',
    ' *   __QR_DATA_URL__     base64 data URL for the QR image',
    ' *   __SAFE_LABEL__      HTML-escaped deploymentId label',
    ' *   __SAFE_ATTACH_URL__ HTML-escaped attach URL',
    ' *',
    " * SECRET-HANDLING: wssUrl MUST NOT appear here. If it does, the build script's",
    ' *   assertion would have caught it — this file should be react-free and secret-free.',
    ' */',
    '',
    "import type { Locale } from '../i18n/index.js';",
    '',
  ];

  for (const locale of LOCALES) {
    const dashboardHtml = renderDashboardChrome(locale);
    const attachHtml = renderAttachChrome(locale);

    // Assert wssUrl sentinel never leaked into the generated strings
    if (dashboardHtml.includes('wssUrl') || attachHtml.includes('wssUrl')) {
      throw new Error(
        `[build-dashboard-html] SECRET-HANDLING VIOLATION: "wssUrl" found in generated HTML for locale "${locale}". ` +
          'Abort — do not write the generated module.',
      );
    }

    sections.push(
      `// ── locale: ${locale} ──────────────────────────────────────────────────────`,
      '',
      `export const dashboardChromeHtml${locale.charAt(0).toUpperCase()}${locale.slice(1)} =`,
      `\`${escapeTsTemplateLiteral(dashboardHtml)}\`;`,
      '',
      `export const attachChromeHtml${locale.charAt(0).toUpperCase()}${locale.slice(1)} =`,
      `\`${escapeTsTemplateLiteral(attachHtml)}\`;`,
      '',
    );
  }

  sections.push(
    '/** Map from Locale to the precompiled dashboard chrome string. */',
    'export const dashboardChromeByLocale: Record<Locale, string> = {',
    ...LOCALES.map((l) => `  ${l}: dashboardChromeHtml${l.charAt(0).toUpperCase()}${l.slice(1)},`),
    '};',
    '',
    '/** Map from Locale to the precompiled attach page chrome string. */',
    'export const attachChromeByLocale: Record<Locale, string> = {',
    ...LOCALES.map((l) => `  ${l}: attachChromeHtml${l.charAt(0).toUpperCase()}${l.slice(1)},`),
    '};',
    '',
  );

  const output = sections.join('\n');

  await writeFile(OUT_FILE, output, 'utf-8');
  console.log(`[build-dashboard-html] wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('[build-dashboard-html] failed:', err);
  process.exit(1);
});
