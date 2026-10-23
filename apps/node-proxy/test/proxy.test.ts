import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIN_PATHS, buildNodeProxy, DEFAULTS, JSON_PATHS, RPC_METHODS, type NodeProxyOptions } from '../src/server.js';

const WEB = 'https://x2f.example';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

interface Upstream {
  url: string;
  seen: Seen[];
  /** Replaces the default handler (200, echoes a fixed reply). */
  handle: ((s: Seen, res: ServerResponse) => void) | undefined;
  /** Most requests in progress at once, and most TCP connections open at once. */
  maxActive: number;
  maxSockets: number;
}

const servers: Server[] = [];
const proxies: FastifyInstance[] = [];

afterEach(async () => {
  for (const p of proxies.splice(0)) await p.close();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function upstream(): Promise<Upstream> {
  const u: Upstream = { url: '', seen: [], handle: undefined, maxActive: 0, maxSockets: 0 };
  let active = 0;
  let sockets = 0;
  const server = createServer((req, res) => {
    active += 1;
    u.maxActive = Math.max(u.maxActive, active);
    res.once('close', () => (active -= 1));
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const s = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) };
      u.seen.push(s);
      if (u.handle) return u.handle(s, res);
      if (s.url.endsWith('.bin')) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'set-cookie': 'a=b' });
        res.end(Buffer.from([0x01, 0x11, 0x01, 0x01, 0xff, 0x00]));
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'a=b', server: 'monerod' });
        res.end(JSON.stringify({ id: '0', jsonrpc: '2.0', result: { height: 123, status: 'OK' } }));
      }
    });
  });
  server.on('connection', (socket) => {
    sockets += 1;
    u.maxSockets = Math.max(u.maxSockets, sockets);
    socket.once('close', () => (sockets -= 1));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  u.url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return u;
}

async function proxy(o: Partial<NodeProxyOptions> = {}): Promise<{ app: FastifyInstance; up: Upstream }> {
  const up = await upstream();
  const app = buildNodeProxy({ upstream: up.url, webOrigin: WEB, ...o });
  proxies.push(app);
  await app.ready();
  return { app, up };
}

function rpc(method: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id: '0', method, params: {}, ...extra });
}

const json = { 'content-type': 'application/json' };

