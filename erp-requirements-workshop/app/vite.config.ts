import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swPlugin from './scripts/sw-plugin.mjs';

const bankDir = fileURLToPath(new URL('./bank-data', import.meta.url));
const hasBank = existsSync(bankDir) && readdirSync(bankDir).some((f) => f.endsWith('.json'));

export default defineConfig({
  plugins: [preact(), swPlugin()],
  define: { __HAS_BANK__: JSON.stringify(hasBank) },
  json: { stringify: true },
  build: {
    target: 'es2020',
    modulePreload: { polyfill: false },
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/docx') || id.includes('node_modules/jszip')) return 'docx';
          if (id.includes('/bank-data/')) return 'bank';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
} as any);
