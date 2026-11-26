// Plan 4 Task 14: the ruling executor. The moderation process settles a published round-1 escrow
// ruling exactly as the gate authorised it (`authorizeRuling` through `gateCheck`): the payouts the
// gate computed from this process's own recorded terms, mod-built for the winner to co-sign, once
// per trade, recorded in the sealed gate store before and after, across restarts. Nothing is handed
// to the party while the owner's tapped emergency stop holds or the API shows the trade paused for
// maintenance. Hermetic: the real gate on software authenticators (gateWorld.ts), a recording party.
// The same path on regtest with three real parties is execute.regtest.test.ts.
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseTag, type Outcome, type PartyHandle } from '@x2f/escrow';
import { escrowPlan, verifyRulingStatement, type RulingStatement } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { rulingExecutor, RULING_WAIT_REPORT_MS, RULING_WINNER_WAIT_MS, type RulingStepInput } from '../src/execute.js';
import { authorizeRuling, openGateStore, recordedTerms as gateRecordedTerms, syncRegistry, type GateStore } from '../src/gate/index.js';
import { BALANCE, ctx, newGate, newKey, recorded, resetSecurity, ruling, tapBy, tapOnNonce, world, type Case, type Person, type World } from './gateWorld.js';
import { DEAL, ESCROW, FEE_WALLET, FUNDS, PAYROLL_WALLET, fakeNetwork, inFunding, makeCtx, moderation, secured, stopAll, TERMS, type Ctx } from './harness.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** A party that records every settle(); each answers when the test resolves it. */
function recordingParty() {
  const settles: Outcome[] = [];
  const answers: Array<(tx: string | null) => void> = [];
  const handle: Pick<PartyHandle, 'settle'> = {
    settle: (o) => {
      settles.push(structuredClone(o));
      return new Promise<string | null>((resolve) => answers.push(resolve));
    },
  };
  return { handle, settles, answer: (tx: string | null) => answers.shift()?.(tx) };
}

interface Setup {
  w: World;
  c: Case;
  dir: string;
  key: Uint8Array;
  store: GateStore;
  /** The moderator who proposed the round-1 ruling (review p4t22 F1, finding A re-signs with their key). */
  signer: Person;
}

/** A pinned gate with a round-1 ruling by a moderator, its propose tap stored, the gate saved in a fresh dir. */
async function setup(o: { outcome?: 'release-to-buyer' | 'refund-to-seller' | 'seller-sends-xmr'; tap?: boolean } = {}): Promise<Setup> {
  const w = await world();
  const mod = w.hire('mod');
  const c = ruling(mod, { outcome: o.outcome ?? 'release-to-buyer' });
  if (o.tap !== false) w.api.taps.push(tapBy(mod, c.intent('propose')));
  w.api.rulings.set(c.ruling.code, { current: c.ruling, round1: null, involved: [] });
  const dir = await mkdtemp(join(tmpdir(), 'x2f-exec-'));
  dirs.push(dir);
  const key = new Uint8Array(randomBytes(32));
  await newGate(dir, key);
  const store = await openGateStore(dir, key);
  store.state = w.gate;
  await store.save();
  return { w, c, dir, key, store, signer: mod };
}

/** The moderation signing key (MOD_SIGNING_SECRET) the executor signs its ruling statements with. */
let modKey: { publicKey: Uint8Array; privateKey: Uint8Array };
beforeAll(async () => {
  await sodium.ready;
  modKey = sodium.crypto_sign_keypair();
});
/** Every ruling statement the executor announced to the API, in order (the API accepts each). */
const announced: Array<{ statement: RulingStatement; sig: string }> = [];
const accept = async (r: { statement: RulingStatement; sig: string }) => (announced.push(r), true);

const step = (s: Setup, handle: Pick<PartyHandle, 'settle' | 'peerRelease' | 'currentRelease'>, over: Partial<RulingStepInput> = {}): RulingStepInput => ({
  code: s.c.ruling.code,
  handle,
  api: { state: 'disputed', paused: false },
  funds: { balance: BALANCE, unlocked: BALANCE },
  recorded: recorded(41_250n),
  escrowAddress: ESCROW,
  announce: accept,
  ...over,
});

const executor = (s: Setup, store: GateStore = s.store, logs: string[] = []) =>
  rulingExecutor({ store, source: s.w.api, ctx: ctx(), log: (e) => logs.push(e.reason), signingSecret: modKey.privateKey });

/** What the gate itself says may be co-signed for this case (a fresh copy of the gate, so the store is untouched). */
async function authorised(s: Setup) {
  // As gateCheck does: the registry synced first (the hired moderator is known only after a sync).
  const g = structuredClone(s.store.state);
  await syncRegistry(s.w.api, g, ctx());
  const a = await authorizeRuling(g, { ruling: s.c.ruling, taps: await s.w.api.rulingTaps(s.c.ruling.id), recorded: recorded(41_250n), balanceAtomic: BALANCE }, ctx());
  if (!a.ok || a.settle === null) throw new Error('fixture: the gate must authorise this case');
  return a.settle;
}

