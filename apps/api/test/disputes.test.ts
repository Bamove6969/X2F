import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { RulingOutcome } from '@x2f/staff';
import { loadDispute } from '../src/disputes/store.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { appealDirect, publishRuling } from './helpers/disputes.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

/** A fresh session at the current test time (a jump of hours or days ends the old one). */
async function relogin(...who: { id: string; browser: { post(url: string, body: unknown): Promise<{ statusCode: number }> } }[]) {
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
}

const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;
const dispute = (code: string) => `/v1/trades/${code}/dispute`;
const appeal = (code: string) => `/v1/trades/${code}/appeal`;

/** A trade in `state` (seller is the poster), with the clock back at START. */
async function tradeIn(state: Parameters<typeof driveTo>[2]) {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade, sides } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, state);
  return { seller, buyer, t, sides };
}

/** The trade's current dispute (its highest `seq`). */
async function disputeRow(code: string) {
  const { rows } = await deps.db.query('select * from disputes where code = $1 order by seq desc limit 1', [code]);
  return rows[0] as Record<string, unknown> | undefined;
}

/** Every dispute the trade has had, oldest first. */
async function disputeRows(code: string) {
  const { rows } = await deps.db.query('select * from disputes where code = $1 order by seq', [code]);
  return rows as Record<string, unknown>[];
}

async function eventTypes(code: string): Promise<string[]> {
  const { rows } = await deps.db.query<{ t: string }>(`select event->>'type' as t from trade_events where code = $1 order by id`, [code]);
  return rows.map((r) => r.t);
}

/**
 * What Plan 4 Task 12 writes when a moderator rules on the trade's current dispute (its staff
 * routes are not built yet), through the dispute machine at `ruledAt` (the clock is put back
 * after): round 1 is published with its 48-hour appeal window (`appealUntil` = ruledAt + 48 h).
 * Round 2 first takes the case through round 1 and an appeal by the seller when it is not there yet.
 */
async function rule(code: string, o: { outcome: RulingOutcome; round?: 1 | 2; ruledAt: Date; appealUntil?: Date | null; evidence?: unknown }) {
  const prev = deps.clock();
  setNow(o.ruledAt);
  try {
    if ((o.round ?? 1) === 2) {
      if ((await loadDispute(deps.db, code))!.status === 'open') await publishRuling(deps, code, { outcome: o.outcome });
      if ((await loadDispute(deps.db, code))!.status === 'published') await appealDirect(deps, code, 'seller');
    }
    const d = await publishRuling(deps, code, { outcome: o.outcome, ...(o.evidence === undefined ? {} : { evidence: o.evidence }) });
    if (o.appealUntil !== undefined) expect(d.round === 1 ? d.appealEndsAt : null).toEqual(o.appealUntil);
  } finally {
    setNow(prev);
  }
}

