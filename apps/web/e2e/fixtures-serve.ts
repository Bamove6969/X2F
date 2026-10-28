// Builds the app in fixtures mode (`vite build --mode fixtures`, src/fixtures/index.ts) and serves
// it through the API's own serveWeb, so the real CSP and security headers apply. Each spec file
// that needs it builds into its own folder (spec files run in parallel workers, and a build empties
// its folder first).
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Fastify, { type FastifyInstance } from 'fastify';
import { clientErrorHandler, frameworkErrors, serveWeb } from '../../api/src/static/serve.js';

const WEB = fileURLToPath(new URL('..', import.meta.url));

/** `outDir` is relative to apps/web and must be gitignored (dist-fixtures/, dist-fixtures-*). */
export async function startFixtures(port: number, outDir = 'dist-fixtures'): Promise<FastifyInstance> {
  await promisify(execFile)(process.execPath, [join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'fixtures', '--outDir', outDir, '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...process.env, VITE_FIXTURES: '1' },
    timeout: 200_000,
  });
  const server = Fastify({ logger: false, frameworkErrors, clientErrorHandler });
  await serveWeb(server, { root: join(WEB, outDir), relayOrigin: 'wss://relay.x2f.invalid', nodeProxyOrigin: 'https://node.x2f.invalid' });
  await server.listen({ host: '127.0.0.1', port });
  return server;
}
