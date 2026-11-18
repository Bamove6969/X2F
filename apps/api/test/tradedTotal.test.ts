import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { setVerifiedPastRepUsd } from '../src/pastrep/store.js';
import { traderSummaries } from '../src/traders/summary.js';
import { countTradeTotals } from '../src/traders/tradedTotal.js';
import { applyEvent } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedReviews, seedTrade } from './helpers/trades.js';
import { appealDirect, publishRuling } from './helpers/disputes.js';
import { applyDispute } from '@x2f/staff';
import { DISPUTE_DEFAULTS } from '../src/disputes/settings.js';
import { withDispute } from '../src/disputes/store.js';

/**
 * A moderator's ruling (helpers/disputes.ts). This app has no price feed, so a dispute's USD value is
 * the large-trade limit itself (fail closed: two people); these trades are small, so put the value
 * under the limit first and one moderator publishes.
 */
async function rule(code: string, outcome: Parameters<typeof publishRuling>[2]['outcome']) {
  await deps.db.query('update disputes set usd_cents = 1 where code = $1', [code]);
  return publishRuling(deps, code, { outcome });
}

// The opt-in traded line (C12b, owner 2026-11-01/02/03; owner Q63 and Q64, 6 Nov 2026):
// - the card shows the XMR traded to date ("X+ XMR"), not dollars: completed trades only (released,
//   or refunded to settle a dispute), each trade's final amount, a per-account running total that
//   survives the trade purge, shown only as a rounded-down bucket ("more than" the step) and only
//   when the trader opted in;
// - imported volume is one line per site in US dollars (owner p4-1), from the dollar figure a
//   moderator verified on an APPROVED past-reputation claim, rounded down (`tradedBucketUsd`);
// - the dollar running total stays for moderators, and the one cancel figure (owner T-017); neither
//   is in a trader-facing answer. Real Postgres.

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
type Who = Awaited<ReturnType<typeof trader>>;

const START = new Date('2026-10-17T12:00:00Z');
const tx = () => randomBytes(32).toString('hex');
const dollars = (d: number): bigint => BigInt(d) * 100n;
const xmr = (n: number): bigint => BigInt(n) * 1_000_000_000_000n;
/** Offer limits wide enough for any amount these tests trade (the line is about XMR, not the offer). */
/** 0.001 XMR: a small trade that still has a fiat value. */
const MILLI = 1_000_000_000n;
const WIDE = { minFiatCents: 1n, maxFiatCents: 10n ** 15n };

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { db: await testDb() }));
  setNow(START);
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

/** A trade of `amountAtomic` between `seller` and `buyer`, driven to `state`, reviews seeded so nothing gates. */
async function trade(seller: Who, buyer: Who, amountAtomic: bigint, o: { state?: 'released' | 'secured'; usdCents?: bigint | null } = {}) {
  const usd = o.usdCents === undefined ? dollars(100) : o.usdCents;
  const { trade: t } = await seedTrade(deps, {
    sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', amountAtomic, ...WIDE, ...(usd === null ? {} : { usdCents: usd }),
  });
  const state = o.state ?? 'released';
  await driveTo(deps, t, state);
  if (state === 'released') await seedReviews(deps, t.code);
  return t.code;
}

const totals = async (id: string) =>
  (await deps.db.query<{ own_usd_cents: string; own_xmr_atomic: string; cancels: number }>(
    'select own_usd_cents, own_xmr_atomic, cancels from account_traded_totals where account_id = $1', [id],
  )).rows[0] ?? null;
/** Round 1's appeal window ends with no appeal: the ruling is final (the dispute timers' step). */
async function closeWindow(code: string) {
  const back = deps.clock();
  setNow(new Date(back.getTime() + 3 * 86_400_000));
  await withDispute(deps, { code }, async (d, _c, at) => applyDispute(d, { type: 'window-closed' }, { kind: 'system' }, at, DISPUTE_DEFAULTS));
  setNow(back);
}
/** The XMR total, '0' with no row (the totals lock step creates an empty row for a party with none: reviews M1, m3). */
const xmrOf = async (id: string) => (await totals(id))?.own_xmr_atomic ?? '0';
const setting = (who: Who) => who.browser.get('/v1/account/profile/traded-total');
const optIn = (who: Who, show: unknown) => who.browser.put('/v1/account/profile/traded-total', { show });
/** The counterparty summary on the trade view: a TraderSummary, as on offer cards. */
const summaryOf = async (viewer: Who, code: string) => {
  const res = await viewer.browser.get(`/v1/trades/${code}`);
  expect(res.statusCode, res.body).toBe(200);
  return { body: res.body, summary: (res.json() as { counterparty: Record<string, unknown> }).counterparty };
};

