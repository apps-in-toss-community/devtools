/**
 * `devtools-test` bin entry point — export-free by design.
 *
 * This file is intentionally export-free so that Rolldown (tsdown) emits the
 * main() call directly into the output bundle rather than hoisting the module
 * body into a shared chunk and replacing this file with a re-export wrapper.
 *
 * Background (#711): cli.ts exports `main`, `runWithConnection`, and
 * `shouldSuppressQr` for use by tests and relay-factory. When cli.ts was also
 * the bin entry, Rolldown split the module body into a shared chunk
 * (`cli-<hash>.js`) and reduced the bin output to a 3-line re-export wrapper.
 * The self-invoke guard (`import.meta.url === process.argv[1]`) evaluated
 * inside the shared chunk where `import.meta.url` is the chunk path, not the
 * bin path — a structural permanent mismatch — so main() was never called and
 * every `devtools-test` / `pnpm test:env3` invocation exited 0 as a silent
 * no-op.
 *
 * NOTE: no shebang in this source file — the tsdown entry's `banner` option
 * injects `#!/usr/bin/env node` into the compiled output (same pattern as
 * other Node bin entries in tsdown.config.ts).
 */

import { main } from './cli.js';

main().catch((e: unknown) => {
  process.stderr.write(
    `devtools-test: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exitCode = 1;
});
