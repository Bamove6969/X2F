// Review multisig-vs-RetoSwap F3 (12 Nov): the finished wallet must be checked to be a 2-of-3 of three
// distinct signers before any address is shown. No daemon: the session takes the wallet, and multisig
// setup itself is local.
import { randomBytes } from 'node:crypto';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';
import { describe, expect, it } from 'vitest';
import { EscrowError, MoneroMultisigSession } from '../src/index.js';

const ADDRESS = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';

// Monero's block base58 (8-byte blocks, 11 characters each; a short last block uses ENCODED[n]).
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ENCODED = [0, 2, 3, 5, 6, 7, 9, 10, 11];
function base58(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8) {
    const block = bytes.subarray(i, i + 8);
    let v = 0n;
    for (const b of block) v = (v << 8n) | BigInt(b);
    let s = '';
    for (let k = 0; k < ENCODED[block.length]!; k++) {
      s = ALPHABET[Number(v % 58n)]! + s;
      v /= 58n;
    }
    out += s;
  }
  return out;
}

/** A round-1 kex message in wallet2's layout: msg privkey (32) | signing pubkey (32) | signature (64). */
function round1(signer: string): string {
  const raw = new Uint8Array(128);
  raw.set(randomBytes(32), 0);
  raw.set(Buffer.from(signer, 'hex'), 32);
  raw.set(randomBytes(64), 64);
  return 'MultisigxV2R1' + base58(raw);
}

const key = (): string => randomBytes(32).toString('hex');

interface Shape {
  ready: boolean;
  multisig: boolean;
  threshold: number;
  participants: number;
}

function fakeWallet(shape: Shape, ownSpend = key()) {
  const calls = { make: [] as string[][] };
  const wallet = {
    getPublicSpendKey: async () => ownSpend,
    makeMultisig: async (peers: string[]) => {
      calls.make.push(peers);
      return 'MultisigxV2Rn-next';
    },
    getMultisigInfo: async () => ({
      getIsReady: () => shape.ready,
      getIsMultisig: () => shape.multisig,
      getThreshold: () => shape.threshold,
      getNumParticipants: () => shape.participants,
    }),
    getPrimaryAddress: async () => ADDRESS,
  };
  return { wallet, calls, ownSpend };
}

const session = (wallet: unknown) => new MoneroMultisigSession(wallet as MoneroWalletFull, 'http://node.test', 'pw');

async function refusal(p: Promise<unknown>): Promise<EscrowError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(EscrowError);
  return e as EscrowError;
}

describe('MoneroMultisigSession.address(): only a finished 2-of-3', () => {
  const good: Shape = { ready: true, multisig: true, threshold: 2, participants: 3 };

  it('gives the address of a ready 2-of-3 wallet', async () => {
    await expect(session(fakeWallet(good).wallet).address()).resolves.toBe(ADDRESS);
  });

  it.each([
    ['2 participants', { ...good, participants: 2 }],
    ['4 participants', { ...good, participants: 4 }],
    ['threshold 1', { ...good, threshold: 1 }],
    ['threshold 3', { ...good, threshold: 3 }],
    ['not a multisig wallet', { ...good, multisig: false }],
    ['not ready', { ...good, ready: false }],
  ])('refuses a wallet with %s and never reads its address', async (_name, shape) => {
    const f = fakeWallet(shape);
    let read = 0;
    const w = { ...f.wallet, getPrimaryAddress: async () => (read++, ADDRESS) };
    const e = await refusal(session(w).address());
    expect(['bad-multisig', 'not-ready']).toContain(e.code);
    if (shape.ready) expect(e.code).toBe('bad-multisig');
    expect(read).toBe(0);
  });
});

