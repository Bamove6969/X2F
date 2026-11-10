// P0 of 8 Nov (local demo, real moderation service): a normal seller-built, buyer-co-signed release
// that is mined must be proven by the moderation watcher. The watcher counts a sweep the mod did not
// sign only once BOTH trade parties' sealed spend.info name it (R3-I1), and the builder sends its
// spend.info only once it saw its release in a block. Three real escrow parties (`runParty`) on a
// fake chain and an in-memory relay; the watcher's own proof (`spendEvidence`) over the real mod
// party's funds(). The cause on the demo (the builder's daemon lookup could never succeed in the
// web bundle) is fixed in packages/escrow monero.ts and tested there on regtest
// (web-bundle-http.test.ts); here: the whole path settles, and while the builder cannot confirm
// its release nothing is counted on the buyer's word alone.
import { newTradeCode, ROLES, type Role } from '@x2f/core';
import { runParty, type Outcome, type PartyHandle, type PartyState } from '@x2f/escrow';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { newWatchState, sweepMinimums } from '@x2f/trade';
import { afterEach, describe, expect, it } from 'vitest';
import { spendEvidence } from '../src/watcher.js';
import { fakeChain, memoryRelay, SWEEP_HASH, type FakeChain } from './chain.js';
import { FEE_WALLET, TERMS } from './harness.js';

const running: PartyHandle[] = [];
afterEach(async () => {
  for (const p of running.splice(0)) await p.stop();
});

async function trade(chain: FakeChain, extra: { daemonTimeoutMs?: number } = {}) {
  const relay = memoryRelay();
  const code = newTradeCode();
  const ids = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await generateIdentity()] as const))) as Record<Role, Identity>;
  const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const ignored: Record<Role, string[]> = { buyer: [], seller: [], mod: [] };
  const saved: Partial<Record<Role, PartyState>> = {};
  const parties = {} as Record<Role, PartyHandle>;
  for (const role of ROLES) {
    parties[role] = runParty({
      role,
      trade: code,
      me: ids[role],
      participants,
      transport: relay.transport(role),
      engine: chain.engine(role),
      daemonUri: 'http://node.test',
      password: `pw-${role}`,
      store: {
        load: async () => (saved[role] ? structuredClone(saved[role]) : null),
        save: async (x) => {
          saved[role] = structuredClone(x);
        },
      },
      resendMs: 20,
      resendMaxMs: 100,
      onIgnored: (reason) => ignored[role].push(reason),
      ...extra,
    });
    running.push(parties[role]);
  }
  await Promise.all(ROLES.map((r) => parties[r].ready()));
  return { parties, ignored, saved };
}

const minimums = sweepMinimums({ kind: 'release', terms: TERMS, feeWallet: FEE_WALLET, sweptAtomic: 1n })!;
const release: Outcome = { kind: 'release', to: minimums, builder: 'seller', cosigner: 'buyer' };

/** The watcher's proof of the sweep over the real mod party's funds (null: `sweep-unproven`). */
async function proof(mod: PartyHandle, logs: string[]) {
  return spendEvidence(await mod.funds(), newWatchState(), {
    settleKind: 'release',
    terms: TERMS,
    feeWallet: FEE_WALLET,
    prove: (h, k, m) => mod.proveSweep!(h, k, m),
    log: (e) => logs.push(e.reason),
  });
}

const proofsOf = async (mod: PartyHandle) => [...((await mod.funds()).spendProofs ?? [])].map((p) => [p.from, p.txHash]).sort();

describe('a seller-built release both traders signed and that is mined settles (P0, 8 Nov)', () => {
  it('both traders name the mined release with spend.info, the watcher proves it, and the seller leaves "signing"', async () => {
    const chain = fakeChain();
    const { parties, saved } = await trade(chain);
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
});
