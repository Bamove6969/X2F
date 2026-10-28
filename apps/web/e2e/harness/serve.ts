// Builds the screen harness (main.tsx) and serves it through the API's own serveWeb, so the real
// CSP and security headers apply, as e2e/serve.ts does for the app.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { clientErrorHandler, frameworkErrors, serveWeb } from '../../../api/src/static/serve.js';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = fileURLToPath(new URL('./vite.config.ts', import.meta.url));

export async function startHarness(port: number): Promise<FastifyInstance> {
  execFileSync('npx', ['vite', 'build', '--config', CONFIG], { cwd: WEB, stdio: 'inherit' });
  const app = Fastify({ logger: false, frameworkErrors, clientErrorHandler });
  await serveWeb(app, {
    root: fileURLToPath(new URL('./dist', import.meta.url)),
    relayOrigin: 'wss://relay.x2f.invalid',
    nodeProxyOrigin: 'https://node.x2f.invalid',
  });
  await app.listen({ host: '127.0.0.1', port });
  return app;
}
