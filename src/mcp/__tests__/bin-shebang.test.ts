import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Build-output guard for the `devtools-mcp` bin shebang.
 *
 * The shebang is injected once by the tsdown `banner` (see tsdown.config.ts).
 * If the entry source ALSO carries its own `#!/usr/bin/env node`, the build
 * emits the line twice — and line 2 then parses as invalid JS, so the bin dies
 * at startup with `SyntaxError: Invalid or unexpected token`. That regression
 * shipped silently in 0.1.30 (no test inspected the built file). This asserts
 * the built bins start with exactly one shebang.
 *
 * Runs against `dist/`, so it only checks when a build is present — which is
 * always the case in `prepublishOnly` (build → typecheck → test). When dist is
 * absent (e.g. a bare `pnpm test` with no prior build) it is skipped, not failed.
 */
const distFiles = ['mcp/cli.js', 'mcp/server.js'] as const;

describe('built mcp bin shebang', () => {
  for (const rel of distFiles) {
    // vitest runs from the package root, so resolve dist relative to cwd
    // rather than import.meta.url (which the test transform may rewrite).
    const path = resolve(process.cwd(), 'dist', rel);

    it.skipIf(!existsSync(path))(`dist/${rel} has exactly one shebang`, () => {
      const src = readFileSync(path, 'utf-8');
      const shebangs = src.split('\n').filter((line) => line.startsWith('#!')).length;
      expect(shebangs).toBe(1);
      // and it must be the very first line, or the interpreter ignores it
      expect(src.startsWith('#!/usr/bin/env node\n')).toBe(true);
    });
  }
});
