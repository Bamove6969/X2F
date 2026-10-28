// The e2e screen harness build (see main.tsx): the app's own Vite setup (React, the net/tls
// aliases, no inlined assets), rooted here and written to ./dist, which is never deployed.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const empty = fileURLToPath(new URL('../../src/empty.ts', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: [{ find: /^(node:)?(net|tls)$/, replacement: empty }] },
  define: { __X2F_FIXTURES__: 'false' },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
