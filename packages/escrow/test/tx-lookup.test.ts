// P0 of 8 Nov (local demo): a seller-built release never settled. In the web app's bundle the
// escrow worker's daemon lookup (`txStatus`, and so `txSeen`, which the builder needs before it is
// done) went through monero-ts's in-process HTTP client, which cannot send there: its Node
// `http`/`https` imports resolve to an empty module, so `new http.Agent()` throws before every
// request ("o.default.Agent is not a constructor", seen in the demo's seller worker on 10 Nov).
// Here the session runs against a fake monerod with monero-ts's in-process HTTP broken the same
// way. No wallet is needed: txStatus only asks the daemon. No monerod either.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HttpClient } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DAEMON_TIMEOUT_MS } from '../src/engine.js';
import { MoneroMultisigSession, txStatusOf } from '../src/monero.js';

const H = 'ab'.repeat(32);

/** monero-ts's in-process HTTP as the web bundle has it: no request can be sent. Returns the undo. */
function breakInProcessHttp(): () => void {
  const h = HttpClient as unknown as { getHttpAgent: () => unknown; getHttpsAgent: () => unknown };
  const [http, https] = [h.getHttpAgent, h.getHttpsAgent];
  const fail = (): never => {
    throw new TypeError('o.default.Agent is not a constructor');
  };
  h.getHttpAgent = fail;
  h.getHttpsAgent = fail;
  return () => {
    h.getHttpAgent = http;
    h.getHttpsAgent = https;
  };
}

/** A fake monerod: answers /get_transactions with `answer(body)`, or never when `hang` is set. */
let server: Server;
let uri: string;
let hang = false;
let httpStatus = 200;
let redirect = false;
let answer: (body: { txs_hashes?: string[] }) => unknown = () => ({ status: 'OK' });
const seen: { path: string; body: unknown }[] = [];
const held: ServerResponse[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as { txs_hashes?: string[] }) : {};
      seen.push({ path: req.url ?? '', body });
      if (hang) return void held.push(res);
      if (redirect && req.url === '/get_transactions') {
        res.statusCode = 307;
        res.setHeader('location', '/elsewhere');
        return void res.end();
      }
      res.statusCode = httpStatus;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer(body)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  uri = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});

let restore: () => void = () => {};
afterEach(() => {
  restore();
  hang = false;
  httpStatus = 200;
  redirect = false;
  seen.length = 0;
  for (const r of held.splice(0)) r.destroy();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const session = (): MoneroMultisigSession => new MoneroMultisigSession({} as never, uri, 'pw');

describe('txStatus without monero-ts\'s in-process HTTP (the web bundle)', () => {
  it('reads the daemon\'s view of the tx: block, pool or none', async () => {
    restore = breakInProcessHttp();
    answer = (b) => ({ status: 'OK', txs: [{ tx_hash: b.txs_hashes![0], in_pool: false, block_height: 120 }] });
    expect(await session().txStatus(H)).toBe('block'); // before the fix: daemon-unavailable, every time
    expect(await session().txSeen(H)).toBe(true);
    expect(seen.at(-1)).toEqual({ path: '/get_transactions', body: { txs_hashes: [H], decode_as_json: false, prune: true } });
    answer = (b) => ({ status: 'OK', txs: [{ tx_hash: b.txs_hashes![0], in_pool: true, block_height: 0 }] });
    expect(await session().txStatus(H)).toBe('pool');
    expect(await session().txSeen(H)).toBe(false);
    answer = (b) => ({ status: 'OK', missed_tx: b.txs_hashes });
    expect(await session().txStatus(H)).toBe('none');
  });

  it('a daemon that never answers is daemon-unavailable after DAEMON_TIMEOUT_MS, never a lookup that hangs', async () => {
    restore = breakInProcessHttp();
    hang = true;
    const t0 = Date.now();
    await expect(session().txStatus(H)).rejects.toMatchObject({ code: 'daemon-unavailable' });
    expect(Date.now() - t0).toBeLessThan(DAEMON_TIMEOUT_MS + 5_000);
    expect(seen.map((s) => s.path)).toEqual(['/get_transactions']); // it was asked; it just never replied
  }, DAEMON_TIMEOUT_MS + 15_000);

  it('a refused or broken answer is daemon-unavailable (retried), never "none"', async () => {
    answer = () => ({ status: 'BUSY' });
    await expect(session().txStatus(H)).rejects.toMatchObject({ code: 'daemon-unavailable' });
    httpStatus = 403;
    answer = (b) => ({ status: 'OK', txs: [{ tx_hash: b.txs_hashes![0], in_pool: false, block_height: 120 }] });
    await expect(session().txStatus(H)).rejects.toMatchObject({ code: 'daemon-unavailable' });
    expect(await session().txStatus('not a hash')).toBe('none'); // never asked
  });
});

describe('txStatusOf: monerod\'s /get_transactions answer, for exactly that hash', () => {
  const unavailable = (body: unknown): void => {
    expect(() => txStatusOf(body, H)).toThrow(expect.objectContaining({ code: 'daemon-unavailable' }));
  };

  it('block only for that hash, out of the pool, at a block height; pool for that hash in the pool', () => {
    expect(txStatusOf({ status: 'OK', txs: [{ tx_hash: H, in_pool: false, block_height: 120 }] }, H)).toBe('block');
    expect(txStatusOf({ status: 'OK', txs: [{ tx_hash: H, in_pool: true, block_height: 0 }] }, H)).toBe('pool');
  });

  it('none only when the daemon names the hash in missed_tx (review L1)', () => {
    expect(txStatusOf({ status: 'OK', missed_tx: [H] }, H)).toBe('none');
    expect(txStatusOf({ status: 'OK', txs: [], missed_tx: ['cd'.repeat(32), H] }, H)).toBe('none');
  });

  it('any other answer is no answer (daemon-unavailable, retried), never none (review L1)', () => {
    unavailable({ status: 'OK' }); // names the hash nowhere
    unavailable({ status: 'OK', txs: [] });
    unavailable({ status: 'OK', missed_tx: ['cd'.repeat(32)] });
    unavailable({ status: 'OK', txs: [{ tx_hash: 'cd'.repeat(32), in_pool: false, block_height: 120 }] });
    unavailable({ status: 'OK', txs: [{ tx_hash: H, in_pool: false, block_height: 0 }] });
    unavailable({ status: 'OK', txs: [{ tx_hash: H, block_height: 120 }] });
    unavailable({ status: 'OK', txs: [{ tx_hash: H, in_pool: false, block_height: '120' }] });
    unavailable({ status: 'OK', missed_tx: H });
    for (const bad of [null, 'x', {}, { status: 'Failed' }, { status: 'BUSY' }, { status: 'OK', txs: {} }]) unavailable(bad);
  });
});

describe('the /get_transactions request (review L3)', () => {
  it('never follows a redirect, sends no credentials and is never served from a cache', async () => {
    const inits: RequestInit[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((u: string, i: RequestInit) => {
      inits.push(i);
      return real(u, i);
    }) as typeof fetch;
    try {
      answer = (b) => ({ status: 'OK', txs: [{ tx_hash: b.txs_hashes![0], in_pool: false, block_height: 120 }] });
      redirect = true;
      await expect(session().txStatus(H)).rejects.toMatchObject({ code: 'daemon-unavailable' }); // before: block, from /elsewhere
      expect(seen.map((x) => x.path)).toEqual(['/get_transactions']);
      expect(inits[0]).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
    } finally {
      globalThis.fetch = real;
    }
  });
});
