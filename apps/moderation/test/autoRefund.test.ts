// Plan 3 Task 10, owner 8 Nov (p6-1, p9-2): the guarded seller-cancel refund, from signed terms and
// signals only. No final alert: once the time to pay has passed without "I've paid" and the seller
// cancels, the moderator co-signs the seller-built refund at once, on its own facts.
// Hermetic (see harness.ts): the real moderation service, desks and signals with real envelopes; the
// escrow party is a recorder. That the party co-signs ONLY a tx set equal to the outcome handed to
// settle() (a seller-built refund paying any other address is refused, nothing broadcast) is Plan
// 1's checkTxSet/cosign, tested on regtest in packages/escrow; here every settle() call is checked.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fiatCents, newTrade as machineTrade, apply, type Trade } from '@x2f/trade';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { autoRefundStep, PAID_CONFLICT_MS, REFUND_UNVERIFIED_MS, type AutoRefundInputs } from '../src/autoRefund.js';
import { fromJson, toJson } from '../src/shadow.js';
import { reviveShadow, WATCH_FRESH_MS, type DeskRecord } from '../src/desk.js';
import {
  acked,
  acksFor,
  DEAL,
  drained,
  ESCROW,
  hash,
  incoming,
  fakeNetwork,
  FUNDS,
  inFunding,
  later,
  makeCtx,
  MIN,
  moderation,
  newTrade,
  OTHER_TERMS,
  secured,
  signal,
  TERMS,
  type Ctx,
  type Live,
  stopAll,
} from './harness.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterEach(stopAll);
afterAll(async () => {
  await ctx.db.end();
});

const record = async (code: string): Promise<DeskRecord> => {
  const { rows } = await ctx.db.query<{ record: unknown }>('select record from mod_trade_desk where trade = $1', [code]);
  return fromJson(rows[0]!.record) as DeskRecord;
};
const REFUND = { kind: 'release', to: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }], builder: 'seller', cosigner: 'mod' };
const PAID = { amountAtomic: DEAL.takeAmountAtomic, fiatCents: fiatCents(DEAL.takeAmountAtomic, { currency: 'USD', centsPerXmr: DEAL.centsPerXmr }) };

/** The API shows the seller's cancel: settling as `auto-refund` (the machine's request-refund, owner 8 Nov). */
const apiCancelled = (l: Live): void => {
  l.net.states.set(l.code, 'settling');
  l.net.settleKinds.set(l.code, 'auto-refund');
};

/** Secured, the time to pay over, the seller's cancel opened by the shadow and shown by the API: returns when. */
async function sellerCancelled(l: Live): Promise<Date> {
  await secured(ctx, l);
  later(ctx, 91 * MIN);
  await acked(l, l.seller, 'trade.refund-request', {});
  apiCancelled(l);
  const rec = await record(l.code);
  expect(rec.shadow!.state).toBe('settling');
  expect(rec.shadow!.settling).toBe('auto-refund');
  return ctx.clock.now;
}

const at = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

