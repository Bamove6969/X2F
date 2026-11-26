// P0 of 8 Nov (local demo, real moderation service): a normal seller-built, buyer-co-signed release
// that is mined must be proven by the moderation watcher. The watcher counts a sweep the mod did not
// sign only once BOTH trade parties' sealed spend.info name it (R3-I1), and the builder sends its
// spend.info only once it saw its release in a block. Three real escrow parties (`runParty`) on a
// fake chain and an in-memory relay; the watcher's own proof (`spendEvidence`) over the real mod
// party's funds(). The cause on the demo (the builder's daemon lookup could never succeed in the
// web bundle) is fixed in packages/escrow monero.ts and tested there on regtest
// (web-bundle-http.test.ts); here: the whole path settles, and while the builder cannot confirm
// its release nothing is counted on the buyer's word alone. The mod's state is saved by the
// moderation service's sealed store (JSON): on the demo of 10 Nov, after the fix above, the mod
// party died saving `shown` (a bigint `spentAtomic`: "Do not know how to serialize a BigInt") as
// the seller's spend.info arrived, so the seller's statement was never imported either.
import { newTradeCode, ROLES, type Role } from '@x2f/core';
import { runParty, type Outcome, type PartyHandle, type PartyState } from '@x2f/escrow';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { newWatchState, sweepMinimums } from '@x2f/trade';
import { afterEach, describe, expect, it } from 'vitest';
import { escrowStore } from '../src/main.js';
import { spendEvidence } from '../src/watcher.js';
import { fakeChain, memoryRelay, SWEEP_HASH, type FakeChain } from './chain.js';
import { FEE_WALLET, PAYROLL_WALLET, makeCtx, TERMS, type Ctx } from './harness.js';

const running: PartyHandle[] = [];
const ctxs: Ctx[] = [];
afterEach(async () => {
  for (const p of running.splice(0)) await p.stop();
  for (const c of ctxs.splice(0)) await c.db.end();
});

async function trade(chain: FakeChain, extra: { daemonTimeoutMs?: number } = {}) {
  const relay = memoryRelay();
  const code = newTradeCode();
  const ids = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await generateIdentity()] as const))) as Record<Role, Identity>;
  const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const ignored: Record<Role, string[]> = { buyer: [], seller: [], mod: [] };
  const saved: Partial<Record<Role, PartyState>> = {};
  const parties = {} as Record<Role, PartyHandle>;
  // The mod's state is sealed in Postgres by the service's own store (JSON under the keystore key),
  // as in production; the traders' stores are in memory.
  const ctx = await makeCtx();
  ctxs.push(ctx);
  const modStore = escrowStore(ctx.db, ctx.keystoreKey, code);
  const argsFor = (role: Role) => ({
      role,
      trade: code,
      me: ids[role],
      participants,
      transport: relay.transport(role),
      engine: chain.engine(role),
      daemonUri: 'http://node.test',
      password: `pw-${role}`,
      store: role === 'mod'
        ? modStore
        : {
            load: async () => (saved[role] ? structuredClone(saved[role]!) : null),
            save: async (x: PartyState) => {
              saved[role] = structuredClone(x);
            },
          },
      resendMs: 20,
      resendMaxMs: 100,
      onIgnored: (reason: string) => ignored[role].push(reason),
      ...extra,
  });
  for (const role of ROLES) {
    parties[role] = runParty(argsFor(role));
    running.push(parties[role]);
  }
  await Promise.all(ROLES.map((r) => parties[r].ready()));
  /** A new mod party on the same sealed store (the moderation service restarted). */
  const restartMod = async (): Promise<PartyHandle> => {
    await parties.mod.stop();
    const mod = runParty(argsFor('mod'));
    running.push(mod);
    return mod;
  };
  return { parties, ignored, saved, modStore, restartMod, argsFor };
}

const minimums = sweepMinimums({ kind: 'release', terms: TERMS, feeWallet: FEE_WALLET, payrollWallet: PAYROLL_WALLET, sweptAtomic: 1n })!;
const release: Outcome = { kind: 'release', to: minimums, builder: 'seller', cosigner: 'buyer' };

