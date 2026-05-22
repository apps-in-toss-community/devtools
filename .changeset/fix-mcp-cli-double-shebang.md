---
"@ait-co/devtools": patch
---

fix: `devtools-mcp` bin no longer ships a doubled shebang

The `mcp/cli` build entry emitted `#!/usr/bin/env node` twice — once from the source file and once from the tsdown `banner` — so the published bin failed to start with `SyntaxError: Invalid or unexpected token` on line 2. This made both `devtools-mcp` (debug) and `devtools-mcp --mode=dev` unrunnable. The shebang now comes from the banner only, and a build-output test guards against the regression.
