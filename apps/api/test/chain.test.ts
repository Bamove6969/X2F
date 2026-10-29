import { describe, expect, it } from 'vitest';
import { daemonConfirmations, monerodUrlFromEnv } from '../src/trades/chain.js';

// The node lookup behind GET /v1/trades/:code/confirmations (Task 24): X2F's own monerod, asked
// for one tx hash at a time over its plain RPC (`/get_transactions`, `/get_height`; both allowed on
// a --restricted-rpc node). Tested against a stubbed fetch.

const HASH = 'ab'.repeat(32);

interface Call {
  url: string;
  body: unknown;
  signal: AbortSignal | null;
}

function stubNode(o: { height?: number; tx?: Record<string, unknown> | null; status?: number; hang?: boolean } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, signal: init?.signal ?? null });
    if (o.hang) {
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
    }
    if (o.status && o.status !== 200) return new Response('nope', { status: o.status });
    if (url.endsWith('/get_height')) return Response.json({ status: 'OK', height: o.height ?? 1000 });
    if (url.endsWith('/get_transactions')) {
      const asked = (body as { txs_hashes: string[] }).txs_hashes[0];
      const tx = o.tx === undefined ? { tx_hash: asked, in_pool: false, block_height: 995 } : o.tx;
      return Response.json(tx === null ? { status: 'OK', missed_tx: [asked] } : { status: 'OK', txs: [tx] });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('daemonConfirmations', () => {
  it('counts confirmations as the chain height minus the block height, asking only for this hash', async () => {
    const n = stubNode({ height: 1000, tx: { tx_hash: HASH, in_pool: false, block_height: 999 } });
    const lookup = daemonConfirmations({ url: 'http://127.0.0.1:18081', fetch: n.fetch });
    expect(await lookup(HASH)).toBe(1);
    const tx = n.calls.find((c) => c.url.endsWith('/get_transactions'))!;
    expect(tx.url).toBe('http://127.0.0.1:18081/get_transactions');
    expect(tx.body).toEqual({ txs_hashes: [HASH], prune: true });
    expect(n.calls.find((c) => c.url.endsWith('/get_height'))!.url).toBe('http://127.0.0.1:18081/get_height');
  });

  it('answers 0 for a tx still in the pool and null for one the node does not know', async () => {
    const pool = stubNode({ tx: { tx_hash: HASH, in_pool: true, block_height: 0 } });
    expect(await daemonConfirmations({ url: 'http://node', fetch: pool.fetch })(HASH)).toBe(0);
    const missing = stubNode({ tx: null });
    expect(await daemonConfirmations({ url: 'http://node', fetch: missing.fetch })(HASH)).toBeNull();
  });

  it('refuses anything but a 64-hex tx hash without calling the node', async () => {
    const n = stubNode();
    const lookup = daemonConfirmations({ url: 'http://node', fetch: n.fetch });
    for (const bad of ['', 'AB'.repeat(32), 'ab'.repeat(31), `${HASH}0`, '../get_info', 'zz'.repeat(32)]) {
      expect(await lookup(bad)).toBeNull();
    }
    expect(n.calls).toEqual([]);
  });

  it('throws on a node error or a malformed answer (the route turns that into null)', async () => {
    await expect(daemonConfirmations({ url: 'http://node', fetch: stubNode({ status: 500 }).fetch })(HASH)).rejects.toThrow();
    const weird = stubNode({ tx: { tx_hash: HASH, in_pool: false, block_height: 'x' } });
    await expect(daemonConfirmations({ url: 'http://node', fetch: weird.fetch })(HASH)).rejects.toThrow();
    const other = stubNode({ tx: { tx_hash: 'cd'.repeat(32), in_pool: false, block_height: 990 } });
    await expect(daemonConfirmations({ url: 'http://node', fetch: other.fetch })(HASH)).rejects.toThrow();
  });

  it('gives up after its timeout', async () => {
    const n = stubNode({ hang: true });
    await expect(daemonConfirmations({ url: 'http://node', fetch: n.fetch, timeoutMs: 20 })(HASH)).rejects.toThrow();
    expect(n.calls[0]!.signal).not.toBeNull();
  });

  it('keeps an answer for cacheMs, so many open released screens cost the node one lookup', async () => {
    let now = 0;
    const n = stubNode();
    const lookup = daemonConfirmations({ url: 'http://node', fetch: n.fetch, cacheMs: 10_000, now: () => now });
    await Promise.all([lookup(HASH), lookup(HASH), lookup(HASH)]);
    expect(n.calls.filter((c) => c.url.endsWith('/get_transactions'))).toHaveLength(1);
    now = 9_999;
    await lookup(HASH);
    expect(n.calls.filter((c) => c.url.endsWith('/get_transactions'))).toHaveLength(1);
    now = 10_000;
    await lookup(HASH);
    expect(n.calls.filter((c) => c.url.endsWith('/get_transactions'))).toHaveLength(2);
  });

  it('does not keep a failed lookup', async () => {
    let fail = true;
    const ok = stubNode();
    const fetch = (async (u: string | URL, i?: RequestInit) => {
      if (fail) throw new Error('down');
      return ok.fetch(u, i);
    }) as typeof globalThis.fetch;
    const lookup = daemonConfirmations({ url: 'http://node', fetch, now: () => 0 });
    await expect(lookup(HASH)).rejects.toThrow();
    fail = false;
    expect(await lookup(HASH)).toBe(5);
  });

  it('holds a bounded number of answers', async () => {
    const n = stubNode();
    const lookup = daemonConfirmations({ url: 'http://node', fetch: n.fetch, maxCached: 2, now: () => 0 });
    const hashes = ['01', '02', '03'].map((b) => b.repeat(32));
    for (const h of hashes) expect(await lookup(h)).toBe(5);
    // The oldest answer made room for the third, so it is looked up again.
    expect(await lookup(hashes[0]!)).toBe(5);
    expect(n.calls.filter((c) => c.url.endsWith('/get_transactions'))).toHaveLength(4);
  });
});

describe('monerodUrlFromEnv', () => {
  it('is off when unset and takes an http(s) URL without credentials, path, query or fragment', () => {
    expect(monerodUrlFromEnv({})).toBeNull();
    expect(monerodUrlFromEnv({ X2F_MONEROD_URL: '' })).toBeNull();
    expect(monerodUrlFromEnv({ X2F_MONEROD_URL: 'http://127.0.0.1:18081' })).toBe('http://127.0.0.1:18081');
    expect(monerodUrlFromEnv({ X2F_MONEROD_URL: 'https://node.internal:18089/' })).toBe('https://node.internal:18089');
    for (const bad of ['ftp://node', 'http://user:pw@node', 'http://node/json_rpc', 'http://node?x=1', 'not a url']) {
      expect(() => monerodUrlFromEnv({ X2F_MONEROD_URL: bad }), bad).toThrow(/X2F_MONEROD_URL/);
    }
  });
});