describe('the running totals', () => {
  it('a released trade adds its XMR and its take-time USD value to both sides once', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(3) + 5n, { usdCents: 1_234_567n });
    const want = { own_usd_cents: '1234567', own_xmr_atomic: (xmr(3) + 5n).toString(), cancels: 0 };
    expect(await totals(seller.id)).toEqual(want);
    expect(await totals(buyer.id)).toEqual(want);
    // Idempotent per trade: counting it again changes nothing.
    const c = await deps.db.connect();
    try {
      await countTradeTotals(c, code);
      await countTradeTotals(c, code);
    } finally {
      c.release();
    }
    expect(await totals(seller.id)).toEqual(want);
    await trade(seller, buyer, xmr(1), { usdCents: 100n });
    expect(await totals(seller.id)).toMatchObject({ own_usd_cents: '1234667', own_xmr_atomic: (xmr(4) + 5n).toString() });
  });

  it('a trade with no stored USD value still counts its XMR; an open trade counts nothing', async () => {
    const seller = await trader();
    const buyer = await trader();
    await trade(seller, buyer, xmr(2), { usdCents: null });
    await trade(seller, buyer, xmr(50), { state: 'secured' });
    expect(await totals(seller.id)).toMatchObject({ own_usd_cents: '0', own_xmr_atomic: xmr(2).toString() });
  });

  it('a refund with no dispute is not completed; a disputed trade counts only once its dispute is decided as a sale (R-012)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const plain = await trade(seller, buyer, xmr(20), { state: 'secured' });
    await applyEvent(deps, plain, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect(await xmrOf(seller.id)).toBe('0');
    // Refunded while the dispute is open: pending, so not counted yet.
    const disputed = await trade(seller, buyer, xmr(30), { state: 'secured' });
    expect((await seller.browser.post(`/v1/trades/${disputed}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await applyEvent(deps, disputed, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect(await xmrOf(seller.id)).toBe('0');
    // Owner Q41: "the total follows the final outcome". A ruling that refunds the seller is a
    // reversal, not a sale: once it is final it is still not counted.
    await rule(disputed, 'refund-to-seller');
    await closeWindow(disputed);
    expect(await xmrOf(seller.id)).toBe('0');
    // A dispute decided as a sale (release to the buyer) counts, once, when it becomes final.
    const sale = await trade(seller, buyer, xmr(7), { state: 'secured' });
    expect((await seller.browser.post(`/v1/trades/${sale}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await rule(sale, 'release-to-buyer');
    expect(await xmrOf(seller.id)).toBe('0');
    await closeWindow(sale);
    expect((await totals(seller.id))!.own_xmr_atomic).toBe(xmr(7).toString());
    expect((await totals(buyer.id))!.own_xmr_atomic).toBe(xmr(7).toString());
    await applyEvent(deps, sale, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
    expect((await totals(seller.id))!.own_xmr_atomic).toBe(xmr(7).toString());
  });

  it('an appeal that reverses a counted trade takes it back off both sides and out of the completed count (R-012)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const keep = await trade(seller, buyer, xmr(2), { usdCents: dollars(50) });
    const code = await trade(seller, buyer, xmr(5), { usdCents: dollars(300) });
    expect(await totals(seller.id)).toMatchObject({ own_usd_cents: '35000', own_xmr_atomic: xmr(7).toString() });
    expect((await summaryOf(buyer, keep)).summary.completedTrades).toBe(2);
    // Late funds escalate it; round 1 releases to the buyer and is appealed: still counted meanwhile.
    await applyEvent(deps, code, { type: 'escalate' }, 'system');
    await rule(code, 'release-to-buyer');
    await appealDirect(deps, code, 'seller');
    expect(await totals(seller.id)).toMatchObject({ own_xmr_atomic: xmr(7).toString() });
    // ...and in the completed count too, matching the totals until the result decides (review m2).
    expect((await summaryOf(buyer, keep)).summary.completedTrades).toBe(2);
    // Round 2 reverses it: the trade comes off both sides' totals and their completed counts.
    await rule(code, 'refund-to-seller');
    for (const id of [seller.id, buyer.id]) expect(await totals(id)).toMatchObject({ own_usd_cents: '5000', own_xmr_atomic: xmr(2).toString() });
    expect((await summaryOf(buyer, keep)).summary.completedTrades).toBe(1);
    // Idempotent: counting again changes nothing.
    const c = await deps.db.connect();
    try {
      await countTradeTotals(c, code);
    } finally {
      c.release();
    }
    expect(await totals(seller.id)).toMatchObject({ own_xmr_atomic: xmr(2).toString() });
  });

  it('a skipped review changes nothing: the trade still counts as completed and in the total (owner 2026-11-02)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', amountAtomic: xmr(15), usdCents: dollars(1), ...WIDE });
    await driveTo(deps, t, 'released');
    expect((await buyer.browser.post(`/v1/trades/${t.code}/review/skip`, {})).statusCode).toBe(204);
    expect((await seller.browser.post(`/v1/trades/${t.code}/review/skip`, {})).statusCode).toBe(204);
    expect((await totals(buyer.id))!.own_xmr_atomic).toBe(xmr(15).toString());
    expect((await optIn(seller, true)).statusCode).toBe(200);
    const { summary } = await summaryOf(buyer, t.code);
    expect(summary).toMatchObject({ completedTrades: 1, tradedOverXmr: 10, imported: [] });
  });

  it('survives the trade purge: the total and the line stay when the trade rows are gone', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(25));
    const other = await trade(seller, buyer, MILLI);
    expect((await optIn(seller, true)).statusCode).toBe(200);
    expect((await summaryOf(buyer, other)).summary.tradedOverXmr).toBe(20);
    // Plan 7's whole-trade purge is not on this tree: remove the trade and everything hanging off
    // it directly (triggers and foreign keys off for this transaction only), then read the total.
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      await c.query('delete from trades where code = $1', [code]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await deps.db.query('select 1 from trades where code = $1', [code])).rowCount).toBe(0);
    expect((await totals(seller.id))!.own_xmr_atomic).toBe((xmr(25) + MILLI).toString());
    expect((await summaryOf(buyer, other)).summary.tradedOverXmr).toBe(20);
  });
});

