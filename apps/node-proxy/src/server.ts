import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

/**
 * The browser's escrow wallet (monero-ts) talks to a Monero node through this proxy. monero-ts keeps
 * only the host and port of a node address, so the proxy serves Monero's own paths at its root
 * (spec 3.2, Phase 0). It forwards only what a wallet needs, from the web app's origin only, and
 * fails closed: any other path, method or json_rpc call is refused without reaching the node.
 *
 * The node must run with `--restricted-rpc` as a second line of defence; main.ts refuses to start otherwise.
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
  /** Calls the proxy holds at once, waiting or at the node; beyond this it answers 503 (default 256). */
  maxInFlight?: number;
  /**
   * Calls open at the node at once (default 20). Every wallet reaches the node from the proxy's one
   * address, and monerod caps connections per address (--rpc-max-connections-per-private-ip 25,
   * -per-public-ip 3, --rpc-max-connections 100 by default), so the proxy queues the rest. A call that
   * waits longer than timeoutMs for a slot gets 503 `busy`. Keep this below the node's per-IP limit
   * (docs/dev-setup.md).
   */
  maxUpstream?: number;
}

/** Default listening port; the relay's admin listener has 8788. */
export const DEFAULT_PORT = 8789;

export const DEFAULTS = { timeoutMs: 20_000, maxBodyBytes: 1024 * 1024, maxInFlight: 256, maxUpstream: 20 } as const;

/*
 * Task 11 allowlist (2026-10-21). Fail closed: the plan's entries plus only what monero-ts 0.11.16
 * (wallet2 inside) is shown to need. test/wallet.test.ts pins it: two real wallets sync, send at
 * default priority, relay and see the pool tx through the proxy against a restricted regtest node,
 * and none of their calls may be refused. Entries beyond the plan, and why:
 *   - json_rpc `getblockheadersrange`, `get_txpool_backlog`: wallet2's adjust_priority (default
 *     priority) reads recent block headers and the pool backlog. Both seen in the wallet test.
 *   - `/get_outs.bin`: wallet2 fetches decoy outputs here (monerod's other name for `/getouts.bin`).
 *   - `/get_output_distribution.bin`: wallet2 reads the output distribution in binary for decoy
 *     selection. Both seen in the wallet test.
 * Removed after review: `get_block_count`/`getblockcount` (only MoneroDaemonRpc.getHeight; txSeen's
 * getTx does not use it), `getlastblockheader` (monero-ts 0.11.16 never calls it) and
 * `get_output_histogram` (expensive on the node, only a fallback). Dropped by the lead (2026-10-21,
 * least privilege): json_rpc `getblockheaderbyheight`, wallet2's name for the plan's
 * `get_block_header_by_height` on a fallback path the wallet test never reaches.
 *   - `/gettransactions` (back, lead 2026-11-20): wallet2's check_tx_key reads the tx here (monerod
 *     serves it with the same handler as `/get_transactions`, already allowed). The escrow builder
 *     proves its own release by its tx key (security review of the no-show refund, M1 and m4); in
 *     the browser that runs only through this proxy. It was dropped on 21 Oct only because nothing
 *     reached it. Pinned by test/wallet.test.ts (a wallet's check_tx_key through the proxy).
 */

/** json_rpc methods a wallet may call. */
export const RPC_METHODS: ReadonlySet<string> = new Set([
  'get_info',
  'get_last_block_header',
  'get_block_header_by_height',
  'get_block_headers_range',
  'getblockheadersrange',
  'get_fee_estimate',
  'get_version',
  'get_output_distribution',
  'get_txpool_backlog',
  'hard_fork_info',
]);

/** Binary (epee portable storage) paths, forwarded byte for byte. */
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

/** JSON paths, re-serialised after parsing. */
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

/** Re-serialises a checked value; JSON nested past the stack limit is the caller's error, not ours. */
function serialise(value: unknown): string {
  try {
    return JSON.stringify(value);
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
  return serialise({ jsonrpc: '2.0', id: id ?? '0', method, ...(params === undefined ? {} : { params }) });
}

function jsonBody(body: Buffer): string | undefined {
  if (body.length === 0) return undefined;
  const req = parseJson(body);
  if (!isPlainObject(req)) throw new Refusal(400, 'bad-request');
  return serialise(req);
}

export function buildNodeProxy(o: NodeProxyOptions): FastifyInstance {
  const base = upstreamBase(o.upstream);
  const webOrigin = checkOrigin(o.webOrigin);
  const timeoutMs = o.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxInFlight = o.maxInFlight ?? DEFAULTS.maxInFlight;
  const maxUpstream = o.maxUpstream ?? DEFAULTS.maxUpstream;
  let inFlight = 0;

  // A counting semaphore around the node: at most maxUpstream fetches (and so connections) open.
  let upstreamOpen = 0;
  const waiting: (() => void)[] = [];
  function acquireUpstream(): Promise<void> {
    if (upstreamOpen < maxUpstream) {
      upstreamOpen += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = (): void => {
        clearTimeout(timer);
        resolve(); // the releasing call's slot passes straight to this one
      };
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(grant), 1);
        reject(new Refusal(503, 'busy'));
      }, timeoutMs);
      waiting.push(grant);
    });
  }
  function releaseUpstream(): void {
    const next = waiting.shift();
    if (next) next();
    else upstreamOpen -= 1;
  }

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
    try {
      await acquireUpstream();
    } catch (e) {
      inFlight -= 1;
      throw e;
    }
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        inFlight -= 1;
        releaseUpstream();
        clearTimeout(backstop);
      }
    };
    // The upstream call is aborted at timeoutMs; free the slot then even if a reply stream that
    // nobody reads never reports its close.
    const backstop = setTimeout(release, timeoutMs + 1000);
    backstop.unref();
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        // No keep-alive: fetch's pool opens extra connections beside idle ones (measured 38 open for
        // 20 calls at once), and monerod counts every one against the proxy's address.
        headers: { 'content-type': kind === 'bin' ? 'application/octet-stream' : 'application/json', connection: 'close' },
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

/** Why the proxy will not start in front of a node. */
export class NodeCheckError extends Error {
  constructor(readonly reason: 'node-unavailable' | 'node-not-restricted') {
    super(reason);
  }
}

/**
 * Refuses a node not running with `--restricted-rpc`: the allowlist is the first line of defence and
 * the node's own restricted mode the second, so the proxy never starts without both. main.ts always
 * calls this; tests that build the proxy directly with buildNodeProxy skip it.
 */
export async function requireRestrictedNode(upstream: string, timeoutMs: number = DEFAULTS.timeoutMs): Promise<void> {
  let info: unknown;
  try {
    const res = await fetch(`${upstreamBase(upstream)}/json_rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_info' }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error('status');
    info = await res.json();
  } catch {
    throw new NodeCheckError('node-unavailable');
  }
  const result = isPlainObject(info) ? info.result : undefined;
  if (!isPlainObject(result) || result.restricted !== true) throw new NodeCheckError('node-not-restricted');
}
