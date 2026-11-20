import type { Socket } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { SITE_SCHEMES, plainOrigin } from '../origins.js';
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

/**
 * Fastify's `frameworkErrors` option: requests refused before routing (a malformed URL such as
 * GET /%zz, an over-long parameter) never run the onRequest hooks, and fastify's default answer
 * quotes the path. This answers them with SECURITY_HEADERS and a fixed body.
 */
export function frameworkErrors(_err: unknown, _req: FastifyRequest, reply: FastifyReply): void {
  void reply.code(400).headers(SECURITY_HEADERS).send({ error: 'bad-request' });
}

const CLIENT_ERRORS: Readonly<Record<string, readonly [number, string, string]>> = {
  HPE_HEADER_OVERFLOW: [431, 'Request Header Fields Too Large', 'headers-too-large'],
  ERR_HTTP_REQUEST_TIMEOUT: [408, 'Request Timeout', 'timeout'],
};
const BAD_REQUEST = [400, 'Bad Request', 'bad-request'] as const;

/**
 * Fastify's `clientErrorHandler` option: HTTP that Node cannot parse (a bad request line, headers
 * over the size limit) never becomes a request, so no hook runs and fastify's default reply has no
 * SECURITY_HEADERS. This writes the reply by hand, with them, a fixed body and nothing from the
 * request, then closes the connection. Nothing is logged.
 */
export function clientErrorHandler(err: NodeJS.ErrnoException, socket: Socket): void {
  if (err.code === 'ECONNRESET' || socket.destroyed) return;
  if (socket.writable) {
    const [status, reason, code] = (err.code !== undefined ? CLIENT_ERRORS[err.code] : undefined) ?? BAD_REQUEST;
    const body = JSON.stringify({ error: code });
    const headers = Object.entries(SECURITY_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n${headers}content-type: application/json\r\n` +
        `content-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
    );
  }
  socket.destroy();
}

export interface WebOptions {
  /** The built web app (apps/web/dist). */
  root: string;
  /** The relay's exact origin, e.g. wss://relay.example.org. */
  relayOrigin: string;
  /** The node proxy's exact origin, e.g. https://node.example.org. */
  nodeProxyOrigin: string;
  /**
   * This site's own exact origins (X2F_ORIGINS), e.g. https://x2f.example.org. The OCR worker may
   * fetch only under each one's /ocr/ (lead call 20 Nov, `ocrWorkerCspFor`).
   */
  siteOrigins: readonly string[];
  /**
   * Allows an http: or ws: origin on a host other than loopback (X2F_ALLOW_INSECURE_ORIGINS=1).
   * Off by default: only a loopback host may be reached in clear text.
   */
  allowInsecureOrigins?: boolean;
}

type ConnectOrigins = Pick<WebOptions, 'relayOrigin' | 'nodeProxyOrigin' | 'allowInsecureOrigins'>;

const CONNECT_SCHEMES = new Set(['https:', 'wss:', 'http:', 'ws:']);
const SECURE_SCHEMES = new Set(['https:', 'wss:']);
/** Hosts that never leave this machine, as `URL.hostname` spells them. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * An exact origin with a plain host (origins.ts `plainOrigin`, review m-1), so nothing else can ride
 * into the policy: no `;`, `,`, `'`, `*` or space.
 */
function origin(value: string, name: string, allowInsecure: boolean): string {
  if (plainOrigin(value, CONNECT_SCHEMES) === null) {
    throw new Error(`web: ${name} must be an exact origin such as wss://relay.example.org`);
  }
  const url = new URL(value);
  // Decided by host, not by NODE_ENV (which nothing sets): the browser may connect in clear text
  // only to this machine, unless the operator opts in with X2F_ALLOW_INSECURE_ORIGINS=1.
  // A future .onion relay or node proxy (http:/ws: over Tor) will need its own deliberate
  // exception here; it is not allowed yet.
  if (!SECURE_SCHEMES.has(url.protocol) && !LOOPBACK_HOSTS.has(url.hostname) && !allowInsecure) {
    throw new Error(`web: ${name} must use https or wss (http and ws only for 127.0.0.1, [::1] or localhost)`);
  }
  return value;
}