describe('the ruling executor (Plan 4 Task 14)', () => {
  it('settles exactly what the gate authorised, mod-built for the winner, recorded before the party is asked, once', async () => {
    const s = await setup();
    const want = await authorised(s);
    expect(want.winner).toBe('buyer');
    const p = recordingParty();
    let recordedFirst: unknown = 'not checked';
    const handle: Pick<PartyHandle, 'settle'> = {
      settle: (o) => {
        // The sealed gate on disk already names this payout when the party is first asked.
        recordedFirst = openGateStore(s.dir, s.key).then((g) => g.state.executions[s.c.ruling.code] ?? null);
        return p.handle.settle(o);
      },
    };
    const exec = executor(s);
    expect(await exec.step(step(s, handle))).toBe('handed');
    expect(p.settles).toEqual([{ kind: 'release', to: want.payouts, builder: 'mod', cosigner: 'buyer' }]);
    expect(await recordedFirst).toMatchObject({
      rulingId: s.c.ruling.id,
      winner: 'buyer',
      payouts: want.payouts.map((x) => ({ address: x.address, amountAtomic: x.amountAtomic.toString() })),
      settledAt: null,
      settledTx: null,
    });
    // While it is in flight, another pass hands nothing more.
    expect(await exec.step(step(s, handle))).toBe('in-flight');
    expect(p.settles).toHaveLength(1);
    // The party finished (as the builder its settle() resolves; the co-signer submits, so the hash
    // may be null): recorded after, and never settled again, in this process or after a restart.
    p.answer(null);
    // On disk (the sealed gate.bin), not only in memory.
    await expect.poll(async () => (await openGateStore(s.dir, s.key)).state.executions[s.c.ruling.code]?.settledAt ?? null).not.toBeNull();
    expect(await exec.step(step(s, handle))).toBe('settled');
    const reopened = await openGateStore(s.dir, s.key);
    const again = recordingParty();
    expect(await executor(s, reopened).step(step(s, again.handle))).toBe('settled');
    expect(again.settles).toEqual([]);
  });

  it('names the kind of a recorded payout for the watcher (R-M2), from the gate store only', async () => {
    const s = await setup({ outcome: 'refund-to-seller' });
    const p = recordingParty();
    const exec = executor(s);
    expect(exec.kindFor(s.c.ruling.code)).toBeNull();
    expect(await exec.step(step(s, p.handle))).toBe('handed');
    expect(exec.kindFor(s.c.ruling.code)).toBe('dispute-seller');
    expect(executor(s, await openGateStore(s.dir, s.key)).kindFor(s.c.ruling.code)).toBe('dispute-seller');
    expect(exec.kindFor('ABCD2345EFGH6789')).toBeNull();
  });

  it('a restart before the payout finished hands the party the same outcome again, and nothing else', async () => {
    const s = await setup();
    const first = recordingParty();
    expect(await executor(s).step(step(s, first.handle))).toBe('handed');
    // The process dies with the payout in flight; a new one opens the gate from disk.
    const store = await openGateStore(s.dir, s.key);
    const second = recordingParty();
    expect(await executor(s, store).step(step(s, second.handle))).toBe('handed');
    expect(second.settles).toEqual(first.settles);
    // A balance that changed since the payout was recorded (a late surplus) is never re-derived into another payout.
    const third = recordingParty();
    const logs: string[] = [];
    expect(await executor(s, await openGateStore(s.dir, s.key), logs).step(step(s, third.handle, { funds: { balance: BALANCE + 5n, unlocked: BALANCE + 5n } }))).toBe('mismatch');
    expect(third.settles).toEqual([]);
    expect(logs).toContain('ruling-execution-mismatch');
  });

  it('hands nothing while the owner has tapped the emergency stop, or the API shows the trade paused for maintenance', async () => {
    const s = await setup();
    const p = recordingParty();
    const exec = executor(s);
    expect(await exec.step(step(s, p.handle, { api: { state: 'disputed', paused: true } }))).toBe('paused');
    s.w.api.taps.push(tapBy(s.w.owner, { kind: 'emergency-stop' }));
    expect(await exec.step(step(s, p.handle))).toBe('refused-stopped');
    expect(p.settles).toEqual([]);
    expect(s.store.state.executions[s.c.ruling.code]).toBeUndefined();
  });

  it('settles nothing the gate did not authorise, nothing after a refund, and nothing outside a dispute', async () => {
    const untapped = await setup({ tap: false });
    const p = recordingParty();
    expect(await executor(untapped).step(step(untapped, p.handle))).toMatch(/^refused-/);
    // Above the gate's own limit with one person only.
    const big = await setup();
    expect(await executor(big).step(step(big, p.handle, { recorded: recorded(500_000n) }))).toBe('refused-needs-second');
    const afterRefund = await setup({ outcome: 'seller-sends-xmr' });
    expect(await executor(afterRefund).step(step(afterRefund, p.handle))).toBe('none');
    const s = await setup();
    const exec = executor(s);
    expect(await exec.step(step(s, p.handle, { api: { state: 'settling', paused: false } }))).toBe('none');
    expect(await exec.step(step(s, p.handle, { recorded: null }))).toBe('no-terms');
    expect(await exec.step(step(s, p.handle, { funds: { balance: BALANCE, unlocked: 0n } }))).toBe('waiting-funds');
    expect(await exec.step(step(s, p.handle, { funds: { balance: 0n, unlocked: 0n } }))).toBe('waiting-funds');
    expect(p.settles).toEqual([]);
  });

  it('while an appeal is pending, round 1 still pays from its own ruling, once (Note 2026-10-30 M3)', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    // Pending: the API has no decided round-2 ruling to give (current null), round 1 kept whole.
    s.w.api.rulings.set(s.c.ruling.code, { current: null, round1: s.c.ruling, involved: [] });
    const want = await authorised({ ...s, c: s.c });
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    expect(p.settles).toEqual([{ kind: 'release', to: want.payouts, builder: 'mod', cosigner: 'buyer' }]);
  });
});

describe('the ruling statement (Haveno review 2026-11-12, finding 2; lead call)', () => {
  it('before the party is asked, the moderator signs the payout it worked out, bound to the trade, the escrow and round 1, and the API took it', async () => {
    const s = await setup();
    const want = await authorised(s);
    const order: string[] = [];
    const announce = async (r: { statement: RulingStatement; sig: string }) => (order.push('announce'), announced.push(r), true);
    const handle: Pick<PartyHandle, 'settle'> = { settle: () => (order.push('settle'), new Promise<string | null>(() => {})) };
    expect(await executor(s).step(step(s, handle, { announce }))).toBe('handed');
    expect(order).toEqual(['announce', 'settle']);
    const { statement, sig } = announced.at(-1)!;
    const check = await verifyRulingStatement(statement, sig, sodium.to_hex(modKey.publicKey), { trade: s.c.ruling.code, escrowAddress: ESCROW, winner: 'buyer', payouts: want.payouts });
    expect(check.ok).toBe(true);
    expect(statement).toMatchObject({ v: 1, trade: s.c.ruling.code, escrowAddress: ESCROW, round: 1, rulingId: s.c.ruling.id, outcome: 'release-to-buyer', winner: 'buyer' });
    // The same statement after a restart (issued at the recorded payout's time): never a second, different one.
    const again: Array<{ statement: RulingStatement; sig: string }> = [];
    const second = await openGateStore(s.dir, s.key);
    expect(await executor(s, second).step(step(s, recordingParty().handle, { announce: async (r) => (again.push(r), true) }))).toBe('handed');
    expect(again).toEqual([{ statement, sig }]);
  });

  it('an announcement the API refuses hands nothing; the next pass that is accepted pays', async () => {
    const s = await setup();
    const p = recordingParty();
    const exec = executor(s);
    expect(await exec.step(step(s, p.handle, { announce: async () => false }))).toBe('announce-failed');
    expect(await exec.step(step(s, p.handle, { announce: async () => Promise.reject(new Error('down')) }))).toBe('announce-failed');
    expect(p.settles).toEqual([]);
    expect(await exec.step(step(s, p.handle))).toBe('handed');
    expect(p.settles).toHaveLength(1);
  });

  it('without the escrow address this process recorded, nothing is signed or handed', async () => {
    const s = await setup();
    const p = recordingParty();
    const seen: unknown[] = [];
    expect(await executor(s).step(step(s, p.handle, { escrowAddress: null, announce: async (r) => (seen.push(r), true) }))).toBe('no-escrow');
    expect(seen).toEqual([]);
    expect(p.settles).toEqual([]);
  });
});