describe("the seller's cancel refund (owner 8 Nov: no final alert, the refund starts at once)", () => {
  it('co-signs the seller-built refund of the whole balance to the SELLER-SIGNED address in the first pass after the cancel', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    expect(l.party.settles).toEqual([]);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    // asked once; the next pass with the same balance does not ask again
    await m.handle.watch();
    expect(l.party.settles).toHaveLength(1);
    expect((await record(l.code)).armed?.kind).toBe('auto-refund');
    // every signal was acked to its sender only
    expect(await acksFor(l, l.seller)).toEqual(['trade.ack:trade.terms', 'trade.ack:trade.refund-request']);
    expect(await acksFor(l, l.buyer)).toEqual(['trade.ack:trade.terms']);
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toEqual([]);
    await m.handle.stop();
  });

  it("nothing is signed while the API does not show the seller's cancel (secured, the retired refund_requested, another settling kind)", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 91 * MIN);
    await acked(l, l.seller, 'trade.refund-request', {});
    expect((await record(l.code)).shadow!.settling).toBe('auto-refund');
    for (const [state, kind] of [['secured', null], ['refund_requested', null], ['settling', 'release'], ['settling', 'buyer-cancel'], ['paid', null]] as const) {
      net.states.set(l.code, state);
      if (kind === null) net.settleKinds.delete(l.code);
      else net.settleKinds.set(l.code, kind);
      await m.handle.watch();
      expect(l.party.settles, `${state}/${kind}`).toEqual([]);
    }
    await m.handle.stop();
  });

  it("a lying API shows the cancel with no seller signal, or before the shadow's own time to pay: nothing is signed; after REFUND_UNVERIFIED_MS it escalates once", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 30 * MIN); // inside the buyer's 90 minutes
    apiCancelled(l);
    await acked(l, l.seller, 'trade.refund-request', {}); // the shadow refuses it too-early: pending
    expect((await record(l.code)).pending).toEqual(['request-refund']);
    await m.handle.watch();
    later(ctx, 30 * MIN); // 60 min after secured: the shadow's own time to pay is still running
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect((await record(l.code)).shadow!.state).toBe('secured');
    await m.handle.stop();
    // A fresh trade where the seller never sends a signal at all.
    const n2 = fakeNetwork(ctx);
    const m2 = await moderation(ctx, n2.fetch);
    const l2 = await inFunding(ctx, m2, n2.net);
    await secured(ctx, l2);
    later(ctx, 91 * MIN);
    apiCancelled(l2);
    await m2.handle.watch();
    later(ctx, REFUND_UNVERIFIED_MS - 1);
    await m2.handle.watch();
    expect(n2.net.reports.filter((r) => r.trade === l2.code && r.kind === 'refund-unverified')).toEqual([]);
    later(ctx, 2);
    await m2.handle.watch();
    later(ctx, MIN);
    await m2.handle.watch();
    expect(n2.net.reports.filter((r) => r.trade === l2.code && r.kind === 'refund-unverified')).toHaveLength(1);
    expect(l2.party.settles).toEqual([]);
    await m2.handle.stop();
  });

  it('the API’s seller_refund overwritten with an attacker address: the refund still pays only the seller-signed address', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    // The API now serves the trade with an attacker's addresses (its work list and anything else):
    // the moderator never reads them again. A terms signal with the attacker's address, even signed
    // by the seller's own identity, is never adopted (it differs from what was attested).
    net.work = [{ ...(await newTrade(OTHER_TERMS)).work, trade: l.code }];
    await m.handle.tick();
    await signal(l, l.seller, 'trade.terms', { refundAddress: OTHER_TERMS.sellerRefund, deal: DEAL });
    await drained();
    expect(m.logs).toContain('signal-terms-mismatch');
    await sellerCancelled(l);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    const { rows } = await ctx.db.query<{ seller_terms: { address: string } }>('select seller_terms from signed_terms where trade = $1', [l.code]);
    expect(rows[0]!.seller_terms.address).toBe(TERMS.sellerRefund);
    await m.handle.stop();
  });

  it("the API shows the cancel while the moderator opened a valid trade.paid: nothing is signed, ever; the conflict escalates once (review M7)", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 95 * MIN); // a late "I've paid" (after payBy: not a hard end, p9-2)
    await acked(l, l.buyer, 'trade.paid', PAID);
    expect((await record(l.code)).shadow!.state).toBe('paid');
    // The seller's signal is refused by the shadow (no cancel after I've paid, p9-4).
    await acked(l, l.seller, 'trade.refund-request', {});
    expect(m.logs).toContain('shadow-request-refund-wrong-state');
    later(ctx, PAID_CONFLICT_MS + 1);
    apiCancelled(l); // the (lying, or raced) API says the cancel came first
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    later(ctx, REFUND_UNVERIFIED_MS);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    await m.handle.stop();
  });

  it("I've paid wins the race at the API (API paid) though the shadow took the cancel first: nothing signed, no escalation", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 91 * MIN);
    await acked(l, l.seller, 'trade.refund-request', {});
    await acked(l, l.buyer, 'trade.paid', PAID); // the shadow refuses it (wrong-state), but it is seen
    expect((await record(l.code)).paidSeen).toBe(true);
    net.states.set(l.code, 'paid');
    for (let i = 0; i < 4; i++) {
      later(ctx, 15 * MIN);
      await m.handle.watch();
    }
    expect(l.party.settles).toEqual([]);
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toEqual([]);
    await m.handle.stop();
  });

  it('an escalation the API answers 409 wrong-state is logged apart (escalate-wrong-state), still final here, nothing signed (review round 2 N4)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 91 * MIN);
    apiCancelled(l); // no seller signal: never signed here
    net.answer = (r) => (r.kind === 'refund-unverified' ? { status: 409, error: 'wrong-state' } : { status: 201 });
    await m.handle.watch();
    later(ctx, REFUND_UNVERIFIED_MS + 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'refund-unverified' && r.trade === l.code)).toHaveLength(1);
    expect(m.logs).toContain('escalate-wrong-state');
    expect((await record(l.code)).escalated).toBe('refund-unverified');
    // a seller signal now changes nothing: escalated is final here
    await acked(l, l.seller, 'trade.refund-request', {});
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('maintenance: nothing is decided while paused; after the resume it signs', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    net.paused.add(l.code);
    await m.handle.watch();
    later(ctx, 20 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    net.paused.delete(l.code);
    later(ctx, MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it("a 24-hour method (cash by mail): a lying API's cancel at 91 minutes is not co-signed, the shadow runs on the trade's own attested time to pay; once it is over the refund is signed", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net, { ...TERMS, payWindowMin: 24 * 60 });
    await secured(ctx, l);
    later(ctx, 91 * MIN); // past the machine default of 90 minutes, well inside the trade's 24 hours
    await acked(l, l.seller, 'trade.refund-request', {});
    apiCancelled(l); // the API took the cancel on the default window
    await m.handle.watch();
    let rec = await record(l.code);
    expect(l.party.settles).toEqual([]);
    expect(rec.shadow!.payWindowMin).toBe(24 * 60);
    expect(rec.shadow!.state).toBe('secured');
    expect(rec.pending).toEqual(['request-refund']);
    net.states.set(l.code, 'secured'); // the API shows the trade as it is again
    net.settleKinds.delete(l.code);
    later(ctx, (24 * 60 - 92) * MIN); // one minute before the trade's own payBy
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect((await record(l.code)).shadow!.state).toBe('secured');
    later(ctx, 2 * MIN); // the buyer's 24 hours are over
    await m.handle.watch();
    rec = await record(l.code);
    expect(rec.shadow!.state).toBe('settling');
    expect(rec.shadow!.settling).toBe('auto-refund');
    expect(rec.pending).toEqual([]);
    apiCancelled(l);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('nudges are optional (owner 8 Nov; lead decision (a) retired): the shadow takes the request with no nudge once its own payBy passed; before it, the request waits (too-early)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 30 * MIN); // well inside the buyer's 90 minutes
    await acked(l, l.seller, 'trade.refund-request', {});
    let rec = await record(l.code);
    expect(rec.shadow!.state).toBe('secured');
    expect(rec.pending).toEqual(['request-refund']);
    await m.handle.watch(); // retried: still too early
    expect((await record(l.code)).shadow!.state).toBe('secured');
    later(ctx, 61 * MIN); // payBy passed
    await m.handle.watch();
    rec = await record(l.code);
    expect(rec.shadow!.state).toBe('settling');
    expect(rec.shadow!.settling).toBe('auto-refund');
    expect(rec.shadow!.sellerNudgedAt).toBeNull();
    expect('finalAlertAt' in rec.shadow!).toBe(false);
    expect(rec.pending).toEqual([]);
    await m.handle.stop();
  });

  it('the seller’s request opened before the shadow’s own payBy is retried, not lost; a resent one is kept once (review M5)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 90 * MIN - 1000); // the API's clock is a second ahead: it accepted the cancel
    await acked(l, l.seller, 'trade.refund-request', {});
    expect((await record(l.code)).pending).toEqual(['request-refund']);
    await acked(l, l.seller, 'trade.refund-request', {});
    expect((await record(l.code)).pending).toEqual(['request-refund']);
    apiCancelled(l);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]); // the shadow's own time to pay is not over yet
    later(ctx, 2000);
    await m.handle.watch();
    const rec = await record(l.code);
    expect(rec.pending).toEqual([]);
    expect(rec.shadow!.state).toBe('settling');
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it("the shadow's signing window does not undo the cancel: hours later it still signs (the refund goes ahead)", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 91 * MIN);
    await acked(l, l.seller, 'trade.refund-request', {});
    // The API shows the cancel only 2 h later (it was slow, or down): the shadow's cancel still stands.
    for (let i = 0; i < 8; i++) {
      later(ctx, 15 * MIN);
      await m.handle.watch();
    }
    expect(l.party.settles).toEqual([]);
    expect((await record(l.code)).shadow!.state).toBe('settling');
    apiCancelled(l);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('after a restart the armed refund is handed to the party again, unchanged', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
    const again = await moderation(ctx, fetch);
    const p = await (async () => {
      await again.handle.watch(); // starts the party again from the moderation database
      return again.parties.get(l.code)!;
    })();
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await again.handle.watch();
    expect(p.settles).toEqual([REFUND]);
    await again.handle.stop();
  });

  it('a desk record saved before the reversal (shadow in refund_requested with a final alert) loads as secured; the seller cancels again and it signs (migration 120)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 91 * MIN);
    await m.handle.watch();
    await m.handle.stop();
    // Rewrite the saved shadow as the old code left it.
    const old = await record(l.code);
    const legacy = { ...old, shadow: { ...old.shadow!, state: 'refund_requested', finalAlertAt: ctx.clock.now } };
    await ctx.db.query('update mod_trade_desk set record = $2, version = version + 1 where trade = $1', [l.code, JSON.stringify(toJson(legacy))]);
    net.states.set(l.code, 'secured'); // the API's migration 120 moved it back too
    const again = await moderation(ctx, fetch);
    await again.handle.watch();
    const p = again.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await again.handle.watch();
    let rec = await record(l.code);
    expect(rec.shadow!.state).toBe('secured');
    expect('finalAlertAt' in rec.shadow!).toBe(false);
    expect(p.settles).toEqual([]);
    const ch = again.transports.get(l.channel)!;
    await acked({ ...l, m: again, party: p, signals: ch }, l.seller, 'trade.refund-request', {});
    apiCancelled(l);
    await again.handle.watch();
    rec = await record(l.code);
    expect(rec.shadow!.settling).toBe('auto-refund');
    expect(p.settles).toEqual([REFUND]);
    await again.handle.stop();
  });
});

