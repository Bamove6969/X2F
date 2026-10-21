import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

/**
 * The browser's escrow wallet (monero-ts) talks to a Monero node through this proxy. monero-ts keeps
 * only the host and port of a node address, so the proxy serves Monero's own paths at its root
 * (spec 3.2, Phase 0). It forwards only what a wallet needs, from the web app's origin only, and
 * fails closed: any other path, method or json_rpc call is refused without reaching the node.
 *
 * Run the node itself with `--restricted-rpc` as a second line of defence.
 */
export interface NodeProxyOptions {
  /** The node's RPC base URL, e.g. http://127.0.0.1:18081. Never taken from a request. */
  upstream: string;
  /** The web app's origin; the only origin that gets CORS headers or may call the proxy. */
  webOrigin: string;
  /** Whole upstream call, headers and body (default 20 s; browsers give up after 15 s). */
  timeoutMs?: number;
  /** Largest request body accepted (default 1 MiB). */
  maxBodyBytes?: number;
  /** Upstream calls in flight at once; beyond this the proxy answers 503 (default 256). */
  maxInFlight?: number;
}

export const DEFAULTS = { timeoutMs: 20_000, maxBodyBytes: 1024 * 1024, maxInFlight: 256 } as const;

/**
 * json_rpc methods a wallet may call: the plan's list plus the older names monerod accepts for the
 * same calls, which wallet2 inside monero-ts uses (`getblockheaderbyheight`), and the read-only
 * calls wallet2 and monero-ts's daemon client make (`get_block_count`, `get_output_histogram`,
 * `get_txpool_backlog`).
 */
export const RPC_METHODS: ReadonlySet<string> = new Set([
  'get_info',
  'get_last_block_header',
  'getlastblockheader',
  'get_block_header_by_height',
  'getblockheaderbyheight',
  'get_block_headers_range',
  'getblockheadersrange',
  'get_block_count',
  'getblockcount',
  'get_fee_estimate',
  'get_version',
  'get_output_distribution',
  'get_output_histogram',
  'get_txpool_backlog',
  'hard_fork_info',
]);

/**
 * Binary (epee portable storage) paths, forwarded byte for byte. Beside the plan's list:
 * `/get_outs.bin` (monerod's other name for `/getouts.bin`) and `/get_output_distribution.bin`,
 * both of which wallet2 inside monero-ts calls.
 */
export const BIN_PATHS: readonly string[] = [
  '/getblocks.bin',
  '/getblocks_by_height.bin',
  '/gethashes.bin',
  '/get_o_indexes.bin',
  '/getouts.bin',
  '/get_outs.bin',
  '/get_transaction_pool_hashes.bin',
  '/get_output_distribution.bin',
];

/** JSON paths, re-serialised after parsing. `/gettransactions` is wallet2's name for `/get_transactions`. */
export const JSON_PATHS: readonly string[] = [
  '/get_transactions',
  '/gettransactions',
  '/sendrawtransaction',
  '/get_height',
  '/get_info',
  '/is_key_image_spent',
  '/get_transaction_pool',
];

const SECURITY_HEADERS = {
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
} as const;

type Kind = 'rpc' | 'json' | 'bin';

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function upstreamBase(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new TypeError('upstream must be an http(s) URL');
  if (u.username || u.password || u.search || u.hash) throw new TypeError('upstream must have no credentials, query or fragment');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

function checkOrigin(raw: string): string {
  const u = new URL(raw);
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== raw) throw new TypeError('webOrigin must be an exact origin');
  return raw;
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Refusal(400, 'bad-request');
  }
}

