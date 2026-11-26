// Plan 4 Task 14 on regtest: a whole dispute's payout, end to end, on a real chain. A moderator
// proposes "release to buyer" on a trade above the large-trade limit and the owner approves it, each
// with a real WebAuthn tap; the moderation process's gate authorises the ruling against its own
// pinned registry and recorded terms; the executor hands the gate's payouts to the moderator's real
// escrow party (`builder: 'mod'`), the buyer's party co-signs as its app would (Task 15), and the
// buyer and the fee wallet are paid on regtest. Exactly once: a restarted executor settles nothing.
// The chain, wallets, multisig engine and all three parties are real; the relay is the in-memory one
// (test/chain.ts): apps/moderation may not load @x2f/relay, tests included (separation check P3-C1).
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLES, networkFeeShares, type Role } from '@x2f/core';
import { MoneroMultisigEngine, runParty, type PartyHandle, type PartyState, type PartyStore } from '@x2f/escrow';
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDispute, newDispute } from '@x2f/staff';
import { apply, fiatCents, newTrade, verifyRulingStatement, type RulingStatement } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { rulingExecutor } from '../../src/execute.js';
import { ownSweepKind } from '../../src/watcher.js';
import { memoryRelay } from '../chain.js';
import { openGateStore } from '../../src/gate/index.js';
import { BALANCE, ctx, newGate, recorded, ruling, tapBy, world } from '../gateWorld.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
/** The most a network fee may take (Plan 1's MAX_NETWORK_FEE is 0.01 XMR). */
const MAX_NET_FEE = 10_000_000_000n;

function memoryStore(): PartyStore {
  let s: PartyState | null = null;
  return {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
    },
  };
}