describe('the opt-in XMR line (owner Q63; off by default)', () => {
  it('off by default: the summary carries tradedOverXmr null; the trader turns it on and off', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(12) + 345n);
    expect((await summaryOf(buyer, code)).summary.tradedOverXmr).toBeNull();
    const own = await setting(seller);
    expect(own.statusCode).toBe(200);
    // The trader sees their own bucket (never the exact total) to decide.
    expect(own.json()).toEqual({ show: false, tradedOverXmr: 10, imported: [] });
    const on = await optIn(seller, true);
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ show: true, tradedOverXmr: 10, imported: [] });
    expect((await summaryOf(buyer, code)).summary.tradedOverXmr).toBe(10);
    expect((await optIn(seller, false)).json()).toEqual({ show: false, tradedOverXmr: 10, imported: [] });
    expect((await summaryOf(buyer, code)).summary.tradedOverXmr).toBeNull();
  });

  it('a plus needs MORE than the step: exactly 10 XMR shows nothing, one atomic unit more shows 10+', async () => {
    const a = { seller: await trader(), buyer: await trader() };
    const exact = await trade(a.seller, a.buyer, xmr(10));
    expect((await optIn(a.seller, true)).json()).toEqual({ show: true, tradedOverXmr: null, imported: [] });
    expect((await summaryOf(a.buyer, exact)).summary.tradedOverXmr).toBeNull();
    const b = { seller: await trader(), buyer: await trader() };
    const more = await trade(b.seller, b.buyer, xmr(10) + 1n);
    expect((await optIn(b.seller, true)).json()).toEqual({ show: true, tradedOverXmr: 10, imported: [] });
    expect((await summaryOf(b.buyer, more)).summary.tradedOverXmr).toBe(10);
  });

  it('the dollar value no longer drives the line (owner Q63: not dollars)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(1), { usdCents: dollars(500_000) });
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverXmr: null, imported: [] });
    expect((await summaryOf(buyer, code)).summary).not.toHaveProperty('tradedOverUsd');
  });

  it('refuses a body that is not { show: boolean }, and a request with no session', async () => {
    const who = await trader();
    for (const show of ['yes', 1, null, undefined]) expect((await optIn(who, show)).statusCode, String(show)).toBe(400);
    expect([401, 403]).toContain((await app.inject({ method: 'PUT', url: '/v1/account/profile/traded-total', payload: { show: true } })).statusCode);
    expect((await app.inject({ method: 'GET', url: '/v1/account/profile/traded-total' })).statusCode).toBe(401);
  });

  it('the exact totals and the cancel figure never appear in any answer', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, 12_345_678_901_234n, { usdCents: 1_234_567n });
    expect((await optIn(seller, true)).statusCode).toBe(200);
    // The trade view shows that trade's own amount, rightly: only its counterparty summary is checked.
    const bodies = [
      JSON.stringify((await summaryOf(buyer, code)).summary),
      (await setting(seller)).body,
      (await seller.browser.get('/v1/account/me')).body,
    ];
    for (const b of bodies) {
      expect(b).not.toMatch(/1234567|12345\.67|12,345|12345678901234|12\.345678|own_usd|own_xmr|usd_?cents|buyer_?cancels|"cancels"/i);
    }
  });
});

