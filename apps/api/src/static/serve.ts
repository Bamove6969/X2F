import { readdir, stat } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { SITE_SCHEMES, clearTextAllowed, plainOrigin } from '../origins.js';
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
   * fetch only under each one's /ocr/ (lead call 20 Nov, `ocrWorkerCspFor`), and the escrow worker
   * may start only monero-ts's worker on each (`escrowWorkerCspFor`: 'self' cannot carry a path).
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
 * The one check for every origin that goes into a policy here: an exact origin with a plain host
 * (origins.ts `plainOrigin`, review m-1), so nothing else can ride into the policy (no `;`, `,`, `'`,
 * `*` or space), and clear text only where origins.ts `clearTextAllowed` allows it, exactly as
 * config.ts checks X2F_ORIGINS.
 * - `site`: this site's own origins (X2F_ORIGINS), http(s); a .onion host may be http.
 * - `connect`: the relay and node proxy, http(s) or ws(s). A .onion relay or node proxy in clear text
 *   is still refused unless the operator opts in (lead default, owner question: it was not allowed
 *   before and needs its own deliberate exception).
 */
function exactOrigin(value: string, name: string, kind: 'site' | 'connect', allowInsecure: boolean): string {
  const example = kind === 'site' ? 'https://x2f.example' : 'wss://relay.example.org';
  if (plainOrigin(value, kind === 'site' ? SITE_SCHEMES : CONNECT_SCHEMES) === null) {
    throw new Error(`web: ${name} must be an exact origin such as ${example}`);
  }
  const url = new URL(value);
  const clear = !SECURE_SCHEMES.has(url.protocol);
  const onionOnly = clear && !allowInsecure && !LOOPBACK_HOSTS.has(url.hostname);
  if (!clearTextAllowed(value, allowInsecure) || (kind === 'connect' && onionOnly)) {
    throw new Error(
      kind === 'site'
        ? `web: ${name} must use https (http only for 127.0.0.1, [::1], localhost or a .onion host)`
        : `web: ${name} must use https or wss (http and ws only for 127.0.0.1, [::1] or localhost)`,
    );
  }
  return value;
}

function origin(value: string, name: string, allowInsecure: boolean): string {
  return exactOrigin(value, name, 'connect', allowInsecure);
}

