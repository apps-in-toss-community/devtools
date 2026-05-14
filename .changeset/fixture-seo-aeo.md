---
"@ait-co/devtools": patch
---

docs(fixture): SEO/AEO on devtools.aitc.dev — JSON-LD, canonical, sitemap, llms.txt

Make the live fixture demo (`devtools.aitc.dev`) discoverable:

- `e2e/fixture/index.html`: descriptive title, meta description, canonical,
  Open Graph + Twitter Card meta with og:image, and a `SoftwareApplication`
  JSON-LD block listing the SDK mock + multi-bundler unplugin + DevTools
  panel.
- `e2e/fixture/launcher/index.html`: `noindex,nofollow` (the launcher is a
  user-only PWA chrome, not a search target).
- `e2e/fixture/public/{robots.txt,sitemap.xml,llms.txt}`: standard SEO
  surface + `llmstxt.org` overview for AI answer engines. AI crawlers
  (GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, Applebot-Extended)
  explicitly allowed per org policy; `/launcher/` excluded from crawls.
- `e2e/fixture/public/og/image.png`: 1200×630 OG image.
