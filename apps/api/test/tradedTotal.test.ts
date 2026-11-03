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

// C12b (owner 2026-11-01/02, via the lead): the opt-in "Completed over $X in trades to date" line.
// Completed trades only (released, or refunded to settle a dispute), valued at the take-time USD
// value (trades.usd_cents), kept in a per-account running total that survives the trade purge,
// shown only as a rounded-down bucket and only when the trader opted in. Also a buyer-cancel count
// for moderators (Plan 4 seam), never in a trader-facing answer. Real Postgres.

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
type Who = Awaited<ReturnType<typeof trader>>;

const START = new Date('2026-10-17T12:00:00Z');
const tx = () => randomBytes(32).toString('hex');
const dollars = (d: number): bigint => BigInt(d) * 100n;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { db: await testDb() }));
  setNow(START);
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

/** A trade between `seller` and `buyer` taken at `usdCents`, driven to `state`, reviews seeded so nothing gates. */
async function trade(seller: Who, buyer: Who, usdCents: bigint | undefined, state: 'released' | 'secured' = 'released') {
  const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', ...(usdCents === undefined ? {} : { usdCents }) });
  await driveTo(deps, t, state);
  if (state === 'released') await seedReviews(deps, t.code);
  return t.code;
}

const totals = async (id: string) =>
  (await deps.db.query<{ own_usd_cents: string; buyer_cancels: number }>('select own_usd_cents, buyer_cancels from account_traded_totals where account_id = $1', [id])).rows[0] ?? null;
const setting = (who: Who) => who.browser.get('/v1/account/profile/traded-total');
const optIn = (who: Who, show: unknown) => who.browser.put('/v1/account/profile/traded-total', { show });
/** The counterparty summary on the trade view: a TraderSummary, as on offer cards. */
const summaryOf = async (viewer: Who, code: string) => {
  const res = await viewer.browser.get(`/v1/trades/${code}`);
  expect(res.statusCode, res.body).toBe(200);
  return { body: res.body, summary: (res.json() as { counterparty: Record<string, unknown> }).counterparty };
};