describe('reviveShadow (pure, migration 120)', () => {
  it('moves the retired state and settleFrom to secured and drops finalAlertAt; leaves anything else as it is', () => {
    const T0 = new Date('2026-10-29T12:00:00Z');
    const t = machineTrade(
      { code: 'ABCD2345EFGH6789', offerId: 'o', poster: 'seller', sellerId: 's', buyerId: 'b', methodId: 'm', amountAtomic: DEAL.takeAmountAtomic, lockedRate: { currency: 'USD', centsPerXmr: DEAL.centsPerXmr }, confirmWindowMin: 120, minFiatCents: 1n, maxFiatCents: DEAL.maxFiatCents },
      T0,
    );
    expect(reviveShadow(t)).toBe(t);
    expect(reviveShadow(null)).toBeNull();
    const old = { ...t, state: 'refund_requested', finalAlertAt: T0 } as unknown as Trade;
    expect(reviveShadow(old)).toEqual({ ...t, state: 'secured' });
    const from = { ...t, state: 'settling', settling: 'buyer-cancel', settleFrom: 'refund_requested', finalAlertAt: null } as unknown as Trade;
    expect(reviveShadow(from)).toEqual({ ...t, state: 'settling', settling: 'buyer-cancel', settleFrom: 'secured' });
  });
});