describe('node proxy: forwarding', () => {
  it('forwards an allowlisted json_rpc call and returns the node reply', async () => {
    const { app, up } = await proxy();
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: '0', jsonrpc: '2.0', result: { height: 123, status: 'OK' } });
    expect(r.headers['content-type']).toBe('application/json');
    expect(up.seen).toHaveLength(1);
    expect(up.seen[0]?.method).toBe('POST');
    expect(up.seen[0]?.url).toBe('/json_rpc');
    expect(JSON.parse(up.seen[0]?.body.toString() ?? '')).toEqual({ jsonrpc: '2.0', id: '0', method: 'get_info', params: {} });
  });

  it('forwards /getblocks.bin byte for byte both ways', async () => {
    const { app, up } = await proxy();
    const body = Buffer.from([0x01, 0x11, 0x01, 0x01, 0x01, 0x01, 0x02, 0x01, 0x01, 0x00, 0x80, 0xfe]);
    const r = await app.inject({ method: 'POST', url: '/getblocks.bin', headers: { 'content-type': 'application/octet-stream' }, payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload).toEqual(Buffer.from([0x01, 0x11, 0x01, 0x01, 0xff, 0x00]));
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(up.seen[0]?.url).toBe('/getblocks.bin');
    expect(up.seen[0]?.body).toEqual(body);
  });

  it('accepts every allowlisted json_rpc method, including the names wallet2 uses', async () => {
    const { app, up } = await proxy();
    const methods = [
      'get_info', 'get_last_block_header', 'get_block_header_by_height', 'get_block_headers_range',
      'getblockheadersrange', 'get_fee_estimate', 'get_version', 'get_output_distribution', 'hard_fork_info', 'get_txpool_backlog',
    ];
    expect([...RPC_METHODS].sort()).toEqual([...methods].sort());
    for (const m of methods) {
      const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc(m) });
      expect(r.statusCode, m).toBe(200);
    }
    expect(up.seen).toHaveLength(methods.length);
  });

  it('forwards every allowlisted path at the root', async () => {
    const { app, up } = await proxy();
    const bin = [
      '/getblocks.bin', '/getblocks_by_height.bin', '/gethashes.bin', '/get_o_indexes.bin', '/getouts.bin', '/get_outs.bin',
      '/get_transaction_pool_hashes.bin', '/get_output_distribution.bin',
    ];
    const plain = ['/get_transactions', '/sendrawtransaction', '/get_height', '/get_info', '/is_key_image_spent', '/get_transaction_pool'];
    for (const p of bin) {
      const r = await app.inject({ method: 'POST', url: p, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from([1, 2]) });
      expect(r.statusCode, p).toBe(200);
    }
    for (const p of plain) {
      const r = await app.inject({ method: 'POST', url: p, headers: json, payload: '{"txs_hashes":["ab"]}' });
      expect(r.statusCode, p).toBe(200);
    }
    expect(up.seen.map((s) => s.url)).toEqual([...bin, ...plain]);
    expect([...BIN_PATHS].sort()).toEqual([...bin].sort());
    expect([...JSON_PATHS].sort()).toEqual([...plain].sort());
  });

  it('re-serialises JSON so the node never sees a body the proxy did not check', async () => {
    const { app, up } = await proxy();
    // JSON.parse keeps the last duplicate key; a different parser upstream might keep the first.
    const tricky = '{"jsonrpc":"2.0","id":"0","method":"stop_daemon","method":"get_info","extra":1}';
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: tricky });
    expect(r.statusCode).toBe(200);
    expect(up.seen[0]?.body.toString()).toBe('{"jsonrpc":"2.0","id":"0","method":"get_info"}');
    await app.inject({ method: 'POST', url: '/get_transactions', headers: json, payload: '{"txs_hashes":["ab"],"txs_hashes":["cd"]}' });
    expect(up.seen[1]?.body.toString()).toBe('{"txs_hashes":["cd"]}');
  });

  it('sends the node only its own content type, never the caller headers', async () => {
    const { app, up } = await proxy();
    await app.inject({
      method: 'POST',
      url: '/json_rpc',
      headers: { ...json, cookie: 's=1', 'x-forwarded-for': '203.0.113.9', authorization: 'Basic eDp5', origin: WEB },
      payload: rpc('get_info'),
    });
    const h = up.seen[0]?.headers ?? {};
    expect(h['content-type']).toBe('application/json');
    expect(h.connection).toBe('close');
    expect(h.cookie).toBeUndefined();
    expect(h['x-forwarded-for']).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h.origin).toBeUndefined();
  });

  it('drops a query string and passes back only the content type', async () => {
    const { app, up } = await proxy();
    const r = await app.inject({ method: 'POST', url: '/get_height?x=1', headers: json, payload: '{}' });
    expect(r.statusCode).toBe(200);
    expect(up.seen[0]?.url).toBe('/get_height');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.headers.server).toBeUndefined();
  });

  it('works with an upstream URL that ends in a slash', async () => {
    const up = await upstream();
    const app = buildNodeProxy({ upstream: `${up.url}/`, webOrigin: WEB });
    proxies.push(app);
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    expect(r.statusCode).toBe(200);
    expect(up.seen[0]?.url).toBe('/json_rpc');
  });
});

