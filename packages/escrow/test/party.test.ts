import { ROLES, feeFor, newTradeCode, type Role } from '@x2f/core';
import { generateIdentity, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MoneroMultisigEngine,
  runParty,
  wsTransport,
  type Outcome,
  type PartyHandle,
  type PartyState,
  type PartyStore,
  type Transport,
} from '../src/index.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;
const MAX_NET_FEE = XMR / 100n;

function memoryStore(): PartyStore & { current(): PartyState | null } {
  let s: PartyState | null = null;
  return {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
    },
    current: () => s,
  };
}

/** A transport that can be fed extra frames and records what it received. */
function tapped(inner: Transport): Transport & { inject(f: unknown): void; seen: unknown[] } {
  const injected: unknown[] = [];
  const seen: unknown[] = [];
  return {
    send: (e) => inner.send(e),
    next: async () => {
      const f = injected.length > 0 ? injected.shift() : await inner.next();
      seen.push(f);
      return f;
    },
    onReconnect: (cb) => inner.onReconnect(cb),
    close: () => inner.close(),
    inject: (f) => injected.push(f),
    seen,
  };
}

interface Trade {
  code: string;
  ids: Record<Role, Identity>;
  participants: Participants;
  stores: Record<Role, ReturnType<typeof memoryStore>>;
  parties: Record<Role, PartyHandle>;
  taps: Record<Role, ReturnType<typeof tapped>>;
}