describe('the watch list is judged when it was read (security review 7 Nov, finding 1)', () => {
  // The pass reads the list once, then syncs each wallet in turn: by the time the desk decides, the
  // API may have paused the trade or taken the buyer's dispute. funds() is where the time goes.
  const slowPass = (l: Live, change: () => void): void => {
    l.party.onFunds = () => {
      l.party.onFunds = null;
      change();
      later(ctx, WATCH_FRESH_MS + 2 * MIN); // the list is now old: the desk must read it again
    };
  };

  it('maintenance starts after the list was read: nothing is armed or handed in that pass, nor while paused', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    slowPass(l, () => net.paused.add(l.code));
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect((await record(l.code)).armed).toBeNull();
    later(ctx, 10 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect((await record(l.code)).armed).toBeNull();
    await m.handle.stop();
  });

  it("the buyer disputes the cancel at once after the list was read (p9-2): nothing is armed or handed", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    slowPass(l, () => net.states.set(l.code, 'disputed'));
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect((await record(l.code)).armed).toBeNull();
    later(ctx, 30 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('an old list the API cannot refresh: nothing is armed in that pass; the next pass on a fresh list signs', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    let down = false;
    const flaky: typeof fetch = async (url, init) => (down && url.includes('/internal/v1/watch') ? { status: 503, json: async () => ({}) } : fetch(url, init));
    await m.handle.stop();
    const m2 = await moderation(ctx, flaky);
    await m2.handle.watch();
    const p = m2.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    p.onFunds = () => {
      p.onFunds = null;
      down = true;
      later(ctx, WATCH_FRESH_MS + MIN);
    };
    await m2.handle.watch();
    expect(p.settles).toEqual([]);
    expect(m2.logs).toContain('watch-list-stale');
    down = false;
    await m2.handle.watch();
    expect(p.settles).toEqual([REFUND]);
    await m2.handle.stop();
  });
});

describe('an armed seller-cancel refund is rechecked every pass, like the armed buyer cancel (security review 7 Nov, finding 1 c)', () => {
  const cases: Array<{ name: string; reason: string; change: (l: Live) => Promise<void> }> = [
    { name: 'the API shows the trade paid', reason: 'auto-refund-api-paid', change: async (l) => void l.net.states.set(l.code, 'paid') },
    { name: 'the buyer disputed the cancel at once (API disputed, p9-2)', reason: 'auto-refund-api-disputed', change: async (l) => void l.net.states.set(l.code, 'disputed') },
    { name: 'the API shows the trade paused', reason: 'auto-refund-paused', change: async (l) => void l.net.paused.add(l.code) },
    { name: 'the buyer\'s trade.paid was opened', reason: 'auto-refund-buyer-paid', change: async (l) => void (await acked(l, l.buyer, 'trade.paid', PAID)) },
  ];
  for (const c of cases) {
    it(`${c.name}: after a restart the armed refund is not handed to the party again, and the record says why`, async () => {
      const { net, fetch } = fakeNetwork(ctx);
      const m = await moderation(ctx, fetch);
      const l = await inFunding(ctx, m, net);
      await sellerCancelled(l);
      await m.handle.watch();
      expect(l.party.settles).toEqual([REFUND]);
      await c.change(l);
      await m.handle.watch();
      expect((await record(l.code)).armed).toMatchObject({ kind: 'auto-refund', blocked: c.reason });
      await m.handle.stop();
      const again = await moderation(ctx, fetch);
      await again.handle.watch();
      const p = again.parties.get(l.code)!;
      p.funds = { ...l.party.funds };
      p.resolveReady('ignored');
      await again.handle.watch();
      later(ctx, MIN);
      await again.handle.watch();
      expect(p.settles).toEqual([]);
      expect((await record(l.code)).armed).toMatchObject({ kind: 'auto-refund', blocked: c.reason });
      expect(again.logs).toContain(c.reason);
      await again.handle.stop();
    });
  }

  it("re-verify R1: a trade.paid after arming while the API still shows the cancel escalates refund-unverified once after PAID_CONFLICT_MS, also across a restart (5 h of passes); nothing is handed", async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    // The buyer's sealed trade.paid (a lie, or a tap the API refused because the cancel came first).
    await acked(l, l.buyer, 'trade.paid', PAID);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toEqual([]);
    await m.handle.stop();
    const again = await moderation(ctx, fetch);
    await again.handle.watch();
    const p = again.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    for (let i = 0; i < 20; i++) {
      later(ctx, 15 * MIN);
      await again.handle.watch();
    }
    expect(p.settles).toEqual([]);
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    const rec = await record(l.code);
    expect(rec.escalated).toBe('refund-unverified');
    expect(rec.armed).toMatchObject({ kind: 'auto-refund', blocked: 'auto-refund-buyer-paid' });
    await again.handle.stop();
  });

  it('re-verify R1: the buyer-paid block escalates only while the API shows the cancel unpaused, and not before PAID_CONFLICT_MS', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    await m.handle.watch();
    await acked(l, l.buyer, 'trade.paid', PAID);
    net.paused.add(l.code);
    later(ctx, PAID_CONFLICT_MS - 1_000);
    await m.handle.watch();
    later(ctx, 10 * MIN);
    await m.handle.watch(); // paused: nothing escalates
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toEqual([]);
    net.paused.delete(l.code);
    later(ctx, MIN);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    later(ctx, MIN);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('a block that no longer holds (a pause that ended) lets the armed refund be handed again', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await sellerCancelled(l);
    await m.handle.watch();
    net.paused.add(l.code);
    await m.handle.watch();
    await m.handle.stop();
    const again = await moderation(ctx, fetch);
    await again.handle.watch();
    const p = again.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await again.handle.watch();
    expect(p.settles).toEqual([]);
    net.paused.delete(l.code);
    later(ctx, MIN);
    await again.handle.watch();
    expect(p.settles).toEqual([REFUND]);
    expect((await record(l.code)).armed?.blocked ?? null).toBeNull();
    await again.handle.stop();
  });
});

