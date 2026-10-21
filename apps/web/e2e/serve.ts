// Serves apps/web/dist through the API's serveWeb for the Playwright specs. API routes are stubbed
// per test with page.route; any other /v1 request gets the API's JSON 404.
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { frameworkErrors, serveWeb } from '../../api/src/static/serve.js';

const app = Fastify({ logger: false, frameworkErrors });
await serveWeb(app, {
  root: fileURLToPath(new URL('../dist', import.meta.url)),
  relayOrigin: 'wss://relay.x2f.invalid',
  nodeProxyOrigin: 'https://node.x2f.invalid',
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.X2F_E2E_PORT ?? 4317) });
