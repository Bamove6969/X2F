// Plan 4 Task 10: disputes for traders on top of Plan 3 Task 27's routes. The dispute machine
// (`@x2f/staff`) is now the source of truth for status and deadlines: opening snapshots the
// settings and the USD value, the appeal runs through the machine with R37's involvement list, a
// timer closes the 48-hour appeal window and maintenance shifts every running deadline (A7).
// Owner 2026-11-02: a dispute alone never blocks trading (a freeze is Task 11's separate action).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../../src/app.js';
import { DISPUTE_DEFAULTS } from '../../src/disputes/settings.js';
import { loadDispute } from '../../src/disputes/store.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { appendLog } from '../../src/log/append.js';
import { applyEvent } from '../../src/trades/store.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { FIAT, driveTo, seedTrade } from '../helpers/trades.js';
import { tradeApp } from '../helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-11-02T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;
const dispute = (code: string) => `/v1/trades/${code}/dispute`;
const appeal = (code: string) => `/v1/trades/${code}/appeal`;
const WHY = 'The moderator missed my bank statement.';

async function relogin(...who: { id: string; browser: { post(url: string, body: unknown): Promise<{ statusCode: number }> } }[]) {
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
}

/** A trade in `state` with the clock at `from` (default START). */
async function tradeIn(state: Parameters<typeof driveTo>[2], from = START) {
  setNow(from);
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, state);
  setNow(from);
  await relogin(seller, buyer);
  return { seller, buyer, t };
}

/**
 * A trade the buyer disputed at `from`: marked paid at the seller's confirm window (120 min in
 * seedTrade) before `from`, since the buyer can't dispute before "I've paid" nor before the
 * window ends (design proto review P1, 8 Nov).
 */
async function disputed(from = START) {
  const x = await tradeIn('paid', new Date(from.getTime() - 120 * MIN));
  expect(x.t.confirmBy).toEqual(from);
  setNow(from);
  await relogin(x.seller, x.buyer);
  const res = await x.buyer.browser.post(dispute(x.t.code), { reason: 'paid', note: '' });
  expect(res.statusCode, res.body).toBe(200);
  return x;
}

async function row(code: string) {
  const { rows } = await deps.db.query('select * from disputes where code = $1 order by seq desc limit 1', [code]);
  return rows[0] as Record<string, unknown>;
}

async function logOf(code: string) {
  const { rows } = await deps.db.query<{ action: string; actor_kind: string; detail: string }>(
    'select action, actor_kind, detail from activity_log where trade_code = $1 order by id',
    [code],
  );
  return rows.map((r) => ({ action: r.action, actor: r.actor_kind, detail: JSON.parse(r.detail) as unknown }));
}

const tick = () => disputeTimerJob().run(deps.db, deps.clock());