describe('the watcher hands each disputed trade to the executor', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await makeCtx();
  });
  afterEach(stopAll);
  afterAll(async () => {
    await c.db.end();
  });

  it('with this process\'s own recorded terms (the attested deal and addresses), the funds the party read and the API item', async () => {
    const { net, fetch } = fakeNetwork(c);
    const seen: Array<Omit<RulingStepInput, 'handle'>> = [];
    const m = await moderation(c, fetch, { rulings: { step: async ({ handle: _h, ...rest }) => (seen.push(rest), 'none'), kindFor: () => null } });
    const l = await inFunding(c, m, net);
    await secured(c, l);
    net.states.set(l.code, 'disputed');
    await m.handle.watch();
    const mine = seen.filter((x) => x.code === l.code && x.api.state === 'disputed');
    expect(mine.length).toBeGreaterThan(0);
    const last = mine.at(-1)!;
    expect(last.funds).toEqual({ balance: FUNDS, unlocked: FUNDS });
    // Haveno finding 2: the escrow address this process recorded at setup, and an announcement over its own signed link.
    expect(last.escrowAddress).toBe(ESCROW);
    const statement = { v: 1, trade: l.code } as unknown as RulingStatement;
    await last.announce({ statement, sig: 'ab' });
    expect(net.reports.filter((r) => r.kind === 'ruling-statement')).toEqual([{ kind: 'ruling-statement', trade: l.code, statement, sig: 'ab' }]);
    // Ruling-winner reasons (lead 22 Nov): why the payout waits goes to the API over the same link, for staff.
    expect(await last.reportWait!('winner-committed')).toBe(true);
    expect(await last.reportWait!(null)).toBe(true);
    expect(net.reports.filter((r) => r.kind === 'ruling-wait')).toEqual([
      { kind: 'ruling-wait', trade: l.code, reason: 'winner-committed' },
      { kind: 'ruling-wait', trade: l.code, reason: null },
    ]);
    expect(last.recorded).toEqual(
      gateRecordedTerms({
        terms: TERMS,
        trade: { amountAtomic: DEAL.takeAmountAtomic, feeAtomic: escrowPlan({ amountAtomic: DEAL.takeAmountAtomic, poster: 'seller' }).feeAtomic, sellerFundsAtomic: FUNDS, poster: 'seller' },
        feeWallet: FEE_WALLET,
        payrollWallet: PAYROLL_WALLET,
      }),
    );
  });
  it('review M4: a mod-built sweep with no executor record is named by nothing (null), never by the desk or the API', async () => {
    const { net, fetch } = fakeNetwork(c);
    const m = await moderation(c, fetch, { rulings: { step: async () => 'none', kindFor: () => null } });
    const l = await inFunding(c, m, net);
    await secured(c, l);
    net.states.set(l.code, 'disputed');
    // The API (or a stale desk) would call it the seller's cancel refund.
    net.settleKinds.set(l.code, 'auto-refund');
    l.party.committed = true;
    l.party.settles.push({ kind: 'release', to: [{ address: TERMS.buyerPayout, amountAtomic: FUNDS }], builder: 'mod', cosigner: 'buyer' });
    const tx = '8'.repeat(64);
    l.party.funds = { ...l.party.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: tx, height: 90, spentAtomic: FUNDS }], ownTxs: [tx] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === l.code)).toEqual([{ kind: 'settled', trade: l.code, txHash: tx, settleKind: null }]);
  });

  it("review M5: the executor hands nothing while the desk's armed refund is not blocked; once it is blocked, it pays", async () => {
    const s = await setup();
    const p = recordingParty();
    const exec = executor(s);
    expect(await exec.step(step(s, p.handle, { deskArmed: { kind: 'auto-refund', blocked: null } }))).toBe('desk-armed');
    expect(p.settles).toEqual([]);
    expect(s.store.state.executions[s.c.ruling.code]).toBeUndefined();
    expect(await exec.step(step(s, p.handle, { deskArmed: { kind: 'auto-refund', blocked: 'auto-refund-api-disputed' } }))).toBe('handed');
    expect(p.settles).toHaveLength(1);
  });

  it("reports the ruling's own sweep with the ruling's kind (R-M2): the payout the executor recorded names it, never the API", async () => {
    const { net, fetch } = fakeNetwork(c);
    const m = await moderation(c, fetch, { rulings: { step: async () => 'none', kindFor: () => 'dispute-buyer' } });
    const l = await inFunding(c, m, net);
    await secured(c, l);
    net.states.set(l.code, 'disputed');
    // The moderator's party built the ruling's release and saw it done: its own tx empties the escrow.
    l.party.committed = true;
    l.party.settles.push({ kind: 'release', to: [{ address: TERMS.buyerPayout, amountAtomic: FUNDS }], builder: 'mod', cosigner: 'buyer' });
    const tx = '7'.repeat(64);
    l.party.funds = { ...l.party.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: tx, height: 90, spentAtomic: FUNDS }], ownTxs: [tx] };
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === l.code)).toEqual([{ kind: 'settled', trade: l.code, txHash: tx, settleKind: 'dispute-buyer' }]);
  });
});