// Owner 2 Nov 01:50 (T-017, J-21): "all cancel types grouped into ONE cancel figure, seen ONLY by
// moderators as an extra stat on the account (not public)". Lead default (BLOCKED question for the
// owner): the figure counts each cancelled trade once, for the side that ended it (P5-A9's rule,
// widened to every kind): the buyer's cancel, the seller's walk-away before funding, the PROPOSER
// of an accepted mutual cancel, and the buyer whose time to pay ran out when the seller then
// cancelled. Nobody tapped a time-out (setup, funding lapse) or a hold's system cancel: not counted.
describe('one cancel figure (moderators only)', () => {
  const cancels = async (who: Who) => (await totals(who.id))?.cancels ?? 0;
  const pair = async () => ({ seller: await trader(), buyer: await trader() });
  const recount = async (code: string) => {
    const c = await deps.db.connect();
    try {
      await countTradeTotals(c, code);
    } finally {
      c.release();
    }
  };

  it('a settled buyer cancel counts once for the buyer, never for the seller, and never in a trader-facing answer', async () => {
    const { seller, buyer } = await pair();
    const code = await trade(seller, buyer, xmr(40), { state: 'secured' });
    await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
    await applyEvent(deps, code, { type: 'settled', kind: 'buyer-cancel', txHash: tx() }, 'system');
    expect(await totals(buyer.id)).toEqual({ own_usd_cents: '0', own_xmr_atomic: '0', cancels: 1 });
    expect(await cancels(seller)).toBe(0);
    await recount(code);
    expect(await cancels(buyer)).toBe(1);
    const { summary, body } = await summaryOf(seller, code);
    expect(Object.keys(summary).sort()).toEqual(
      ['badges', 'completedTrades', 'displayName', 'disputes', 'featuredBadges', 'imported', 'lastSeenAt', 'online', 'positivePct', 'stage', 'tradedOverXmr', 'typicalMinutes'],
    );
    // The public cancel rate is gone (owner T-017): no cancel figure of any kind on the trade view.
    expect(body).not.toMatch(/cancelRate|cancel_rate|cancels"|cancelledByMe/i);
  });

  it('a buyer cancel before any coins (the trade closes as cancelled) counts for the buyer', async () => {
    const { seller, buyer } = await pair();
    const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', amountAtomic: xmr(1), ...WIDE });
    await driveTo(deps, t, 'funding');
    const next = await applyEvent(deps, t.code, { type: 'buyer-cancel' }, 'buyer');
    expect(next.state).toBe('cancelled');
    expect([await cancels(buyer), await cancels(seller)]).toEqual([1, 0]);
    await recount(t.code);
    expect(await cancels(buyer)).toBe(1);
  });

  it("the seller's walk-away before funding counts for the seller", async () => {
    const { seller, buyer } = await pair();
    const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', amountAtomic: xmr(1), ...WIDE });
    expect((await applyEvent(deps, t.code, { type: 'walk-away' }, 'seller')).state).toBe('cancelled');
    expect([await cancels(buyer), await cancels(seller)]).toEqual([0, 1]);
  });

  it('an accepted mutual cancel counts for the side that proposed it, before funding and after it', async () => {
    const { seller, buyer } = await pair();
    // Before coins: it closes as cancelled at once.
    const { trade: early } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', amountAtomic: xmr(1), ...WIDE });
    await driveTo(deps, early, 'funding');
    await applyEvent(deps, early.code, { type: 'propose-cancel' }, 'seller');
    expect((await applyEvent(deps, early.code, { type: 'accept-cancel' }, 'buyer')).state).toBe('cancelled');
    expect([await cancels(buyer), await cancels(seller)]).toEqual([0, 1]);
    // Secured: the refund settles later; the proposer is read from the stored events.
    const code = await trade(seller, buyer, xmr(1), { state: 'secured' });
    await applyEvent(deps, code, { type: 'propose-cancel' }, 'buyer');
    await applyEvent(deps, code, { type: 'accept-cancel' }, 'seller');
    await applyEvent(deps, code, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect([await cancels(buyer), await cancels(seller)]).toEqual([1, 1]);
    await recount(code);
    expect([await cancels(buyer), await cancels(seller)]).toEqual([1, 1]);
  });

  it("the seller's cancel after the buyer's time to pay ran out counts for the buyer", async () => {
    const { seller, buyer } = await pair();
    const code = await trade(seller, buyer, xmr(1), { state: 'secured' });
    const row = await deps.db.query<{ pay_by: Date }>('select pay_by from trades where code = $1', [code]);
    setNow(new Date(row.rows[0]!.pay_by.getTime() + 60_000));
    try {
      await applyEvent(deps, code, { type: 'request-refund' }, 'seller');
      await applyEvent(deps, code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system');
    } finally {
      setNow(START);
    }
    expect([await cancels(buyer), await cancels(seller)]).toEqual([1, 0]);
  });

  it('a time-out nobody tapped and a hold\'s system cancel count for nobody; a completed trade is no cancel', async () => {
    const { seller, buyer } = await pair();
    const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', amountAtomic: xmr(1), ...WIDE });
    expect((await applyEvent(deps, t.code, { type: 'system-cancel' }, 'system')).state).toBe('cancelled');
    await trade(seller, buyer, xmr(1));
    expect([await cancels(buyer), await cancels(seller)]).toEqual([0, 0]);
  });
});

// Owner Q64 (6 Nov 2026), p4-1 (7 Nov): imported volume is a separate line per site with proof: the
// dollar figure a moderator verified on an APPROVED claim (migration 310), shown in US dollars and
// rounded down ("$X+ on <site>, verified"; no XMR conversion, no live price). An unverified, not-yet-approved or dead claim shows nothing; the figures never leave the
// server, only the buckets. The XMR line never includes them.
describe('verified imported volume, one line per site (owner Q64)', () => {
  let staffN = 0;
  let staffId: string | undefined;
  const staff = async () =>
    (staffId ??= await seedAccount(deps, { loginName: `ttstaff${++staffN}${randomBytes(3).toString('hex')}`, kind: 'staff' }));
  let site = 0;
  /** A claim (approved unless said; key and signature bytes do not matter here). */
  async function claim(accountId: string, status = 'approved', name?: string): Promise<{ id: string; site: string }> {
    site += 1;
    const s = name ?? `Site${String(site).padStart(3, '0')}`;
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
       values ($1, $2, 'https://web.archive.org/web/2023/x', 10, $3, $4, 'text', $4, $5, $6) returning id`,
      [accountId, s, randomBytes(20).toString('hex'), randomBytes(40), status, START],
    );
    return { id: rows[0]!.id, site: s };
  }
  /** A site's line in whole US dollars (owner p4-1): the step it is MORE than; none at $10,000 or less. */
  const lineOf = (site: string, overUsd: number | null) => (overUsd === null ? [] : [{ site, overUsd }]);
  const verify = async (claimId: string, usdCents: bigint | null) =>
    expect(await setVerifiedPastRepUsd(deps.db, claimId, usdCents === null ? null : Number(usdCents), { accountId: await staff(), role: 'senior' }, START)).toEqual({ ok: true });

  it('each verified, approved site is its own line; the XMR line is not lifted; figures never appear', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(5));
    const a = await claim(seller.id, 'approved', 'LocalMonero');
    const b = await claim(seller.id, 'approved', 'Paxful');
    await verify(a.id, dollars(23_456) + 78n);
    await verify(b.id, dollars(99_000));
    expect((await optIn(seller, true)).json()).toEqual({
      show: true, tradedOverXmr: null, imported: [...lineOf('LocalMonero', 20_000), ...lineOf('Paxful', 90_000)],
    });
    const viewed = await summaryOf(buyer, code);
    expect(viewed.summary).toMatchObject({ tradedOverXmr: null, imported: [...lineOf('LocalMonero', 20_000), ...lineOf('Paxful', 90_000)] });
    expect((await setting(buyer)).json()).toEqual({ show: false, tradedOverXmr: null, imported: [] });
    for (const body of [viewed.body, (await setting(seller)).body]) expect(body).not.toMatch(/2345678|23,456|9900000|99,000|verified_?usd|usd_?cents/i);
  });

  it('off by default: no line for others even with a verified figure; the trader sees their own', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(1));
    const c = await claim(seller.id);
    await verify(c.id, dollars(30_000) + 1n);
    expect((await summaryOf(buyer, code)).summary).toMatchObject({ tradedOverXmr: null, imported: [] });
    expect((await setting(seller)).json()).toEqual({ show: false, tradedOverXmr: null, imported: lineOf(c.site, 30_000) });
  });

  it('a site at $10,000 or less, unverified, cleared, signed or dead shows no line', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, xmr(1));
    expect((await optIn(seller, true)).statusCode).toBe(200);
    await verify((await claim(seller.id)).id, dollars(1));
    await verify((await claim(seller.id)).id, dollars(10_000)); // exactly $10,000: a plus needs MORE
    await claim(seller.id); // never verified
    const signed = await claim(seller.id, 'signed');
    await verify(signed.id, dollars(50_000) + 1n); // entered before approval: counts only once approved
    const cleared = await claim(seller.id);
    await verify(cleared.id, dollars(50_000));
    await verify(cleared.id, null);
    expect((await summaryOf(buyer, code)).summary.imported).toEqual([]);
    await deps.db.query(`update past_reputation set status = 'approved' where id = $1`, [signed.id]);
    expect((await summaryOf(buyer, code)).summary.imported).toEqual(lineOf(signed.site, 50_000));
    for (const dead of ['revoked', 'removed', 'rejected']) {
      await deps.db.query('update past_reputation set status = $2 where id = $1', [signed.id, dead]);
      expect((await summaryOf(buyer, code)).summary.imported, dead).toEqual([]);
    }
  });

  // OWNER-Q (kept from C12b): imported volume with no X2F trades of its own still shows its lines.
  it('verified imported volume alone, with no trades here, shows its line (OWNER-Q)', async () => {
    const solo = await trader();
    const viewer = await trader();
    const c = await claim(solo.id);
    await verify(c.id, dollars(25_000));
    expect(await totals(solo.id)).toBeNull();
    expect((await traderSummaries(deps.db, [solo.id], START, viewer.id)).get(solo.id)).toMatchObject({ tradedOverXmr: null, imported: [] });
    expect((await optIn(solo, true)).json()).toEqual({ show: true, tradedOverXmr: null, imported: lineOf(c.site, 20_000) });
    expect((await traderSummaries(deps.db, [solo.id], START, viewer.id)).get(solo.id)).toMatchObject({ completedTrades: 0, imported: lineOf(c.site, 20_000) });
  });

  // Owner p4-1: the lines are in dollars, so they no longer depend on the live price.
  it('shows the lines while the USD price is paused', async () => {
    const solo = await trader();
    const viewer = await trader();
    const c = await claim(solo.id);
    await verify(c.id, dollars(60_000) + 1n);
    const real = deps.prices;
    deps.prices = { ...real, quote: () => null } as unknown as Deps['prices'];
    try {
      expect((await optIn(solo, true)).json()).toEqual({ show: true, tradedOverXmr: null, imported: lineOf(c.site, 60_000) });
      expect((await traderSummaries(deps.db, [solo.id], START, viewer.id)).get(solo.id)).toMatchObject({ imported: lineOf(c.site, 60_000) });
    } finally {
      deps.prices = real;
    }
  });
});