/** The Content-Security-Policy for HTML responses (Global Constraints). */
export function cspFor(o: ConnectOrigins): string {
  const insecure = o.allowInsecureOrigins === true;
  const relay = origin(o.relayOrigin, 'relay origin', insecure);
  const node = origin(o.nodeProxyOrigin, 'node proxy origin', insecure);
  const csp = [
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
  // Review m-1: one policy of exactly these 11 directives, whatever the settings held.
  if (csp.split(';').length !== 11 || csp.includes(',')) throw new Error('web: the page CSP did not come out as 11 directives');
  return csp;
}

/**
 * The CSP on every `/ocr/*` response (Plan 5 Task 13, Global Constraints). A dedicated worker takes
 * its CSP from its own response, not from the page, so the OCR worker gets this one: it may load
 * scripts and compile WebAssembly from this origin and fetch from this origin, nothing else (so even
 * a CDN default inside tesseract.js could not be reached).
 *
 * Lead call 20 Nov (the Task 16 review): connect-src is not 'self' but this site's /ocr/ path on each
 * of its origins (a source with a path: the worker's fetches of its model match it, a fetch to /v1/
 * does not), so a worker taken over through the OCR engine, which now reads a picture the counterparty
 * made, cannot reach the API with the trader's cookies. CSP ignores the path after a redirect, and
 * nothing under /ocr/ redirects (static files only). Review M-1: script-src is narrowed the same way
 * (importScripts and a nested Worker send cookie-bearing GETs too; tesseract's worker only
 * importScripts its core from /ocr/), and worker-src 'none' (it starts no worker). The worker's own
 * script is checked against the page's worker-src 'self'. Tested in apps/web/e2e/proof-ocr.spec.ts.
 */
export function ocrWorkerCspFor(o: Pick<WebOptions, 'siteOrigins'>): string {
  if (!Array.isArray(o.siteOrigins) || o.siteOrigins.length === 0) throw new Error('web: the site origins (X2F_ORIGINS) are needed for the OCR worker CSP');
  // Review m-4: exactly what config.ts accepts for X2F_ORIGINS (the same helper), so a site origin
  // the API runs with never fails here, and an onion's http: origin gets its /ocr/ too.
  const sources = o.siteOrigins.map((v) => {
    if (plainOrigin(v, SITE_SCHEMES) === null) throw new Error('web: a site origin (X2F_ORIGINS) must be an exact origin such as https://x2f.example');
    return `${v}/ocr/`;
  });
  const ocr = sources.join(' ');
  return `default-src 'none'; script-src ${ocr} 'wasm-unsafe-eval'; connect-src ${ocr}; worker-src 'none'`;
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
  const siteOrigins = need('X2F_ORIGINS').split(',').map((v) => v.trim());
  const allowInsecureOrigins = env.X2F_ALLOW_INSECURE_ORIGINS === '1';
  const o: WebOptions = { root, relayOrigin, nodeProxyOrigin, siteOrigins, ...(allowInsecureOrigins ? { allowInsecureOrigins } : {}) };
  cspFor(o);
  ocrWorkerCspFor(o);
  return o;
}

/**
 * File extensions the web build emits or a browser asks for on its own (fonts, source maps,
 * icons, manifest, wasm). Only these make a path "a file": an app route whose last segment merely
 * contains a dot (/u/mira.k, /trade/ABCD.EFGH) is still the app page.
 */
const FILE_EXTENSIONS = new Set([
  'js', 'mjs', 'css', 'html', 'map', 'json', 'txt', 'xml', 'wasm',
  'woff', 'woff2', 'ttf', 'otf',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'webmanifest',
]);

/** Drops trailing dots and whitespace, like .replace(/[.\s]+$/, '') but linear: that regex backtracks quadratically on '. . . … .x'. */
function trimTrailingDotsAndSpaces(seg: string): string {
  let end = seg.length;
  while (end > 0 && /[.\s]/.test(seg.charAt(end - 1))) end--;
  return seg.slice(0, end);
}

/**
 * Whether `url` is an API path (first segment `apiSegment`: `v1` on the trader origin, `staff` on the
 * staff origin, Plan 4 Task 16) or a file-like path, so never the app page.
 */
export function isApiOrFilePath(url: string, apiSegment = 'v1'): boolean {
  const raw = url.split('?', 1)[0] ?? '';
  let path: string;
  try {
    path = decodeURIComponent(raw).toLowerCase();
  } catch {
    return true; // undecodable: never the app page
  }
  // Repeated slashes collapse and trailing dots or spaces on a segment drop, so //v1/x, /v1./x
  // and /v1%20 are judged like /v1/x.
  const segments = path.split('/').filter((seg) => seg !== '');
  const first = trimTrailingDotsAndSpaces(segments[0] ?? '');
  if (first === apiSegment) return true;
  const last = segments.at(-1) ?? '';
  const dot = last.lastIndexOf('.');
  const ext = last.slice(dot + 1);
  // The OCR model (Plan 5 Task 13): a missing /ocr/*.gz is a 404, never the app page. Only there, so
  // a profile such as /u/alice.gz stays the app page (review m-4).
  if (dot > 0 && ext === 'gz') return first === 'ocr';
  return dot > 0 && FILE_EXTENSIONS.has(ext);
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Review m-2: under /ocr/ (the only path the OCR worker may reach, `ocrWorkerCspFor`) a raw path with
 * an encoded slash, dot or backslash, a `%25`, a `..` or a backslash is refused. The browser leaves
 * `/ocr/..%2Fv1%2Fx` as it is and the CSP allows it; this server never resolves it, but a front
 * proxy that decodes or normalises could turn it into /v1/x. Read from the raw request line, since
 * an injected request is normalised before routing.
 */
export function badOcrPath(rawUrl: string): boolean {
  const path = (rawUrl.split('?', 1)[0] ?? '').toLowerCase();
  if (path !== '/ocr' && !path.startsWith('/ocr/')) return false;
  return /%2f|%2e|%5c|%25|\\|\.\./.test(path);
}

/**
 * Serves the built web app on this origin: hashed files from `root`, and index.html for every
 * other GET outside /v1 (the client router takes it from there). HTML carries the CSP; every
 * response carries SECURITY_HEADERS.
 */
export async function serveWeb(app: FastifyInstance, o: WebOptions): Promise<void> {
  const csp = cspFor(o);
  const ocrCsp = ocrWorkerCspFor(o);
  const ocrDir = join(resolve(o.root), 'ocr') + sep;
  await app.register(async (scope) => {
    scope.addHook('onRequest', addSecurityHeaders);
    scope.addHook('onRequest', async (req, reply) => {
      if (badOcrPath(req.raw.url ?? '')) return reply.code(400).send({ error: 'bad-request' });
    });
    await scope.register(fastifyStatic, {
      root: o.root,
      wildcard: false, // one route per built file; the catch-all below handles the rest
      index: false,
      serveDotFiles: false,
      setHeaders(reply, path) {
        if (resolve(path).startsWith(ocrDir)) {
          // Plan 5 Task 13: the OCR worker, its engine and model get the worker's own CSP.
          void reply.header('content-security-policy', ocrCsp);
        } else if (path.endsWith('.html')) {
          void reply.header('content-security-policy', csp).header('cache-control', 'no-cache');
        } else if (/[\\/]sw\.js$/.test(path) && !/[\\/]assets[\\/]/.test(path)) {
          // The service worker (Task 19) keeps its name across releases: always revalidated.
          void reply.header('cache-control', 'no-cache');
        } else if (/[\\/]assets[\\/]/.test(path)) {
          void reply.header('cache-control', IMMUTABLE);
        }
      },
    });

    const page = (_req: FastifyRequest, reply: FastifyReply) =>
      reply.header('content-security-policy', csp).header('cache-control', 'no-cache').sendFile('index.html');

    scope.get('/', page);
    scope.get('/*', (req, reply) => {
      // API paths (in any case or encoding, e.g. /V1/x or /v1%2fx) and file-like paths that were not
      // built are plain 404s, never the app page.
      if (isApiOrFilePath(req.url)) {
        return reply.code(404).send({ error: 'not-found' });
      }
      return page(req, reply);
    });
  });
}