/**
 * Ruling-winner reasons (lead 22 Nov; review-lead-fix-ruling-pay builder's question 1): a winner whose
 * party is committed to another outcome never exports for the mod-built ruling set, and the payout
 * waited at `ruling-signing` with no reason. Once the winner has not taken part for the set time, the
 * executor says why, from its own party's view only (`peerRelease`: the winner's own signed release
 * messages), logs it, and reports it for the staff case view. What the moderator signs is unchanged.
 */
describe('why a ruling payout waits on its winner (ruling-winner-committed / -offline)', () => {
  type View = ReturnType<NonNullable<PartyHandle['peerRelease']>>;
  /** A recording party whose peerRelease the test sets; every view asked is recorded with its role. */
  function viewingParty(view: View) {
    const p = recordingParty();
    const asked: string[] = [];
    const v = { now: view };
    const handle: Pick<PartyHandle, 'settle' | 'peerRelease'> = { settle: p.handle.settle, peerRelease: (from) => (asked.push(from), structuredClone(v.now)) };
    return { ...p, handle, asked, set: (x: View) => (v.now = x) };
  }
  const reporter = (answer = true) => {
    const sent: Array<string | null> = [];
    return { sent, reportWait: async (r: 'winner-committed' | 'winner-offline' | null) => (sent.push(r), answer) };
  };
  const waiting = (s: Setup, logs: string[], o: { waitMs?: number; at?: () => Date } = {}) =>
    rulingExecutor({ store: s.store, source: s.w.api, ctx: o.at ? { ...ctx(), now: o.at } : ctx(), log: (e) => logs.push(e.reason), signingSecret: modKey.privateKey, ...(o.waitMs !== undefined ? { winnerWaitMs: o.waitMs } : {}) });
  const COMMITTED: View = { current: false, elsewhere: { tag: '0123456789abcdef', txSet: true, at: 1 } };
  const SILENT: View = { current: false, elsewhere: null };

  it('a winner that sent the moderator a built set for another outcome is committed to it: logged and reported once', async () => {
    const s = await setup();
    const p = viewingParty(COMMITTED);
    const r = reporter();
    const logs: string[] = [];
    const exec = waiting(s, logs, { waitMs: 0 });
    expect(await exec.step(step(s, p.handle, { reportWait: r.reportWait }))).toBe('handed');
    expect(await exec.step(step(s, p.handle, { reportWait: r.reportWait }))).toBe('in-flight');
    expect(await exec.step(step(s, p.handle, { reportWait: r.reportWait }))).toBe('in-flight');
    expect(r.sent).toEqual(['winner-committed']);
    expect(logs.filter((x) => x.startsWith('ruling-winner-'))).toEqual(['ruling-winner-committed']);
    // The winner's view, never the loser's.
    expect(new Set(p.asked)).toEqual(new Set(['buyer']));
    // Nothing more or other was handed.
    expect(p.settles).toHaveLength(1);
    expect(p.settles[0]).toMatchObject({ builder: 'mod', cosigner: 'buyer' });
  });

  it("the seller's ruling asks the seller's view", async () => {
    const s = await setup({ outcome: 'refund-to-seller' });
    const p = viewingParty(SILENT);
    const r = reporter();
    const exec = waiting(s, [], { waitMs: 0 });
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    expect(new Set(p.asked)).toEqual(new Set(['seller']));
    expect(r.sent).toEqual(['winner-offline']);
  });

  it('a winner the moderator heard nothing from (or only an export for another outcome: not committed) is offline as far as it can tell', async () => {
    for (const view of [SILENT, { current: false, elsewhere: { tag: '0123456789abcdef', txSet: false, at: 1 } }] satisfies View[]) {
      const s = await setup();
      const p = viewingParty(view);
      const r = reporter();
      const logs: string[] = [];
      const exec = waiting(s, logs, { waitMs: 0 });
      await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
      await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
      expect(r.sent).toEqual(['winner-offline']);
      expect(logs).toContain('ruling-winner-offline');
    }
  });

  it('nothing before the set time (lead default one hour from the recorded payout), then the reason', async () => {
    const s = await setup();
    const p = viewingParty(COMMITTED);
    const r = reporter();
    let now = ctx().now();
    const exec = waiting(s, [], { at: () => now });
    const recordedAt = now;
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    now = new Date(recordedAt.getTime() + RULING_WINNER_WAIT_MS - 1);
    expect(await exec.step(step(s, p.handle, { reportWait: r.reportWait }))).toBe('in-flight');
    expect(r.sent).toEqual([]);
    now = new Date(recordedAt.getTime() + RULING_WINNER_WAIT_MS);
    expect(await exec.step(step(s, p.handle, { reportWait: r.reportWait }))).toBe('in-flight');
    expect(r.sent).toEqual(['winner-committed']);
    expect(RULING_WINNER_WAIT_MS).toBe(60 * 60_000);
  });

  it('once the winner takes part (its export for the ruling came), the reason is cleared, once; a change is reported again', async () => {
    const s = await setup();
    const p = viewingParty(SILENT);
    const r = reporter();
    const logs: string[] = [];
    const exec = waiting(s, logs, { waitMs: 0 });
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    p.set(COMMITTED);
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    p.set({ current: true, elsewhere: COMMITTED.elsewhere });
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    expect(r.sent).toEqual(['winner-offline', 'winner-committed', null]);
    expect(logs.filter((x) => x.startsWith('ruling-winner-'))).toEqual(['ruling-winner-offline', 'ruling-winner-committed', 'ruling-winner-joined']);
  });

  it('a report the API refused is sent again on the next pass', async () => {
    const s = await setup();
    const p = viewingParty(COMMITTED);
    const sent: Array<string | null> = [];
    let ok = false;
    const reportWait = async (x: 'winner-committed' | 'winner-offline' | null) => (sent.push(x), ok);
    const exec = waiting(s, [], { waitMs: 0 });
    await exec.step(step(s, p.handle, { reportWait }));
    await exec.step(step(s, p.handle, { reportWait }));
    ok = true;
    await exec.step(step(s, p.handle, { reportWait: async (x) => (sent.push(x), Promise.reject(new Error('down'))) }));
    await exec.step(step(s, p.handle, { reportWait }));
    await exec.step(step(s, p.handle, { reportWait }));
    expect(sent).toEqual(['winner-committed', 'winner-committed', 'winner-committed']);
  });

  it('review m2: a report that never answers does not hold the pass; it counts as refused and is sent again', async () => {
    const s = await setup();
    const p = viewingParty(COMMITTED);
    const sent: Array<string | null> = [];
    const exec = rulingExecutor({ store: s.store, source: s.w.api, ctx: ctx(), log: () => {}, signingSecret: modKey.privateKey, winnerWaitMs: 0, reportWaitMs: 50 });
    const hang = async (x: 'winner-committed' | 'winner-offline' | null) => (sent.push(x), new Promise<boolean>(() => {}));
    await exec.step(step(s, p.handle, { reportWait: hang }));
    const t0 = Date.now();
    expect(await exec.step(step(s, p.handle, { reportWait: hang }))).toBe('in-flight');
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(await exec.step(step(s, p.handle, { reportWait: hang }))).toBe('in-flight');
    expect(sent).toEqual(['winner-committed', 'winner-committed']);
    expect(RULING_WAIT_REPORT_MS).toBe(15_000);
  });

  it('a party without the read says nothing (it cannot tell), and nothing is said once the payout is settled', async () => {
    const s = await setup();
    const p = recordingParty();
    const r = reporter();
    const exec = waiting(s, [], { waitMs: 0 });
    await exec.step(step(s, p.handle, { reportWait: r.reportWait }));
    expect(await exec.step(step(s, p.handle, { reportWait: r.reportWait }))).toBe('in-flight');
    expect(r.sent).toEqual([]);
    const v = viewingParty(SILENT);
    const s2 = await setup();
    const exec2 = waiting(s2, [], { waitMs: 0 });
    await exec2.step(step(s2, v.handle, { reportWait: r.reportWait }));
    v.answer(null);
    await expect.poll(() => s2.store.state.executions[s2.c.ruling.code]?.settledAt ?? null).not.toBeNull();
    expect(await exec2.step(step(s2, v.handle, { reportWait: r.reportWait }))).toBe('settled');
    expect(r.sent).toEqual([]);
  });
});

