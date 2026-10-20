import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Sent on every response, API and web alike (Global Constraints; P3-I15). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
};

/**
 * `onRequest` hook adding SECURITY_HEADERS. Set before the handler runs, they stay on whatever
 * reply follows: 404s and errors included. (An async `onSend` hook would delay the first send and
 * change how a handler that replies twice fails.)
 */
export function addSecurityHeaders(_req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  void reply.headers(SECURITY_HEADERS);
  done();
}

export interface WebOptions {
  /** The built web app (apps/web/dist). */
  root: string;
  /** The relay's exact origin, e.g. wss://relay.example.org. */
  relayOrigin: string;
  /** The node proxy's exact origin, e.g. https://node.example.org. */
  nodeProxyOrigin: string;
}

const CONNECT_SCHEMES = new Set(['https:', 'wss:', 'http:', 'ws:']);

/** An exact origin, so nothing else can ride into the policy. */
function origin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`web: ${name} must be an exact origin such as wss://relay.example.org`);
  }
  if (!CONNECT_SCHEMES.has(url.protocol) || url.origin !== value) {
    throw new Error(`web: ${name} must be an exact origin such as wss://relay.example.org`);
  }
  return value;
}

/** The Content-Security-Policy for HTML responses (Global Constraints). */
export function cspFor(o: Pick<WebOptions, 'relayOrigin' | 'nodeProxyOrigin'>): string {
  const relay = origin(o.relayOrigin, 'relay origin');
  const node = origin(o.nodeProxyOrigin, 'node proxy origin');
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    `connect-src 'self' ${relay} ${node}`,
    "img-src 'self' data:",
    "style-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The web settings from the environment; `null` when this process does not serve the web app. */
export function webOptionsFromEnv(env: Record<string, string | undefined>): WebOptions | null {
  const root = env.X2F_WEB_ROOT;
  if (root === undefined || root === '') return null;
  const need = (name: string): string => {
    const v = env[name];
    if (v === undefined || v === '') throw new Error(`config: ${name} is missing (needed with X2F_WEB_ROOT)`);
    return v;
  };
  const relayOrigin = need('X2F_RELAY_ORIGIN');
  const nodeProxyOrigin = need('X2F_NODE_PROXY_ORIGIN');
  cspFor({ relayOrigin, nodeProxyOrigin });
  return { root, relayOrigin, nodeProxyOrigin };
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves the built web app on this origin: hashed files from `root`, and index.html for every
 * other GET outside /v1 (the client router takes it from there). HTML carries the CSP; every
 * response carries SECURITY_HEADERS.
 */
export async function serveWeb(app: FastifyInstance, o: WebOptions): Promise<void> {
  const csp = cspFor(o);
  await app.register(async (scope) => {
    scope.addHook('onRequest', addSecurityHeaders);
    await scope.register(fastifyStatic, {
      root: o.root,
      wildcard: false, // one route per built file; the catch-all below handles the rest
      index: false,
      serveDotFiles: false,
      setHeaders(reply, path) {
        if (path.endsWith('.html')) {
          void reply.header('content-security-policy', csp).header('cache-control', 'no-cache');
        } else if (/[\\/]assets[\\/]/.test(path)) {
          void reply.header('cache-control', IMMUTABLE);
        }
      },
    });

    const page = (_req: FastifyRequest, reply: FastifyReply) =>
      reply.header('content-security-policy', csp).header('cache-control', 'no-cache').sendFile('index.html');

    scope.get('/', page);
    scope.get('/*', (req, reply) => {
      const path = req.url.split('?', 1)[0] ?? '';
      // API paths and file-like paths that were not built are plain 404s, never the app page.
      if (path === '/v1' || path.startsWith('/v1/') || /\.[A-Za-z0-9]+$/.test(path)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      return page(req, reply);
    });
  });
}