/** The watcher's proof of the sweep over the real mod party's funds (null: `sweep-unproven`). */
async function proof(mod: PartyHandle, logs: string[]) {
  return spendEvidence(await mod.funds(), newWatchState(), {
    settleKind: 'release',
    terms: TERMS,
    feeWallet: FEE_WALLET,
    payrollWallet: PAYROLL_WALLET,
    prove: (h, k, m) => mod.proveSweep!(h, k, m),
    log: (e) => logs.push(e.reason),
  });
}

const proofsOf = async (mod: PartyHandle) => [...((await mod.funds()).spendProofs ?? [])].map((p) => [p.from, p.txHash]).sort();

describe('a seller-built release both traders signed and that is mined settles (P0, 8 Nov)', () => {
  it('both traders name the mined release with spend.info, the watcher proves it, and the seller leaves "signing"', async () => {
    const chain = fakeChain();
    const { parties, saved, modStore } = await trade(chain);
    chain.fund(minimums.reduce((s, p) => s + p.amountAtomic, 0n));
    chain.mine(10);
    const sellerDone = parties.seller.settle(release);
    expect(await parties.buyer.settle(release)).toBe(SWEEP_HASH);
    chain.mine(1);
    const logs: string[] = [];
    await expect.poll(async () => (await proof(parties.mod, logs))?.txHash ?? null, { timeout: 5000, interval: 50 }).toBe(SWEEP_HASH);
    expect((await parties.mod.funds()).ownTxs).toEqual([]); // shown only through the imports
    expect(await proofsOf(parties.mod)).toEqual([['buyer', SWEEP_HASH], ['seller', SWEEP_HASH]]);
    await expect(sellerDone).resolves.toBeNull();
    expect(saved.seller!.release!.phase).toBe('done');
    // The mod's sealed state holds the shown sweep and both statements (it saved, and stayed alive).
    const modSaved = await modStore.load();
    expect(modSaved!.shown?.map((x) => x.txHash)).toEqual([SWEEP_HASH]);
    expect(Object.keys(modSaved!.received['spend.info:0'] ?? {}).sort()).toEqual(['buyer', 'seller']);
  });

  it("while the builder cannot confirm its release in a block (the demo's broken daemon lookup), nothing is counted on the buyer's word; once it can, the release settles", async () => {
    const chain = fakeChain();
    const { parties, ignored, saved } = await trade(chain);
    chain.fund(minimums.reduce((s, p) => s + p.amountAtomic, 0n));
    chain.mine(10);
    chain.daemonDown.add('seller');
    let sellerSettled = false;
    const sellerDone = parties.seller.settle(release).then((v) => {
      sellerSettled = true;
      return v;
    });
    expect(await parties.buyer.settle(release)).toBe(SWEEP_HASH);
    chain.mine(1);
    // The demo: the buyer's spend.info reached the mod, whose wallet shows the mined sweep; the
    // seller sits in 'built' retrying its lookup and sends nothing, so every pass is sweep-unproven.
    await expect.poll(() => proofsOf(parties.mod), { timeout: 5000, interval: 50 }).toEqual([['buyer', SWEEP_HASH]]);
    await expect.poll(() => ignored.seller.includes('daemon-unavailable'), { timeout: 5000 }).toBe(true);
    const logs: string[] = [];
    for (let i = 0; i < 5; i++) {
      expect(await proof(parties.mod, logs)).toBeNull();
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(logs.every((l) => l === 'sweep-unproven')).toBe(true);
    expect(saved.seller!.release!.phase).toBe('built');
    expect(saved.seller!.sent['spend.info:0']).toBeUndefined();
    expect(sellerSettled).toBe(false);
    // The lookup works again (the fix): the seller confirms its release, names it, and it settles.
    chain.daemonDown.delete('seller');
    await expect.poll(async () => (await proof(parties.mod, []))?.txHash ?? null, { timeout: 5000, interval: 50 }).toBe(SWEEP_HASH);
    await expect(sellerDone).resolves.toBeNull();
  });

  it('a builder lookup that never answers is given up and retried on a later tick, never blocking the loop; it settles once the daemon answers', async () => {
    const chain = fakeChain();
    const { parties, ignored, saved } = await trade(chain, { daemonTimeoutMs: 150 });
    chain.fund(minimums.reduce((s, p) => s + p.amountAtomic, 0n));
    chain.mine(10);
    chain.daemonHang.add('seller');
    let sellerSettled = false;
    const sellerDone = parties.seller.settle(release).then((v) => {
      sellerSettled = true;
      return v;
    });
    expect(await parties.buyer.settle(release)).toBe(SWEEP_HASH);
    chain.mine(1);
    // The seller's lookup hangs: each one is given up as 'daemon-unavailable' and a later tick asks
    // again (more than one lookup was started), so the loop never sits behind one that never returns.
    await expect.poll(() => chain.lookups.seller, { timeout: 5000, interval: 20 }).toBeGreaterThan(2);
    expect(ignored.seller).toContain('daemon-unavailable');
    // Meanwhile the seller's party still serves its other calls (funds() runs on the same chain).
    await expect(parties.seller.funds()).resolves.toMatchObject({ balance: 0n });
    const logs: string[] = [];
    expect(await proof(parties.mod, logs)).toBeNull();
    expect(logs).toEqual(['sweep-unproven']);
    expect(saved.seller!.release!.phase).toBe('built');
    expect(saved.seller!.sent['spend.info:0']).toBeUndefined();
    expect(sellerSettled).toBe(false);
    // The daemon answers again: the next lookup sees the release in a block and it settles.
    chain.daemonHang.delete('seller');
    await expect.poll(async () => (await proof(parties.mod, []))?.txHash ?? null, { timeout: 5000, interval: 50 }).toBe(SWEEP_HASH);
    await expect(sellerDone).resolves.toBeNull();
  });

  it("the mod's shown sweep reloads from the sealed store with the same amount, and a malformed one is bad-state (review L2)", async () => {
    const chain = fakeChain();
    const { parties, modStore, restartMod, argsFor } = await trade(chain);
    chain.fund(minimums.reduce((s, p) => s + p.amountAtomic, 0n));
    chain.mine(10);
    const sellerDone = parties.seller.settle(release);
    expect(await parties.buyer.settle(release)).toBe(SWEEP_HASH);
    chain.mine(1);
    await expect.poll(async () => (await proof(parties.mod, []))?.txHash ?? null, { timeout: 5000, interval: 50 }).toBe(SWEEP_HASH);
    await expect(sellerDone).resolves.toBeNull();
    const before = (await parties.mod.funds()).outgoing!.find((o) => o.txHash === SWEEP_HASH)!;
    expect(typeof before.spentAtomic).toBe('bigint');

    // The moderation service restarts: the new party reads `shown` back from the sealed JSON.
    chain.shows.mod = false; // its wallet no longer shows the sweep: only the saved record does
    const mod = await restartMod();
    const after = (await mod.funds()).outgoing!.find((o) => o.txHash === SWEEP_HASH)!;
    expect(after).toEqual(before);
    expect(after.spentAtomic).toBe(before.spentAtomic);
    expect(typeof after.spentAtomic).toBe('bigint');

    // A malformed record is never read as an amount or a tx: the party refuses its state.
    const good = (await modStore.load())!;
    const bad = [
      { spentAtomic: '0x10' }, { spentAtomic: '' }, { spentAtomic: ' 10' }, { spentAtomic: '010' }, { spentAtomic: '-1' }, { spentAtomic: 10 },
      { txHash: SWEEP_HASH.toUpperCase() }, { txHash: 'f'.repeat(63) },
      { height: 1.5 }, { height: -1 }, { height: '101' }, { height: null },
    ];
    await mod.stop();
    for (const change of bad) {
      await modStore.save({ ...good, shown: [{ ...good.shown![0]!, ...change }] } as unknown as PartyState);
      const again = runParty(argsFor('mod'));
      running.push(again);
      await expect(again.ready(), JSON.stringify(change)).rejects.toMatchObject({ code: 'bad-state' });
      await again.stop();
    }
    // The good record still loads.
    await modStore.save(good);
    const ok = runParty(argsFor('mod'));
    running.push(ok);
    expect((await ok.funds()).outgoing!.find((o) => o.txHash === SWEEP_HASH)).toEqual(before);
  });
});