describe('POST /v1/trades/:code/dispute', () => {
  it('refuses the buyer before the seller\'s confirm window ends, and writes nothing', async () => {
    const { buyer, t } = await tradeIn('paid');
    setNow(at(119 * MIN));
    const res = await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('too-early');
    expect(await disputeRow(t.code)).toBeUndefined();
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
    expect(await eventTypes(t.code)).not.toContain('open-dispute');
  });

  it("refuses the seller too in paid until the confirm window ends (owner p9-4), then opens it", async () => {
    const { seller, t } = await tradeIn('paid');
    setNow(at(119 * MIN));
    const early = await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(early.statusCode).toBe(409);
    expect(errorOf(early)).toBe('too-early');
    expect(await disputeRow(t.code)).toBeUndefined();
    expect(await eventTypes(t.code)).not.toContain('open-dispute');
    setNow(at(120 * MIN));
    expect((await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' })).statusCode).toBe(200);
    expect(await disputeRow(t.code)).toMatchObject({ opened_by: 'seller' });
  });

  it('opens a dispute once the window has ended: the trade, its event and the dispute row in one go', async () => {
    const { buyer, seller, t } = await tradeIn('paid');
    setNow(at(120 * MIN));
    const note = 'I sent $412.50 by Zelle at 10:02 from my own account.';
    const res = await buyer.browser.post(dispute(t.code), { reason: 'paid', note });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ openedBy: 'buyer', reason: 'paid', afterRefund: false, status: 'open', moderator: null, ruling: null, appeal: null });
    expect(body.openedAt).toBe(at(120 * MIN).toISOString());
    expect(body).not.toHaveProperty('note');
    expect((await loadTrade(deps.db, t.code))!.state).toBe('disputed');
    expect(await eventTypes(t.code)).toContain('open-dispute');
    expect(await disputeRow(t.code)).toMatchObject({ opened_by: 'buyer', reason: 'paid', note, after_refund: false, status: 'open' });

    const again = await seller.browser.post(dispute(t.code), { reason: 'silent', note: '' });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('dispute-exists');
    expect(await disputeRow(t.code)).toMatchObject({ opened_by: 'buyer' });
  });

  it("lets the seller open one while the escrow is securing or secured, never the buyer before I've paid (proto review P1)", async () => {
    const a = await tradeIn('secured');
    expect((await a.seller.browser.post(dispute(a.t.code), { reason: 'silent', note: '' })).statusCode).toBe(200);
    expect(await disputeRow(a.t.code)).toMatchObject({ opened_by: 'seller', reason: 'silent' });
    const b = await tradeIn('securing');
    expect(errorOf(await b.buyer.browser.post(dispute(b.t.code), { reason: 'other', note: 'x' }))).toBe('too-early');
    expect(errorOf(await a.buyer.browser.post(dispute(a.t.code), { reason: 'other', note: 'x' }))).toBe('dispute-exists');
    const c = await tradeIn('secured');
    expect(errorOf(await c.buyer.browser.post(dispute(c.t.code), { reason: 'paid', note: '' }))).toBe('too-early');
    expect(await disputeRow(c.t.code)).toBeUndefined();
    expect((await b.seller.browser.post(dispute(b.t.code), { reason: 'other', note: 'x' })).statusCode).toBe(200);
  });

  it('opens a dispute after a refund for the buyer within 48 hours (owner 2026-10-29), never for the seller, never after', async () => {
    const { buyer, seller, t } = await tradeIn('secured');
    await applyEvent(deps, t.code, { type: 'settled', kind: 'auto-refund', txHash: 'ab'.repeat(32) }, 'system');
    setNow(at(2 * DAY));
    await relogin(buyer, seller);
    const wrong = await seller.browser.post(dispute(t.code), { reason: 'other', note: '' });
    expect(errorOf(wrong)).toBe('wrong-party');
    const ok = await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { afterRefund: boolean }).afterRefund).toBe(true);
    expect(await disputeRow(t.code)).toMatchObject({ after_refund: true });

    const late = await tradeIn('secured');
    await applyEvent(deps, late.t.code, { type: 'settled', kind: 'auto-refund', txHash: 'cd'.repeat(32) }, 'system');
    setNow(at(2 * DAY + 1));
    await relogin(late.buyer);
    const res = await late.buyer.browser.post(dispute(late.t.code), { reason: 'paid', note: '' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('too-late');
    expect(await disputeRow(late.t.code)).toBeUndefined();
  });

  it('refuses a bad body with 400 and changes nothing', async () => {
    const { seller, t } = await tradeIn('secured');
    for (const body of [
      {},
      { reason: 'paid' },
      { note: 'x' },
      { reason: 'not-received', note: '' },
      { reason: 'paid', note: 'x'.repeat(1001) },
      { reason: 'paid', note: 7 },
      { reason: 'paid', note: '', by: 'seller' },
      { reason: 'paid', note: '', type: 'open-dispute' },
      // Postgres refuses U+0000 in text (a 500 before this fix); other C0 controls are refused too.
      { reason: 'paid', note: 'a\u0000b' },
      { reason: 'paid', note: 'a\u0007b' },
      { reason: 'paid', note: 'a\u001bb' },
    ]) {
      const res = await seller.browser.post(dispute(t.code), body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await disputeRow(t.code)).toBeUndefined();
    // A line break and a tab are text.
    expect((await seller.browser.post(dispute(t.code), { reason: 'paid', note: 'x'.repeat(998) + '\n\t' })).statusCode).toBe(200);
  });

  it('answers 404 to an outsider and an unknown code, 403 to staff, 401 without a session', async () => {
    const { t } = await tradeIn('secured');
    const other = await trader();
    expect((await other.browser.post(dispute(t.code), { reason: 'paid', note: '' })).statusCode).toBe(404);
    expect((await other.browser.post(dispute('ZZZZ-ZZZZ-ZZZZ-ZZZZ'), { reason: 'paid', note: '' })).statusCode).toBe(404);
    expect((await other.browser.get(dispute(t.code))).statusCode).toBe(404);
    const staff = await trader('staff');
    expect(errorOf(await staff.browser.post(dispute(t.code), { reason: 'paid', note: '' }))).toBe('wrong-account-kind');
    const anon = await app.inject({ method: 'POST', url: dispute(t.code), headers: { origin: 'https://x2f.test' }, payload: { reason: 'paid', note: '' } });
    expect(anon.statusCode).toBe(401);
    expect(await disputeRow(t.code)).toBeUndefined();
  });

  it('is the only way to open a dispute: the events route refuses open-dispute (every dispute has its reason)', async () => {
    const { buyer, t } = await tradeIn('secured');
    const res = await buyer.browser.post(`/v1/trades/${t.code}/events`, { type: 'open-dispute' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe('event-not-allowed');
    expect((await loadTrade(deps.db, t.code))!.state).toBe('secured');
  });
});

describe('GET /v1/trades/:code/dispute', () => {
  it('is 404 before a dispute, then shows the dispute, the moderator once joined, and never the note', async () => {
    const { buyer, seller, t } = await tradeIn('secured');
    expect((await buyer.browser.get(dispute(t.code))).statusCode).toBe(404);
    await seller.browser.post(dispute(t.code), { reason: 'silent', note: 'private to the moderator' });
    const before = (await seller.browser.get(dispute(t.code))).json() as Record<string, unknown>;
    expect(before).toMatchObject({ openedBy: 'seller', reason: 'silent', moderator: null, dueAt: at(48 * 60 * MIN).toISOString() });
    expect(JSON.stringify(before)).not.toContain('private to the moderator');
    expect(typeof before.serverNow).toBe('string');

    await deps.db.query(`update disputes set moderator_name = 'sarah.v', moderator_joined_at = $2, ruling_due_at = $3 where code = $1`, [
      t.code, at(38 * MIN), at(DAY),
    ]);
    const after = (await buyer.browser.get(dispute(t.code))).json() as Record<string, unknown>;
    expect(after).toMatchObject({ moderator: { name: 'sarah.v', joinedAt: at(38 * MIN).toISOString() }, dueAt: at(DAY).toISOString() });
  });

  it('shows the ruling, with the destination ending only to the side it pays, and never a whole address', async () => {
    const { buyer, seller, t, sides } = await tradeIn('secured');
    await deps.db.query(`insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $3)`, [
      buyer.id, sides.buyerPayout, START,
    ]);
    await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(2 * 60 * MIN), appealUntil: at(50 * 60 * MIN), evidence: ['The trade chat, 09:40 to 13:55', 7] });
    const mine = (await buyer.browser.get(dispute(t.code))).json() as { ruling: Record<string, unknown>; status: string };
    expect(mine.status).toBe('ruled');
    expect(mine.ruling).toMatchObject({
      round: 1,
      outcome: 'release-to-buyer',
      reason: "The payment is in the seller's activity.",
      evidence: ['The trade chat, 09:40 to 13:55'],
      moderatorName: 'sarah.v',
      ruledAt: at(2 * 60 * MIN).toISOString(),
      appealUntil: at(50 * 60 * MIN).toISOString(),
      destination: { walletApp: 'cake', addressEnd: sides.buyerPayout!.slice(-6) },
    });
    const theirs = (await seller.browser.get(dispute(t.code))).json() as { ruling: Record<string, unknown> };
    expect(theirs.ruling.destination).toBeNull();
    for (const body of [mine, theirs]) {
      expect(JSON.stringify(body)).not.toContain(sides.buyerPayout!);
      expect(JSON.stringify(body)).not.toContain(sides.sellerRefund!);
    }
  });

  it('shows the appeal round over the first one', async () => {
    const { buyer, seller, t } = await tradeIn('secured');
    await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(49 * 60 * MIN) });
    await rule(t.code, { outcome: 'refund-to-seller', round: 2, ruledAt: at(70 * MIN), appealUntil: null });
    const body = (await buyer.browser.get(dispute(t.code))).json() as { ruling: Record<string, unknown> };
    expect(body.ruling).toMatchObject({ round: 2, outcome: 'refund-to-seller', appealUntil: null, destination: null });
  });
});