describe('review p4t22 M1 (d): the gate refusal reaches the API, for the staff case view', () => {
  const reports = () => {
    const sent: Array<{ rulingId: string; reason: string | null }> = [];
    return { sent, reportRefusal: async (r: { rulingId: string; reason: string | null }) => (sent.push(r), true) };
  };

  it('a refusal is reported once per change; a pass the gate then allows clears it once', async () => {
    const s = await setup();
    const p = recordingParty();
    const exec = executor(s);
    const r = reports();
    // Above the gate's own limit with one person only: needs-second, said once.
    expect(await exec.step(step(s, p.handle, { recorded: recorded(500_000n), reportRefusal: r.reportRefusal }))).toBe('refused-needs-second');
    expect(await exec.step(step(s, p.handle, { recorded: recorded(500_000n), reportRefusal: r.reportRefusal }))).toBe('refused-needs-second');
    expect(r.sent).toEqual([{ rulingId: s.c.ruling.id, reason: 'needs-second' }]);
    // Under it, the gate allows the ruling: the refusal is cleared, once.
    expect(await exec.step(step(s, p.handle, { reportRefusal: r.reportRefusal }))).toBe('handed');
    expect(await exec.step(step(s, p.handle, { reportRefusal: r.reportRefusal }))).toBe('in-flight');
    expect(r.sent).toEqual([{ rulingId: s.c.ruling.id, reason: 'needs-second' }, { rulingId: s.c.ruling.id, reason: null }]);
  });

  it('residual (b): no recorded terms is reported (no-terms) like a refusal, once', async () => {
    const s = await setup();
    const p = recordingParty();
    const exec = executor(s);
    const r = reports();
    expect(await exec.step(step(s, p.handle, { recorded: null, reportRefusal: r.reportRefusal }))).toBe('no-terms');
    expect(await exec.step(step(s, p.handle, { recorded: null, reportRefusal: r.reportRefusal }))).toBe('no-terms');
    expect(r.sent).toEqual([{ rulingId: s.c.ruling.id, reason: 'no-terms' }]);
    expect(await exec.step(step(s, p.handle, { reportRefusal: r.reportRefusal }))).toBe('handed');
    expect(r.sent.at(-1)).toEqual({ rulingId: s.c.ruling.id, reason: null });
  });

  it('a refused report is sent again on the next pass; a different refusal is a change', async () => {
    const s = await setup();
    const p = recordingParty();
    const exec = executor(s);
    const sent: Array<string | null> = [];
    let ok = false;
    const reportRefusal = async (x: { reason: string | null }) => (sent.push(x.reason), ok);
    await exec.step(step(s, p.handle, { recorded: recorded(500_000n), reportRefusal }));
    ok = true;
    await exec.step(step(s, p.handle, { recorded: recorded(500_000n), reportRefusal }));
    await exec.step(step(s, p.handle, { recorded: recorded(500_000n), reportRefusal }));
    s.w.api.taps.push(tapBy(s.w.owner, { kind: 'emergency-stop' }));
    await exec.step(step(s, p.handle, { recorded: recorded(500_000n), reportRefusal }));
    expect(sent).toEqual(['needs-second', 'needs-second', 'stopped']);
    expect(p.settles).toEqual([]);
  });
});

