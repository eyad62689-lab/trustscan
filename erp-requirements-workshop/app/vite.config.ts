import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swPlugin from './scripts/sw-plugin.mjs';

const bankDir = fileURLToPath(new URL('./bank-data', import.meta.url));
const hasBank = existsSync(bankDir) && readdirSync(bankDir).some((f) => f.endsWith('.json'));

// Same CSP as netlify.toml so `vite preview` exercises it.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export default defineConfig({
  preview: { headers: { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } },
  plugins: [preact(), swPlugin()],
  define: { __HAS_BANK__: JSON.stringify(hasBank) },
  json: { stringify: true },
  build: {
    target: 'es2020',
    modulePreload: { polyfill: false },
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
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