describe('a ruling paid out on regtest (Plan 4 Task 14)', () => {
  let node: Regtest;
  let funder: MoneroWalletFull;
  const running: PartyHandle[] = [];
  const wallets: MoneroWalletFull[] = [];
  const dirs: string[] = [];

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
  });

  afterAll(async () => {
    for (const p of running.splice(0)) await p.stop();
    for (const w of wallets.splice(0)) await w.close();
    await funder?.close();
    await node?.stop();
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  /** Keeps mining while `p` runs: the builder counts a release done only once it is in a block. */
  async function mining<T>(p: Promise<T>): Promise<T> {
    let done = false;
    const address = await funder.getPrimaryAddress();
    const miner = (async () => {
      while (!done) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!done) await mine(node.rpcUri, 1, address).catch(() => undefined);
      }
    })();
    try {
      return await p;
    } finally {
      done = true;
      await miner;
    }
  }

  async function balanceOf(w: MoneroWalletFull): Promise<bigint> {
    await w.setDaemonConnection({ uri: node.rpcUri });
    await w.sync();
    return w.getBalance();
  }

  it('propose, approve, gate, payout: the buyer and the fee wallet are paid, once', async () => {
    await payout('release-to-buyer');
  });

  // Review I9: the seller wins above the limit with two taps: the whole balance to the seller's
  // signed refund address, no fee (a full reversal), and the sweep reported as `dispute-seller`.
  it('seller wins: propose, approve, gate, payout: the whole balance goes to the seller\'s signed refund address, once', async () => {
    await payout('refund-to-seller');
  });

  // Review p4t22 N1: the moderator who ruled round 1 ("release to buyer") is removed before its
  // payout ran, and an uninvolved senior's appeal overturns it ("refund to seller"). Round 1 never
  // pays; the appeal does, from the gate reading round 1's signers from its taps (R37).
  it('review p4t22 N1: round 1 by a moderator removed before it paid; the appeal that overturns it pays the seller, once', async () => {
    await payout('refund-to-seller', { removedRound1: true });
  });

  async function payout(outcome: 'release-to-buyer' | 'refund-to-seller', o: { removedRound1?: boolean } = {}): Promise<void> {
    const buyerWins = outcome === 'release-to-buyer';
    const winner = buyerWins ? 'buyer' : 'seller';
    // The staff and the ruling: a moderator proposes, the owner approves (the trade is above the gate's limit).
    // N1: under the limit, a moderator's round 1 on one tap, then removed; a senior's round 2 on one tap.
    const w = await world();
    const mod = w.hire('mod');
    let c = ruling(mod, o.removedRound1 ? { outcome: 'release-to-buyer' } : { approver: w.owner, outcome });
    const code = c.ruling.code;
    if (o.removedRound1) {
      w.api.taps.push(tapBy(mod, c.intent('propose')));
      const senior = w.hire('senior');
      const round1 = c.ruling;
      c = ruling(senior, { round: 2, round1Id: round1.id, code, outcome });
      w.api.taps.push(tapBy(senior, c.intent('propose')));
      w.api.rulings.set(code, { current: c.ruling, round1, involved: [] });
      const row = w.api.staffRows.get(mod.id)!;
      row.removed = true;
      row.switchedOff = true;
    } else {
      w.api.taps.push(tapBy(mod, c.intent('propose')), tapBy(w.owner, c.intent('approve')));
      w.api.rulings.set(code, { current: c.ruling, round1: null, involved: [] });
    }
    const dir = await mkdtemp(join(tmpdir(), 'x2f-exec-rt-'));
    dirs.push(dir);
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const store = await openGateStore(dir, key);
    store.state = w.gate;
    await store.save();

    // The escrow: three real parties, funded with the seller's whole deposit.
    const ids = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await generateIdentity()] as const))) as Record<Role, Identity>;
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    const relay = memoryRelay();
    const parties = Object.fromEntries(
      ROLES.map((role) => {
        const p = runParty({
          role,
          trade: code,
          me: ids[role],
          participants,
          transport: relay.transport(role),
          engine,
          daemonUri: node.rpcUri,
          password: `pw-${role}`,
          store: memoryStore(),
          resendMs: 500,
          resendMaxMs: 2000,
        });
        running.push(p);
        return [role, p] as const;
      }),
    ) as Record<Role, PartyHandle>;
    const addresses = await Promise.all(ROLES.map((r) => parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount: BALANCE, relay: true });
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());

    // This process's own recorded terms: the attested deal and the traders' addresses.
    const [buyerW, sellerW, feeW] = [await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri), await newTestWallet(node.rpcUri)];
    wallets.push(buyerW, sellerW, feeW);
    const terms = { ...recorded(o.removedRound1 ? 41_250n : 200_000n), buyerPayout: await buyerW.getPrimaryAddress(), sellerRefund: await sellerW.getPrimaryAddress(), feeWallet: await feeW.getPrimaryAddress() };

    // The executor's pass, on the funds the moderator's own party reads, until it hands the payout.
    // Haveno review finding 2: the moderation signing key signs the statement the winner's app verifies.
    await sodium.ready;
    const modKey = sodium.crypto_sign_keypair();
    const statements: Array<{ statement: RulingStatement; sig: string }> = [];
    const exec = rulingExecutor({ store, source: w.api, ctx: ctx(), log: () => {}, signingSecret: modKey.privateKey });
    const pass = async () => {
      const f = await parties.mod.funds();
      return exec.step({
        code, handle: parties.mod, api: { state: 'disputed', paused: false }, funds: { balance: f.balance, unlocked: f.unlocked }, recorded: terms,
        escrowAddress: addresses[0]!, announce: async (r) => (statements.push(r), true),
      });
    };
    await expect.poll(pass, { timeout: 120_000, interval: 2000 }).toBe('handed');
    const ex = store.state.executions[code]!;
    expect(ex).toMatchObject({ rulingId: c.ruling.id, winner, settledAt: null });
    // A buyer ruling: the winner's app co-signs the list `payoutsFor('dispute-buyer')` gives (apps/web
    // policy.ts), the gate's own: both outputs bear the network fee (owner 16 Nov), and the mark is in
    // the outcome digest, so the buyer's outcome carries it as the moderator's does. A seller ruling's
    // one refund output is unmarked and bears all of it, as before.
    const to = ex.payouts.map((p) => ({ address: p.address, amountAtomic: BigInt(p.amountAtomic), ...(buyerWins ? { bearsNetworkFee: true } : {}) }));
    if (buyerWins) expect(to.map((p) => p.address)).toEqual([terms.buyerPayout, terms.feeWallet]);
    else expect(to).toEqual([{ address: terms.sellerRefund, amountAtomic: BALANCE }]);

    // The winner's app checks the signed statement against its own trade, escrow and payouts first.
    const st = statements.at(-1)!;
    // N1: the statement names round 2's ruling; round 1 was read for its signers only, never authorised.
    if (o.removedRound1) {
      expect(st.statement).toMatchObject({ round: 2, rulingId: c.ruling.id, winner });
      expect(Object.values(store.state.rulingsSeen).find((x) => x.round === 1)).toMatchObject({ signersOnly: true, signers: [mod.id] });
    }
    expect((await verifyRulingStatement(st.statement, st.sig, sodium.to_hex(modKey.publicKey), { trade: code, escrowAddress: addresses[0]!, winner, payouts: to })).ok).toBe(true);
    // The winner's app co-signs exactly that mod-built set (Task 15's cosignPolicy); the tx lands.
    const tx = await mining(parties[winner].settle({ kind: 'release', to, builder: 'mod', cosigner: winner }));
    expect(tx).toMatch(/^[0-9a-f]{64}$/);
    await mining(expect.poll(() => store.state.executions[code]?.settledAt ?? null, { timeout: 120_000, interval: 1000 }).not.toBeNull());
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    if (buyerWins) {
      // Owner 16 Nov: the buyer's output and the fee output share the network fee, wallet2's split
      // (`networkFeeShares`: the buyer, first in pay order, takes an odd unit).
      const feeShort = to[1]!.amountAtomic - (await balanceOf(feeW));
      const buyerShort = to[0]!.amountAtomic - (await balanceOf(buyerW));
      const networkFee = buyerShort + feeShort;
      expect(networkFee).toBeGreaterThan(0n);
      expect(networkFee).toBeLessThan(MAX_NET_FEE);
      expect([buyerShort, feeShort]).toEqual(networkFeeShares(networkFee, [true, true]));
      expect(await balanceOf(sellerW)).toBe(0n);
    } else {
      // A full reversal: nothing to the fee wallet or the buyer; the seller gets the balance less the network fee.
      expect(await balanceOf(feeW)).toBe(0n);
      expect(await balanceOf(buyerW)).toBe(0n);
      const got = await balanceOf(sellerW);
      expect(got).toBeLessThan(BALANCE);
      expect(got).toBeGreaterThan(BALANCE - MAX_NET_FEE);
    }

    // The end states (R-M2): the moderator's own party shows the sweep as its own tx, the watcher's
    // report names the ruling's kind, and on that report the trade machine releases the trade and the
    // dispute machine records the execution (closed once the appeal window ends, A1 dropped).
    const after = await parties.mod.funds();
    expect(after.balance).toBe(0n);
    expect(after.ownTxs).toContain(tx);
    const kind = ownSweepKind(parties.mod.committedBuilder?.() ?? null, exec.kindFor(code));
    expect(kind).toBe(buyerWins ? 'dispute-buyer' : 'dispute-seller');
    const T0 = new Date('2026-11-12T10:00:00Z');
    const at = (min: number) => new Date(T0.getTime() + min * 60_000);
    const rate = { currency: 'USD', centsPerXmr: 80_000n };
    let t = newTrade({ code, offerId: 'o', poster: 'seller', sellerId: 's', buyerId: 'b', methodId: 'ZELLE', amountAtomic: terms.amountAtomic, lockedRate: rate, confirmWindowMin: 120, minFiatCents: 1n, maxFiatCents: 10_000_000n }, T0);
    t = apply(t, { type: 'setup-done', escrowAddress: addresses[0]! }, 'system', at(1));
    t = apply(t, { type: 'chain', receivedAtomic: BALANCE, unlockedAtomic: BALANCE, confirmations: 10 }, 'system', at(10));
    t = apply(t, { type: 'mark-paid', fiatCents: fiatCents(terms.amountAtomic, rate) }, 'buyer', at(20));
    t = apply(t, { type: 'open-dispute' }, 'buyer', at(200));
    expect(t.state).toBe('disputed');
    t = apply(t, { type: 'settled', kind: kind!, txHash: tx! }, 'system', at(300));
    expect(t).toMatchObject({ state: buyerWins ? 'released' : 'refunded', txHash: tx, settling: null });
    if (o.removedRound1) {
      // Once: a restarted executor (the gate reopened from disk) settles nothing more.
      expect(await pass()).toBe('settled');
      const again = rulingExecutor({ store: await openGateStore(dir, key), source: w.api, ctx: ctx(), log: () => {}, signingSecret: modKey.privateKey });
      const asked: unknown[] = [];
      expect(await again.step({ code, handle: { settle: async (x) => (asked.push(x), null) }, api: { state: 'disputed', paused: false }, funds: { balance: BALANCE, unlocked: BALANCE }, recorded: terms, escrowAddress: addresses[0]!, announce: async () => true })).toBe('settled');
      expect(asked).toEqual([]);
      return;
    }
    const S = { appealWindowH: 48, firstResponseH: 4 };
    const modActor = { kind: 'staff' as const, id: mod.id, role: 'mod' as const };
    const ownerActor = { kind: 'staff' as const, id: w.owner.id, role: 'owner' as const };
    let d = newDispute({ code, openedBy: 'buyer', afterRefund: false, usdCents: 200_000n, limitUsdCents: 100_000n, firstResponseH: 4, now: at(200) });
    d = applyDispute(d, { type: 'assign', staffId: mod.id, role: 'mod' }, modActor, at(210), S);
    d = applyDispute(d, { type: 'propose', gate: { usdCents: d.usdCents, limitUsdCents: d.limitUsdCents }, ruling: { id: c.ruling.id, outcome, accountAction: { kind: 'none' }, proposer: mod.id } }, modActor, at(220), S);
    d = applyDispute(d, { type: 'approve' }, ownerActor, at(230), S);
    expect(d.status).toBe('published');
    d = applyDispute(d, { type: 'executed', round: 1 }, { kind: 'system' }, at(300), S);
    expect(d).toMatchObject({ status: 'published', executedAt: at(300) });
    d = applyDispute(d, { type: 'window-closed' }, { kind: 'system' }, new Date(d.appealEndsAt!.getTime() + 1), S);
    expect(d.status).toBe('closed');

    // Once: this executor and a restarted one (the gate reopened from disk) settle nothing more.
    expect(await pass()).toBe('settled');
    const reopened = await openGateStore(dir, key);
    const restarted = rulingExecutor({ store: reopened, source: w.api, ctx: ctx(), log: () => {}, signingSecret: modKey.privateKey });
    const asked: unknown[] = [];
    expect(await restarted.step({ code, handle: { settle: async (o) => (asked.push(o), null) }, api: { state: 'disputed', paused: false }, funds: { balance: BALANCE, unlocked: BALANCE }, recorded: terms, escrowAddress: addresses[0]!, announce: async () => true })).toBe('settled');
    expect(asked).toEqual([]);
  }
});