describe('review p4t22 m1 (lead default, owner question OQ2): an appeal decided before round 1 paid', () => {
  /** Round 1 release-to-buyer by a moderator; round 2 decided by an uninvolved senior, its tap stored. */
  async function overturned(outcome: 'refund-to-seller' | 'release-to-buyer' = 'refund-to-seller') {
    const s = await setup({ outcome: 'release-to-buyer' });
    const senior = s.w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome });
    s.w.api.taps.push(tapBy(senior, r2.intent('propose')));
    s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [] });
    return { s, r2 };
  }

  it("round 2's outcome pays, never the round 1 it overturned; the statement names round 2", async () => {
    const { s, r2 } = await overturned();
    const p = recordingParty();
    const before = announced.length;
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    expect(p.settles).toHaveLength(1);
    expect(p.settles[0]).toMatchObject({ kind: 'release', builder: 'mod', cosigner: 'seller' });
    expect(s.store.state.executions[s.c.ruling.code]).toMatchObject({ rulingId: r2.ruling.id, winner: 'seller' });
    const st = announced.slice(before).at(-1)!.statement;
    expect(st).toMatchObject({ round: 2, rulingId: r2.ruling.id, outcome: 'refund-to-seller', winner: 'seller' });
    // Round 1 was authorised first (unpaid), so the gate's R37 checks know its signers.
    expect(Object.keys(s.store.state.rulingsSeen)).toEqual(expect.arrayContaining([s.c.ruling.id, r2.ruling.id]));
    expect(executor(s).kindFor(s.c.ruling.code)).toBe('dispute-seller');
  });

  it('a round-1 payout already recorded (handed before the appeal was decided) is carried on, never swapped', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    const p = recordingParty();
    const exec = executor(s);
    expect(await exec.step(step(s, p.handle))).toBe('handed');
    const senior = s.w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome: 'refund-to-seller' });
    s.w.api.taps.push(tapBy(senior, r2.intent('propose')));
    s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [] });
    expect(await exec.step(step(s, p.handle))).toBe('in-flight');
    // A restart: the record pins round 1's payout; round 1 is handed again, identical.
    const again = recordingParty();
    expect(await executor(s).step(step(s, again.handle))).toBe('handed');
    expect(again.settles).toEqual(p.settles);
    expect(s.store.state.executions[s.c.ruling.code]?.rulingId).toBe(s.c.ruling.id);
  });

  it('round 2 by someone involved in round 1 is refused (R37 now guards a payout), and reported', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    const senior = s.w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome: 'refund-to-seller' });
    s.w.api.taps.push(tapBy(senior, r2.intent('propose')));
    s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [senior.id] });
    const p = recordingParty();
    const sent: Array<{ rulingId: string; reason: string | null }> = [];
    expect(await executor(s).step(step(s, p.handle, { reportRefusal: async (r) => (sent.push(r), true) }))).toBe('refused-involved');
    expect(p.settles).toEqual([]);
    expect(sent).toEqual([{ rulingId: r2.ruling.id, reason: 'involved' }]);
  });

  it('"Decision stands" before round 1 paid: round 2 pays the same payout', async () => {
    const { s, r2 } = await overturned('release-to-buyer');
    const want = await authorised(s);
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    expect(p.settles).toEqual([{ kind: 'release', to: want.payouts, builder: 'mod', cosigner: 'buyer' }]);
    expect(s.store.state.executions[s.c.ruling.code]?.rulingId).toBe(r2.ruling.id);
  });
});

describe('review p4t22 N1: round 1 by a moderator removed before its payout ran', () => {
  /** Round 1 release-to-buyer by a moderator, round 2 (`outcome`) decided by an uninvolved senior, then the moderator removed. */
  async function removedThenAppealed(outcome: 'refund-to-seller' | 'release-to-buyer' | null = 'refund-to-seller') {
    const s = await setup({ outcome: 'release-to-buyer' });
    const senior = s.w.hire('senior');
    let r2: Case | null = null;
    if (outcome !== null) {
      r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome });
      s.w.api.taps.push(tapBy(senior, r2.intent('propose')));
      s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [] });
    }
    const row = s.w.api.staffRows.get(s.c.ruling.proposer)!;
    row.removed = true;
    row.switchedOff = true;
    return { s, r2, senior };
  }

  it('the appeal that overturns it pays (the probe of the re-review); round 1 never does', async () => {
    const { s, r2 } = await removedThenAppealed();
    const p = recordingParty();
    const logs: string[] = [];
    const sent: Array<{ rulingId: string; reason: string | null }> = [];
    const before = announced.length;
    expect(await executor(s, s.store, logs).step(step(s, p.handle, { reportRefusal: async (r) => (sent.push(r), true) }))).toBe('handed');
    expect(p.settles).toHaveLength(1);
    expect(p.settles[0]).toMatchObject({ kind: 'release', builder: 'mod', cosigner: 'seller' });
    expect(s.store.state.executions[s.c.ruling.code]).toMatchObject({ rulingId: r2!.ruling.id, winner: 'seller' });
    expect(announced.slice(before).at(-1)!.statement).toMatchObject({ round: 2, rulingId: r2!.ruling.id, winner: 'seller' });
    // Round 1's signers are known (for R37), but round 1 is not authorised: it is never paid.
    expect(s.store.state.rulingsSeen[s.c.ruling.id]).toMatchObject({ round: 1, signersOnly: true, signers: [s.c.ruling.proposer] });
    expect(sent.at(-1)).toEqual({ rulingId: r2!.ruling.id, reason: null });
  });

  it("with no appeal, the removed moderator's round 1 is still refused as revoked, and reported", async () => {
    const { s } = await removedThenAppealed(null);
    const p = recordingParty();
    const sent: Array<{ rulingId: string; reason: string | null }> = [];
    expect(await executor(s).step(step(s, p.handle, { reportRefusal: async (r) => (sent.push(r), true) }))).toBe('refused-revoked');
    expect(p.settles).toEqual([]);
    expect(sent).toEqual([{ rulingId: s.c.ruling.id, reason: 'revoked' }]);
  });

  it('"Decision stands" after the removal: round 2 pays, from its own taps', async () => {
    const { s, r2 } = await removedThenAppealed('release-to-buyer');
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    expect(p.settles[0]).toMatchObject({ kind: 'release', builder: 'mod', cosigner: 'buyer' });
    expect(s.store.state.executions[s.c.ruling.code]?.rulingId).toBe(r2!.ruling.id);
  });

  it('a round 1 with a forged tap still blocks the appeal, and nothing is paid', async () => {
    const { s, r2 } = await removedThenAppealed();
    // The stored round-1 tap swapped for one by a key the gate never trusted.
    const i = s.w.api.taps.findIndex((t) => (JSON.parse(t.intent) as { rulingId?: string }).rulingId === s.c.ruling.id);
    const mod = { id: s.c.ruling.proposer, key: newKey(), role: 'mod' as const };
    s.w.api.taps[i] = tapBy(mod, s.c.intent('propose'));
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('refused-unknown-key');
    expect(p.settles).toEqual([]);
    expect(s.store.state.rulingsSeen[r2!.ruling.id]).toBeUndefined();
  });
});