describe('the desk loses no facts (review M2)', () => {
  it('a desk that failed to open is opened on a later pass, and its shadow catches up from the watcher’s latest facts', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const deskFails = { on: true };
    const m = await moderation(ctx, fetch, { deskFails });
    const t = await newTrade();
    net.work = [t.work];
    await m.handle.tick();
    net.work = [];
    const party = m.parties.get(t.code)!;
    party.resolveReady(ESCROW);
    net.states.set(t.code, 'setup');
    await expect.poll(async () => {
      await m.handle.watch();
      return net.reports.some((r) => r.kind === 'setup-done' && r.trade === t.code);
    }).toBe(true);
    net.states.set(t.code, 'funding');
    party.funds = { ...party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
    await m.handle.watch(); // the chain is reported while there is no desk
    expect(net.reports.some((r) => r.kind === 'chain' && r.trade === t.code)).toBe(true);
    expect(m.logs).toContain('desk-open-failed');
    net.states.set(t.code, 'secured');
    deskFails.on = false;
    await m.handle.watch(); // opened now; no new chain report, the shadow catches up anyway
    const rec = await record(t.code);
    expect(rec.shadow!.state).toBe('secured');
    expect(rec.shadow!.receivedAtomic).toBe(FUNDS);
    await m.handle.stop();
  });
});

