import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

// __VERSION__ is defined in all entries so any source file can reference it
export default defineConfig([
  {
    entry: {
      'mock/index': 'src/mock/index.ts',
      'panel/index': 'src/panel/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
  },
  {
    entry: {
      'unplugin/index': 'src/unplugin/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
  },
]);