describe('review p4t22 F1: a round 1 the gate authorised still pays once its signer is removed, switched off or reset', () => {
  /** The moderator who proposed the setup's round 1, as `resetSecurity` needs them (only the id is read). */
  const proposerOf = (s: Setup) => ({ id: s.c.ruling.proposer, key: newKey(), role: 'mod' as const });

  it('removed after the payout was recorded and handed: after a restart the same payout is handed again (the probe), also once an appeal is decided', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    const row = s.w.api.staffRows.get(s.c.ruling.proposer)!;
    row.removed = true;
    row.switchedOff = true;
    // A restart: a fresh executor on the same sealed store.
    const again = recordingParty();
    const sent: Array<{ rulingId: string; reason: string | null }> = [];
    expect(await executor(s).step(step(s, again.handle, { reportRefusal: async (r) => (sent.push(r), true) }))).toBe('handed');
    expect(again.settles).toEqual(p.settles);
    expect(sent).toEqual([{ rulingId: s.c.ruling.id, reason: null }]);
    // An appeal decided since: the record still pins round 1's payout, handed again after a restart.
    const senior = s.w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome: 'refund-to-seller' });
    s.w.api.taps.push(tapBy(senior, r2.intent('propose')));
    s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [] });
    const third = recordingParty();
    expect(await executor(s, await openGateStore(s.dir, s.key)).step(step(s, third.handle))).toBe('handed');
    expect(third.settles).toEqual(p.settles);
    expect(s.store.state.executions[s.c.ruling.code]?.rulingId).toBe(s.c.ruling.id);
  });

  it('switched off after the gate authorised it but before any payout was recorded (a desk refund was armed): it pays once the desk refund is blocked', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle, { deskArmed: { kind: 'auto-refund', blocked: null } }))).toBe('desk-armed');
    expect(s.store.state.rulingsSeen[s.c.ruling.id]).toBeDefined();
    expect(s.store.state.executions[s.c.ruling.code]).toBeUndefined();
    s.w.api.staffRows.get(s.c.ruling.proposer)!.switchedOff = true;
    const store = await openGateStore(s.dir, s.key);
    expect(await executor(s, store).step(step(s, p.handle, { deskArmed: { kind: 'auto-refund', blocked: 'auto-refund-api-disputed' } }))).toBe('handed');
    expect(p.settles).toHaveLength(1);
    expect(p.settles[0]).toMatchObject({ kind: 'release', builder: 'mod', cosigner: 'buyer' });
    expect(store.state.staff[s.c.ruling.proposer]?.revoked).toBe(true);
    expect(store.state.executions[s.c.ruling.code]?.rulingId).toBe(s.c.ruling.id);
  });

  it("reset after the payout was handed (the old key is retired): after a restart the same payout is handed again", async () => {
    const s = await setup({ outcome: 'refund-to-seller' });
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    resetSecurity(s.w, proposerOf(s));
    const again = recordingParty();
    const store = await openGateStore(s.dir, s.key);
    expect(await executor(s, store).step(step(s, again.handle))).toBe('handed');
    expect(again.settles).toEqual(p.settles);
    // The reset reached the gate: the proposer's tapped key is retired, no longer one of theirs.
    const st = store.state.staff[s.c.ruling.proposer]!;
    const tapped = s.w.api.taps.find((t) => (JSON.parse(t.intent) as { rulingId?: string }).rulingId === s.c.ruling.id)!.credentialId;
    expect(st.creds.map((c) => c.credentialId)).not.toContain(tapped);
    expect(st.retiredCreds?.map((c) => c.credentialId)).toEqual([tapped]);
  });

  it('the emergency stop still holds an authorised payout whose signer was removed: nothing is handed', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    const p = recordingParty();
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    s.w.api.staffRows.get(s.c.ruling.proposer)!.removed = true;
    s.w.api.taps.push(tapBy(s.w.owner, { kind: 'emergency-stop' }));
    const again = recordingParty();
    expect(await executor(s, await openGateStore(s.dir, s.key)).step(step(s, again.handle))).toBe('refused-stopped');
    expect(again.settles).toEqual([]);
  });

  it('finding A: authorised while a desk refund was armed, its moderator reset, the outcome re-signed on the bound nonce: nothing is handed', async () => {
    for (const change of ['reset', 'active'] as const) {
      const s = await setup({ outcome: 'release-to-buyer' });
      const p = recordingParty();
      expect(await executor(s).step(step(s, p.handle, { deskArmed: { kind: 'auto-refund', blocked: null } }))).toBe('desk-armed');
      if (change === 'reset') resetSecurity(s.w, proposerOf(s));
      // A compromised API swaps in the other outcome, signed by the (retired or active) key on the bound nonce.
      const i = s.w.api.taps.findIndex((t) => (JSON.parse(t.intent) as { rulingId?: string }).rulingId === s.c.ruling.id);
      s.w.api.taps[i] = tapOnNonce(s.signer, s.c.intent('propose', { outcome: 'refund-to-seller' }), s.w.api.taps[i]!.nonceHex);
      s.w.api.rulings.set(s.c.ruling.code, { current: { ...s.c.ruling, outcome: 'refund-to-seller' }, round1: null, involved: [] });
      const store = await openGateStore(s.dir, s.key);
      const res = await executor(s, store).step(step(s, p.handle, { deskArmed: { kind: 'auto-refund', blocked: 'auto-refund-api-disputed' } }));
      expect(res, change).toBe(change === 'reset' ? 'refused-revoked' : 'refused-replayed');
      expect(p.settles, change).toEqual([]);
      expect(store.state.executions[s.c.ruling.code], change).toBeUndefined();
    }
  });

  it("F1's twin: round 1 never authorised, its moderator then reset: refused as revoked (re-proposable); an appeal decided by someone else pays", async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    resetSecurity(s.w, proposerOf(s));
    const p = recordingParty();
    const sent: Array<{ rulingId: string; reason: string | null }> = [];
    expect(await executor(s).step(step(s, p.handle, { reportRefusal: async (r) => (sent.push(r), true) }))).toBe('refused-revoked');
    expect(sent).toEqual([{ rulingId: s.c.ruling.id, reason: 'revoked' }]);
    expect(p.settles).toEqual([]);
    const senior = s.w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome: 'refund-to-seller' });
    s.w.api.taps.push(tapBy(senior, r2.intent('propose')));
    s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [] });
    expect(await executor(s).step(step(s, p.handle))).toBe('handed');
    expect(p.settles[0]).toMatchObject({ kind: 'release', builder: 'mod', cosigner: 'seller' });
    expect(s.store.state.executions[s.c.ruling.code]?.rulingId).toBe(r2.ruling.id);
    expect(s.store.state.rulingsSeen[s.c.ruling.id]).toMatchObject({ signersOnly: true, signers: [s.c.ruling.proposer] });
  });
});