describe('autoRefundStep (pure)', () => {
  const T0 = new Date('2026-10-29T12:00:00Z');
  const atMin = (m: number, ms = 0) => new Date(T0.getTime() + m * MIN + ms);
  /** Secured at minute 10 (payBy 100); the seller's cancel taken at `cancelAt`. */
  const shadowAt = (cancelAt: Date = atMin(101)): Trade => {
    let t = machineTrade(
      { code: 'ABCD2345EFGH6789', offerId: 'o', poster: 'seller', sellerId: 's', buyerId: 'b', methodId: 'm', amountAtomic: DEAL.takeAmountAtomic, lockedRate: { currency: 'USD', centsPerXmr: DEAL.centsPerXmr }, confirmWindowMin: 120, minFiatCents: 1n, maxFiatCents: DEAL.maxFiatCents },
      T0,
    );
    t = apply(t, { type: 'setup-done', escrowAddress: 'E' }, 'system', atMin(1));
    t = apply(t, { type: 'chain', receivedAtomic: FUNDS, unlockedAtomic: FUNDS, confirmations: 10 }, 'system', atMin(10));
    return apply(t, { type: 'request-refund' }, 'seller', cancelAt); // no nudge (owner 8 Nov)
  };
  const API = { state: 'settling', settleKind: 'auto-refund' };
  const base = (over: Partial<AutoRefundInputs> = {}): AutoRefundInputs => ({
    now: atMin(101, 1),
    shadow: shadowAt(),
    api: API,
    apiRefundSince: atMin(101),
    paidSeen: false,
    recordedRefundAddress: TERMS.sellerRefund,
    funds: { balance: FUNDS, unlocked: FUNDS },
    refundFor: (b) => [{ address: TERMS.sellerRefund, amountAtomic: b }],
    ...over,
  });

  it('signs at once when every condition holds: no final alert, no receipt', () => {
    expect(autoRefundStep(base())).toEqual({ action: 'sign', proposed: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }] });
  });

  it("waits unless the API shows the seller's cancel, unpaused", () => {
    for (const api of [{ state: 'secured' }, { state: 'refund_requested' }, { state: 'paid' }, { state: 'disputed' }, { state: 'settling', settleKind: 'release' }, { state: 'settling', settleKind: 'buyer-cancel' }, { state: 'settling', settleKind: null }]) {
      expect(autoRefundStep(base({ api })), JSON.stringify(api)).toEqual({ action: 'wait', reason: 'api-not-cancelled' });
    }
    expect(autoRefundStep(base({ api: { ...API, paused: true } }))).toEqual({ action: 'wait', reason: 'paused' });
    const s = shadowAt();
    expect(autoRefundStep(base({ shadow: { ...s, pausedAt: atMin(101) } }))).toEqual({ action: 'wait', reason: 'paused' });
  });

  it("waits on the shadow's own facts: no cancel taken (still secured, before its payBy), or no shadow; escalates after the fallback", () => {
    const s = shadowAt();
    const notCancelled: Trade = { ...s, state: 'secured', settling: null, settleFrom: null, settleBy: null };
    expect(autoRefundStep(base({ shadow: notCancelled }))).toEqual({ action: 'wait', reason: 'shadow-not-cancelled' });
    expect(autoRefundStep(base({ shadow: null }))).toEqual({ action: 'wait', reason: 'shadow-not-cancelled' });
    expect(autoRefundStep(base({ shadow: notCancelled, now: atMin(101 + 60) }))).toEqual({ action: 'escalate', report: 'refund-unverified' });
    // A shadow settling another kind is not the seller's cancel.
    expect(autoRefundStep(base({ shadow: { ...s, settling: 'buyer-cancel' } }))).toEqual({ action: 'wait', reason: 'shadow-not-cancelled' });
    // The guard's own deadline check (defence in depth): a shadow whose payBy is not yet past refuses.
    expect(autoRefundStep(base({ shadow: { ...s, payBy: atMin(102) } }))).toEqual({ action: 'refuse', reason: 'window-open' });
  });

  it('refuses or waits on every other missing fact', () => {
    expect(autoRefundStep(base({ paidSeen: true }))).toEqual({ action: 'wait', reason: 'buyer-paid' });
    expect(autoRefundStep(base({ recordedRefundAddress: null }))).toEqual({ action: 'wait', reason: 'no-seller-terms' });
    expect(autoRefundStep(base({ recordedRefundAddress: null, now: atMin(161) }))).toEqual({ action: 'escalate', report: 'refund-unverified' });
    // a trade.paid seen while the API still shows the cancel (review M7)
    expect(autoRefundStep(base({ paidSeen: true, paidSeenAt: atMin(100) }))).toEqual({ action: 'wait', reason: 'buyer-paid' });
    expect(autoRefundStep(base({ paidSeen: true, paidSeenAt: atMin(99, -1) }))).toEqual({ action: 'escalate', report: 'refund-unverified' });
    const s = shadowAt();
    expect(autoRefundStep(base({ shadow: { ...s, paidAt: atMin(100) } }))).toEqual({ action: 'wait', reason: 'buyer-paid' });
    expect(autoRefundStep(base({ funds: { balance: FUNDS, unlocked: FUNDS - 1n } }))).toEqual({ action: 'wait', reason: 'not-unlocked' });
    expect(autoRefundStep(base({ funds: { balance: 0n, unlocked: 0n } }))).toEqual({ action: 'wait', reason: 'not-unlocked' });
    expect(autoRefundStep(base({ refundFor: (b) => [{ address: OTHER_TERMS.sellerRefund, amountAtomic: b }] }))).toEqual({ action: 'refuse', reason: 'wrong-destination' });
    expect(autoRefundStep(base({ refundFor: (b) => [{ address: TERMS.sellerRefund, amountAtomic: b - 1n }, { address: TERMS.buyerPayout, amountAtomic: 1n }] }))).toEqual({ action: 'refuse', reason: 'wrong-destination' });
    expect(autoRefundStep(base({ refundFor: () => { throw new RangeError('x'); } }))).toEqual({ action: 'refuse', reason: 'no-payout' });
  });
});

describe('the only paths to settle() as the moderator', () => {
  it('apps/moderation calls settle() in desk.ts alone, and only with the guarded refunds', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const callers = readdirSync(dir).filter((f) => f.endsWith('.ts') && /\.settle\(/.test(readFileSync(dir + f, 'utf8')));
    expect(callers).toEqual(['desk.ts']);
    const desk = readFileSync(dir + 'desk.ts', 'utf8');
    expect(desk.match(/\.settle\(/g)).toHaveLength(1);
  });
});
