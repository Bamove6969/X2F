import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const empty = fileURLToPath(new URL('./src/empty.ts', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'), ...process.env };
  // Fixture mode never reaches a production build, whatever the environment says.
  const fixtures = mode !== 'production' && env.VITE_FIXTURES === '1';
  return {
    plugins: [react()],
    resolve: {
      // monero-ts pulls in Node's net and tls; the browser build gets an empty module (research §3, P3-M8).
      alias: [{ find: /^(node:)?(net|tls)$/, replacement: empty }],
    },
    define: { __X2F_FIXTURES__: JSON.stringify(fixtures) },
    build: {
      // font-src and img-src allow 'self' only for fonts: never inline assets as data: URIs.
      assetsInlineLimit: 0,
      sourcemap: false,
    },
  };
});