/**
 * Owner 26 Nov: either trader's app co-signs the ruling's fixed payout, whichever opens first. The
 * moderator hands it with the winner the co-signer and switches to the other trader only while its
 * party is not committed, the winner sent nothing for it, and the other trader sent its export for
 * this very set with itself the co-signer. The payouts never change.
 */
describe('either trader co-signs the ruling payout', () => {
  type View = ReturnType<NonNullable<PartyHandle['peerRelease']>>;
  function party() {
    const settles: Outcome[] = [];
    const waiters: Array<{ resolve: (tx: string | null) => void; reject: (e: Error) => void }> = [];
    const views: Record<'buyer' | 'seller', View> = { buyer: { current: false, elsewhere: null }, seller: { current: false, elsewhere: null } };
    const state = { committed: false, current: null as Outcome | null };
    const handle: Pick<PartyHandle, 'settle' | 'peerRelease' | 'currentRelease'> = {
      settle: (o) => {
        // As the party does: an uncommitted settle is replaced and its waiter rejected.
        waiters.splice(0).forEach((w) => w.reject(new Error('replaced by a later settle()')));
        settles.push(structuredClone(o));
        state.current = structuredClone(o);
        return new Promise<string | null>((resolve, reject) => waiters.push({ resolve, reject }));
      },
      peerRelease: (from) => structuredClone(from === 'mod' ? { current: false, elsewhere: null } : views[from]),
      currentRelease: () => (state.current === null ? null : { tag: releaseTag(state.current), counterpart: state.current.cosigner, committed: state.committed }),
    };
    return { handle, settles, views, state, answer: (tx: string | null) => waiters.shift()?.resolve(tx) };
  }
  const exported = (o: Outcome): View => ({ current: false, elsewhere: { tag: releaseTag(o), txSet: false, at: 1 } });

  it('the loser opens first: the same payouts are handed again with the loser the co-signer; the record and statement stay the winner\'s', async () => {
    const s = await setup();
    const p = party();
    const logs: string[] = [];
    const exec = executor(s, s.store, logs);
    expect(await exec.step(step(s, p.handle))).toBe('handed');
    const first = p.settles[0]!;
    expect(first).toMatchObject({ builder: 'mod', cosigner: 'buyer' });
    expect(await exec.step(step(s, p.handle))).toBe('in-flight');
    // The seller (the loser) exports for the very same set with itself the co-signer.
    p.views.seller = exported({ ...first, cosigner: 'seller' });
    expect(await exec.step(step(s, p.handle))).toBe('handed');
    expect(p.settles).toHaveLength(2);
    expect(p.settles[1]).toEqual({ ...first, cosigner: 'seller' });
    expect(logs).toContain('ruling-cosigner-loser');
    expect(logs).not.toContain('ruling-settle-failed');
    expect(await exec.step(step(s, p.handle))).toBe('in-flight');
    expect(s.store.state.executions[s.c.ruling.code]).toMatchObject({ winner: 'buyer', settledAt: null });
    // It lands: recorded once, as the ruling's payout.
    p.answer('9'.repeat(64));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.store.state.executions[s.c.ruling.code]).toMatchObject({ winner: 'buyer', settledTx: '9'.repeat(64) });
    expect(await exec.step(step(s, p.handle))).toBe('settled');
  });

  it('never switches for an export of another set, once the winner took part, or once the party is committed', async () => {
    const cases: Array<[string, (p: ReturnType<typeof party>, first: Outcome) => void]> = [
      ['other payouts', (p, first) => (p.views.seller = exported({ ...first, to: first.to.map((x, i) => (i === 0 ? { ...x, amountAtomic: x.amountAtomic - 1n } : x)), cosigner: 'seller' }))],
      ['a seller-built set', (p, first) => (p.views.seller = exported({ ...first, builder: 'seller', cosigner: 'mod' }))],
      ['the winner took part', (p, first) => {
        p.views.buyer = { current: true, elsewhere: null };
        p.views.seller = exported({ ...first, cosigner: 'seller' });
      }],
      ['committed', (p, first) => {
        p.state.committed = true;
        p.views.seller = exported({ ...first, cosigner: 'seller' });
      }],
    ];
    for (const [name, arrange] of cases) {
      const s = await setup();
      const p = party();
      const exec = executor(s);
      await exec.step(step(s, p.handle));
      arrange(p, p.settles[0]!);
      expect(await exec.step(step(s, p.handle)), name).toBe('in-flight');
      expect(p.settles, name).toHaveLength(1);
    }
  });

  it('a party without currentRelease never switches (fail closed)', async () => {
    const s = await setup();
    const p = party();
    const { currentRelease: _, ...handle } = p.handle;
    const exec = executor(s);
    await exec.step(step(s, handle));
    p.views.seller = exported({ ...p.settles[0]!, cosigner: 'seller' });
    expect(await exec.step(step(s, handle))).toBe('in-flight');
    expect(p.settles).toHaveLength(1);
  });

  it('after a restart, the party\'s saved release with the loser co-signing is handed again as it is', async () => {
    const s = await setup();
    const p = party();
    const exec = executor(s);
    await exec.step(step(s, p.handle));
    p.views.seller = exported({ ...p.settles[0]!, cosigner: 'seller' });
    await exec.step(step(s, p.handle));
    expect(p.settles.at(-1)).toMatchObject({ cosigner: 'seller' });
    // A new process: the same store, the party resumed with its saved release.
    const again = executor(s);
    expect(await again.step(step(s, p.handle))).toBe('handed');
    expect(p.settles.at(-1)).toMatchObject({ cosigner: 'seller' });
    expect(p.settles.at(-1)!.to).toEqual(p.settles[0]!.to);
  });
});