describe('node proxy: over a real socket', () => {
  async function listen(app: FastifyInstance): Promise<number> {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const a = app.server.address();
    return typeof a === 'object' && a ? a.port : 0;
  }

  function raw(port: number, path: string, body: Buffer, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-length': String(body.length), ...headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('streams a large binary reply and refuses dot-segment paths', async () => {
    const { app, up } = await proxy();
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    up.handle = (_s, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(big);
    };
    const port = await listen(app);
    const r = await raw(port, '/getblocks.bin', Buffer.from([1, 2, 3]), { 'content-type': 'application/octet-stream' });
    expect(r.status).toBe(200);
    expect(r.body.equals(big)).toBe(true);
    for (const p of ['/./json_rpc', '/x/../json_rpc', '/json_rpc%00', '/json_rpc;a']) {
      const bad = await raw(port, p, Buffer.from(rpc('get_info')), json);
      expect(bad.status, p).toBe(404);
    }
    expect(up.seen).toHaveLength(1);
  });

  it('frees the slot by its backstop timer when a reply stream never closes', async () => {
    // A node reply whose body never ends and ignores the abort (as a fully buffered body would):
    // only the backstop timer (timeoutMs + 1 s) frees the slot while the client stays connected.
    const { app } = await proxy({ maxInFlight: 1, timeoutMs: 100 });
    const stuck = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () =>
      new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const port = await listen(app);
    const client = request({ host: '127.0.0.1', port, path: '/getblocks.bin', method: 'POST', headers: { 'content-length': '1' } });
    client.on('error', () => undefined);
    client.end(Buffer.from([1]));
    try {
      while (stuck.mock.calls.length === 0) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 50));
      const held = await app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' });
      expect(held.statusCode).toBe(503);
      await new Promise((r) => setTimeout(r, 1300));
      const freed = await app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' });
      expect(freed.statusCode).toBe(200);
    } finally {
      client.destroy();
      stuck.mockRestore();
    }
  });

  it('answers 503 busy to a call that waits for an upstream slot longer than timeoutMs', async () => {
    const { app, up } = await proxy({ maxUpstream: 1, timeoutMs: 200 });
    // The only upstream slot is held past timeoutMs by a reply that never ends (freed by the backstop).
    const stuck = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () =>
      new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }), { status: 200 }),
    );
    const port = await listen(app);
    const client = request({ host: '127.0.0.1', port, path: '/getblocks.bin', method: 'POST', headers: { 'content-length': '1' } });
    client.on('error', () => undefined);
    client.end(Buffer.from([1]));
    try {
      while (stuck.mock.calls.length === 0) await new Promise((r) => setTimeout(r, 5));
      const started = Date.now();
      const queued = await app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' });
      expect(queued.statusCode).toBe(503);
      expect(queued.json()).toEqual({ error: 'busy' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(190);
      expect(up.seen).toHaveLength(0);
    } finally {
      client.destroy();
      stuck.mockRestore();
    }
    const after = await app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' });
    expect(after.statusCode).toBe(200);
  });

  it('forwards a body sent with no content type', async () => {
    const { app, up } = await proxy();
    const port = await listen(app);
    const r = await raw(port, '/json_rpc', Buffer.from(rpc('get_version')));
    expect(r.status).toBe(200);
    expect(up.seen).toHaveLength(1);
  });
});

