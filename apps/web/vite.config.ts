import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const empty = fileURLToPath(new URL('./src/empty.ts', import.meta.url));

/** The only build mode that may carry fixture mode (Playwright's board fixtures); see `fixturesOn`. */
export const FIXTURES_BUILD_MODE = 'fixtures';

/**
 * Fixture mode needs VITE_FIXTURES=1 and either the dev server (`vite`, not in production mode) or
 * `vite build --mode fixtures`. Every other build (production, staging, anything else) leaves it out.
 */
export function fixturesOn(command: 'build' | 'serve', mode: string, flag: string | undefined): boolean {
  if (flag !== '1') return false;
  return command === 'serve' ? mode !== 'production' : mode === FIXTURES_BUILD_MODE;
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'), ...process.env };
  const fixtures = fixturesOn(command, mode, env.VITE_FIXTURES);
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
