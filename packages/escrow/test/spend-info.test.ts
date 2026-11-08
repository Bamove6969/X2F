// Task 9 I/O, lead decision (A) of 2026-10-29: after a seller–buyer release, the releasing device
// sends the moderator its post-release multisig info; the moderator imports it, and only then does
// its OWN wallet show the spend (funds().outgoing). Regtest.
import { ROLES, type Role } from '@x2f/core';
import { generateIdentity, seal } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MoneroMultisigEngine,
  SPEND_INFO_MAX_HEX,
  runParty,
  wsTransport,
  type EscrowEngine,
  type EscrowSession,
  type Outcome,
  type Transport,
} from '../src/index.js';
import { minedWhile, partyKit, tapped, type MemoryStore, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;

describe('post-release multisig info shows the moderator a seller-buyer release (regtest)', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  const kit = partyKit({ relay: () => relay, relayUrl: () => relayUrl, daemonUri: () => node.rpcUri, engine });

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    funderAddress = await funder.getPrimaryAddress();
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await kit.stopAll();
  });

  afterAll(async () => {
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  async function fund(t: Trade, amount: bigint): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount, relay: true });
    await mine(node.rpcUri, 12, funderAddress);
    return addresses[0]!;
  }

  it('a seller-buyer release is shown to the mod only through the releasing parties\' spend.info: strict import, resent until acked', async () => {
    const [t, other] = [await kit.newTrade(), await kit.newTrade()];
    await fund(t, XMR);
    await Promise.all(ROLES.map((r) => other.parties[r].ready()));
    const dest = await newTestWallet(node.rpcUri);
    // The mod's party is restarted on a transport that drops every incoming frame while `deaf`.
    await t.parties.mod.stop();
    await new Promise((r) => setTimeout(r, 2000)); // the relay drops the old connection first (else 4409)
    let deaf = true;
    const inner = wsTransport({ url: relayUrl, code: t.code, role: 'mod', me: t.ids.mod });
    const deafInner: Transport = {
      send: (e) => inner.send(e),
      next: async () => {
        for (;;) {
          const f = await inner.next();
          if (!deaf) return f;
        }
      },
      onReconnect: (cb) => inner.onReconnect(cb),
      close: () => inner.close(),
    };
    const deafTransport = tapped(deafInner);
    const modIgnored: string[] = [];
    // runParty directly: kit.startParty would open a second mod socket, and the relay keeps one per role (4409).
    const mod = runParty({
      role: 'mod', trade: t.code, me: t.ids.mod, participants: t.participants, transport: deafTransport, engine,
      daemonUri: node.rpcUri, password: 'pw-mod', store: t.stores.mod, resendMs: 500, resendMaxMs: 2000, onIgnored: (r) => modIgnored.push(r),
    });
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // Before any release is done there is nothing to export (the nonces are in use).
      await expect(t.parties.buyer.spendInfo()).rejects.toMatchObject({ code: 'bad-state' });
      const [hash] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o)]));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      await mine(node.rpcUri, 2, funderAddress);

      // The gap: the mod took no part, so its own wallet does not show the spend.
      let f = await mod.funds();
      expect(f.outgoing).toEqual([]);
      expect(f.balance).toBe(XMR); // without the key images it still counts the coins as its own

      // Strict input: garbage, wrong size, another escrow's info and a tampered one are refused.
      await expect(mod.importSpendInfo('zz')).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(mod.importSpendInfo('abc')).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(mod.importSpendInfo('ab'.repeat(SPEND_INFO_MAX_HEX / 2 + 1))).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(mod.importSpendInfo('00'.repeat(200))).rejects.toMatchObject({ code: 'bad-spend-info' });
      const info = await t.parties.buyer.spendInfo();
      expect(info).toMatch(/^[0-9a-f]+$/);
      expect(info.length).toBeLessThanOrEqual(SPEND_INFO_MAX_HEX);
      expect(await t.parties.buyer.spendInfo()).toBe(info); // exported once, saved
      // Review I1: the info goes with the release's tx and its secret key. The co-signer (buyer)
      // submitted the tx, so its wallet stores the key; the builder (seller) kept it from the build.
      const buyerSent = t.stores.buyer.current()!.sent['spend.info:0']!;
      expect(buyerSent).toMatchObject({ hex: info, txHash: hash });
      expect(buyerSent.txKey).toMatch(/^[0-9a-f]{64}$/);
      await expect(other.parties.mod.importSpendInfo(info)).rejects.toMatchObject({ code: 'bad-spend-info' });
      const flipped = info.slice(0, -4) + (info.slice(-4) === '0000' ? '0001' : '0000');
      await expect(mod.importSpendInfo(flipped)).rejects.toMatchObject({ code: 'bad-spend-info' });
      // A party never imports (its own release is done; the info is for the moderator only).
      f = await mod.funds();
      expect(f.outgoing).toEqual([]);
      // Calls on the handle are not claims: only a sealed message from a trade party is (lead decision b).
      expect(f.spendClaims).toEqual([]);
      expect((await t.parties.buyer.funds()).spendClaims).toBeUndefined();
      expect(t.stores.buyer.current()!.received['spend.ack:0']).toBeUndefined();

      // The mod hears again: the parties' resends arrive, it imports, its own wallet shows the
      // sweep in its block spending everything, and both releasing parties get the ack.
      deaf = false;
      await expect.poll(async () => (await mod.funds()).outgoing?.map((x) => x.txHash), { timeout: 60_000, interval: 1000 }).toEqual([hash]);
      f = await mod.funds();
      expect(f.balance).toBe(0n);
      expect(f.outgoing![0]).toMatchObject({ txHash: hash, spentAtomic: XMR });
      expect(typeof f.outgoing![0]!.height).toBe('number');
      await expect.poll(() => [t.stores.buyer, t.stores.seller].map((s) => s.current()!.received['spend.ack:0']?.mod !== undefined), { timeout: 60_000 }).toEqual([true, true]);
      expect(Object.keys(t.stores.mod.current()!.received['spend.info:0'] ?? {}).sort()).toEqual(['buyer', 'seller']);
      expect(modIgnored).not.toContain('spend-info-refused');
      expect([...(await mod.funds()).spendClaims!].sort()).toEqual(['buyer', 'seller']);
      expect([...t.stores.mod.current()!.claims!].sort()).toEqual(['buyer', 'seller']);

      // Review I1: the mod did not sign this tx; both parties sent the tx key, and both prove the payout.
      f = await mod.funds();
      expect(f.ownTxs).toEqual([]);
      const proofs = [...f.spendProofs!].sort((x, y) => x.from.localeCompare(y.from));
      expect(proofs.map((p) => [p.from, p.txHash])).toEqual([['buyer', hash], ['seller', hash]]);
      expect(proofs[0]!.txKey).toBe(proofs[1]!.txKey);
      const key = proofs[0]!.txKey;
      const destAddress = await dest.getPrimaryAddress();
      // the payout is short by the network fee, which comes off payout 0: still proven
      expect(await mod.proveSweep!(hash!, key, [{ address: destAddress, amountAtomic: XMR }])).toBe(true);
      // one atomic unit more than was paid, another address, a wrong key: not proven
      expect(await mod.proveSweep!(hash!, key, [{ address: destAddress, amountAtomic: XMR + 1n }])).toBe(false);
      expect(await mod.proveSweep!(hash!, key, [{ address: funderAddress, amountAtomic: XMR / 2n }])).toBe(false);
      expect(await mod.proveSweep!(hash!, '1'.repeat(64), [{ address: destAddress, amountAtomic: XMR / 2n }])).toBe(false); // not a reduced scalar: refused before monero-ts sees it
      expect(await mod.proveSweep!(hash!, '01' + '0'.repeat(62), [{ address: destAddress, amountAtomic: XMR / 2n }])).toBe(false); // a scalar, but not this tx's key
      expect(await mod.proveSweep!(hash!, 'zz', [{ address: destAddress, amountAtomic: XMR / 2n }])).toBe(false);
      // Review round 2 (R2-I1): an unrelated real tx (one a forger points the mod's key images at,
      // e.g. another trade's release, whose key its builder or submitter holds) is never proven, even
      // when its key proves exactly what it paid: no input of it spends one of THIS escrow's outputs
      // (no key image of this wallet's outputs, with that output in its ring).
      const otherWallet = await newTestWallet(node.rpcUri);
      try {
        await funder.sync();
        const t2 = await funder.createTx({ accountIndex: 0, address: await otherWallet.getPrimaryAddress(), amount: XMR / 2n, relay: true });
        await mine(node.rpcUri, 1, funderAddress);
        const k2 = await funder.getTxKey(t2.getHash());
        expect(await mod.proveSweep!(t2.getHash(), k2, [{ address: destAddress, amountAtomic: XMR }])).toBe(false);
        expect(await mod.proveSweep!(t2.getHash(), k2, [{ address: await otherWallet.getPrimaryAddress(), amountAtomic: XMR / 2n }])).toBe(false);
      } finally {
        await otherWallet.close();
      }

      // Review M2: a later, different info from a sender already imported is acked but never imported,
      // and the sweep the mod's wallet showed stays shown.
      deafTransport.inject(await seal({
        trade: t.code, from: 'buyer', seq: 1_000_000, type: 'spend.info',
        payload: { key: 'spend.info:0', hex: '00'.repeat(200), txHash: hash!, txKey: '' }, to: ['mod'], me: t.ids.buyer, participants: t.participants,
      }));
      await expect.poll(() => modIgnored.includes('spend-info-again'), { timeout: 30_000 }).toBe(true);
      expect((await mod.funds()).outgoing?.map((x) => x.txHash)).toEqual([hash]);
      expect(t.stores.mod.current()!.shown?.map((x) => x.txHash)).toEqual([hash]);
    } finally {
      await mod.stop();
      await dest.close();
    }
  });

  it('a release paying a buyer subaddress and the fee wallet is proven with the whole tx key, additional keys included (review round 2, R2-I2)', async () => {
    const t = await kit.newTrade();
    await fund(t, XMR);
    const buyerWallet = await newTestWallet(node.rpcUri);
    const feeWallet = await newTestWallet(node.rpcUri);
    try {
      // What Cake, Feather and the GUI hand out by default: a subaddress.
      const sub = (await buyerWallet.createSubaddress(0)).getAddress();
      expect(sub.startsWith('8')).toBe(true);
      const fee = XMR / 100n;
      const to = [{ address: sub, amountAtomic: XMR - fee }, { address: await feeWallet.getPrimaryAddress(), amountAtomic: fee }];
      const o: Outcome = { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
      const [hash] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o)]));
      await mine(node.rpcUri, 2, funderAddress);
      // Both releasing parties sent the key, and it carries one additional key per output.
      await expect.poll(async () => (await t.parties.mod.funds()).spendProofs?.length ?? 0, { timeout: 60_000, interval: 1000 }).toBe(2);
      const f = await t.parties.mod.funds();
      expect(f.outgoing?.map((x) => x.txHash)).toEqual([hash]);
      const keys = f.spendProofs!.map((p) => {
        expect(p.txHash).toBe(hash);
        return p.txKey;
      });
      for (const key of keys) {
        expect(key).toMatch(/^([0-9a-f]{64}){2,}$/);
        expect(await t.parties.mod.proveSweep!(hash!, key, to)).toBe(true);
      }
      expect(keys[0]).toBe(keys[1]); // the builder's key from the build equals the submitter's stored one
      // The main key alone does not prove a subaddress payout; nor does one unit more.
      expect(await t.parties.mod.proveSweep!(hash!, keys[0]!.slice(0, 64), to)).toBe(false);
      expect(await t.parties.mod.proveSweep!(hash!, keys[0]!, [to[0]!, { ...to[1]!, amountAtomic: fee + 1n }])).toBe(false);
      // A chunk that is not a reduced scalar is refused before monero-ts sees it (its WebAssembly aborts on one).
      expect(await t.parties.mod.proveSweep!(hash!, keys[0]!.slice(0, 64) + '1'.repeat(64), to)).toBe(false);
      expect(await t.parties.mod.proveSweep!(hash!, keys[0]!, to)).toBe(true); // the wallet still answers
    } finally {
      await buyerWallet.close();
      await feeWallet.close();
    }
  });

  it('a claim counts from a trade party\'s sealed spend.info even when the import is refused, and from spend.claim when the info is too big; a foreign frame never counts (lead decision b)', async () => {
    // The buyer's post-release export is garbage (refused by the mod), the seller's too big to send.
    const stores: Partial<Record<Role, MemoryStore>> = {};
    const fakeExport = (role: Role, hex: string): EscrowEngine => {
      const wrap = (sess: EscrowSession): EscrowSession =>
        new Proxy(sess, {
          get(target, key, receiver) {
            const v = Reflect.get(target, key, receiver) as unknown;
            if (key !== 'exportState' || typeof v !== 'function') return v;
            // Only the post-release export: the release's own exports stay real.
            return async () => (stores[role]?.current()?.release?.phase === 'done' ? hex : await (v as () => Promise<string>).apply(target));
          },
        });
      return {
        create: async (a) => wrap(await engine.create(a)),
        resume: async (saved, a) => wrap(await engine.resume(saved, a)),
      };
    };
    const big = 'ab'.repeat(SPEND_INFO_MAX_HEX / 2 + 1);
    const t = await kit.newTrade({ buyer: { engine: fakeExport('buyer', '00'.repeat(200)) }, seller: { engine: fakeExport('seller', big) } });
    stores.buyer = t.stores.buyer;
    stores.seller = t.stores.seller;
    await fund(t, XMR);
    const dest = await newTestWallet(node.rpcUri);
    try {
      // A spend.info signed by someone outside the trade, naming the buyer as sender: never opened, never a claim.
      const stranger = await generateIdentity();
      const before = kit.ignoredBy.mod.length;
      t.taps.mod.inject(await seal({ trade: t.code, from: 'buyer', seq: 1_000_000, type: 'spend.info', payload: { key: 'spend.info:0', hex: '00'.repeat(10) }, to: ['mod'], me: stranger, participants: { ...t.participants, buyer: { signPublic: stranger.signPublic, boxPublic: stranger.boxPublic } } }));
      await expect.poll(() => kit.ignoredBy.mod.length, { timeout: 10_000 }).toBeGreaterThan(before);
      expect((await t.parties.mod.funds()).spendClaims).toEqual([]);

      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o)]));
      await expect.poll(async () => [...((await t.parties.mod.funds()).spendClaims ?? [])].sort(), { timeout: 60_000, interval: 1000 }).toEqual(['buyer', 'seller']);
      // The buyer's info was refused: not imported, not acked (it keeps resending). The seller's claim is acked.
      expect(kit.ignoredBy.mod).toContain('spend-info-refused');
      expect(t.stores.mod.current()!.received['spend.info:0']).toBeUndefined();
      expect(Object.keys(t.stores.mod.current()!.received['spend.claim:0'] ?? {})).toEqual(['seller']);
      await expect.poll(() => t.stores.seller.current()!.received['spend.ack:0']?.mod !== undefined, { timeout: 60_000 }).toBe(true);
      expect(t.stores.buyer.current()!.received['spend.ack:0']).toBeUndefined();
      expect(t.stores.seller.current()!.sent['spend.info:0']).toMatchObject({ hex: big }); // kept, never sent
      // Review M2: the buyer's refused info is resent every 0.5 s but tried again at most every 30 s.
      expect(kit.ignoredBy.mod).toContain('spend-info-throttled');
      // The mod's own wallet still shows nothing: only the fallback covers these.
      expect((await t.parties.mod.funds()).outgoing).toEqual([]);
    } finally {
      await dest.close();
    }
  });
});