describe('POST /v1/trades/:code/appeal', () => {
  async function ruled() {
    const x = await tradeIn('secured');
    await x.seller.browser.post(dispute(x.t.code), { reason: 'paid', note: '' });
    return x;
  }

  it('refuses an appeal before there is a ruling', async () => {
    const { seller, t } = await ruled();
    const res = await seller.browser.post(appeal(t.code), { why: 'The moderator missed my bank statement.' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-state');
  });

  it('accepts one appeal inside the window, and refuses it at the end of the window and after', async () => {
    const { seller, t } = await ruled();
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: START, appealUntil: at(48 * 60 * MIN) });
    setNow(at(48 * 60 * MIN));
    await relogin(seller);
    const late = await seller.browser.post(appeal(t.code), { why: 'The moderator missed my bank statement.' });
    expect(late.statusCode).toBe(409);
    expect(errorOf(late)).toBe('too-late');
    setNow(at(48 * 60 * MIN + 1));
    expect(errorOf(await seller.browser.post(appeal(t.code), { why: 'The moderator missed my bank statement.' }))).toBe('too-late');

    const b = await ruled();
    await rule(b.t.code, { outcome: 'release-to-buyer', ruledAt: START, appealUntil: at(48 * 60 * MIN) });
    setNow(at(48 * 60 * MIN - 1));
    await relogin(b.seller, b.buyer);
    const ok = await b.seller.browser.post(appeal(b.t.code), { why: 'The moderator missed my bank statement.' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'appealed', appeal: { by: 'seller', at: at(48 * 60 * MIN - 1).toISOString() } });
    expect(JSON.stringify(ok.json())).not.toContain('bank statement');
    const second = await b.buyer.browser.post(appeal(b.t.code), { why: 'I want a second look as well.' });
    expect(errorOf(second)).toBe('wrong-state');
  });

  it('stores exactly one appeal when both sides appeal at the same moment', async () => {
    const { seller, buyer, t } = await ruled();
    await rule(t.code, { outcome: 'refund-to-seller', ruledAt: START, appealUntil: at(48 * 60 * MIN) });
    setNow(at(2 * 60 * MIN));
    const [a, b] = await Promise.all([
      seller.browser.post(appeal(t.code), { why: 'Please look again at this.' }),
      buyer.browser.post(appeal(t.code), { why: 'Please look again at this.' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const { rows } = await deps.db.query('select count(*)::int as n from dispute_appeals where code = $1', [t.code]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('refuses an appeal unless round 1 is published: every other machine status stays as it is', async () => {
    for (const status of ['open', 'awaiting-approval', 'appealed', 'final', 'complying', 'closed']) {
      const { seller, t } = await ruled();
      await rule(t.code, { outcome: 'release-to-buyer', ruledAt: START, appealUntil: at(48 * 60 * MIN) });
      await deps.db.query(`update disputes set status = $2, closed_at = case when $2 = 'closed' then now() end where code = $1`, [t.code, status]);
      setNow(at(2 * 60 * MIN));
      const res = await seller.browser.post(appeal(t.code), { why: 'Please look again at this.' });
      expect(res.statusCode, status).toBe(409);
      expect(errorOf(res), status).toBe('wrong-state');
      expect(await disputeRow(t.code), status).toMatchObject({ status });
      const { rows } = await deps.db.query('select count(*)::int as n from dispute_appeals where code = $1', [t.code]);
      expect(rows[0], status).toEqual({ n: 0 });
    }
  });

  it('refuses an appeal on a final (appeal-round) ruling, a short reason, and an outsider', async () => {
    const { seller, buyer, t } = await ruled();
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: START, appealUntil: at(48 * 60 * MIN) });
    setNow(at(2 * 60 * MIN));
    expect((await seller.browser.post(appeal(t.code), { why: 'too short' })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: '         x' })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again at this.', extra: 1 })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again\u0000 at this.' })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again\u0008 at this.' })).statusCode).toBe(400);
    const other = await trader();
    expect((await other.browser.post(appeal(t.code), { why: 'Please look again at this.' })).statusCode).toBe(404);
    await rule(t.code, { outcome: 'release-to-buyer', round: 2, ruledAt: at(90 * MIN), appealUntil: null });
    // Even with the status put back to 'published', a round-2 ruling has no appeal (it is binding).
    await deps.db.query(`update disputes set status = 'published' where code = $1`, [t.code]);
    expect(errorOf(await buyer.browser.post(appeal(t.code), { why: 'Please look again at this.' }))).toBe('wrong-state');
  });
});

describe('a dispute the system escalates (late funds, a lapse nobody refunded)', () => {
  it('writes the dispute row with the trade, so both sides see the dispute and can appeal its ruling', async () => {
    const { buyer, seller, t } = await tradeIn('released');
    setNow(at(3 * 60 * MIN));
    await relogin(buyer, seller);
    const next = await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    expect(next.state).toBe('disputed');
    expect(await disputeRow(t.code)).toMatchObject({ opened_by: 'system', reason: 'escalated', note: '', after_refund: false, status: 'open', closed_at: null });
    for (const who of [buyer, seller]) {
      const res = await who.browser.get(dispute(t.code));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ openedBy: 'system', reason: 'escalated', status: 'open', openedAt: at(3 * 60 * MIN).toISOString(), ruling: null, appeal: null });
    }
    // Neither side can open a second one on top of it.
    expect(errorOf(await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' }))).toBe('dispute-exists');

    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(4 * 60 * MIN), appealUntil: at(52 * 60 * MIN) });
    setNow(at(5 * 60 * MIN));
    await relogin(seller);
    const res = await seller.browser.post(appeal(t.code), { why: 'The moderator missed my bank statement.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'appealed', appeal: { by: 'seller' } });
  });

  it('a re-escalation opens a new dispute and keeps every earlier dispute, ruling, appeal and note as they were', async () => {
    // The reviewer's probe: a dispute gets a final round-2 ruling, the trade is released,
    // then late funds escalate it (twice). Nothing of the earlier disputes is deleted or wiped.
    const { buyer, seller, t } = await tradeIn('secured');
    await seller.browser.post(dispute(t.code), { reason: 'paid', note: 'the first one' });
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(49 * 60 * MIN) });
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again at this.' })).statusCode).toBe(200);
    await rule(t.code, { outcome: 'release-to-buyer', round: 2, ruledAt: at(90 * MIN), appealUntil: null });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: 'ef'.repeat(32) }, 'system');
    setNow(at(3 * 60 * MIN));
    await relogin(buyer, seller);
    expect((await applyEvent(deps, t.code, { type: 'escalate' }, 'system')).state).toBe('disputed');

    const all = await disputeRows(t.code);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ seq: 1, opened_by: 'seller', reason: 'paid', note: 'the first one', status: 'final' });
    expect(all[1]).toMatchObject({ seq: 2, opened_by: 'system', reason: 'escalated', note: '', status: 'open', closed_at: null });
    const rulings = await deps.db.query('select seq, round, outcome from dispute_rulings where code = $1 order by seq, round', [t.code]);
    expect(rulings.rows).toEqual([{ seq: 1, round: 1, outcome: 'release-to-buyer' }, { seq: 1, round: 2, outcome: 'release-to-buyer' }]);
    const appeals = await deps.db.query('select seq, by, why from dispute_appeals where code = $1', [t.code]);
    expect(appeals.rows).toEqual([{ seq: 1, by: 'seller', why: 'Please look again at this.' }]);

    // GET shows the new dispute as current, with none of the earlier one's ruling or appeal.
    const res = await buyer.browser.get(dispute(t.code));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openedBy: 'system', reason: 'escalated', status: 'open', ruling: null, appeal: null, moderator: null });

    // The new dispute is ruled and appealed on its own: the earlier appeal does not block it.
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(4 * 60 * MIN), appealUntil: at(52 * 60 * MIN) });
    setNow(at(5 * 60 * MIN));
    await relogin(seller);
    expect((await seller.browser.post(appeal(t.code), { why: 'The late deposit is mine.' })).json()).toMatchObject({ status: 'appealed', appeal: { by: 'seller' } });
    await rule(t.code, { outcome: 'release-to-buyer', round: 2, ruledAt: at(6 * 60 * MIN), appealUntil: null });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: 'aa'.repeat(32) }, 'system');
    expect((await applyEvent(deps, t.code, { type: 'escalate' }, 'system')).state).toBe('disputed');
    expect((await disputeRows(t.code)).map((d) => [d.seq, d.status])).toEqual([[1, 'final'], [2, 'final'], [3, 'open']]);
    const counts = await deps.db.query<{ r: number; a: number }>(
      'select (select count(*)::int from dispute_rulings where code = $1) as r, (select count(*)::int from dispute_appeals where code = $1) as a',
      [t.code],
    );
    expect(counts.rows[0]).toEqual({ r: 4, a: 2 });
  });

  it('rolls the escalation back when its dispute row cannot be written: the trade stays as it was, no event', async () => {
    const { t } = await tradeIn('released');
    setNow(at(3 * 60 * MIN));
    const before = await eventTypes(t.code);
    // A test-only trigger makes the dispute insert fail for this one trade.
    await deps.db.query(`create function t27_refuse() returns trigger language plpgsql as $$
      begin if new.code = '${t.code}' then raise exception 't27 probe'; end if; return new; end $$`);
    await deps.db.query('create trigger t27_refuse before insert on disputes for each row execute function t27_refuse()');
    try {
      await expect(applyEvent(deps, t.code, { type: 'escalate' }, 'system')).rejects.toThrow('t27 probe');
    } finally {
      await deps.db.query('drop trigger t27_refuse on disputes');
      await deps.db.query('drop function t27_refuse()');
    }
    expect((await loadTrade(deps.db, t.code))!.state).toBe('released');
    expect(await eventTypes(t.code)).toEqual(before);
    expect(await disputeRows(t.code)).toEqual([]);
  });
});