/** The JSON the node receives: rebuilt from what was checked, so no parser differences reach it. */
function rpcBody(body: Buffer): string {
  const req = parseJson(body);
  if (!isPlainObject(req)) throw new Refusal(400, 'bad-request');
  const { jsonrpc, id, method, params } = req;
  if (jsonrpc !== undefined && jsonrpc !== '2.0') throw new Refusal(400, 'bad-request');
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') throw new Refusal(400, 'bad-request');
  if (params !== undefined && !isPlainObject(params)) throw new Refusal(400, 'bad-request');
  if (typeof method !== 'string') throw new Refusal(400, 'bad-request');
  if (!RPC_METHODS.has(method)) throw new Refusal(403, 'method-not-allowed');
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? '0', method, ...(params === undefined ? {} : { params }) });
}

function jsonBody(body: Buffer): string | undefined {
  if (body.length === 0) return undefined;
  const req = parseJson(body);
  if (!isPlainObject(req)) throw new Refusal(400, 'bad-request');
  try {
    return JSON.stringify(req);
  } catch {
    throw new Refusal(400, 'bad-request');
  }
}

export function buildNodeProxy(o: NodeProxyOptions): FastifyInstance {
  const base = upstreamBase(o.upstream);
  const webOrigin = checkOrigin(o.webOrigin);
  const timeoutMs = o.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxInFlight = o.maxInFlight ?? DEFAULTS.maxInFlight;
  let inFlight = 0;

  const app = Fastify({
    // No logger at all: nothing about requests, callers or their addresses is ever written (spec 4.1).
    // trustProxy is left unset, so forwarded addresses are never read either.
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: o.maxBodyBytes ?? DEFAULTS.maxBodyBytes,
    requestTimeout: 30_000,
  });

  // Every body arrives as raw bytes; each route decides what it may be.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // Only the web app may call from a browser. Requests with no Origin (tools, curl) are allowed:
  // CORS protects users' browsers, and the allowlist protects the node.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== webOrigin) return reply.code(403).send({ error: 'origin-not-allowed' });
  });

  app.addHook('onSend', async (req, reply) => {
    void reply.headers(SECURITY_HEADERS);
    void reply.header('vary', 'Origin');
    if (req.headers.origin === webOrigin && reply.statusCode !== 404) void reply.header('access-control-allow-origin', webOrigin);
  });

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: 'not-found' });
  });

  app.setErrorHandler((err: FastifyError | Refusal, _req, reply) => {
    if (err instanceof Refusal) return reply.code(err.status).send({ error: err.code });
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    const code = status === 413 ? 'too-large' : status === 415 ? 'unsupported-media-type' : status === 500 ? 'internal' : 'bad-request';
    return reply.code(status).send({ error: code });
  });

  async function forward(path: string, kind: Kind, req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const body = kind === 'rpc' ? rpcBody(raw) : kind === 'json' ? jsonBody(raw) : new Uint8Array(raw);
    if (inFlight >= maxInFlight) throw new Refusal(503, 'busy');
    inFlight += 1;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        inFlight -= 1;
      }
    };
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': kind === 'bin' ? 'application/octet-stream' : 'application/json' },
        ...(body === undefined ? {} : { body }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      void reply.code(res.status).header('content-type', res.headers.get('content-type') ?? 'application/octet-stream');
      if (!res.body) {
        release();
        return reply.send('');
      }
      const stream = Readable.fromWeb(res.body as NodeWebStream<Uint8Array>);
      stream.once('close', release);
      return reply.send(stream);
    } catch (e) {
      release();
      if (e instanceof Error && e.name === 'TimeoutError') throw new Refusal(504, 'node-timeout');
      throw new Refusal(502, 'node-unavailable');
    }
  }

  const routes: [string, Kind][] = [['/json_rpc', 'rpc'], ...JSON_PATHS.map((p): [string, Kind] => [p, 'json']), ...BIN_PATHS.map((p): [string, Kind] => [p, 'bin'])];
  for (const [path, kind] of routes) {
    app.post(path, (req, reply) => forward(path, kind, req, reply));
    app.options(path, (req, reply) => {
      if (req.headers.origin === webOrigin) {
        void reply.headers({ 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' });
      }
      return reply.code(204).send();
    });
  }

  return app;
}