describe('MoneroMultisigSession.make(): three distinct signers', () => {
  const unfinished: Shape = { ready: false, multisig: false, threshold: 0, participants: 0 };

  it('passes two peers with keys distinct from each other and from mine to the wallet', async () => {
    const f = fakeWallet(unfinished);
    const peers = [round1(key()), round1(key())];
    await expect(session(f.wallet).make(peers)).resolves.toBe('MultisigxV2Rn-next');
    expect(f.calls.make).toEqual([peers]);
  });

  it('refuses a peer that reuses my signing key, before the wallet becomes multisig', async () => {
    const f = fakeWallet(unfinished);
    const e = await refusal(session(f.wallet).make([round1(f.ownSpend), round1(key())]));
    expect(e.code).toBe('bad-multisig');
    expect(f.calls.make).toEqual([]);
  });

  it('refuses two peers with the same signing key (one party in two roles)', async () => {
    const f = fakeWallet(unfinished);
    const k = key();
    const e = await refusal(session(f.wallet).make([round1(k), round1(k)]));
    expect(e.code).toBe('bad-multisig');
    expect(f.calls.make).toEqual([]);
  });

  it('refuses anything but exactly two peers', async () => {
    for (const peers of [[], [round1(key())], [round1(key()), round1(key()), round1(key())]]) {
      const f = fakeWallet(unfinished);
      expect((await refusal(session(f.wallet).make(peers))).code).toBe('bad-multisig');
      expect(f.calls.make).toEqual([]);
    }
  });

  it('refuses a peer message that is not a round-1 kex message', async () => {
    for (const bad of ['', 'prepare-hex', 'MultisigxV2Rn' + round1(key()).slice(13), 'MultisigxV2R1' + '0'.repeat(10), round1(key()).slice(0, -4)]) {
      const f = fakeWallet(unfinished);
      expect((await refusal(session(f.wallet).make([bad, round1(key())]))).code).toBe('bad-multisig');
      expect(f.calls.make).toEqual([]);
    }
  });
});

describe('with real monero-ts wallets (offline)', () => {
  const create = () => MoneroWalletFull.createWallet(new MoneroWalletConfig({ networkType: MoneroNetworkType.MAINNET, password: 'pw', proxyToWorker: false }));

  it("a prepare message names its wallet's spend key, and an honest setup ends in an address", async () => {
    const wallets = await Promise.all([0, 1, 2].map(create));
    try {
      // Imported here, so the other tests in this file still run (and fail) before the decoder exists.
      const { kexSignerKey } = await import('../src/monero.js');
      const sessions = wallets.map((w) => new MoneroMultisigSession(w, 'http://node.test', 'pw'));
      const prepared = await Promise.all(sessions.map((s) => s.prepare()));
      for (let i = 0; i < 3; i++) expect(kexSignerKey(prepared[i]!)).toBe(await wallets[i]!.getPublicSpendKey());
      let hex = await Promise.all(sessions.map((s, i) => s.make(prepared.filter((_, j) => j !== i))));
      let ready = false;
      for (let round = 0; !ready && round < 4; round++) {
        const r = await Promise.all(sessions.map((s, i) => s.exchange(hex.filter((_, j) => j !== i))));
        hex = r.map((x) => x.hex);
        ready = r.every((x) => x.ready);
      }
      expect(ready).toBe(true);
      const addresses = await Promise.all(sessions.map((s) => s.address()));
      expect(new Set(addresses).size).toBe(1);
    } finally {
      for (const w of wallets) await w.close();
    }
  });

  it('a real wallet refuses its own prepare message offered back as a peer', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    try {
      const sa = new MoneroMultisigSession(a!, 'http://node.test', 'pw');
      const sb = new MoneroMultisigSession(b!, 'http://node.test', 'pw');
      const [pa, pb] = await Promise.all([sa.prepare(), sb.prepare()]);
      expect((await refusal(sa.make([pb, pa]))).code).toBe('bad-multisig');
      expect(await a!.isMultisig()).toBe(false);
    } finally {
      await a!.close();
      await b!.close();
    }
  });
});
