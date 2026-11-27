import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { AMOUNT, FIAT, driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// GET /v1/trades (lead job, register D-005's completed-trades list): the caller's own trades, newest
// first, cursor-paged, open or completed. Only fields the trade view already shows that party; a
// team member reads them only with the box for that part (open: See active trades, completed: See
// trade history); a trade deleted by the retention rule (R36) is simply gone.

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let setNow: (d: Date) => void;
let at = Date.parse('2026-10-17T12:00:00.000Z');
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

/** Moves the server clock one minute on, so each seeded trade has its own `takenAt`. */
function tick(): void {
  at += 60_000;
  setNow(new Date(at));
}

type Item = Record<string, unknown> & { code: string; role: string; state: string };
type Page = { trades: Item[]; next: string | null };

const err = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, error: (res.json() as { error?: string }).error });

async function page(b: Browser, query = ''): Promise<Page> {
  const res = await b.get(`/v1/trades${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Page;
}

/** Every page of the list, following `next`, at `limit` a page. */
async function all(b: Browser, status: string | null, limit: number): Promise<Item[]> {
  const out: Item[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status !== null) q.set('status', status);
    if (cursor !== null) q.set('cursor', cursor);
    const p = await page(b, `?${q}`);
    expect(p.trades.length).toBeLessThanOrEqual(limit);
    out.push(...p.trades);
    if (p.next === null) return out;
    cursor = p.next;
  }
  throw new Error('the list never ended');
}

async function member(teamId: string, abilities: string[]): Promise<Browser> {
  const name = `Lister${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `llogin${n}x`, tradeTag: `l-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  await deps.db.query(
    `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5)`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const browser = new Browser(app);
  const res = await browser.post('/t/login', { accountId: loginId });
  expect(res.statusCode, res.body).toBe(200);
  return browser;
}

/** A team member row (no login), for audit rows: its id and name. */
async function teamMember(teamId: string): Promise<{ id: string; name: string }> {
  const name = `Actor${String(++n).padStart(4, '0')}`;
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, created_at)
     values ($1, $2, $3, $4, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), ['trades-see-active'], deps.clock()],
  );
  return { id: rows[0]!.id, name };
}

/** One row of the account's team log (migration 015), as `auditMember` / `auditLead` write it. */
async function audit(accountId: string, memberId: string | null, code: string, action: string, when: Date): Promise<void> {
  await deps.db.query('insert into team_audit (account_id, member_id, at, action, trade_code) values ($1, $2, $3, $4, $5)', [
    accountId, memberId, when, action, code,
  ]);
}

describe('GET /v1/trades', () => {
  it("lists the caller's own trades, newest first, with only the list's fields", async () => {
    const me = await trader();
    const a = await trader();
    const b = await trader();
    const stranger = await trader();
    tick();
    const t1 = await seedTrade(deps, { sellerId: me.id, buyerId: a.id, poster: 'seller' });
    tick();
    const t2 = await seedTrade(deps, { sellerId: b.id, buyerId: me.id, poster: 'seller' });
    tick();
    // Someone else's trade is never listed.
    await seedTrade(deps, { sellerId: a.id, buyerId: stranger.id, poster: 'buyer' });
    tick();
    await driveTo(deps, t1.trade, 'released');

    const p = await page(me.browser);
    expect(p.next).toBeNull();
    expect(p.trades.map((t) => t.code)).toEqual([t2.code, t1.code]);
    expect(p.trades[0]).toEqual({
      code: t2.code,
      role: 'buyer',
      state: 'setup',
      amountAtomic: AMOUNT.toString(),
      fiatCents: FIAT.toString(),
      currency: 'USD',
      counterparty: { tradeTag: b.tradeTag },
      takenAt: t2.trade.takenAt.toISOString(),
      closedAt: null,
      // Plan 3 Task 42: the account owner's open rows say which member last acted (none here).
      lastActedBy: null,
    });
    expect(p.trades[1]).toEqual({
      code: t1.code,
      role: 'seller',
      state: 'released',
      amountAtomic: AMOUNT.toString(),
      fiatCents: FIAT.toString(),
      currency: 'USD',
      counterparty: { tradeTag: a.tradeTag },
      takenAt: t1.trade.takenAt.toISOString(),
      closedAt: new Date(at).toISOString(),
    });
    // Nothing the room keeps to itself: no fee (even to the poster), no address, no payment details, no login name.
    const body = JSON.stringify(p);
    for (const word of ['fee', 'escrow', 'payout', 'refund', 'instructions', 'txHash', a.loginName, b.loginName]) expect(body).not.toContain(word);
    for (const addr of [t1.sides.buyerPayout, t1.sides.sellerRefund, t2.sides.buyerPayout, t2.sides.sellerRefund]) expect(body).not.toContain(addr!);

    // The two parties each see the trade from their own side.
    expect((await page(a.browser)).trades.find((t) => t.code === t1.code)?.role).toBe('buyer');
    expect((await page(stranger.browser)).trades.map((t) => t.code)).not.toContain(t1.code);
  });

  it('splits open from completed: completed is every trade that has closed', async () => {
    const me = await trader();
    const other = await trader();
    tick();
    const open = await seedTrade(deps, { sellerId: me.id, buyerId: other.id, poster: 'seller' });
    tick();
    const paid = await seedTrade(deps, { sellerId: other.id, buyerId: me.id, poster: 'buyer' });
    await driveTo(deps, paid.trade, 'paid');
    tick();
    const done = await seedTrade(deps, { sellerId: me.id, buyerId: other.id, poster: 'buyer' });
    await driveTo(deps, done.trade, 'released');

    expect((await page(me.browser, '?status=open')).trades.map((t) => t.code)).toEqual([paid.code, open.code]);
    expect((await page(me.browser, '?status=completed')).trades.map((t) => t.code)).toEqual([done.code]);
    expect((await page(me.browser)).trades.map((t) => t.code)).toEqual([done.code, paid.code, open.code]);
  });

  it('pages with a cursor: every trade once, in order, ties on the same minute included', async () => {
    const me = await trader();
    const other = await trader();
    const codes: string[] = [];
    for (let i = 0; i < 7; i++) {
      // Three pairs share a takenAt, so the order and the cursor must break ties.
      if (i % 2 === 0) tick();
      codes.push((await seedTrade(deps, { sellerId: me.id, buyerId: other.id, poster: 'seller' })).code);
    }
    const one = await all(me.browser, null, 100);
    expect(one).toHaveLength(7);
    expect(new Set(one.map((t) => t.code))).toEqual(new Set(codes));
    const times = one.map((t) => Date.parse(t.takenAt as string));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    for (const limit of [1, 2, 3]) expect((await all(me.browser, null, limit)).map((t) => t.code)).toEqual(one.map((t) => t.code));
    expect((await all(me.browser, 'open', 2)).map((t) => t.code)).toEqual(one.map((t) => t.code));
    expect(await all(me.browser, 'completed', 2)).toEqual([]);
    // 20 a page by default.
    expect((await page(me.browser)).trades).toHaveLength(7);
  });

  it('refuses a bad filter, cursor or limit (400), and anyone signed out (401)', async () => {
    const me = await trader();
    for (const q of ['?status=closed', '?status=', '?status=open&status=completed', '?limit=0', '?limit=101', '?limit=2.5', '?limit=x', '?cursor=', '?cursor=nope', '?cursor=' + 'A'.repeat(300)]) {
      expect(err(await me.browser.get(`/v1/trades${q}`)), q).toEqual({ status: 400, error: 'bad-request' });
    }
    // Review M1: a cursor in the right shape whose date does not exist is a 400 too, never a 500.
    const code = 'K7M2-9QXA-4FTR-8WPN';
    for (const when of ['2026-02-30T10:00:00.000000', '2026-13-01T10:00:00.000000', '2026-01-01T25:61:61.000000', '0000-01-01T00:00:00.000000']) {
      const cursor = Buffer.from(`${when}|${code}`, 'utf8').toString('base64url');
      expect(err(await me.browser.get(`/v1/trades?cursor=${cursor}`)), when).toEqual({ status: 400, error: 'bad-request' });
    }
    // A real date in that shape still pages.
    const fine = Buffer.from(`2026-02-28T10:00:00.000000|${code}`, 'utf8').toString('base64url');
    expect((await me.browser.get(`/v1/trades?cursor=${fine}`)).statusCode).toBe(200);
    expect((await new Browser(app).get('/v1/trades')).statusCode).toBe(401);
  });

  it("a team member reads the account's trades only with the box for that part", async () => {
    const owner = await trader();
    await makeVendor(deps, owner.id);
    const other = await trader();
    tick();
    const open = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    tick();
    const done = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    await driveTo(deps, done.trade, 'released');

    const active = await member(owner.id, ['trades-see-active']);
    expect((await page(active, '?status=open')).trades.map((t) => [t.code, t.role])).toEqual([[open.code, 'seller']]);
    expect(err(await active.get('/v1/trades?status=completed'))).toEqual({ status: 403, error: 'forbidden' });
    expect((await page(active)).trades.map((t) => t.code)).toEqual([open.code]);

    const history = await member(owner.id, ['trades-see-history']);
    expect((await page(history, '?status=completed')).trades.map((t) => [t.code, t.role])).toEqual([[done.code, 'buyer']]);
    expect(err(await history.get('/v1/trades?status=open'))).toEqual({ status: 403, error: 'forbidden' });
    expect((await page(history)).trades.map((t) => t.code)).toEqual([done.code]);

    const both = await member(owner.id, ['trades-see-active', 'trades-see-history']);
    expect((await page(both)).trades.map((t) => t.code)).toEqual([done.code, open.code]);

    const offersOnly = await member(owner.id, rolesToAbilities(['offers']));
    expect(err(await offersOnly.get('/v1/trades'))).toEqual({ status: 403, error: 'forbidden' });
  });

  it("review I1: a member opens a trade's room only with the box for its part (open: See active trades; completed: See trade history)", async () => {
    const owner = await trader();
    await makeVendor(deps, owner.id);
    const other = await trader();
    tick();
    const open = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    tick();
    const done = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    await driveTo(deps, done.trade, 'released');
    const room = async (b: Browser, c: string) => {
      const res = await b.get(`/v1/trades/${c}`);
      return res.statusCode === 200 ? 200 : err(res);
    };

    const active = await member(owner.id, ['trades-see-active']);
    expect(await room(active, open.code)).toBe(200);
    expect(await room(active, done.code)).toEqual({ status: 403, error: 'forbidden' });

    const history = await member(owner.id, ['trades-see-history']);
    expect(await room(history, done.code)).toBe(200);
    expect(await room(history, open.code)).toEqual({ status: 403, error: 'forbidden' });

    const both = await member(owner.id, ['trades-see-active', 'trades-see-history']);
    expect([await room(both, open.code), await room(both, done.code)]).toEqual([200, 200]);
    // The owner reads both, and a trade not the account's stays a 404 for a member with the box.
    expect([await room(owner.browser, open.code), await room(owner.browser, done.code)]).toEqual([200, 200]);
    const stranger = await seedTrade(deps, { sellerId: other.id, buyerId: (await trader()).id, poster: 'seller' });
    expect(await room(both, stranger.code)).toEqual({ status: 404, error: 'not-found' });
  });

  it("Plan 3 Task 42: the account owner's open rows say which member last acted (team_audit); nobody else gets the field", async () => {
    const owner = await trader();
    await makeVendor(deps, owner.id);
    const other = await trader();
    await makeVendor(deps, other.id);
    tick();
    const acted = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    tick();
    const quiet = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    tick();
    const done = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, done.trade, 'released');
    const first = await teamMember(owner.id);
    const second = await teamMember(owner.id);
    const theirs = await teamMember(other.id);
    const t = (min: number) => new Date(at + min * 60_000);
    await audit(owner.id, first.id, acted.code, 'mark-paid', t(1));
    await audit(owner.id, second.id, acted.code, 'extend', t(2));
    // The lead's own row (member null) is not a member acting.
    await audit(owner.id, null, acted.code, 'release-started', t(3));
    // The other side's team log on the same trade is theirs: never on this account's row.
    await audit(other.id, theirs.id, acted.code, 'mark-paid', t(4));
    await audit(owner.id, first.id, done.code, 'mark-paid', t(1));

    const open = (await page(owner.browser, '?status=open')).trades;
    expect(open.map((r) => [r.code, r.lastActedBy])).toEqual([
      [quiet.code, null],
      [acted.code, { memberName: second.name, at: t(2).toISOString() }],
    ]);
    // The Active trades list only (the plan's words): a completed row has no such field.
    const completed = (await page(owner.browser, '?status=completed')).trades;
    expect(completed.map((r) => r.code)).toEqual([done.code]);
    expect(completed[0]).not.toHaveProperty('lastActedBy');
    // The other account's owner sees their own member, never this account's.
    expect((await page(other.browser, '?status=open')).trades.find((r) => r.code === acted.code)?.lastActedBy).toEqual({
      memberName: theirs.name, at: t(4).toISOString(),
    });
    // Visible to the account owner only: a member, even with both trades boxes, gets no such field.
    const both = await member(owner.id, ['trades-see-active', 'trades-see-history']);
    const seen = (await page(both)).trades;
    expect(seen.map((r) => r.code).sort()).toEqual([acted.code, quiet.code, done.code].sort());
    for (const r of seen) expect(r).not.toHaveProperty('lastActedBy');
    expect(JSON.stringify(seen)).not.toContain(second.name);
  });

  it('a trade deleted by the retention rule (R36) is simply gone: no row, no stub', async () => {
    const me = await trader();
    const other = await trader();
    tick();
    const kept = await seedTrade(deps, { sellerId: me.id, buyerId: other.id, poster: 'seller' });
    tick();
    const gone = await seedTrade(deps, { sellerId: me.id, buyerId: other.id, poster: 'seller' });
    expect((await page(me.browser)).trades.map((t) => t.code)).toEqual([gone.code, kept.code]);
    await deps.db.query('delete from trade_events where code = $1', [gone.code]);
    await deps.db.query('delete from trades where code = $1', [gone.code]);
    const p = await page(me.browser);
    expect(p.trades.map((t) => t.code)).toEqual([kept.code]);
    expect(JSON.stringify(p)).not.toContain(gone.code);
  });
});
