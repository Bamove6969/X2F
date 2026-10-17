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

function memoryStore(): PartyStore & { current(): PartyState | null; onSave?: ((x: PartyState) => void) | undefined } {
  let s: PartyState | null = null;
  const store: PartyStore & { current(): PartyState | null; onSave?: ((x: PartyState) => void) | undefined } = {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
      store.onSave?.(x);
    },
    current: () => s,
  };
  return store;
}

/** A transport that can be fed extra frames, records what it received, and can drop sends. */
function tapped(inner: Transport): Transport & { inject(f: unknown): void; seen: unknown[]; out: Envelope[]; dropSend: (n: number) => boolean; sent: number } {
  const injected: unknown[] = [];
  const seen: unknown[] = [];
  const t = {
    sent: 0,
    out: [] as Envelope[],
    dropSend: (_n: number) => false,
    send: (e: Envelope) => {
      t.sent += 1;
      t.out.push(e);
      if (!t.dropSend(t.sent)) inner.send(e);
    },
    next: async () => {
      const f = injected.length > 0 ? injected.shift() : await inner.next();
      seen.push(f);
      return f;
    },
    onReconnect: (cb: () => void) => inner.onReconnect(cb),
    close: () => inner.close(),
    inject: (f: unknown) => injected.push(f),
    seen,
  };
  return t;
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

  const ignoredBy: Record<Role, string[]> = { buyer: [], seller: [], mod: [] };

  function startParty(t: Pick<Trade, 'code' | 'ids' | 'participants' | 'stores'>, role: Role) {
    const tap = tapped(wsTransport({ url: relayUrl, code: t.code, role, me: t.ids[role] }));
    ignoredBy[role] = [];
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
      resendMs: 500,
      onIgnored: (reason) => ignoredBy[role].push(reason),
      resendMaxMs: 2000,
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
    expect(ignoredBy.buyer).toContain('bad-signature'); // the outsider signed as the seller
    expect(ignoredBy.buyer).toContain('replay');
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
      // The moderator's cross-check names the cheat: the seller's messages differ between peers.
      const modErr = await mod.ready().then(() => null, (e: unknown) => e);
      expect(String(modErr)).toMatch(/seller sent different messages to buyer and me/);
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
      // The seller saves its built set, then dies before the set leaves the device.
      t.stores.seller.onSave = (x) => {
        if (x.release?.phase === 'built') t.taps.seller.dropSend = () => true;
      };
      const buyerDone = t.parties.buyer.settle(o);
      const sellerDone = t.parties.seller.settle(o).catch(() => 'stopped');
      await expect.poll(() => t.stores.seller.current()?.release?.phase, { timeout: 120_000, interval: 5 }).toBe('built');
      t.stores.seller.onSave = undefined;
      const builtSet = t.stores.seller.current()!.release!.txSet;
      await t.parties.seller.stop();
      expect(await sellerDone).toBe('stopped');
      const restarted = startParty(t, 'seller');
      t.parties.seller = restarted.party;
      await t.parties.seller.ready(); // the normal order: wait for ready, then settle
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

  it('a co-signer that dies after signing but before broadcasting finishes after a restart', async () => {
    const t = await newTrade();
    const amount = XMR;
    await readyAndFund(t, amount);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: amount }];
      const o: Outcome = { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
      t.stores.buyer.onSave = (x) => {
        if (x.release?.phase === 'signed') throw new Error('power cut');
      };
      const sellerDone = t.parties.seller.settle(o);
      const first = await t.parties.buyer.settle(o).then(() => null, (e: unknown) => e);
      expect(String(first)).toMatch(/power cut/);
      expect(t.stores.buyer.current()?.release?.phase).toBe('signed');
      t.stores.buyer.onSave = undefined;
      const restarted = startParty(t, 'buyer');
      t.parties.buyer = restarted.party;
      await t.parties.buyer.ready();
      const hash = await t.parties.buyer.settle(o);
      expect(hash).toBe(t.stores.buyer.current()!.release!.txHash);
      expect(await sellerDone).toBeNull();
      await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
      const got = await balanceOf(dest);
      expect(got).toBeGreaterThan(amount - MAX_NET_FEE);
      expect(got).toBeLessThan(amount);
    } finally {
      await dest.close();
    }
  });

  it('settle() before ready and before funding waits, then settles; lost messages are resent', async () => {
    const t = await newTrade();
    // Lose the buyer's 2nd to 4th messages; the resend timer must recover.
    t.taps.buyer.dropSend = (n) => n >= 2 && n <= 4;
    const amount = XMR;
    const dest = await newTestWallet(node.rpcUri);
    try {
      const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: amount }];
      const o: Outcome = { kind: 'release', to, builder: 'mod', cosigner: 'seller' };
      const settled = Promise.all(ROLES.map((r) => t.parties[r].settle(o)));
      await readyAndFund(t, amount);
      const results = await settled;
      expect(results[ROLES.indexOf('seller')]).toMatch(/^[0-9a-f]{64}$/);
      expect(results[ROLES.indexOf('buyer')]).toBeNull();
      expect(t.taps.buyer.sent).toBeGreaterThan(4);
    } finally {
      await dest.close();
    }
  });

  it('after setup, a stray setup message from the third party is ignored, not fatal', async () => {
    const t = await newTrade();
    const amount = XMR;
    await readyAndFund(t, amount);
    const junk = await seal({
      trade: t.code,
      from: 'buyer',
      seq: 10_000,
      type: 'msig.prepare',
      payload: { key: 'msig.prepare:0', hex: 'x' },
      to: ['seller', 'mod'],
      me: t.ids.buyer,
      participants: t.participants,
    });
    t.taps.seller.inject(junk);
    t.taps.mod.inject(junk);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: amount }];
      const [, s, m] = await Promise.all(ROLES.map((r) => t.parties[r].settle({ kind: 'release', to, builder: 'mod', cosigner: 'seller' })));
      expect(s).toMatch(/^[0-9a-f]{64}$/);
      expect(m).toBeNull();
      expect(ignoredBy.seller).toContain('setup-after-ready');
    } finally {
      await dest.close();
    }
  });

  it('recovers when the final setup message to a peer is lost', async () => {
    const code = newTradeCode();
    const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    relay.registerTrade(code, { buyer: ids.buyer.signPublic, seller: ids.seller.signPublic, mod: ids.mod.signPublic });
    const stores = { buyer: memoryStore(), seller: memoryStore(), mod: memoryStore() };
    const base = { code, ids, participants, stores };
    // Drop the seller's first send of its last kex message (the step before the address).
    let dropNext = false;
    let dropped = false;
    stores.seller.onSave = (x) => {
      if (!dropped && !x.address && x.step === 'msig.kex:2' && x.sent['msig.kex:2']) dropNext = true;
    };
    const started = ROLES.map((r) => startParty(base, r));
    const seller = started[ROLES.indexOf('seller')]!;
    seller.tap.dropSend = () => {
      if (dropNext && !dropped) {
        dropped = true;
        return true;
      }
      return false;
    };
    const addresses = await Promise.all(started.map((x) => x.party.ready()));
    expect(dropped).toBe(true);
    expect(new Set(addresses).size).toBe(1);
  });

  it('nobody becomes ready while one peer hides its address from another', async () => {
    const code = newTradeCode();
    const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    relay.registerTrade(code, { buyer: ids.buyer.signPublic, seller: ids.seller.signPublic, mod: ids.mod.signPublic });
    const stores = { buyer: memoryStore(), seller: memoryStore(), mod: memoryStore() };
    const base = { code, ids, participants, stores };
    const buyer = startParty(base, 'buyer');
    const seller = startParty(base, 'seller');
    const mod = startParty(base, 'mod');
    // Once the moderator has its address, it sends nothing more to the relay; its address
    // message reaches the buyer only (delivered straight into the buyer's inbox).
    let modHasAddress = false;
    stores.mod.onSave = (x) => {
      if (x.address) modHasAddress = true;
    };
    let forwarded = 0;
    mod.tap.dropSend = () => {
      if (!modHasAddress) return false;
      const last = mod.tap.out[mod.tap.out.length - 1]!;
      if (forwarded < 3) {
        forwarded += 1;
        buyer.tap.inject(last);
      }
      return true;
    };
    await expect.poll(() => stores.buyer.current()?.received['msig.addr:0']?.mod !== undefined, { timeout: 120_000 }).toBe(true);
    const settledEarly = await Promise.race([
      Promise.any([buyer.party.ready(), seller.party.ready()]).then(() => 'ready'),
      new Promise((r) => setTimeout(() => r('waiting'), 8000)),
    ]);
    expect(settledEarly).toBe('waiting');
    void mod;
  });

  it('a garbage tx set or a jump to attempt 20 from the builder cannot lock the co-signer', async () => {
    const t = await newTrade();
    const amount = XMR;
    await readyAndFund(t, amount);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: amount }];
      const o: Outcome = { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
      // Pause the real seller so the fakes below take the next sequence numbers.
      await t.parties.seller.stop();
      const buyerDone = t.parties.buyer.settle(o);
      await expect.poll(() => t.stores.buyer.current()?.release?.outcome, { timeout: 60_000 }).toBeTruthy();
      const tag = t.stores.buyer.current()!.release!.outcome.slice(0, 16);
      let seq = t.stores.seller.current()!.seq;
      const fake = (key: string, payload: Record<string, string>) =>
        seal({ trade: t.code, from: 'seller', seq: ++seq, type: key.split(':')[0]!, payload: { key, ...payload }, to: ['buyer'], me: t.ids.seller, participants: t.participants });
      // Before the real seller acts: a garbage set for attempt 1 and an export for attempt 20.
      t.taps.buyer.inject(await fake(`release.txset:${tag}.1`, { txSet: 'not a tx set' }));
      t.taps.buyer.inject(await fake(`state.export:${tag}.20`, { hex: 'x' }));
      await expect.poll(() => t.stores.buyer.current()?.received[`release.txset:${tag}.1`]?.seller, { timeout: 60_000 }).toBeTruthy();
      t.parties.seller = startParty(t, 'seller').party; // its first two seqs are now replays; resends get past them
      const [b, s] = await Promise.all([buyerDone, t.parties.seller.settle(o)]);
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(s).toBeNull();
      expect(ignoredBy.buyer).toContain('cosign-payout-mismatch');
      expect(t.stores.buyer.current()!.release!.attempt).toBe(2); // refused once, never jumped to 20
    } finally {
      await dest.close();
    }
  });

  it('a party that checked the addresses can settle even if a peer withholds its confirmation', async () => {
    const code = newTradeCode();
    const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    relay.registerTrade(code, { buyer: ids.buyer.signPublic, seller: ids.seller.signPublic, mod: ids.mod.signPublic });
    const stores = { buyer: memoryStore(), seller: memoryStore(), mod: memoryStore() };
    const base = { code, ids, participants, stores };
    const buyer = startParty(base, 'buyer');
    const seller = startParty(base, 'seller');
    const mod = startParty(base, 'mod');
    // The moderator confirms to the buyer only, then goes silent.
    let modConfirmed = false;
    stores.mod.onSave = (x) => {
      if (x.sent['msig.ready:0']) modConfirmed = true;
    };
    let forwarded = false;
    mod.tap.dropSend = () => {
      if (!modConfirmed) return false;
      if (!forwarded) {
        forwarded = true;
        buyer.tap.inject(mod.tap.out[mod.tap.out.length - 1]!);
      }
      return true;
    };
    const address = await buyer.party.ready();
    await expect.poll(() => stores.seller.current()?.sent['msig.ready:0'] !== undefined, { timeout: 60_000 }).toBe(true);
    // A different setup message from the moderator no longer kills the seller.
    seller.tap.inject(await seal({ trade: code, from: 'mod', seq: 1_000_000, type: 'msig.prepare', payload: { key: 'msig.prepare:0', hex: 'other' }, to: ['buyer', 'seller'], me: ids.mod, participants }));
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address, amount: XMR, relay: true });
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    const dest = await newTestWallet(node.rpcUri);
    try {
      const to = [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }];
      const o: Outcome = { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
      const [b, s] = await Promise.all([buyer.party.settle(o), seller.party.settle(o)]);
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(s).toBeNull();
      expect(ignoredBy.seller).toContain('setup-after-ready');
    } finally {
      await dest.close();
    }
  });
});
