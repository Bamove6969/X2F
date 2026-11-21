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
import type { Outcome, PartyHandle } from '@x2f/escrow';
import { escrowPlan, verifyRulingStatement, type RulingStatement } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { rulingExecutor, type RulingStepInput } from '../src/execute.js';
import { authorizeRuling, openGateStore, recordedTerms as gateRecordedTerms, syncRegistry, type GateStore } from '../src/gate/index.js';
import { BALANCE, ctx, newGate, recorded, ruling, tapBy, world, type Case, type World } from './gateWorld.js';
import { DEAL, ESCROW, FEE_WALLET, FUNDS, fakeNetwork, inFunding, makeCtx, moderation, secured, stopAll, TERMS, type Ctx } from './harness.js';

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
  return { w, c, dir, key, store };
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

const step = (s: Setup, handle: Pick<PartyHandle, 'settle'>, over: Partial<RulingStepInput> = {}): RulingStepInput => ({
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

  it('after an appeal, round 1 still pays from its own ruling, once (Note 2026-10-30 M3); round 2 never reaches settle', async () => {
    const s = await setup({ outcome: 'release-to-buyer' });
    const senior = s.w.hire('senior');
    const r2 = ruling(senior, { round: 2, round1Id: s.c.ruling.id, code: s.c.ruling.code, outcome: 'refund-to-seller' });
    s.w.api.rulings.set(s.c.ruling.code, { current: r2.ruling, round1: s.c.ruling, involved: [] });
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
    expect(last.recorded).toEqual(
      gateRecordedTerms({
        terms: TERMS,
        trade: { amountAtomic: DEAL.takeAmountAtomic, feeAtomic: escrowPlan({ amountAtomic: DEAL.takeAmountAtomic, poster: 'seller' }).feeAtomic, sellerFundsAtomic: FUNDS, poster: 'seller' },
        feeWallet: FEE_WALLET,
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