/** This site's own origins (X2F_ORIGINS), each through `exactOrigin`; at least one. */
function siteOriginsOf(o: Pick<WebOptions, 'siteOrigins' | 'allowInsecureOrigins'>, why: string): string[] {
  if (!Array.isArray(o.siteOrigins) || o.siteOrigins.length === 0) throw new Error(`web: the site origins (X2F_ORIGINS) are needed for ${why}`);
  return o.siteOrigins.map((v) => exactOrigin(v, 'a site origin (X2F_ORIGINS)', 'site', o.allowInsecureOrigins === true));
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
export function ocrWorkerCspFor(o: Pick<WebOptions, 'siteOrigins' | 'allowInsecureOrigins'>): string {
  // Review m-4: exactly what config.ts accepts for X2F_ORIGINS (the same helpers), so a site origin
  // the API runs with never fails here, and an onion's http: origin gets its /ocr/ too.
  const sources = siteOriginsOf(o, 'the OCR worker CSP').map((v) => `${v}/ocr/`);
  const ocr = sources.join(' ');
  return `default-src 'none'; script-src ${ocr} 'wasm-unsafe-eval'; connect-src ${ocr}; worker-src 'none'`;
}

/** Where the web build serves monero-ts's own wallet worker (Gap 1, tools/copy-monero-worker.ts). */
export const MONERO_WORKER_PATH = '/monero/monero.worker.js';

/**
 * The CSP on every `/monero/*` response (Gap 1). A dedicated worker takes its CSP from its own
 * response, not from the page, so monero-ts's wallet worker (where every escrow wallet's keys live)
 * gets this one: it may compile its inline WebAssembly and reach the node proxy, and nothing else:
 * no script loads at all (it is one self-contained file), no relay, not even this origin.
 */
export function moneroWorkerCspFor(o: ConnectOrigins): string {
  const node = origin(o.nodeProxyOrigin, 'node proxy origin', o.allowInsecureOrigins === true);
  return ["default-src 'none'", "script-src 'wasm-unsafe-eval'", `connect-src ${node}`].join('; ');
}

/**
 * The CSP on the escrow worker (lead call 20 Nov), where every trader's multisig key shares, chat
 * identity and chat keys live. A dedicated worker takes its CSP from its own response, so without
 * this it ran under no policy at all. What it really reaches (read from the code, proved by the
 * regtest e2e and apps/web/e2e/worker-csp.spec.ts):
 * - connect-src <site>/v1/ on each site origin: the API (escrow, chat and news under /v1, all
 *   relative URLs), and nothing else on this origin (review m-2: not 'self');
 * - the relay (escrow signals and the multisig rounds, wsTransport over VITE_RELAY_URL);
 * - the node proxy (MoneroMultisigEngine's fee and tx reads, and in-process wallets' daemon calls);
 * - script-src 'wasm-unsafe-eval': libsodium's and monero-ts's WebAssembly, never JS eval, and
 *   (review m-2: no 'self') no script loads at all: it is one self-contained module worker, so no
 *   same-origin script can be pulled into the worker that holds the keys;
 * - worker-src: only monero-ts's own wallet worker, by full URL on each site origin.
 */
export function escrowWorkerCspFor(o: ConnectOrigins & Pick<WebOptions, 'siteOrigins'>): string {
  const insecure = o.allowInsecureOrigins === true;
  const relay = origin(o.relayOrigin, 'relay origin', insecure);
  const node = origin(o.nodeProxyOrigin, 'node proxy origin', insecure);
  const sites = siteOriginsOf(o, 'the escrow worker CSP');
  const workers = sites.map((w) => `${w}${MONERO_WORKER_PATH}`);
  const api = sites.map((w) => `${w}/v1/`);
  return [
    "default-src 'none'",
    "script-src 'wasm-unsafe-eval'",
    `worker-src ${workers.join(' ')}`,
    `connect-src ${api.join(' ')} ${relay} ${node}`,
  ].join('; ');
}

/**
 * The CSP on the service worker (/sw.js, Task 19): it shows a notification, posts the kind to open
 * windows and opens or focuses the site, none of which CSP governs; it fetches and loads nothing.
 */
export const SERVICE_WORKER_CSP = "default-src 'none'";

/**
 * Review M-1 (20 Nov): the CSP on every other script under /assets/ (re-review n-1: and on any script
 * outside /assets/, /ocr/, /monero/ and /sw.js). A `<script>` or `import` load
 * ignores a response's CSP, so the page is unaffected; but the page's `worker-src 'self'` lets page
 * code start any same-origin script as a dedicated worker, which takes its CSP from its own response
 * and so ran under none (a way round the page's connect-src). Now such a worker may reach nothing,
 * and an escrow worker that a build ever named otherwise fails closed instead of running unpoliced.
 */
export const ASSET_SCRIPT_CSP = "default-src 'none'";

/**
 * The escrow worker's file, exactly as apps/web/vite.config.ts `ESCROW_WORKER_FILE_NAMES` emits it
 * (assets/escrow-worker-<8-character hash>.js; apps/web/test/bundle.test.ts pins both), so a rename
 * can never silently leave it without its CSP.
 */
export const ESCROW_WORKER_FILE = /[\\/]assets[\\/]escrow-worker-[A-Za-z0-9_-]{8}\.js$/;

/**
 * Review m-3: when the build has an assets folder, it must hold exactly one file named as
 * ESCROW_WORKER_FILE says, or serveWeb refuses to start (bundle.test pins this at build time; this
 * catches a build or rename that slipped past it before any trader's keys run unpoliced).
 * Re-review n-1: a root with the app page (index.html) must have that folder too, so a changed
 * `build.assetsDir` cannot skip this check. A root with neither (no app at all) still starts.
 */
async function checkEscrowWorker(root: string): Promise<void> {
  const assets = join(resolve(root), 'assets');
  let names: string[];
  try {
    names = await readdir(assets);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    if (await exists(join(resolve(root), 'index.html'))) {
      throw new Error(`web: ${root} has index.html but no assets folder (the escrow worker must be ${assets}/escrow-worker-<8-character hash>.js)`);
    }
    return;
  }
  const found = names.filter((n) => ESCROW_WORKER_FILE.test(join(assets, n)));
  if (found.length !== 1) {
    throw new Error(`web: ${assets} must hold exactly one escrow worker (escrow-worker-<8-character hash>.js); found ${found.length}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
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
  escrowWorkerCspFor(o);
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
 * Review m-2: under /ocr/ (its first segment `ocr` in any case and encoding; the only path the OCR worker may reach, `ocrWorkerCspFor`) a raw path with
 * an encoded slash, dot or backslash, a `%25`, a `..` or a backslash is refused. The browser leaves
 * `/ocr/..%2Fv1%2Fx` as it is and the CSP allows it; this server never resolves it, but a front
 * proxy that decodes or normalises could turn it into /v1/x. Read from the raw request line, since
 * an injected request is normalised before routing.
 */
export function badOcrPath(rawUrl: string): boolean {
  const path = (rawUrl.split('?', 1)[0] ?? '').toLowerCase();
  // Re-review n-1: the first segment decoded once (`/%6Fcr/` is /ocr/ to a proxy that decodes), and
  // a first segment that does not decode is refused outright.
  const first = path.replace(/^\/+/, '').split('/', 1)[0] ?? '';
  let name: string;
  try {
    name = decodeURIComponent(first).toLowerCase();
  } catch {
    return true;
  }
  if (name !== 'ocr') return false;
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
  const moneroCsp = moneroWorkerCspFor(o);
  const escrowCsp = escrowWorkerCspFor(o);
  await checkEscrowWorker(o.root);
  const ocrDir = join(resolve(o.root), 'ocr') + sep;
  const moneroDir = join(resolve(o.root), 'monero') + sep;
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
        } else if (resolve(path).startsWith(moneroDir)) {
          // Gap 1: monero-ts's wallet worker gets its own CSP; its name is fixed, so revalidated.
          void reply.header('content-security-policy', moneroCsp).header('cache-control', 'no-cache');
        } else if (path.endsWith('.html')) {
          void reply.header('content-security-policy', csp).header('cache-control', 'no-cache');
        } else if (/[\\/]sw\.js$/.test(path) && !/[\\/]assets[\\/]/.test(path)) {
          // The service worker (Task 19) keeps its name across releases: always revalidated.
          void reply.header('content-security-policy', SERVICE_WORKER_CSP).header('cache-control', 'no-cache');
        } else if (ESCROW_WORKER_FILE.test(path)) {
          // The escrow worker (lead call 20 Nov): its own CSP. Review m-1: revalidated (ETag) like the
          // monero worker, not cached for a year, since its policy follows X2F_ORIGINS, which the
          // file's hash does not cover: a tightened policy must reach browsers that hold the file.
          void reply.header('content-security-policy', escrowCsp).header('cache-control', 'no-cache');
        } else if (/[\\/]assets[\\/]/.test(path)) {
          // Review M-1: any other script, started as a worker, may reach nothing (ASSET_SCRIPT_CSP).
          if (/\.m?js$/i.test(path)) void reply.header('content-security-policy', ASSET_SCRIPT_CSP);
          void reply.header('cache-control', IMMUTABLE);
        } else if (/\.m?js$/i.test(path)) {
          // Re-review n-1: a script anywhere else (a future public/*.js, a changed build.assetsDir)
          // is deny-all too, so nothing outside the branches above can start as an unpoliced worker.
          void reply.header('content-security-policy', ASSET_SCRIPT_CSP);
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