describe('party runner over the relay on regtest', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  const running: PartyHandle[] = [];

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    for (const p of running.splice(0)) await p.stop();
  });

  afterAll(async () => {
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  function startParty(t: Pick<Trade, 'code' | 'ids' | 'participants' | 'stores'>, role: Role) {
    const tap = tapped(wsTransport({ url: relayUrl, code: t.code, role, me: t.ids[role] }));
    const party = runParty({
      role,
      trade: t.code,
      me: t.ids[role],
      participants: t.participants,
      transport: tap,
      engine,
      daemonUri: node.rpcUri,
      password: `pw-${role}`,
      store: t.stores[role],
    });
    running.push(party);
    return { party, tap };
  }

  async function newTrade(): Promise<Trade> {
    const code = newTradeCode();
    const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    relay.registerTrade(code, { buyer: ids.buyer.signPublic, seller: ids.seller.signPublic, mod: ids.mod.signPublic });
    const stores = { buyer: memoryStore(), seller: memoryStore(), mod: memoryStore() };
    const base = { code, ids, participants, stores };
    const started = Object.fromEntries(ROLES.map((r) => [r, startParty(base, r)])) as Record<Role, ReturnType<typeof startParty>>;
    return {
      ...base,
      parties: { buyer: started.buyer.party, seller: started.seller.party, mod: started.mod.party },
      taps: { buyer: started.buyer.tap, seller: started.seller.tap, mod: started.mod.tap },
    };
  }

  async function readyAndFund(t: Trade, amount: bigint): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount, relay: true });
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    return addresses[0]!;
  }

  async function balanceOf(w: MoneroWalletFull): Promise<bigint> {
    await w.setDaemonConnection({ uri: node.rpcUri });
    await w.sync();
    return w.getBalance();
  }

  async function settleAll(t: Trade, o: Outcome): Promise<(string | null)[]> {
    return Promise.all(ROLES.map((r) => t.parties[r].settle(o)));
  }

  it('normal release: seller builds, buyer co-signs, buyer and fee wallet are paid', async () => {
    const t = await newTrade();
    const amount = 1_250_000_000_000n;
    await readyAndFund(t, amount);
    const [buyerW, feeW] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    try {
      const fee = feeFor(amount);
      const to = [
        { address: await buyerW.getPrimaryAddress(), amountAtomic: amount - fee },
        { address: await feeW.getPrimaryAddress(), amountAtomic: fee },
      ];
      const [b, s, m] = await settleAll(t, { kind: 'release', to, builder: 'seller', cosigner: 'buyer' });
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(s).toBeNull();
      expect(m).toBeNull();
      await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
      expect(await balanceOf(feeW)).toBe(fee);
      const got = await balanceOf(buyerW);
      expect(got).toBeLessThan(amount - fee);
      expect(got).toBeGreaterThan(amount - fee - MAX_NET_FEE);
    } finally {
      await buyerW.close();
      await feeW.close();
    }
  });

  for (const [name, builder, cosigner] of [
    ['mutual cancel: buyer builds, seller co-signs the refund', 'buyer', 'seller'],
    ['dispute won by buyer: moderator builds, buyer co-signs', 'mod', 'buyer'],
    ['dispute won by seller: moderator builds, seller co-signs', 'mod', 'seller'],
  ] as const) {
    it(name, async () => {
      const t = await newTrade();
      const amount = XMR;
      await readyAndFund(t, amount);
      const dest = await newTestWallet(node.rpcUri);
      try {
        const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: amount }];
        const results = await settleAll(t, { kind: 'release', to, builder, cosigner });
        expect(results[ROLES.indexOf(cosigner)]).toMatch(/^[0-9a-f]{64}$/);
        await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
        const got = await balanceOf(dest);
        expect(got).toBeLessThan(amount);
        expect(got).toBeGreaterThan(amount - MAX_NET_FEE);
      } finally {
        await dest.close();
      }
    });
  }

  it('ignores a validly shaped message from an outsider and a replayed message', async () => {
    const t = await newTrade();
    const outsider = await generateIdentity();
    const forged = await seal({
      trade: t.code,
      from: 'seller',
      seq: 99,
      type: 'msig.make',
      payload: { key: 'msig.make:1', hex: 'MultisigxV2Rn1LVforged', echo: {} },
      to: ['buyer', 'mod'],
      me: outsider,
      participants: { ...t.participants, seller: { signPublic: outsider.signPublic, boxPublic: outsider.boxPublic } },
    });
    t.taps.buyer.inject(forged);
    // Replay the first real envelope the buyer received once setup is under way.
    await expect.poll(() => t.taps.buyer.seen.filter((f) => (f as Envelope).sig !== forged.sig).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const captured = t.taps.buyer.seen.find((f) => (f as Envelope).sig !== forged.sig);
    t.taps.buyer.inject(captured);
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
  });

  it('catches a seller who sends different setup messages to the buyer and the moderator', async () => {
    const code = newTradeCode();
    const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    relay.registerTrade(code, { buyer: ids.buyer.signPublic, seller: ids.seller.signPublic, mod: ids.mod.signPublic });
    const stores = { buyer: memoryStore(), seller: memoryStore(), mod: memoryStore() };
    const base = { code, ids, participants, stores };
    const buyer = startParty(base, 'buyer').party;
    const mod = startParty(base, 'mod').party;

    // The dishonest seller: two wallets, a different prepare message to each peer.
    const [w1, w2] = [await engine.create({ daemonUri: node.rpcUri, password: 'x' }), await engine.create({ daemonUri: node.rpcUri, password: 'x' })];
    const out = wsTransport({ url: relayUrl, code, role: 'seller', me: ids.seller });
    try {
      const msg = (seq: number, to: Role[], type: string, payload: Record<string, unknown>) =>
        seal({ trade: code, from: 'seller', seq, type, payload, to, me: ids.seller, participants });
      out.send(await msg(1, ['buyer'], 'msig.prepare', { key: 'msig.prepare:0', hex: await w1.prepare() }));
      out.send(await msg(2, ['mod'], 'msig.prepare', { key: 'msig.prepare:0', hex: await w2.prepare() }));
      out.send(await msg(3, ['buyer', 'mod'], 'msig.make', { key: 'msig.make:1', hex: 'x', echo: { buyer: '', mod: '' } }));
      for (const p of [buyer, mod]) {
        const err = await p.ready().then(() => null, (e: unknown) => e);
        expect((err as { code?: string }).code).toBe('equivocation');
      }
    } finally {
      out.close();
      await w1.close();
      await w2.close();
    }
  });

  it('a buyer killed mid-setup resumes from its store and ends with the same address', async () => {
    const t = await newTrade();
    await expect.poll(() => t.stores.buyer.current()?.step, { timeout: 120_000 }).toMatch(/^msig\.kex:/);
    await t.parties.buyer.stop();
    const restarted = startParty(t, 'buyer');
    t.parties.buyer = restarted.party;
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
  });

  it('a seller killed after sending the tx set restarts and the trade settles exactly once', async () => {
    const t = await newTrade();
    const amount = XMR;
    const escrow = await readyAndFund(t, amount);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: amount }];
      const o: Outcome = { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
      // Kill the seller as soon as it has saved the tx set it built.
      const buyerDone = t.parties.buyer.settle(o);
      const sellerDone = t.parties.seller.settle(o).catch(() => 'stopped');
      await expect.poll(() => t.stores.seller.current()?.release?.phase, { timeout: 120_000, interval: 5 }).toMatch(/^(built|done)$/);
      const builtSet = t.stores.seller.current()!.release!.txSet;
      await t.parties.seller.stop();
      expect(await sellerDone).toBe('stopped');
      const restarted = startParty(t, 'seller');
      t.parties.seller = restarted.party;
      const [hash, sellerResult] = await Promise.all([buyerDone, t.parties.seller.settle(o)]);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(sellerResult).toBeNull();
      expect(t.stores.seller.current()!.release!.txSet).toBe(builtSet); // resent, never rebuilt
      await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
      const got = await balanceOf(dest);
      expect(got).toBeGreaterThan(amount - MAX_NET_FEE);
      expect(got).toBeLessThan(amount);
      void escrow;
    } finally {
      await dest.close();
    }
  });
});