describe('one dispute per trade opening, whatever the dispute rows say', () => {
  it('refuses a second dispute on a refunded trade that had one, even once its rows are gone', async () => {
    // The reviewer's probe: the buyer disputes, the final ruling is refund-to-seller, the trade
    // settles to refunded and the dispute closes. Inside the 48-hour window (TIMERS.disputeAfterRefundHours) the buyer may not
    // re-open the decided case, before or after any purge of the dispute rows.
    const { buyer, seller, t } = await tradeIn('secured');
    await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    await rule(t.code, { outcome: 'refund-to-seller', round: 2, ruledAt: at(60 * MIN), appealUntil: null });
    expect((await applyEvent(deps, t.code, { type: 'settled', kind: 'mutual-cancel', txHash: 'bc'.repeat(32) }, 'system')).state).toBe('refunded');
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [t.code, at(2 * 60 * MIN)]);
    setNow(at(10 * DAY));
    await relogin(buyer);
    const first = await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(first.statusCode).toBe(409);
    expect(errorOf(first)).toBe('dispute-exists');

    // As a purge would (Plan 4 Task 23): the rows go, the trade's dispute field stays.
    await deps.db.query('delete from dispute_appeals where code = $1', [t.code]);
    await deps.db.query('delete from dispute_rulings where code = $1', [t.code]);
    await deps.db.query('delete from disputes where code = $1', [t.code]);
    setNow(at(31 * DAY));
    await relogin(buyer);
    const again = await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('dispute-exists');
    expect((await loadTrade(deps.db, t.code))!.state).toBe('refunded');
    expect(await disputeRows(t.code)).toEqual([]);
  });
});

