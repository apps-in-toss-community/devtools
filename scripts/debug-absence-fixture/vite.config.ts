import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Minimal release-consumer fixture for the build-time absence guard (#647).
// Builds scripts/debug-absence-fixture/main.ts, whose single
// `import('@ait-co/devtools/in-app')` is guarded by `if (__DEBUG_BUILD__)`.
// AIT_DEBUG_BUILD unset → false → the in-app graph (Chii + eruda) DCEs to 0
// bytes; AIT_DEBUG_BUILD=1 → true → it survives (positive control).
//
// Intentionally NOT a panel/mock fixture: no @ait-co/devtools/panel import and
// no @apps-in-toss/web-framework alias, so the only variable is the build
// guard. (The e2e panel fixture keeps its live dynamic import for unrelated
// chunking reasons — see e2e/fixture/main.tsx.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  define: {
    __DEBUG_BUILD__: JSON.stringify(process.env.AIT_DEBUG_BUILD === '1'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Minify ON (Vite default for production) is required: a dead if(false){}
    // husk would otherwise survive as text and its identifier strings (e.g.
    // 'eruda') would false-positive the grep. See check-debug-surface-absent.sh.
  },
});
