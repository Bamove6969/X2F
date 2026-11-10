// The fetch-based client for in-process (resumed regtest) wallets: what monero-ts's WebAssembly glue
// sends and reads back (monero-ts/dist/monero.js, js_send_json_request / js_send_binary_request).
// A fake daemon; no monerod.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAEMON_TIMEOUT_MS } from '../src/engine.js';
import { inProcessHttp } from '../src/inProcessHttp.js';

let server: Server;
let uri: string;
const seen: { path: string; type: string | undefined; body: Buffer }[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ path: req.url ?? '', type: req.headers['content-type'], body });
      if (req.url === '/hang') return; // never answers
      if (req.url === '/getblocks.bin') {
        res.setHeader('content-type', 'application/octet-stream');
        return void res.end(Buffer.from([1, 2, 3, 0, 255]));
      }
      res.statusCode = req.url === '/refused' ? 403 : 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"jsonrpc":"2.0","id":"0","result":{"height":123}}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  uri = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('inProcessHttp', () => {
  it('sends a JSON-RPC request and returns status, headers and the text', async () => {
    const r = await inProcessHttp.request({ method: 'POST', uri: `${uri}/json_rpc`, username: '', password: '', body: '{"method":"get_info"}', cancelToken: inProcessHttp.createCancelToken().token });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('{"jsonrpc":"2.0","id":"0","result":{"height":123}}');
    expect(r.headers['content-type']).toBe('application/json');
    expect(seen.at(-1)).toMatchObject({ path: '/json_rpc', type: 'application/json' });
    expect(seen.at(-1)!.body.toString()).toBe('{"method":"get_info"}');
  });

  it('sends binary bytes and returns bytes', async () => {
    const r = await inProcessHttp.request({ method: 'POST', uri: `${uri}/getblocks.bin`, body: new Uint8Array([9, 8, 7]) });
    expect(r.body).toBeInstanceOf(Uint8Array);
    expect([...(r.body as Uint8Array)]).toEqual([1, 2, 3, 0, 255]);
    expect([...seen.at(-1)!.body]).toEqual([9, 8, 7]);
  });

  it('returns a refusal as a status for the wallet to judge, never as bytes it trusts', async () => {
    const r = await inProcessHttp.request({ method: 'POST', uri: `${uri}/refused`, body: '{}' });
    expect(r.statusCode).toBe(403);
  });

  it('a cancelled request (the wallet closing) fails at once', async () => {
    const c = inProcessHttp.createCancelToken();
    const p = inProcessHttp.request({ method: 'POST', uri: `${uri}/hang`, body: '{}', cancelToken: c.token });
    setTimeout(() => c.cancel('Wallet is closing'), 50);
    await expect(p).rejects.toThrow('Wallet is closing');
  });

  it('a daemon that never answers fails after DAEMON_TIMEOUT_MS', async () => {
    const t0 = Date.now();
    await expect(inProcessHttp.request({ method: 'POST', uri: `${uri}/hang`, body: '{}' })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(DAEMON_TIMEOUT_MS + 5_000);
  }, DAEMON_TIMEOUT_MS + 15_000);

  it('refuses digest auth and SOCKS proxies (never sent)', async () => {
    const n = seen.length;
    await expect(inProcessHttp.request({ method: 'POST', uri: `${uri}/json_rpc`, username: 'u', password: 'p', body: '{}' })).rejects.toThrow(/authentication/);
    await expect(inProcessHttp.request({ method: 'POST', uri: `${uri}/json_rpc`, proxyUri: 'socks5://127.0.0.1:9050', body: '{}' })).rejects.toThrow(/proxied/);
    expect(seen.length).toBe(n);
  });

  it('never follows a redirect, sends no credentials and is never served from a cache (as txStatus, review L3)', async () => {
    const inits: RequestInit[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((u: string, i: RequestInit) => {
      inits.push(i);
      return real(u, i);
    }) as typeof fetch;
    try {
      await inProcessHttp.request({ method: 'POST', uri: `${uri}/json_rpc`, body: '{}' });
    } finally {
      globalThis.fetch = real;
    }
    expect(inits[0]).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
  });
});