describe('opening a dispute', () => {
  it('stores the machine state: deadlines from the settings, the USD value and the limit snapshot; logs dispute.opened', async () => {
    const { buyer, t } = await disputed();
    const d = (await loadDispute(deps.db, t.code))!;
    expect(d).toMatchObject({
      code: t.code,
      seq: 1,
      openedBy: 'buyer',
      afterRefund: false,
      status: 'open',
      round: 1,
      assignee: null,
      replyDueAt: at(DISPUTE_DEFAULTS.firstResponseH * H),
      rulingDueAt: at(48 * H),
      usdCents: FIAT,
      limitUsdCents: BigInt(DISPUTE_DEFAULTS.largeTradeLimitUsd) * 100n,
      ruling: null,
      round1: null,
      seen: [],
    });
    const view = (await buyer.browser.get(dispute(t.code))).json() as Record<string, unknown>;
    expect(view).toMatchObject({
      status: 'open',
      round: 1,
      dueAt: iso(48 * H),
      // Owner 2026-11-03: the goal is every dispute resolved within 24 hours (RULING_GOAL_H).
      goalAt: iso(24 * H),
      replyDueAt: iso(4 * H),
      firstReplyAt: null,
      complyBy: null,
    });
    expect(await logOf(t.code)).toContainEqual({ action: 'dispute.opened', actor: 'trader', detail: { reason: 'paid', afterRefund: false, seq: 1 } });
  });

  it('the seller opens one with "I haven\'t received the payment" (reason codes are relative to the opener)', async () => {
    const { seller, t } = await tradeIn('secured');
    const res = await seller.browser.post(dispute(t.code), { reason: 'paid', note: '' });
    expect(res.statusCode).toBe(200);
    expect((await loadDispute(deps.db, t.code))!.openedBy).toBe('seller');
  });

  it('a second opening is dispute-exists and a third party gets 404', async () => {
    const { seller, t } = await disputed();
    expect(errorOf(await seller.browser.post(dispute(t.code), { reason: 'silent', note: '' }))).toBe('dispute-exists');
    const other = await trader();
    expect((await other.browser.post(dispute(t.code), { reason: 'silent', note: '' })).statusCode).toBe(404);
    expect((await other.browser.get(dispute(t.code))).statusCode).toBe(404);
  });

  it('snapshots the large-trade limit and first-reply time: a later settings edit changes neither', async () => {
    try {
      await deps.db.query('update settings set large_trade_limit_usd = 300, first_response_h = 2');
      const { buyer, t } = await disputed();
      await deps.db.query('update settings set large_trade_limit_usd = 5000, first_response_h = 8');
      const d = (await loadDispute(deps.db, t.code))!;
      expect(d).toMatchObject({ limitUsdCents: 30_000n, replyDueAt: at(2 * H) });
      // $412.50 against the $300 snapshot: a ruling on it needs two people, whatever the setting is now.
      expect(d.usdCents >= d.limitUsdCents).toBe(true);
      expect(((await buyer.browser.get(dispute(t.code))).json() as Record<string, unknown>).replyDueAt).toBe(iso(2 * H));
    } finally {
      await deps.db.query('update settings set large_trade_limit_usd = 1000, first_response_h = 4');
    }
  });

  it('places no trading hold on either side (owner 2026-11-02: a dispute alone never blocks trading)', async () => {
    const { buyer, seller } = await disputed();
    const { rows } = await deps.db.query('select 1 from trading_holds where account_id = any($1)', [[buyer.id, seller.id]]);
    expect(rows).toEqual([]);
  });

  it('a dispute the system escalates gets the same machine state', async () => {
    const { t } = await tradeIn('released');
    setNow(at(3 * H));
    await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    const d = (await loadDispute(deps.db, t.code))!;
    expect(d).toMatchObject({ openedBy: 'system', status: 'open', replyDueAt: at(7 * H), rulingDueAt: at(51 * H), usdCents: FIAT });
  });
});

describe('the queue position', () => {
  it('is 1 + the unassigned open disputes with an earlier reply deadline, while unassigned', async () => {
    // Only this test's disputes are unassigned and open.
    await deps.db.query(`update disputes set assignee = gen_random_uuid() where assignee is null`);
    const older = await disputed(at(100 * H));
    const mine = await disputed(at(100 * H + MIN));
    const view = (await mine.buyer.browser.get(dispute(mine.t.code))).json() as Record<string, unknown>;
    expect(view.queuePosition).toBe(2);
    expect(((await older.buyer.browser.get(dispute(older.t.code))).json() as Record<string, unknown>).queuePosition).toBe(1);
    await deps.db.query(`update disputes set assignee = gen_random_uuid() where code = $1`, [mine.t.code]);
    expect(((await mine.buyer.browser.get(dispute(mine.t.code))).json() as Record<string, unknown>).queuePosition).toBeNull();
  });
});

