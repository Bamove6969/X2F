// Serves apps/staff-web/dist for the Playwright specs through the staff API's serveStaffWeb, with
// the staff API's answer headers (STAFF_CSP, no-store, the security headers). API routes are
// stubbed per test with page.route; any other /staff request gets the API's JSON 404.
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { STAFF_CSP } from '../../api/src/staff/app.js';
import { serveStaffWeb } from '../../api/src/staff/web.js';
import { addSecurityHeaders, clientErrorHandler, frameworkErrors } from '../../api/src/static/serve.js';

const app = Fastify({ logger: false, frameworkErrors, clientErrorHandler });
app.addHook('onRequest', addSecurityHeaders);
app.addHook('onRequest', (_req, reply, done) => {
  void reply.header('cache-control', 'no-store').header('content-security-policy', STAFF_CSP);
  done();
});
await serveStaffWeb(app, fileURLToPath(new URL('../dist', import.meta.url)));
await app.listen({ host: 'localhost', port: Number(process.env.X2F_E2E_PORT ?? 4318) });
