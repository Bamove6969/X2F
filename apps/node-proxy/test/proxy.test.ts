import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNodeProxy, type NodeProxyOptions } from '../src/server.js';

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
  const u: Upstream = { url: '', seen: [], handle: undefined };
  const server = createServer((req, res) => {
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
      'get_info', 'get_last_block_header', 'getlastblockheader', 'get_block_header_by_height', 'getblockheaderbyheight',
      'get_block_headers_range', 'getblockheadersrange', 'get_fee_estimate', 'get_version', 'get_output_distribution',
      'hard_fork_info', 'get_block_count', 'getblockcount', 'get_output_histogram', 'get_txpool_backlog',
    ];
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
    const plain = ['/get_transactions', '/gettransactions', '/sendrawtransaction', '/get_height', '/get_info', '/is_key_image_spent', '/get_transaction_pool'];
    for (const p of bin) {
      const r = await app.inject({ method: 'POST', url: p, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from([1, 2]) });
      expect(r.statusCode, p).toBe(200);
    }
    for (const p of plain) {
      const r = await app.inject({ method: 'POST', url: p, headers: json, payload: '{"txs_hashes":["ab"]}' });
      expect(r.statusCode, p).toBe(200);
    }
    expect(up.seen.map((s) => s.url)).toEqual([...bin, ...plain]);
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

describe('node proxy: refusals (fail closed)', () => {
  it('refuses stop_daemon and other json_rpc methods off the list without calling the node', async () => {
    const { app, up } = await proxy();
    for (const m of ['stop_daemon', 'generateblocks', 'submit_block', 'get_block_template', 'set_bans', 'flush_txpool', 'relay_tx', 'GET_INFO', '']) {
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
      '/', '/%2fjson_rpc', '//json_rpc', '/./json_rpc', '/x/../json_rpc',
    ];
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
    release();
    expect((await first).statusCode).toBe(200);
    const third = await app.inject({ method: 'POST', url: '/get_height', headers: json, payload: '{}' });
    expect(third.statusCode).toBe(200);
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

  it('never trusts forwarded addresses and logs nothing', async () => {
    const { app } = await proxy();
    expect(app.initialConfig.trustProxy).toBeFalsy();
    expect(app.log.level).toBe('silent');
  });
});