describe('the appeal (one only, within 48 hours of the ruling)', () => {
  it('goes through the machine: round 2, the appeal stored once, appeal.opened logged with R37\'s involved list', async () => {
    const { buyer, seller, t } = await disputed();
    setNow(at(H));
    const modId = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
    // The moderator opened the case before ruling (any log entry counts as involvement, R37).
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await appendLog(client, { at: at(H), actor: { kind: 'staff', id: modId, role: 'mod' }, tradeCode: t.code, action: 'case.opened', detail: {} });
      await client.query('commit');
    } finally {
      client.release();
    }
    await publishRuling(deps, t.code, { outcome: 'release-to-buyer', staffId: modId });
    expect((await buyer.browser.get(dispute(t.code))).json()).toMatchObject({ status: 'ruled', ruling: { appealUntil: iso(49 * H) } });
    setNow(at(2 * H));
    await relogin(seller, buyer);
    const res = await seller.browser.post(appeal(t.code), { why: WHY });
    expect(res.statusCode, res.body).toBe(200);
    // The appeal is aimed at 48 hours (APPEAL_GOAL_H, owner): its goal is its deadline.
    expect(res.json()).toMatchObject({ status: 'appealed', round: 2, appeal: { by: 'seller', at: iso(2 * H) }, dueAt: iso(50 * H), goalAt: iso(50 * H) });
    const d = (await loadDispute(deps.db, t.code))!;
    expect(d).toMatchObject({ status: 'appealed', round: 2, appealBy: 'seller', appealedAt: at(2 * H), assignee: null, ruling: null });
    expect(d.round1!.involved).toContain(modId);
    expect(d.round1!.outcome).toBe('release-to-buyer');
    expect(await logOf(t.code)).toContainEqual({ action: 'appeal.opened', actor: 'trader', detail: { side: 'seller' } });
    // One appeal only: the other side cannot appeal again, nor can the same side.
    expect(errorOf(await buyer.browser.post(appeal(t.code), { why: WHY }))).toBe('wrong-state');
    expect(errorOf(await seller.browser.post(appeal(t.code), { why: WHY }))).toBe('wrong-state');
  });

  it('two appeals at the same moment store exactly one; the other gets wrong-state', async () => {
    const { buyer, seller, t } = await disputed();
    await publishRuling(deps, t.code, { outcome: 'refund-to-seller' });
    setNow(at(H));
    await relogin(seller, buyer);
    const [a, b] = await Promise.all([
      seller.browser.post(appeal(t.code), { why: WHY }),
      buyer.browser.post(appeal(t.code), { why: WHY }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect([errorOf(a), errorOf(b)]).toContain('wrong-state');
    const { rows } = await deps.db.query('select count(*)::int as n from dispute_appeals where code = $1', [t.code]);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('is accepted 1 ms before appealEndsAt and refused too-late at it exactly', async () => {
    const a = await disputed();
    await publishRuling(deps, a.t.code, { outcome: 'release-to-buyer' });
    setNow(at(48 * H - 1));
    await relogin(a.seller);
    expect((await a.seller.browser.post(appeal(a.t.code), { why: WHY })).statusCode).toBe(200);

    const b = await disputed();
    await publishRuling(deps, b.t.code, { outcome: 'release-to-buyer' });
    setNow(at(48 * H));
    await relogin(b.seller);
    const late = await b.seller.browser.post(appeal(b.t.code), { why: WHY });
    expect(late.statusCode).toBe(409);
    expect(errorOf(late)).toBe('too-late');
    expect((await loadDispute(deps.db, b.t.code))!.status).toBe('published');
  });

  it('a final (appeal-round) ruling can never be appealed (the appeal is completely binding)', async () => {
    const { buyer, seller, t } = await disputed();
    await publishRuling(deps, t.code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, t.code, 'seller');
    await publishRuling(deps, t.code, { outcome: 'refund-to-seller' });
    expect((await loadDispute(deps.db, t.code))!).toMatchObject({ round: 2, status: 'final', overturned: true });
    setNow(at(H));
    await relogin(seller, buyer);
    expect(errorOf(await buyer.browser.post(appeal(t.code), { why: WHY }))).toBe('wrong-state');
    expect((await buyer.browser.get(dispute(t.code))).json()).toMatchObject({ status: 'final', ruling: { round: 2, appealUntil: null } });
  });
});

describe('the events route', () => {
  it('refuses every dispute and system event with event-not-allowed', async () => {
    const { buyer, seller, t } = await disputed();
    for (const type of ['window-closed', 'executed', 'complied', 'close', 'moderator-joined', 'assign', 'reply', 'propose', 'approve', 'send-back', 'appeal', 'open-dispute', 'escalate']) {
      for (const who of [buyer, seller]) {
        const res = await who.browser.post(`/v1/trades/${t.code}/events`, { type });
        expect({ type, status: res.statusCode, error: errorOf(res) }).toEqual({ type, status: 400, error: 'event-not-allowed' });
      }
    }
    expect((await loadDispute(deps.db, t.code))!.status).toBe('open');
  });
});

describe('startDisputeTimers', () => {
  it('closes the appeal window once appealEndsAt has passed: the ruling is final, logged ruling.final', async () => {
    const { buyer, t } = await disputed();
    await publishRuling(deps, t.code, { outcome: 'release-to-buyer' });
    setNow(at(48 * H - 1));
    await tick();
    expect((await loadDispute(deps.db, t.code))!.status).toBe('published');
    setNow(at(48 * H));
    await tick();
    const d = (await loadDispute(deps.db, t.code))!;
    // An escrow case stays final (not closed) until Task 14's executor reports the payout.
    expect(d.status).toBe('final');
    await relogin(buyer);
    expect((await buyer.browser.get(dispute(t.code))).json()).toMatchObject({ status: 'final' });
    const final = (await logOf(t.code)).filter((e) => e.action === 'ruling.final');
    expect(final).toEqual([{ action: 'ruling.final', actor: 'system', detail: { rulingId: d.ruling!.id, round: 1, overturned: false } }]);
    // Idempotent: a second tick changes nothing.
    await tick();
    expect((await logOf(t.code)).filter((e) => e.action === 'ruling.final')).toHaveLength(1);
  });

  it('maintenance pauses the appeal window: nothing closes while it is on, and every running deadline moves by its length', async () => {
    await deps.db.query('update site_flags set maintenance_since = null');
    const base = 500 * H;
    const a = await disputed(at(base));
    const b = await disputed(at(base));
    await publishRuling(deps, b.t.code, { outcome: 'release-to-buyer' });
    try {
      setNow(at(base + H));
      await deps.db.query('update site_flags set maintenance_since = $1', [at(base + H)]);
      await tick();
      // Past b's original appeal end (base + 48 h), still in maintenance: it stays open to appeal.
      setNow(at(base + 49 * H));
      await tick();
      expect((await loadDispute(deps.db, b.t.code))!.status).toBe('published');
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null');
    }
    await tick();
    expect((await loadDispute(deps.db, a.t.code))!.replyDueAt).toEqual(at(base + 4 * H + 48 * H));
    expect((await loadDispute(deps.db, b.t.code))!).toMatchObject({ status: 'published', appealEndsAt: at(base + 96 * H) });
  });

  it('2 hours of maintenance move replyDueAt and appealEndsAt by 2 hours (A7)', async () => {
    await deps.db.query('update site_flags set maintenance_since = null');
    const base = 1000 * H;
    const c = await disputed(at(base));
    await publishRuling(deps, c.t.code, { outcome: 'release-to-buyer' });
    setNow(at(base + H));
    await deps.db.query('update site_flags set maintenance_since = $1', [at(base + H)]);
    await tick();
    setNow(at(base + 3 * H));
    await deps.db.query('update site_flags set maintenance_since = null');
    await tick();
    const d = (await loadDispute(deps.db, c.t.code))!;
    expect(d.replyDueAt).toEqual(at(base + 6 * H));
    expect(d.appealEndsAt).toEqual(at(base + 50 * H));
    expect(d.rulingDueAt).toEqual(at(base + 50 * H));
    await relogin(c.buyer);
    expect(((await c.buyer.browser.get(dispute(c.t.code))).json() as Record<string, unknown>).goalAt).toBe(iso(base + 26 * H));
    // The traders' view of round 1's window moves with it.
    await relogin(c.buyer);
    expect((await c.buyer.browser.get(dispute(c.t.code))).json()).toMatchObject({ replyDueAt: iso(base + 6 * H), ruling: { appealUntil: iso(base + 50 * H) } });
    // A second tick shifts nothing again.
    await tick();
    expect((await loadDispute(deps.db, c.t.code))!.appealEndsAt).toEqual(at(base + 50 * H));
  });

  it('J-14 (D-059): a compromised-account lock on either side pauses the dispute; its deadlines move by the lock once lifted', async () => {
    await deps.db.query('update site_flags set maintenance_since = null');
    const base = 1500 * H;
    const c = await disputed(at(base));
    await publishRuling(deps, c.t.code, { outcome: 'release-to-buyer' });
    // The seller's account is locked 1 h in (as tickets/lock.ts `placeLock` writes it).
    await deps.db.query('insert into account_locks (account_id, locked_at, set_disabled) values ($1, $2, false)', [c.seller.id, at(base + H)]);
    setNow(at(base + 2 * H));
    await tick();
    expect((await row(c.t.code)).paused_since).toEqual(at(base + H));
    // Past the original appeal end (base + 48 h) while locked: the window stays open.
    setNow(at(base + 60 * H));
    await tick();
    expect((await loadDispute(deps.db, c.t.code))!.status).toBe('published');
    // Lifted at base + 61 h: every running deadline moves by the 60 h the lock held.
    setNow(at(base + 61 * H));
    await deps.db.query('update account_locks set unlocked_at = $2 where account_id = $1 and unlocked_at is null', [c.seller.id, at(base + 61 * H)]);
    await tick();
    expect((await loadDispute(deps.db, c.t.code))!).toMatchObject({ status: 'published', appealEndsAt: at(base + 108 * H) });
    expect((await row(c.t.code)).paused_since).toBeNull();
  });
});

describe('J-14 (D-059): a held trade takes no appeal', () => {
  // "No trader event moves a held trade (the other party's neither)" (tickets/lock.ts): the appeal
  // moves the dispute too, so it waits, like the trade, until staff lift the lock.
  it('neither side appeals while either account is locked; once lifted, the appeal goes in', async () => {
    await deps.db.query('update site_flags set maintenance_since = null');
    const base = 1700 * H;
    const c = await disputed(at(base));
    await publishRuling(deps, c.t.code, { outcome: 'release-to-buyer' });
    await deps.db.query('insert into account_locks (account_id, locked_at, set_disabled) values ($1, $2, false)', [c.seller.id, at(base + H)]);
    setNow(at(base + 2 * H));
    await relogin(c.buyer);
    const res = await c.buyer.browser.post(appeal(c.t.code), { why: WHY });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: 'trade-held' } });
    expect((await loadDispute(deps.db, c.t.code))!.status).toBe('published');
    expect((await deps.db.query('select count(*)::int as n from dispute_appeals where code = $1', [c.t.code])).rows[0]).toEqual({ n: 0 });
    await deps.db.query('update account_locks set unlocked_at = $2 where account_id = $1 and unlocked_at is null', [c.seller.id, at(base + 3 * H)]);
    setNow(at(base + 3 * H));
    await tick();
    await relogin(c.buyer);
    const ok = await c.buyer.browser.post(appeal(c.t.code), { why: WHY });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('live delivery', () => {
  it('an appeal tells both sides\' open streams to re-read the trade', async () => {
    const { buyer, seller, t } = await disputed();
    await publishRuling(deps, t.code, { outcome: 'release-to-buyer' });
    const spy = vi.spyOn(app.events, 'publish');
    try {
      setNow(at(H));
      await relogin(seller);
      expect((await seller.browser.post(appeal(t.code), { why: WHY })).statusCode).toBe(200);
      const to = spy.mock.calls.map(([id, ev]) => [id, (ev as { type: string; code?: string }).type, (ev as { code?: string }).code]);
      expect(to).toEqual(expect.arrayContaining([[buyer.id, 'trade', t.code], [seller.id, 'trade', t.code]]));
    } finally {
      spy.mockRestore();
    }
  });
});

describe('tripwires (local tree only)', () => {
  const src = (p: string) => fileURLToPath(new URL(`../../src/${p}`, import.meta.url));
  it('NEEDS_TASK_25_LIEN_ON_APPEAL: once liens exist, filing an appeal must suspend the round-1 lien', () => {
    expect(existsSync(src('disputes/lien.ts')), 'NEEDS_TASK_25_LIEN_ON_APPEAL').toBe(false);
  });
});

describe('dispute timers keep going past one bad dispute (lead review 7 Nov)', () => {
  it('a dispute whose row cannot be read is reported after the pass; the others still close their window', async () => {
    const good = await disputed();
    const bad = await disputed();
    await publishRuling(deps, good.t.code, { outcome: 'release-to-buyer' });
    await publishRuling(deps, bad.t.code, { outcome: 'release-to-buyer' });
    // A ruling with no id: closing its window fails (the log entry needs the id), not a rule refusal.
    await deps.db.query(`update disputes set ruling = ruling - 'id' where code = $1`, [bad.t.code]);
    setNow(new Date(START.getTime() + 49 * H));
    await expect(tick()).rejects.toThrow(/dispute timers: 1 dispute\(s\) failed/);
    expect((await loadDispute(deps.db, good.t.code))!.status).not.toBe('published');
  });
});
