import { defineConfig } from 'tsup';

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
  },
]);
