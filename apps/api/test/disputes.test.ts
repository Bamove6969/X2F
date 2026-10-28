import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
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

async function disputeRow(code: string) {
  const { rows } = await deps.db.query('select * from disputes where code = $1', [code]);
  return rows[0] as Record<string, unknown> | undefined;
}

async function eventTypes(code: string): Promise<string[]> {
  const { rows } = await deps.db.query<{ t: string }>(`select event->>'type' as t from trade_events where code = $1 order by id`, [code]);
  return rows.map((r) => r.t);
}

/** What Plan 4 writes when a moderator rules (its staff routes are not built yet). */
async function rule(code: string, o: { outcome: string; round?: 1 | 2; ruledAt: Date; appealUntil: Date | null; evidence?: unknown }) {
  await deps.db.query(
    `insert into dispute_rulings (code, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [code, o.round ?? 1, o.outcome, 'The payment is in the seller\'s activity.', JSON.stringify(o.evidence ?? ['The trade chat']), 'sarah.v', o.ruledAt, o.appealUntil],
  );
  await deps.db.query(`update disputes set status = 'ruled' where code = $1`, [code]);
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

  it('lets either side open one while the escrow is securing or secured', async () => {
    const a = await tradeIn('secured');
    expect((await a.seller.browser.post(dispute(a.t.code), { reason: 'silent', note: '' })).statusCode).toBe(200);
    expect(await disputeRow(a.t.code)).toMatchObject({ opened_by: 'seller', reason: 'silent' });
    const b = await tradeIn('securing');
    expect((await b.buyer.browser.post(dispute(b.t.code), { reason: 'other', note: 'x' })).statusCode).toBe(200);
  });

  it('opens a dispute after a refund for the buyer within 90 days, never for the seller, never after', async () => {
    const { buyer, seller, t } = await tradeIn('secured');
    await applyEvent(deps, t.code, { type: 'settled', kind: 'auto-refund', txHash: 'ab'.repeat(32) }, 'system');
    setNow(at(90 * DAY));
    await relogin(buyer, seller);
    const wrong = await seller.browser.post(dispute(t.code), { reason: 'other', note: '' });
    expect(errorOf(wrong)).toBe('wrong-party');
    const ok = await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { afterRefund: boolean }).afterRefund).toBe(true);
    expect(await disputeRow(t.code)).toMatchObject({ after_refund: true });

    const late = await tradeIn('secured');
    await applyEvent(deps, late.t.code, { type: 'settled', kind: 'auto-refund', txHash: 'cd'.repeat(32) }, 'system');
    setNow(at(90 * DAY + 1));
    await relogin(late.buyer);
    const res = await late.buyer.browser.post(dispute(late.t.code), { reason: 'paid', note: '' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('too-late');
    expect(await disputeRow(late.t.code)).toBeUndefined();
  });

  it('refuses a bad body with 400 and changes nothing', async () => {
    const { buyer, t } = await tradeIn('secured');
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
      const res = await buyer.browser.post(dispute(t.code), body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await disputeRow(t.code)).toBeUndefined();
    // A line break and a tab are text.
    expect((await buyer.browser.post(dispute(t.code), { reason: 'paid', note: 'x'.repeat(998) + '\n\t' })).statusCode).toBe(200);
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
    await buyer.browser.post(dispute(t.code), { reason: 'silent', note: 'private to the moderator' });
    const before = (await seller.browser.get(dispute(t.code))).json() as Record<string, unknown>;
    expect(before).toMatchObject({ openedBy: 'buyer', reason: 'silent', moderator: null, dueAt: null });
    expect(JSON.stringify(before)).not.toContain('private to the moderator');
    expect(typeof before.serverNow).toBe('string');

    await deps.db.query(`update disputes set moderator_name = 'sarah.v', moderator_joined_at = $2, due_at = $3 where code = $1`, [
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
    await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
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
    const { buyer, t } = await tradeIn('secured');
    await buyer.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(49 * 60 * MIN) });
    await rule(t.code, { outcome: 'refund-to-seller', round: 2, ruledAt: at(70 * MIN), appealUntil: null });
    const body = (await buyer.browser.get(dispute(t.code))).json() as { ruling: Record<string, unknown> };
    expect(body.ruling).toMatchObject({ round: 2, outcome: 'refund-to-seller', appealUntil: null, destination: null });
  });
});

describe('POST /v1/trades/:code/appeal', () => {
  async function ruled() {
    const x = await tradeIn('secured');
    await x.buyer.browser.post(dispute(x.t.code), { reason: 'paid', note: '' });
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
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(48 * 60 * MIN) });
    setNow(at(48 * 60 * MIN));
    await relogin(seller);
    const late = await seller.browser.post(appeal(t.code), { why: 'The moderator missed my bank statement.' });
    expect(late.statusCode).toBe(409);
    expect(errorOf(late)).toBe('too-late');
    setNow(at(48 * 60 * MIN + 1));
    expect(errorOf(await seller.browser.post(appeal(t.code), { why: 'The moderator missed my bank statement.' }))).toBe('too-late');

    const b = await ruled();
    await rule(b.t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(48 * 60 * MIN) });
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
    await rule(t.code, { outcome: 'refund-to-seller', ruledAt: at(60 * MIN), appealUntil: at(48 * 60 * MIN) });
    setNow(at(2 * 60 * MIN));
    const [a, b] = await Promise.all([
      seller.browser.post(appeal(t.code), { why: 'Please look again at this.' }),
      buyer.browser.post(appeal(t.code), { why: 'Please look again at this.' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const { rows } = await deps.db.query('select count(*)::int as n from dispute_appeals where code = $1', [t.code]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('refuses an appeal unless the dispute is ruled: open, appealed, final and closed all stay as they are', async () => {
    for (const status of ['open', 'appealed', 'final', 'closed']) {
      const { seller, t } = await ruled();
      await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(48 * 60 * MIN) });
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
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(48 * 60 * MIN) });
    setNow(at(2 * 60 * MIN));
    expect((await seller.browser.post(appeal(t.code), { why: 'too short' })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: '         x' })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again at this.', extra: 1 })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again\u0000 at this.' })).statusCode).toBe(400);
    expect((await seller.browser.post(appeal(t.code), { why: 'Please look again\u0008 at this.' })).statusCode).toBe(400);
    const other = await trader();
    expect((await other.browser.post(appeal(t.code), { why: 'Please look again at this.' })).statusCode).toBe(404);
    await rule(t.code, { outcome: 'release-to-buyer', round: 2, ruledAt: at(90 * MIN), appealUntil: null });
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

  it('a trade disputed and settled before shows the new dispute, never the old one as current', async () => {
    const { buyer, t } = await tradeIn('secured');
    await buyer.browser.post(dispute(t.code), { reason: 'paid', note: 'the first one' });
    await rule(t.code, { outcome: 'release-to-buyer', ruledAt: at(60 * MIN), appealUntil: at(49 * 60 * MIN) });
    await buyer.browser.post(appeal(t.code), { why: 'Please look again at this.' });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: 'ef'.repeat(32) }, 'system');
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [t.code, at(2 * 60 * MIN)]);
    setNow(at(3 * 60 * MIN));
    await relogin(buyer);
    expect((await applyEvent(deps, t.code, { type: 'escalate' }, 'system')).state).toBe('disputed');
    const res = await buyer.browser.get(dispute(t.code));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openedBy: 'system', reason: 'escalated', status: 'open', ruling: null, appeal: null, moderator: null });
    expect(await disputeRow(t.code)).toMatchObject({ note: '', closed_at: null });
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
