// Serves apps/web/dist through the API's serveWeb for the Playwright specs. API routes are stubbed
// per test with page.route; any other /v1 request gets the API's JSON 404.
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { clientErrorHandler, frameworkErrors, serveWeb } from '../../api/src/static/serve.js';

const app = Fastify({ logger: false, frameworkErrors, clientErrorHandler });
const PORT = Number(process.env.X2F_E2E_PORT ?? 4317);
await serveWeb(app, {
  root: fileURLToPath(new URL('../dist', import.meta.url)),
  relayOrigin: 'wss://relay.x2f.invalid',
  nodeProxyOrigin: 'https://node.x2f.invalid',
  // Both names the specs open the app by (playwright.config.ts): the OCR worker fetches under /ocr/ on either.
  siteOrigins: [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`],
});
await app.listen({ host: '127.0.0.1', port: PORT });
