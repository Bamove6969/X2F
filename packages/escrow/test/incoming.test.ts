import { ROLES, feeFor, type Role } from '@x2f/core';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seal } from '@x2f/protocol';
import { MoneroMultisigEngine, type Outcome, type PartyHandle, type Payout } from '../src/index.js';
import { minedWhile, partyKit, spyEngine, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;
const MAX_NET_FEE = XMR / 100n;

describe('incoming funds, funds() and outcome buffering on regtest', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  const spy = spyEngine(engine);
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

  async function pay(address: string, amount: bigint): Promise<string> {
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    const tx = await funder.createTx({ accountIndex: 0, address, amount, relay: true });
    return tx.getHash();
  }

  async function ready(t: Trade): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    return addresses[0]!;
  }

  async function balanceOf(w: MoneroWalletFull): Promise<bigint> {
    await w.setDaemonConnection({ uri: node.rpcUri });
    await w.sync();
    return w.getBalance();
  }

  it('reports each of two funding transfers, and unlocks them after 12 blocks', async () => {
    const t = await kit.newTrade();
    const escrow = await ready(t);
    const first = await pay(escrow, 600_000_000_000n);
    const second = await pay(escrow, 400_000_000_000n);
    // In the pool: both seen, unconfirmed and locked.
    await expect.poll(async () => (await t.parties.mod.funds()).incoming.length, { timeout: 60_000, interval: 1000 }).toBe(2);
    let f = await t.parties.mod.funds();
    expect(new Map(f.incoming.map((i) => [i.txHash, i.amountAtomic]))).toEqual(new Map([[first, 600_000_000_000n], [second, 400_000_000_000n]]));
    for (const i of f.incoming) expect(i).toMatchObject({ confirmations: 0, unlocked: false, height: null });
    expect(f.outgoing).toEqual([]);
    await mine(node.rpcUri, 1, funderAddress);
    f = await t.parties.mod.funds();
    expect(f.balance).toBe(XMR);
    expect(f.unlocked).toBe(0n);
    for (const i of f.incoming) expect(i).toMatchObject({ confirmations: 1, unlocked: false });
    // Task 9: absolute heights, with the chain height from the same read (confirmations = chainHeight - height).
    const blockOf = f.incoming[0]!.height;
    expect(typeof f.chainHeight).toBe('number');
    for (const i of f.incoming) expect(i.height).toBe(f.chainHeight! - 1);
    await mine(node.rpcUri, 11, funderAddress);
    f = await t.parties.mod.funds();
    expect(f.unlocked).toBe(XMR);
    expect(f.incoming).toHaveLength(2);
    for (const i of f.incoming) expect(i).toMatchObject({ confirmations: 12, unlocked: true, height: blockOf });
    expect(f.chainHeight! - blockOf!).toBe(12);
  });

  it('funds() during a settle never interleaves wallet calls', async () => {
    spy.maxInFlight = 0;
    const t = await kit.newTrade({ buyer: { engine: spy } });
    const escrow = await ready(t);
    await pay(escrow, XMR);
    await mine(node.rpcUri, 12, funderAddress);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      const settled = Promise.all(ROLES.map((r) => t.parties[r].settle(o)));
      const reads: Promise<unknown>[] = [];
      let stop = false;
      const reader = (async () => {
        while (!stop) {
          reads.push(t.parties.buyer.funds());
          await new Promise((r) => setTimeout(r, 50));
        }
      })();
      const [b] = await minedWhile(node.rpcUri, funderAddress, settled);
      stop = true;
      await reader;
      await Promise.all(reads);
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(reads.length).toBeGreaterThan(5);
      expect(spy.calls.signRelease).toBe(1);
      expect(spy.calls.incoming).toBeGreaterThan(5);
      expect(spy.maxInFlight).toBe(1);
    } finally {
      await dest.close();
    }
  });

  it('settles a set only for the outcome this party settles, whichever side moves first', async () => {
    const t = await kit.newTrade();
    const escrow = await ready(t);
    await pay(escrow, XMR);
    await mine(node.rpcUri, 12, funderAddress);
    const [refund, other] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    try {
      // The seller asks for the auto-refund; the moderator has not settled it (yet).
      const o: Outcome = { kind: 'release', to: [{ address: await refund.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'mod' };
      const sellerDone = t.parties.seller.settle(o);
      await expect.poll(() => kit.ignoredBy.mod.includes('not-current-release'), { timeout: 60_000 }).toBe(true);
      // The moderator settles a different outcome first: nothing is ever signed for either.
      const wrong: Outcome = { ...o, to: [{ address: await other.getPrimaryAddress(), amountAtomic: XMR }] };
      const wrongDone = t.parties.mod.settle(wrong);
      wrongDone.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 8000));
      expect(t.stores.mod.current()!.release!.phase).toBe('export'); // waiting for a set that never comes
      expect(Object.keys(t.stores.mod.current()!.received).some((k) => k.startsWith('release.txset'))).toBe(false);
      expect(t.stores.seller.current()!.release!.phase).toBe('export');
      // Now the moderator settles the same outcome: the seller's set is built and signed.
      const [hash, sellerResult] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.mod.settle(o), sellerDone]));
      await expect(wrongDone).rejects.toMatchObject({ code: 'bad-outcome' });
      // Watcher revival re-verify R2: the committed outcome's builder, for the mod's own settled report.
      expect(t.parties.mod.committedBuilder!()).toBe('seller');
      expect(t.parties.seller.committedBuilder!()).toBe('seller');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(sellerResult).toBeNull();
      await mine(node.rpcUri, 12, funderAddress);
      // Task 9: the co-signing mod's own wallet shows the sweep it signed, in its block, spending the whole escrow.
      const modFunds = await t.parties.mod.funds();
      expect(modFunds.outgoing).toHaveLength(1);
      expect(modFunds.outgoing![0]).toMatchObject({ txHash: hash, spentAtomic: XMR });
      expect(modFunds.outgoing![0]!.height).toBeLessThanOrEqual(modFunds.chainHeight! - 12);
      expect(await balanceOf(other)).toBe(0n);
      const got = await balanceOf(refund);
      expect(got).toBeGreaterThan(XMR - MAX_NET_FEE);
      expect(got).toBeLessThan(XMR);
    } finally {
      await refund.close();
      await other.close();
    }
  });

  // Gap 4 (20 Nov) and its review (M1, m1, m3, m4): settleSent(o) goes true on the moderator's DONE
  // only (never in 'built' before it), and landed(o) proves from the chain that the seller-built
  // refund is in a block: by the builder's own tx key when no DONE ever reaches it, after a restart
  // too; a DONE is accepted only once the same key proves the tx it names.
  it("settleSent(o) and landed(o) for a seller-built refund: false in 'built' until DONE; proven by the builder's tx key with the DONE held back, also after a restart; DONE then accepted", async () => {
    const t = await kit.newTrade();
    const escrow = await ready(t);
    await pay(escrow, XMR);
    await mine(node.rpcUri, 12, funderAddress);
    const [refund, other] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await refund.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'mod' };
      const elsewhere: Outcome = { ...o, to: [{ address: await other.getPrimaryAddress(), amountAtomic: XMR }] };
      for (const r of ROLES) expect(t.parties[r].settleSent!(o)).toBe(false); // no settle at all
      expect(await t.parties.seller.landed!(o)).toBeNull();
      // The moderator's DONE never leaves (every frame it sends once its release is done is dropped).
      t.taps.mod.dropSend = () => t.stores.mod.current()?.release?.phase === 'done';
      const sellerDone = t.parties.seller.settle(o);
      sellerDone.catch(() => undefined);
      await expect.poll(() => t.stores.seller.current()?.release?.phase, { timeout: 60_000 }).toBe('export');
      expect(t.parties.seller.settleSent!(o)).toBe(false);
      // No block is mined until the moderator has submitted it.
      const hash = await t.parties.mod.settle(o);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(t.parties.mod.settleSent!(o)).toBe(true);
      expect(t.parties.mod.settleSent!(elsewhere)).toBe(false); // m3: tied to the outcome
      await expect.poll(() => t.stores.seller.current()?.release?.phase, { timeout: 60_000 }).toBe('built');
      await new Promise((r) => setTimeout(r, 3000)); // resends come and go; the DONE is held
      // m1: built, but no DONE: still needed.
      expect(t.parties.seller.settleSent!(o)).toBe(false);
      expect(Object.keys(t.stores.seller.current()!.received).some((k) => k.startsWith('release.done'))).toBe(false);
      expect(await t.parties.seller.landed!(o)).toBeNull(); // in the pool only
      await mine(node.rpcUri, 2, funderAddress);
      // M1 fix c.2: the builder's own tx key proves its set landed, with nobody's word.
      await expect.poll(() => t.parties.seller.landed!(o), { timeout: 60_000, interval: 1000 }).toBe(hash);
      expect(await t.parties.seller.landed!(elsewhere)).toBeNull();
      // The seller's device closes and comes back with no DONE (as after the trade closed).
      await t.parties.seller.stop();
      const back = kit.startParty(t, 'seller');
      await expect.poll(() => back.party.landed!(o), { timeout: 60_000, interval: 1000 }).toBe(hash);
      // m4: the DONE now arrives; the builder accepts it once its key proves the named tx.
      t.taps.mod.dropSend = () => false;
      const [result] = await minedWhile(node.rpcUri, funderAddress, Promise.all([back.party.settle(o)]));
      expect(result).toBeNull();
      expect(t.stores.seller.current()!.release!).toMatchObject({ phase: 'done', txHash: hash });
      expect(back.party.settleSent!(o)).toBe(true);
      expect(await back.party.landed!(o)).toBe(hash);
    } finally {
      await refund.close();
      await other.close();
    }
  });

  // Review m4 (lead 20 Nov): a DONE whose tx the builder's own key does not fit is refused. The
  // moderator and the buyer spend the escrow elsewhere (2-of-3, by design), and a DONE signed by the
  // moderator names that tx for the seller's refund: the seller's wallet does see it spend the escrow
  // in a block, but its tx key for the refund it built does not fit, so it never counts as done.
  it("m4: a moderator's DONE naming another spend of the escrow is refused by the builder's tx key (never done, landed() null)", async () => {
    const keySpy = spyEngine(engine);
    const t = await kit.newTrade({ seller: { engine: keySpy } });
    const escrow = await ready(t);
    await pay(escrow, XMR);
    await mine(node.rpcUri, 12, funderAddress);
    const [refund, other] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    try {
      const a: Outcome = { kind: 'release', to: [{ address: await refund.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'mod' };
      const b: Outcome = { kind: 'release', to: [{ address: await other.getPrimaryAddress(), amountAtomic: XMR }], builder: 'buyer', cosigner: 'mod' };
      // The seller's built set never reaches the moderator.
      t.taps.seller.dropSend = () => t.stores.seller.current()?.release?.phase === 'built';
      const sellerA = t.parties.seller.settle(a);
      sellerA.catch(() => undefined);
      const modA = t.parties.mod.settle(a);
      modA.catch(() => undefined);
      await expect.poll(() => t.stores.seller.current()?.release?.phase, { timeout: 60_000 }).toBe('built');
      // The moderator switches to the buyer-built outcome (it never committed to a) and the two settle it.
      const [modB] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.mod.settle(b), t.parties.buyer.settle(b)]));
      expect(modB).toMatch(/^[0-9a-f]{64}$/);
      await mine(node.rpcUri, 2, funderAddress);
      // A DONE for a, signed by the moderator, naming b's tx.
      const tag = t.stores.seller.current()!.release!.outcome.slice(0, 16);
      const key = `release.done:${tag}.0`;
      t.taps.seller.inject(await seal({ trade: t.code, from: 'mod', seq: 1_000_000, type: 'release.done', payload: { key, txHash: modB! }, to: ['seller'], me: t.ids.mod, participants: t.participants }));
      await expect.poll(() => t.stores.seller.current()!.received[key]?.mod !== undefined, { timeout: 30_000 }).toBe(true);
      // The key check ran (spentBy and txSeen held for b) and refused it, block after block.
      await expect.poll(() => keySpy.calls.txKeyPays ?? 0, { timeout: 60_000, interval: 1000 }).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) {
        await mine(node.rpcUri, 1, funderAddress);
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(t.stores.seller.current()!.release!.phase).toBe('built');
      expect(await t.parties.seller.landed!(a)).toBeNull();
      expect(await t.parties.seller.landed!(b)).toBeNull(); // not this party's release
    } finally {
      await refund.close();
      await other.close();
    }
  });

  it('a late surplus before signing: both re-derive, and the sweep pays it to the poster after it unlocks', async () => {
    const t = await kit.newTrade();
    const escrow = await ready(t);
    const [buyerW, feeW, sellerW] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    try {
      const amount = XMR;
      const fee = feeFor(amount);
      const sellerFunds = amount + fee; // a seller's ad: the seller funds amount + 1%
      const surplus = 100_000_000n; // 0.0001 XMR
      const addr = { buyer: await buyerW.getPrimaryAddress(), fee: await feeW.getPrimaryAddress(), seller: await sellerW.getPrimaryAddress() };
      // What each side derives from the balance it observes (Task 1's payoutsFor, release, poster seller).
      const derive = (balance: bigint): Outcome => {
        const to: Payout[] = [{ address: addr.buyer, amountAtomic: amount }, { address: addr.fee, amountAtomic: fee }];
        if (balance > sellerFunds) to.push({ address: addr.seller, amountAtomic: balance - sellerFunds });
        return { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
      };
      // Each side watches its own funds() and settles again whenever the balance changes.
      const latest: Partial<Record<Role, Promise<string | null>>> = {};
      let watching = true;
      const watch = async (r: Role, party: PartyHandle): Promise<void> => {
        let seen = -1n;
        while (watching) {
          const { balance } = await party.funds().catch(() => ({ balance: seen }));
          if (balance > 0n && balance !== seen) {
            seen = balance;
            const p = party.settle(derive(balance));
            p.catch(() => undefined); // an older outcome is replaced
            latest[r] = p;
          }
          await new Promise((res) => setTimeout(res, 500));
        }
      };
      const watchers = [watch('seller', t.parties.seller), watch('buyer', t.parties.buyer)];

      await pay(escrow, sellerFunds);
      await mine(node.rpcUri, 2, funderAddress); // funded, still locked
      await expect.poll(() => t.stores.buyer.current()?.release?.phase, { timeout: 60_000 }).toBe('waiting-funds');
      const firstOutcome = t.stores.buyer.current()!.release!.outcome;
      await pay(escrow, surplus); // the surplus arrives after both sides called settle
      await mine(node.rpcUri, 1, funderAddress);
      await expect.poll(() => t.stores.buyer.current()?.release?.outcome !== firstOutcome && t.stores.seller.current()?.release?.outcome === t.stores.buyer.current()?.release?.outcome, { timeout: 60_000 }).toBe(true);
      // The first payment unlocks; the surplus (9 confirmations) is still locked, so nothing is signed yet.
      await mine(node.rpcUri, 8, funderAddress);
      await new Promise((r) => setTimeout(r, 3000));
      expect(t.stores.buyer.current()!.release!.phase).toBe('waiting-funds');
      await mine(node.rpcUri, 3, funderAddress);
      const [hash, sellerResult] = await minedWhile(node.rpcUri, funderAddress, (async () => {
        await expect.poll(() => latest.buyer !== undefined && latest.seller !== undefined).toBe(true);
        return Promise.all([latest.buyer!, latest.seller!]);
      })());
      watching = false;
      await Promise.all(watchers);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(sellerResult).toBeNull();
      await mine(node.rpcUri, 12, funderAddress);
      expect(await balanceOf(feeW)).toBe(fee); // the fee output stays exact
      expect(await balanceOf(sellerW)).toBe(surplus); // the surplus goes to the poster
      const got = await balanceOf(buyerW);
      expect(got).toBeLessThan(amount);
      expect(got).toBeGreaterThan(amount - MAX_NET_FEE);
    } finally {
      for (const w of [buyerW, feeW, sellerW]) await w.close();
    }
  });
});
