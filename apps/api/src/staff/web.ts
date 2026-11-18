import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import nodePath from 'node:path';
import { isApiOrFilePath } from '../static/serve.js';
import { PUBLIC_LOGIN } from './login.js';

/**
 * Serves the built staff app (apps/staff-web/dist) on the staff origin (Plan 4 Task 16), when
 * `X2F_STAFF_WEB_ROOT` names it: the built files, and index.html for every other GET outside
 * /staff (the client router takes it from there). Every answer already carries the staff API's
 * STAFF_CSP (Plan 3's policy without the relay or the node proxy; 'wasm-unsafe-eval' for libsodium only),
 * SECURITY_HEADERS and `no-store` from buildStaffApi's hooks. The routes are public (perm
 * `public-login`): the pages hold nothing until the API lets the person in.
 */
export async function serveStaffWeb(app: FastifyInstance, root: string): Promise<void> {
  // `serve: false`: no routes of its own (each staff route must declare a perm); only sendFile.
  // `dotfiles: 'ignore'`: @fastify/send refuses dot files itself (a second layer under fileUnderRoot).
  await app.register(fastifyStatic, { root, serve: false, index: false, serveDotFiles: false, dotfiles: 'ignore' });
  // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile -- literal file name under `root`, no request input
  const page = (_req: FastifyRequest, reply: FastifyReply) => reply.sendFile('index.html');
  app.get('/', { config: PUBLIC_LOGIN }, page);
  app.get('/*', { config: PUBLIC_LOGIN }, (req, reply) => {
    const path = req.url.split('?', 1)[0] ?? '';
    // An unknown /staff path is the API's 404, never the app page.
    if (isApiOrFilePath(req.url, 'staff')) {
      const segments = path.split('/').filter((s) => s !== '');
      if (segments[0]?.toLowerCase() === 'staff' || segments.some((s) => s.startsWith('.'))) return reply.code(404).send({ error: 'not-found' });
      const file = fileUnderRoot(root, path);
      if (file === null) return reply.code(404).send({ error: 'not-found' });
      // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile -- `file` is canonicalised by fileUnderRoot and proven to sit under `root`; @fastify/send roots it again
      return reply.sendFile(file);
    }
    return page(req, reply);
  });
}

/**
 * The request path as a file path relative to `root`, or null when it does not name a file
 * strictly inside `root`: undecodable percent-escapes, dot segments or dot files (encoded or not),
 * an empty name, a NUL byte, or anything that resolves to `root` itself or outside it.
 */
export function fileUnderRoot(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const segments = decoded.split('/').filter((s) => s !== '');
  // Any segment starting with a dot: `.`, `..` and dot files alike (also when the dot was %2E-encoded).
  if (segments.length === 0 || segments.some((s) => s.startsWith('.') || s.includes('\\'))) return null;
  const rootAbs = nodePath.resolve(root);
  const fileAbs = nodePath.resolve(rootAbs, ...segments);
  if (!fileAbs.startsWith(rootAbs + nodePath.sep)) return null;
  return nodePath.relative(rootAbs, fileAbs);
}