describe('node proxy: refusals (fail closed)', () => {
  it('refuses stop_daemon and other json_rpc methods off the list without calling the node', async () => {
    const { app, up } = await proxy();
    const unneeded = ['get_block_count', 'getblockcount', 'getlastblockheader', 'get_output_histogram', 'getblockheaderbyheight']; // no wallet call needs these (getblockheaderbyheight dropped by the lead, 2026-10-21: least privilege)
    for (const m of [...unneeded, 'stop_daemon', 'generateblocks', 'submit_block', 'get_block_template', 'set_bans', 'flush_txpool', 'relay_tx', 'GET_INFO', '']) {
      const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc(m) });
      expect(r.statusCode, m).toBe(403);
      expect(r.json()).toEqual({ error: 'method-not-allowed' });
    }
    expect(up.seen).toHaveLength(0);
  });

  it('refuses malformed json_rpc bodies', async () => {
    const { app, up } = await proxy();
    const bad = [
      '[{"jsonrpc":"2.0","id":"0","method":"get_info"}]', // batches
      '{"jsonrpc":"2.0","id":"0"}',
      '{"jsonrpc":"2.0","id":"0","method":["get_info"]}',
      '{"jsonrpc":"1.0","id":"0","method":"get_info"}',
      '{"jsonrpc":"2.0","id":{},"method":"get_info"}',
      '{"jsonrpc":"2.0","id":"0","method":"get_info","params":[1]}',
      'not json',
      '',
      '"get_info"',
      'null',
    ];
    for (const b of bad) {
      const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: b });
      expect([400, 403], b).toContain(r.statusCode);
    }
    expect(up.seen).toHaveLength(0);
  });

  it('answers 400, not 500, to JSON nested too deeply to re-serialise', async () => {
    const { app, up } = await proxy();
    const deep = (n: number): string => `${'['.repeat(n)}${']'.repeat(n)}`;
    const n = 400_000; // 800 kB: under the body limit, past JSON.stringify's stack
    const rpcBody = `{"jsonrpc":"2.0","id":"0","method":"get_info","params":{"a":${deep(n)}}}`;
    const r1 = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpcBody });
    expect(r1.statusCode).toBe(400);
    expect(r1.json()).toEqual({ error: 'bad-request' });
    const r2 = await app.inject({ method: 'POST', url: '/get_transactions', headers: json, payload: `{"a":${deep(n)}}` });
    expect(r2.statusCode).toBe(400);
    expect(up.seen).toHaveLength(0);
  });

  it('refuses a JSON path body that is not one JSON object', async () => {
    const { app, up } = await proxy();
    for (const b of ['[1]', 'nope', '"x"', '1']) {
      const r = await app.inject({ method: 'POST', url: '/sendrawtransaction', headers: json, payload: b });
      expect(r.statusCode, b).toBe(400);
    }
    expect(up.seen).toHaveLength(0);
  });

  it('answers 404 for paths off the list, including /daemon/json_rpc', async () => {
    const { app, up } = await proxy();
    const paths = [
      '/daemon/json_rpc', '/json_rpc/', '/JSON_RPC', '/stop_daemon', '/start_mining', '/stop_mining', '/mining_status',
      '/set_log_level', '/get_peer_list', '/out_peers', '/update', '/send_raw_transaction', '/get_blocks_by_height.bin',
      '/', '/%2fjson_rpc', '//json_rpc',
      '/gettransactions', // dropped by the lead, 2026-10-21: no wallet evidence, least privilege
    ];
    // (Dot segments are resolved by the test client before routing; the forwarded path is a constant anyway.)
    for (const p of paths) {
      const r = await app.inject({ method: 'POST', url: p, headers: json, payload: rpc('get_info') });
      expect(r.statusCode, p).toBe(404);
    }
    expect(up.seen).toHaveLength(0);
  });

  it('answers 404 to methods other than POST on allowlisted paths', async () => {
    const { app, up } = await proxy();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
      const r = await app.inject({ method, url: '/get_info' });
      expect(r.statusCode, method).toBe(404);
    }
    expect(up.seen).toHaveLength(0);
  });

  it('refuses a body over the limit without calling the node', async () => {
    const { app, up } = await proxy({ maxBodyBytes: 1024 });
    const r = await app.inject({ method: 'POST', url: '/getouts.bin', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(2048) });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toEqual({ error: 'too-large' });
    expect(up.seen).toHaveLength(0);
  });

  it('answers 504 when the node is too slow', async () => {
    const { app, up } = await proxy({ timeoutMs: 100 });
    up.handle = () => undefined; // never answers
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    expect(r.statusCode).toBe(504);
    expect(r.json()).toEqual({ error: 'node-timeout' });
  });

  it('answers 502 when the node is unreachable, without naming it', async () => {
    const app = buildNodeProxy({ upstream: 'http://127.0.0.1:1', webOrigin: WEB });
    proxies.push(app);
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('127.0.0.1');
    expect(r.json()).toEqual({ error: 'node-unavailable' });
  });

  it('does not follow a redirect from the node', async () => {
    const { app, up } = await proxy();
    up.handle = (_s, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/' });
      res.end();
    };
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    expect(r.statusCode).toBe(502);
    expect(r.headers.location).toBeUndefined();
    expect(up.seen).toHaveLength(1);
  });

  it('answers 503 beyond the in-flight limit', async () => {
    const { app, up } = await proxy({ maxInFlight: 1, timeoutMs: 2000 });
    let release: () => void = () => undefined;
    up.handle = (_s, res) => {
      release = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      };
    };
    const first = app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    while (up.seen.length === 0) await new Promise((r) => setTimeout(r, 5));
    const second = await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') });
    expect(second.statusCode).toBe(503);
    expect(second.json()).toEqual({ error: 'busy' });
    up.handle = undefined;
    release();
    expect((await first).statusCode).toBe(200);
    const third = await app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' });
    expect(third.statusCode).toBe(200);
  });

  it('keeps at most maxUpstream calls open at the node and queues the rest (monerod caps connections per IP)', async () => {
    expect(DEFAULTS.maxUpstream).toBe(20);
    for (const o of [{}, { maxUpstream: 3 }]) {
      const cap = o.maxUpstream ?? DEFAULTS.maxUpstream;
      const { app, up } = await proxy(o);
      up.handle = (_s, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
        }, 20);
      };
      const n = 3 * cap + 5;
      const rs = await Promise.all(Array.from({ length: n }, () => app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' })));
      expect(rs.map((r) => r.statusCode)).toEqual(Array<number>(n).fill(200));
      expect(up.seen).toHaveLength(n);
      expect(up.maxActive, `cap ${cap}`).toBe(cap);
      expect(up.maxSockets, `cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  it('refuses bad options at build time', () => {
    expect(() => buildNodeProxy({ upstream: 'ftp://node', webOrigin: WEB })).toThrow();
    expect(() => buildNodeProxy({ upstream: 'http://u:p@node:18081', webOrigin: WEB })).toThrow();
    expect(() => buildNodeProxy({ upstream: 'http://node:18081/?a=1', webOrigin: WEB })).toThrow();
    expect(() => buildNodeProxy({ upstream: 'http://node:18081', webOrigin: 'https://x2f.example/app' })).toThrow();
    expect(() => buildNodeProxy({ upstream: 'http://node:18081', webOrigin: '*' })).toThrow();
  });
});

describe('node proxy: CORS and headers', () => {
  it('gives the web origin a CORS header', async () => {
    const { app } = await proxy();
    const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: { ...json, origin: WEB }, payload: rpc('get_info') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(WEB);
    expect(r.headers.vary).toContain('Origin');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('gives another origin no CORS header and does not call the node', async () => {
    const { app, up } = await proxy();
    for (const origin of ['https://evil.example', 'null', `${WEB}.evil.example`, 'http://x2f.example']) {
      const r = await app.inject({ method: 'POST', url: '/json_rpc', headers: { ...json, origin }, payload: rpc('get_info') });
      expect(r.statusCode, origin).toBe(403);
      expect(r.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    expect(up.seen).toHaveLength(0);
  });

  it('answers a preflight from the web origin only, on allowlisted paths only', async () => {
    const { app, up } = await proxy();
    const pre = (url: string, origin: string) =>
      app.inject({ method: 'OPTIONS', url, headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    const ok = await pre('/getblocks.bin', WEB);
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(WEB);
    expect(ok.headers['access-control-allow-methods']).toBe('POST');
    expect(ok.headers['access-control-allow-headers']).toBe('content-type');
    const other = await pre('/getblocks.bin', 'https://evil.example');
    expect(other.statusCode).toBe(403);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const offList = await pre('/stop_daemon', WEB);
    expect(offList.statusCode).toBe(404);
    expect(offList.headers['access-control-allow-origin']).toBeUndefined();
    expect(up.seen).toHaveLength(0);
  });

  it('sets the security headers on every response', async () => {
    const { app } = await proxy();
    const responses = [
      await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('get_info') }),
      await app.inject({ method: 'POST', url: '/json_rpc', headers: json, payload: rpc('stop_daemon') }),
      await app.inject({ method: 'POST', url: '/nope' }),
    ];
    for (const r of responses) {
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(r.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('has no logger and never reads forwarded addresses (no trustProxy)', async () => {
    const up = await upstream();
    const app = buildNodeProxy({ upstream: up.url, webOrigin: WEB });
    proxies.push(app);
    const seen: string[] = [];
    app.addHook('onRequest', async (req) => {
      seen.push(`${req.ip} ${req.host} ${req.protocol}`);
    });
    const r = await app.inject({
      method: 'POST',
      url: '/json_rpc',
      headers: { ...json, host: 'proxy.local', 'x-forwarded-for': '203.0.113.9', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
      payload: rpc('get_info'),
      remoteAddress: '198.51.100.7',
    });
    expect(r.statusCode).toBe(200);
    expect(seen).toEqual(['198.51.100.7 proxy.local http']);
    // A pino logger (logger: true or any options object) has a level; Fastify's no-op logger has none.
    expect(app.log.level).toBeUndefined();
  });
});
