import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isApiOrFilePath } from '../static/serve.js';
import { PUBLIC_LOGIN } from './login.js';

/**
 * Serves the built staff app (apps/staff-web/dist) on the staff origin (Plan 4 Task 16), when
 * `X2F_STAFF_WEB_ROOT` names it: the built files, and index.html for every other GET outside
 * /staff (the client router takes it from there). Every answer already carries the staff API's
 * STAFF_CSP (Plan 3's policy without 'wasm-unsafe-eval', the relay or the node proxy),
 * SECURITY_HEADERS and `no-store` from buildStaffApi's hooks. The routes are public (perm
 * `public-login`): the pages hold nothing until the API lets the person in.
 */
export async function serveStaffWeb(app: FastifyInstance, root: string): Promise<void> {
  // `serve: false`: no routes of its own (each staff route must declare a perm); only sendFile.
  await app.register(fastifyStatic, { root, serve: false, index: false, serveDotFiles: false });
  const page = (_req: FastifyRequest, reply: FastifyReply) => reply.sendFile('index.html');
  app.get('/', { config: PUBLIC_LOGIN }, page);
  app.get('/*', { config: PUBLIC_LOGIN }, (req, reply) => {
    const path = req.url.split('?', 1)[0] ?? '';
    // An unknown /staff path is the API's 404, never the app page.
    if (isApiOrFilePath(req.url, 'staff')) {
      const segments = path.split('/').filter((s) => s !== '');
      if (segments[0]?.toLowerCase() === 'staff' || segments.some((s) => s.startsWith('.'))) return reply.code(404).send({ error: 'not-found' });
      return reply.sendFile(decodeURIComponent(path.slice(1)));
    }
    return page(req, reply);
  });
}
