// Builds the app in demo mode (`vite build --mode demo` with VITE_X2F_DEMO=1: the /lab/intro proof of
// concept, vite.config.ts `demoOn`) and serves it through the API's own serveWeb, so the real CSP and
// security headers apply. As fixtures-serve.ts, each spec builds into its own gitignored folder.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Fastify, { type FastifyInstance } from 'fastify';
import { clientErrorHandler, frameworkErrors, serveWeb } from '../../api/src/static/serve.js';

const WEB = fileURLToPath(new URL('..', import.meta.url));

/** `outDir` is relative to apps/web and must be gitignored (dist-demo/, dist-demo-*). */
export async function startDemo(port: number, outDir = 'dist-demo'): Promise<FastifyInstance> {
  await promisify(execFile)(process.execPath, [join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'demo', '--outDir', outDir, '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...process.env, VITE_X2F_DEMO: '1' },
    timeout: 200_000,
  });
  const server = Fastify({ logger: false, frameworkErrors, clientErrorHandler });
  await serveWeb(server, { root: join(WEB, outDir), relayOrigin: 'wss://relay.x2f.invalid', nodeProxyOrigin: 'https://node.x2f.invalid' });
  await server.listen({ host: '127.0.0.1', port });
  return server;
}