describe('dispute records (108, 110)', () => {
  it('closed and closed_at go together', async () => {
    const { seller, t } = await tradeIn('secured');
    await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    await expect(deps.db.query(`update disputes set status = 'closed' where code = $1`, [t.code])).rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query(`update disputes set closed_at = now() where code = $1`, [t.code])).rejects.toMatchObject({ code: '23514' });
  });

  it('a trade with a dispute cannot be deleted until its dispute records are handled (no cascade)', async () => {
    const { seller, t } = await tradeIn('secured');
    await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(49 * 60 * MIN) });
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await client.query('set local role x2f_purge');
      await client.query('delete from trade_events where code = $1', [t.code]);
      await client.query('reset role');
      await expect(client.query('delete from trades where code = $1', [t.code])).rejects.toMatchObject({ code: '23503' });
      await client.query('rollback');
      await client.query('begin');
      // Nor can a dispute be deleted from under its ruling.
      await expect(client.query('delete from disputes where code = $1', [t.code])).rejects.toMatchObject({ code: '23503' });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('a dispute opening is delivered live (Task 19)', () => {
  it('publishes exactly one open-dispute trade event, by the side that opened it', async () => {
    const published: { type: string; by: string; state: string }[] = [];
    const live = await tradeApp({ tradePublish: async (t, e, by) => void published.push({ type: e.type, by, state: t.state }) });
    try {
      const seller = await live.trader();
      const buyer = await live.trader();
      const { trade } = await seedTrade(live.deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      await driveTo(live.deps, trade, 'secured');
      published.length = 0;
      expect((await seller.browser.post(dispute(trade.code), { reason: 'silent', note: '' })).statusCode).toBe(200);
      expect(published).toEqual([{ type: 'open-dispute', by: 'seller', state: 'disputed' }]);
    } finally {
      await live.app.close();
    }
  });
});