describe('the running total', () => {
  it('a released trade adds its take-time USD value to both sides once', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, 1_234_567n);
    expect(await totals(seller.id)).toEqual({ own_usd_cents: '1234567', buyer_cancels: 0 });
    expect(await totals(buyer.id)).toEqual({ own_usd_cents: '1234567', buyer_cancels: 0 });
    // Idempotent per trade: counting it again changes nothing.
    const c = await deps.db.connect();
    try {
      await countTradeTotals(c, code);
      await countTradeTotals(c, code);
    } finally {
      c.release();
    }
    expect(await totals(seller.id)).toEqual({ own_usd_cents: '1234567', buyer_cancels: 0 });
    await trade(seller, buyer, 100n);
    expect((await totals(seller.id))!.own_usd_cents).toBe('1234667');
  });

  it('a trade with no stored USD value counts nothing; an open trade counts nothing', async () => {
    const seller = await trader();
    const buyer = await trader();
    await trade(seller, buyer, undefined);
    await trade(seller, buyer, dollars(50_000), 'secured');
    expect((await totals(seller.id))?.own_usd_cents ?? '0').toBe('0');
  });

  it('a refund with no dispute is not completed; a refund that settles a dispute is (whoever won)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const plain = await trade(seller, buyer, dollars(20_000), 'secured');
    await applyEvent(deps, plain, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect((await totals(seller.id))?.own_usd_cents ?? '0').toBe('0');
    const disputed = await trade(seller, buyer, dollars(30_000), 'secured');
    expect((await buyer.browser.post(`/v1/trades/${disputed}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await applyEvent(deps, disputed, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect((await totals(seller.id))!.own_usd_cents).toBe(dollars(30_000).toString());
    expect((await totals(buyer.id))!.own_usd_cents).toBe(dollars(30_000).toString());
  });

  it('a skipped review changes nothing: the trade still counts as completed and in the total (owner 2026-11-02)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', usdCents: dollars(15_000) });
    await driveTo(deps, t, 'released');
    expect((await buyer.browser.post(`/v1/trades/${t.code}/review/skip`, {})).statusCode).toBe(204);
    expect((await seller.browser.post(`/v1/trades/${t.code}/review/skip`, {})).statusCode).toBe(204);
    expect((await totals(buyer.id))!.own_usd_cents).toBe(dollars(15_000).toString());
    expect((await optIn(seller, true)).statusCode).toBe(200);
    const { summary } = await summaryOf(buyer, t.code);
    expect(summary).toMatchObject({ completedTrades: 1, tradedOverUsd: 10_000 });
  });

  it('survives the trade purge: the total and the line stay when the trade rows are gone', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(25_000));
    const other = await trade(seller, buyer, dollars(1));
    expect((await optIn(seller, true)).statusCode).toBe(200);
    expect((await summaryOf(buyer, other)).summary.tradedOverUsd).toBe(20_000);
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
    expect((await totals(seller.id))!.own_usd_cents).toBe(dollars(25_001).toString());
    expect((await summaryOf(buyer, other)).summary.tradedOverUsd).toBe(20_000);
  });
});

describe('the opt-in line (off by default)', () => {
  it('off by default: the summary carries tradedOverUsd null; the trader turns it on and off', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, 1_234_567n);
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
    const own = await setting(seller);
    expect(own.statusCode).toBe(200);
    // The trader sees their own bucket (never the exact total) to decide.
    expect(own.json()).toEqual({ show: false, tradedOverUsd: 10_000 });
    const on = await optIn(seller, true);
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBe(10_000);
    expect((await optIn(seller, false)).json()).toEqual({ show: false, tradedOverUsd: 10_000 });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
  });

  it('opted in below $10,000: nothing shows', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(10_000) - 1n);
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: null });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
  });

  it('opted in at exactly $10,000: nothing shows (owner 2026-11-03: a plus needs MORE than the step)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(10_000));
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: null });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
  });

  it('opted in at $10,000.01: the $10,000+ line shows (owner 2026-11-03: more than the step)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(10_000) + 1n);
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBe(10_000);
  });

  it('opted in at $10,001: the $10,000+ line shows (owner 2026-11-03)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(10_001));
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBe(10_000);
  });

  it('refuses a body that is not { show: boolean }, and a request with no session', async () => {
    const who = await trader();
    for (const show of ['yes', 1, null, undefined]) expect((await optIn(who, show)).statusCode, String(show)).toBe(400);
    expect([401, 403]).toContain((await app.inject({ method: 'PUT', url: '/v1/account/profile/traded-total', payload: { show: true } })).statusCode);
    expect((await app.inject({ method: 'GET', url: '/v1/account/profile/traded-total' })).statusCode).toBe(401);
  });

  it('the exact total and the buyer-cancel count never appear in any answer', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, 1_234_567n);
    expect((await optIn(seller, true)).statusCode).toBe(200);
    const bodies = [
      (await summaryOf(buyer, code)).body,
      (await setting(seller)).body,
      (await seller.browser.get(`/v1/trades/${code}`)).body,
      (await seller.browser.get('/v1/account/me')).body,
    ];
    for (const b of bodies) {
      expect(b).not.toMatch(/1234567|12345\.67|12,345|own_usd|usd_?cents|buyer_?cancels/i);
    }
  });
});

describe('buyer cancels (moderators only, a Plan 4 seam)', () => {
  it('a buyer cancel is counted once for the buyer, never for the seller, and never in a trader-facing answer', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(40_000), 'secured');
    await applyEvent(deps, code, { type: 'settled', kind: 'buyer-cancel', txHash: tx() }, 'system');
    expect(await totals(buyer.id)).toEqual({ own_usd_cents: '0', buyer_cancels: 1 });
    expect((await totals(seller.id))?.buyer_cancels ?? 0).toBe(0);
    const c = await deps.db.connect();
    try {
      await countTradeTotals(c, code);
    } finally {
      c.release();
    }
    expect((await totals(buyer.id))!.buyer_cancels).toBe(1);
    const { summary } = await summaryOf(seller, code);
    expect(Object.keys(summary).sort()).toEqual(
      ['badges', 'completedTrades', 'displayName', 'lastSeenAt', 'online', 'positivePct', 'stage', 'tradedOverUsd', 'typicalMinutes'],
    );
    // A mutual cancel is not a buyer cancel.
    const mutual = await trade(seller, buyer, dollars(1), 'secured');
    await applyEvent(deps, mutual, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect((await totals(buyer.id))!.buyer_cancels).toBe(1);
  });
});

// Owner 2026-11-02 (lead 01:48 and 07:48): the line INCLUDES volume proven on other sites, ONLY
// through the dollar figure a moderator verified on an APPROVED past-reputation claim (migration 310);
// an unverified (null), not-yet-approved or dead claim adds nothing. The figure, like the own total, never leaves the
// server: only the rounded-down bucket does.
describe('moderator-verified imported volume (past reputation)', () => {
  let staffN = 0;
  let staffId: string | undefined;
  const staff = async () =>
    (staffId ??= await seedAccount(deps, { loginName: `ttstaff${++staffN}${randomBytes(3).toString('hex')}`, kind: 'staff' }));
  let site = 0;
  /** A claim (approved unless said; key and signature bytes do not matter here). */
  async function claim(accountId: string, status = 'approved'): Promise<string> {
    site += 1;
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
       values ($1, $2, 'https://web.archive.org/web/2023/x', 10, $3, $4, 'text', $4, $5, $6) returning id`,
      [accountId, `Site${site}`, randomBytes(20).toString('hex'), randomBytes(40), status, START],
    );
    return rows[0]!.id;
  }
  const verify = async (claimId: string, usdCents: bigint | null) =>
    expect(await setVerifiedPastRepUsd(deps.db, claimId, usdCents === null ? null : Number(usdCents), { accountId: await staff(), role: 'senior' }, START)).toEqual({ ok: true });

  it('a verified figure lifts a trader over a step, and never appears in an answer', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(9_000));
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: null });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
    await verify(await claim(seller.id), 234_567n); // $2,345.67: own $9,000 + $2,345.67 = $11,345.67
    expect((await setting(seller)).json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    const viewed = await summaryOf(buyer, code);
    expect(viewed.summary.tradedOverUsd).toBe(10_000);
    // The buyer's own total is not lifted by the seller's claim.
    expect((await setting(buyer)).json()).toEqual({ show: false, tradedOverUsd: null });
    const bodies = [viewed.body, (await setting(seller)).body, (await seller.browser.get(`/v1/trades/${code}`)).body, (await seller.browser.get('/v1/account/me')).body];
    for (const b of bodies) expect(b).not.toMatch(/234567|2345\.67|2,345|1134567|11,345|verified_?usd|usd_?cents/i);
  });

  it('two verified claims add together; off by default even with a verified figure', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(1_000));
    await verify(await claim(seller.id), dollars(30_000));
    await verify(await claim(seller.id), dollars(20_000));
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
    expect((await setting(seller)).json()).toEqual({ show: false, tradedOverUsd: 50_000 });
  });

  it('an unverified claim (null figure) adds nothing', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(9_000));
    await claim(seller.id);
    await claim(seller.id, 'signed');
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: null });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
    // A figure the moderator cleared adds nothing either.
    const cleared = await claim(seller.id);
    await verify(cleared, dollars(5_000));
    expect((await setting(seller)).json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    await verify(cleared, null);
    expect((await setting(seller)).json()).toEqual({ show: true, tradedOverUsd: null });
  });

  it('a verified figure must bring the total to MORE than a step (owner 2026-11-03)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(9_000));
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: null });
    const exact = await claim(seller.id);
    await verify(exact, dollars(1_000)); // exactly $10,000.00: not more than the step
    expect((await setting(seller)).json()).toEqual({ show: true, tradedOverUsd: null });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
    await verify(exact, dollars(1_000) + 1n); // $10,000.01
    expect((await setting(seller)).json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBe(10_000);
  });

  it('owner 2026-11-02: a signed (not yet approved) claim with a figure counts nothing; once approved it counts', async () => {
    const seller = await trader();
    const buyer = await trader();
    const code = await trade(seller, buyer, dollars(9_000));
    const id = await claim(seller.id, 'signed');
    await verify(id, dollars(5_000)); // a moderator may enter the figure before approving
    expect((await optIn(seller, true)).json()).toEqual({ show: true, tradedOverUsd: null });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBeNull();
    await deps.db.query(`update past_reputation set status = 'approved' where id = $1`, [id]);
    expect((await setting(seller)).json()).toEqual({ show: true, tradedOverUsd: 10_000 });
    expect((await summaryOf(buyer, code)).summary.tradedOverUsd).toBe(10_000);
  });

  it('a revoked, removed or rejected claim adds nothing, at once', async () => {
    for (const dead of ['revoked', 'removed', 'rejected']) {
      const seller = await trader();
      const buyer = await trader();
      const code = await trade(seller, buyer, dollars(9_000));
      const id = await claim(seller.id);
      await verify(id, dollars(5_000));
      expect((await optIn(seller, true)).json(), dead).toEqual({ show: true, tradedOverUsd: 10_000 });
      await deps.db.query('update past_reputation set status = $2 where id = $1', [id, dead]);
      expect((await setting(seller)).json(), dead).toEqual({ show: true, tradedOverUsd: null });
      expect((await summaryOf(buyer, code)).summary.tradedOverUsd, dead).toBeNull();
    }
  });

  // OWNER-Q: verified imported volume with no X2F trades of its own. Built: it counts (the owner said
  // the line includes proven imported volume; nothing says it needs an X2F trade first).
  it('verified imported volume alone, with no trades here, counts (OWNER-Q)', async () => {
    const solo = await trader();
    const viewer = await trader();
    await verify(await claim(solo.id), dollars(25_000));
    expect(await totals(solo.id)).toBeNull();
    expect((await setting(solo)).json()).toEqual({ show: false, tradedOverUsd: 20_000 });
    expect((await traderSummaries(deps.db, [solo.id], START, viewer.id)).get(solo.id)!.tradedOverUsd).toBeNull();
    expect((await optIn(solo, true)).json()).toEqual({ show: true, tradedOverUsd: 20_000 });
    expect((await traderSummaries(deps.db, [solo.id], START, viewer.id)).get(solo.id)).toMatchObject({ completedTrades: 0, tradedOverUsd: 20_000 });
  });
});
