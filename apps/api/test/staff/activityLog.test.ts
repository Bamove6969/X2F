// Plan 4 Task 19: the Activity log page's reads (filters by trade, actor, kind and date, paging,
// the staff scope, the chain check and the log alarm) and the training library (closed cases read
// through the anonymizer). The Global Constraint "entries never contain chat text, ruling reasons,
// addresses or IP addresses" is checked on every answer, including after a row is tampered with.
import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@x2f/staff';
import type { Deps } from '../../src/app.js';
import { appendLog } from '../../src/log/append.js';
import { roundXmrAtomic, trainingId } from '../../src/staff/training.js';
import { LOG_ACTIONS, kindOf } from '../../src/log/actions.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, seedStaff, staffApps } from '../helpers/staffApp.js';
import { driveTo, fakeAddress, seedTrade, type SeededTrade } from '../helpers/trades.js';

const T0 = new Date('2026-11-10T09:00:00.000Z');
const MIN = 60_000;
const H = 60 * MIN;
const NOTE = 'NOTE-SENTINEL the seller ignored me';
const REASON = 'REASON-SENTINEL';
const CHAT = 'CHAT-SENTINEL hello there';
const IP = '203.0.113.77';
const CARD = '4111 1111 1111 1111';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: { id: string; b: StaffBrowser; name: string };
let senior: { id: string; b: StaffBrowser };
let mod: { id: string; b: StaffBrowser; name: string };
let helper: { id: string; b: StaffBrowser };
let A: SeededTrade;
let B: SeededTrade;
let C: SeededTrade;
const addresses: string[] = [];
// Re-review B1: fixed names, trade codes and addresses, so every run reads the same texts.
const buyerName = 'Mirakowal';
const sellerName = 'Quietfoxseller';
const CODES = { A: 'K7M2-9QXA-4FTR-8WPN', B: 'RVGF-4PMG-R9CM-EZA9', C: 'FTYB-J3ZD-7MCZ-WKRA' } as const;
const BASE58 = '123456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A made-up stagenet-shaped address (never a real key), the same on every run for a seed. */
function fixedAddress(seed: number): string {
  let s = '5';
  let x = seed;
  for (let i = 1; i < 95; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += BASE58[(x >> 8) % BASE58.length];
  }
  return s;
}

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await deps.db.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const log = (e: { at?: Date; actor: Actor; tradeCode: string | null; action: keyof typeof LOG_ACTIONS; detail?: object }) =>
  tx((c) => appendLog(c, { at: e.at ?? deps.clock(), actor: e.actor, tradeCode: e.tradeCode, action: e.action, detail: e.detail ?? {} }));

async function member(role: 'owner' | 'senior' | 'mod' | 'helper') {
  const s = await seedStaff(deps, { role, loginName: { owner: 'owner_one', senior: 'senior_one', mod: 'dmitri_mod', helper: 'helper_one' }[role] });
  const b = new StaffBrowser(app).withSession((await insertSession(deps, s.id, 'staff')).token);
  const name = (await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [s.id])).rows[0]!.display_name;
  return { id: s.id, b, name };
}

async function dispute(code: string, o: { status?: string; closedAt?: Date; note?: string } = {}) {
  await deps.db.query(
    `insert into disputes (code, seq, opened_by, reason, note, opened_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, status, closed_at)
     values ($1, 1, 'buyer', 'paid', $2, $3, $3, $3, 41250, 100000, $4, $5)`,
    [code, o.note ?? '', deps.clock(), o.status ?? 'open', o.closedAt ?? null],
  );
}

const staffActor = (m: { id: string }, role: 'owner' | 'senior' | 'mod'): Actor => ({ kind: 'staff', id: m.id, role });

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(T0);
  owner = await member('owner');
  senior = await member('senior');
  mod = await member('mod');
  helper = await member('helper');
  const buyer = await seedAccount(deps, { loginName: 'mlogin_mira', displayName: buyerName });
  const seller = await seedAccount(deps, { loginName: 'qlogin_quiet', displayName: sellerName });
  const fixed = (n: number) => ({ buyerPayout: fixedAddress(2 * n + 1), sellerRefund: fixedAddress(2 * n + 2) });
  // A: disputed and open. B: never disputed. C: disputed and closed (the training case).
  A = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller', methodId: 'ZELLE', code: CODES.A, ...fixed(0) });
  B = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller', code: CODES.B, ...fixed(1) });
  C = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller', methodId: 'REVOLUT', code: CODES.C, ...fixed(2) });
  for (const t of [A, B, C]) addresses.push(t.sides.buyerPayout!, t.sides.sellerRefund!);
  await driveTo(deps, A.trade, 'paid');
  await driveTo(deps, B.trade, 'funding');
  await driveTo(deps, C.trade, 'paid');

  setNow(new Date(T0.getTime() + H));
  await dispute(A.code, { note: `${NOTE} ${addresses[0]}` });
  await log({ actor: { kind: 'trader', side: 'buyer' }, tradeCode: A.code, action: 'dispute.opened', detail: { reason: 'paid', afterRefund: false, seq: 1 } });
  setNow(new Date(T0.getTime() + 2 * H));
  await log({ actor: staffActor(mod, 'mod'), tradeCode: A.code, action: 'dispute.assigned', detail: { staffId: mod.id } });
  await log({ actor: staffActor(mod, 'mod'), tradeCode: A.code, action: 'case.opened' });
  await log({ actor: staffActor(mod, 'mod'), tradeCode: A.code, action: 'chat.read' });
  // The owner's own entries, never in the staff scope.
  await log({ actor: staffActor(owner, 'owner'), tradeCode: null, action: 'settings.changed', detail: { field: 'large_trade_limit_usd', from: 500, to: 1000 } });
  await log({ actor: staffActor(owner, 'owner'), tradeCode: null, action: 'staff.invite-created', detail: { inviteId: 'inv-1', role: 'mod' } });

  // C: opened, ruled and closed on day 2.
  setNow(new Date(T0.getTime() + 24 * H));
  const opened = deps.clock();
  await deps.db.query(
    `insert into disputes (code, seq, opened_by, reason, note, opened_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, status)
     values ($1, 1, 'seller', 'paid', $2, $3, $3, $3, 41250, 100000, 'open')`,
    [C.code, `${buyerName} never paid, call me on +1 (555) 123-4567`, opened],
  );
  await log({ at: opened, actor: { kind: 'trader', side: 'seller' }, tradeCode: C.code, action: 'dispute.opened', detail: { reason: 'paid', afterRefund: false, seq: 1 } });
  await log({ at: new Date(opened.getTime() + 42 * MIN), actor: staffActor(senior, 'senior'), tradeCode: C.code, action: 'case.opened' });
  const ruled = new Date(opened.getTime() + 3 * H);
  await deps.db.query(
    `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
     values ($1, 1, 1, 'release-to-buyer', $2, $3, $4, $5, $6)`,
    [C.code, `${REASON}: ${buyerName}'s payment from card ${CARD} shows in ${sellerName}'s bank. Trade ${C.code}. Refund address ${addresses[5]}.`,
      JSON.stringify([`Screenshot sent by ${sellerName}`]), mod.name, ruled, new Date(ruled.getTime() + 48 * H)],
  );
  await log({ at: ruled, actor: staffActor(mod, 'mod'), tradeCode: C.code, action: 'ruling.published', detail: { rulingId: 'r-c', round: 1, outcome: 'release-to-buyer', accountAction: 'none' } });
  await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [C.code, new Date(opened.getTime() + 52 * H)]);
  setNow(new Date(T0.getTime() + 80 * H));
  // Fresh sessions at the final clock (a staff session lasts 2 hours).
  for (const m of [owner, senior, mod, helper] as Array<{ b: StaffBrowser; id?: string }>) {
    const id = m.id ?? (await deps.db.query<{ account_id: string }>("select account_id::text as account_id from staff_members where role = 'helper' limit 1")).rows[0]!.account_id;
    m.b.withSession((await insertSession(deps, id, 'staff')).token);
  }
});
afterAll(async () => close());

type Entry = { id: string; at: string; tradeCode: string | null; action: string; actor: { kind: string; role: string | null; id: string | null; name: string | null }; detail: Record<string, unknown>; withheld?: true };
type Page = { scope: string; entries: Entry[]; names: Record<string, string>; next: string | null };

async function page(b: StaffBrowser, qs = ''): Promise<Page> {
  const res = await b.get(`/staff/v1/log${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Page;
}

/** Every page of the reader's log, plus the filters and active disputes, as raw answer bodies. */
async function everything(b: StaffBrowser): Promise<string[]> {
  const bodies: string[] = [];
  let before: string | null = null;
  do {
    const res = await b.get(`/staff/v1/log?limit=3${before ? `&before=${before}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    bodies.push(res.body);
    before = (res.json() as Page).next;
  } while (before !== null);
  for (const u of ['/staff/v1/log/filters', '/staff/v1/log/active-disputes']) bodies.push((await b.get(u)).body);
  return bodies;
}

function assertClean(bodies: string[]) {
  const all = bodies.join('\n');
  for (const s of [NOTE, REASON, CHAT, CARD, ...addresses]) expect(all, s.slice(0, 20)).not.toContain(s);
  expect(all).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  expect(all).not.toContain('+1 (555)');
}

describe('the log kinds', () => {
  it('every log action belongs to a kind', () => {
    for (const a of Object.keys(LOG_ACTIONS)) expect(kindOf(a), a).toBeDefined();
  });
});

describe('GET /staff/v1/log', () => {
  it('the owner reads everything, newest first, the owner-only entries included', async () => {
    const p = await page(owner.b);
    expect(p.scope).toBe('all');
    const actions = p.entries.map((e) => e.action);
    expect(actions).toContain('settings.changed');
    expect(actions).toContain('staff.invite-created');
    expect(actions).toContain('trade.setup-done');
    const ids = p.entries.map((e) => BigInt(e.id));
    expect([...ids].sort((x, y) => (x > y ? -1 : 1))).toEqual(ids);
  });

  it('a moderator reads the staff scope: disputed trades only, never settings or staff entries', async () => {
    for (const who of [mod, senior]) {
      const p = await page(who.b, '?limit=100');
      expect(p.scope).toBe('cases');
      expect(p.entries.length).toBeGreaterThan(0);
      for (const e of p.entries) {
        expect([A.code, C.code]).toContain(e.tradeCode);
        expect(e.action).not.toMatch(/^(settings|staff|owner|site|shift|pay|news|treasury)\./);
      }
      expect(p.entries.some((e) => e.tradeCode === B.code)).toBe(false);
    }
    // An owner-only kind is refused in the staff scope.
    expect((await mod.b.get('/staff/v1/log?kind=owner')).statusCode).toBe(400);
  });

  it('filters by trade code typed any way, by actor, by kind and by date', async () => {
    const byCode = await page(owner.b, `?code=${A.code.replaceAll('-', '').toLowerCase()}`);
    expect(byCode.entries.length).toBeGreaterThan(3);
    expect(byCode.entries.every((e) => e.tradeCode === A.code)).toBe(true);

    const byMod = await page(owner.b, `?actor=${mod.id}`);
    expect(new Set(byMod.entries.map((e) => e.action))).toEqual(new Set(['dispute.assigned', 'case.opened', 'chat.read', 'ruling.published']));
    expect(byMod.entries.every((e) => e.actor.id === mod.id && e.actor.name === mod.name)).toBe(true);

    const byBuyer = await page(owner.b, `?actor=buyer&code=${A.code}`);
    expect(byBuyer.entries.map((e) => e.action).sort()).toEqual(['dispute.opened', 'trade.mark-paid']);
    // A trader is named by their side, with the trade's display name.
    expect(byBuyer.entries.every((e) => e.actor.kind === 'trader' && e.actor.role === 'buyer' && e.actor.name === buyerName)).toBe(true);

    const system = await page(owner.b, `?actor=system&code=${A.code}`);
    expect(system.entries.length).toBeGreaterThan(0);
    expect(system.entries.every((e) => e.actor.kind === 'system' && e.actor.name === null)).toBe(true);

    const disputeKind = await page(owner.b, '?kind=dispute');
    expect(new Set(disputeKind.entries.map((e) => e.action))).toEqual(new Set(['dispute.opened', 'dispute.assigned', 'case.opened']));

    // Day 2 (UTC) holds C's dispute only; `to` includes its whole day.
    const day2 = await page(owner.b, '?from=2026-11-11&to=2026-11-11');
    expect(day2.entries.length).toBeGreaterThan(0);
    expect(day2.entries.every((e) => e.tradeCode === C.code)).toBe(true);
    expect((await page(owner.b, '?from=2026-11-20')).entries).toEqual([]);

    for (const bad of ['?actor=dmitri', '?kind=nope', '?from=2026-13-01', '?from=2026-11-12&to=2026-11-11', '?before=0', '?limit=500', '?code=x&extra=1']) {
      expect((await owner.b.get(`/staff/v1/log${bad}`)).statusCode, bad).toBe(400);
    }
  });

  it('`before` must be a safe integer: anything larger is a 400, never a 500 (review m2)', async () => {
    for (const bad of ['9999999999999999999', '9223372036854775808', '9007199254740992', '1e3', '0x10', '-1', ' 5', '5 ']) {
      const res = await owner.b.get(`/staff/v1/log?before=${encodeURIComponent(bad)}`);
      expect(res.statusCode, bad).toBe(400);
    }
    expect((await owner.b.get('/staff/v1/log?before=9007199254740991')).statusCode).toBe(200);
  });

  it('`limit` is a plain decimal from 1 to 100 (review m3)', async () => {
    for (const bad of ['1e2', '0x10', ' 50', '50 ', '+5', '050', '5.0', '0', '-1', '']) {
      const res = await owner.b.get(`/staff/v1/log?limit=${encodeURIComponent(bad)}`);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('the page cap is 100: 100 is read, 101 is a 400 (review m4)', async () => {
    expect((await owner.b.get('/staff/v1/log?limit=100')).statusCode).toBe(200);
    expect((await owner.b.get('/staff/v1/log?limit=101')).statusCode).toBe(400);
  });

  it('pages with `before`: no entry twice, none missed', async () => {
    const whole = await page(owner.b, '?limit=100');
    const seen: string[] = [];
    let before: string | null = null;
    do {
      const p = await page(owner.b, `?limit=4${before ? `&before=${before}` : ''}`);
      expect(p.entries.length).toBeLessThanOrEqual(4);
      seen.push(...p.entries.map((e) => e.id));
      before = p.next;
    } while (before !== null);
    expect(seen).toEqual(whole.entries.map((e) => e.id));
  });

  it('names the staff an entry\'s detail points at, by display name', async () => {
    const p = await page(owner.b, `?code=${A.code}&kind=dispute`);
    const assigned = p.entries.find((e) => e.action === 'dispute.assigned')!;
    expect(assigned.detail).toEqual({ staffId: mod.id });
    expect(p.names[mod.id]).toBe(mod.name);
  });

  it('a helper cannot read the log', async () => {
    expect((await helper.b.get('/staff/v1/log')).statusCode).toBe(403);
  });
});

describe('the filters and the active disputes', () => {
  it('offers the actors and kinds in the reader\'s scope', async () => {
    const o = (await owner.b.get('/staff/v1/log/filters')).json() as { actors: Array<{ id: string; name: string }>; kinds: string[] };
    expect(o.actors.map((a) => a.id)).toEqual(expect.arrayContaining([owner.id, mod.id, senior.id]));
    expect(o.kinds).toEqual(['trade', 'dispute', 'chat', 'ruling', 'account', 'staff', 'owner', 'site', 'other']);
    const m = (await mod.b.get('/staff/v1/log/filters')).json() as { actors: Array<{ id: string }>; kinds: string[] };
    // The owner appears only through owner-only entries here: not in the staff scope.
    expect(m.actors.map((a) => a.id)).not.toContain(owner.id);
    expect(m.actors.map((a) => a.id)).toEqual(expect.arrayContaining([mod.id, senior.id]));
    expect(m.kinds).toEqual(['trade', 'dispute', 'chat', 'ruling', 'account', 'other']);
  });

  it('lists the open disputes with method, amount and status; a closed one is not active', async () => {
    const res = await mod.b.get('/staff/v1/log/active-disputes');
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<{ code: string }> }).items;
    expect(items).toContainEqual({ code: A.code, method: 'ZELLE', methodName: 'Zelle', xmr: A.trade.amountAtomic.toString(), status: 'open' });
    expect(items.map((i) => i.code)).not.toContain(C.code);
  });
});

describe('the chain check and the log alarm', () => {
  it('the owner sees the chain intact and no alarm; then the alarm the moderation process set', async () => {
    const res = await owner.b.get('/staff/v1/log/integrity');
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json() as { chain: { ok: boolean; headId?: string }; alarm: string | null; entries: number; checkedAt: string };
    expect(v.chain.ok).toBe(true);
    expect(v.alarm).toBeNull();
    expect(v.entries).toBeGreaterThan(10);
    expect(v.checkedAt).toBe(deps.clock().toISOString());
    const at = new Date(T0.getTime() + 70 * H);
    await deps.db.query('update site_flags set log_alarm = $1', [at]);
    expect(((await owner.b.get('/staff/v1/log/integrity')).json() as { alarm: string }).alarm).toBe(at.toISOString());
    await deps.db.query('update site_flags set log_alarm = null');
  });

  it('a moderator cannot run the chain check', async () => {
    expect((await mod.b.get('/staff/v1/log/integrity')).statusCode).toBe(403);
  });
});

describe('entries never show chat text, ruling reasons, addresses or IP addresses', () => {
  it('no answer of the log pages holds the note, a ruling reason, an address or an IP, for the owner or a moderator', async () => {
    for (const who of [owner, mod]) assertClean(await everything(who.b));
  });

  it('a tampered row holding chat text and an IP shows no detail at all, and the chain check finds it', async () => {
    // As the superuser, with the triggers off: a row whose detail its action does not allow.
    await deps.db.query('alter table activity_log disable trigger user');
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into activity_log (at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash)
       values ($1, 'staff', $2, 'mod', $3, 'chat.read', $4, (select hash from activity_log order by id desc limit 1), decode(repeat('00', 32), 'hex'))
       returning id::text as id`,
      [deps.clock(), mod.id, A.code, JSON.stringify({ text: CHAT, ip: IP, address: addresses[0] })],
    );
    await deps.db.query(
      `insert into activity_log (at, actor_kind, trade_code, action, detail, prev_hash, hash)
       values ($1, 'system', $2, 'trade.chain', 'not json', decode(repeat('02', 32), 'hex'), decode(repeat('01', 32), 'hex'))`,
      [deps.clock(), A.code],
    );
    await deps.db.query('alter table activity_log enable trigger user');
    const id = rows[0]!.id;
    for (const who of [owner, mod]) {
      assertClean(await everything(who.b));
      const p = await page(who.b, `?code=${A.code}&kind=chat`);
      expect(p.entries.find((e) => e.id === id)).toMatchObject({ action: 'chat.read', detail: {}, withheld: true });
    }
    const v = (await owner.b.get('/staff/v1/log/integrity')).json() as { chain: { ok: boolean; brokenAt?: string } };
    expect(v.chain).toEqual({ ok: false, brokenAt: id });
  });
});

describe('the training library', () => {
  type Item = { id: string; closedMonth: string; method: string; methodName: string; xmr: string; outcome: string; overturned: boolean; afterRefund: boolean };
  type Field = { text: string; masks: Array<{ start: number; end: number; kind: string }> };
  type Review = Item & { status: 'unmarked' | 'marked' | 'stale'; fields: Record<string, Field>; manual: Array<{ field: string; start?: number; end?: number; whole?: true }> };
  const CID = () => trainingId(deps.config.trainingIdKey, C.code, 1);
  const list = async (who: { b: StaffBrowser }) => ((await who.b.get('/staff/v1/training')).json() as { items: Item[] }).items;

  it('lists nothing until a curator marks a case (lead call: review-first)', async () => {
    for (const who of [mod, senior, owner]) {
      const res = await who.b.get('/staff/v1/training');
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { items: Item[] }).items).toEqual([]);
    }
    expect((await mod.b.get(`/staff/v1/training/${CID()}`)).statusCode).toBe(404);
  });

  it('only a curator (the owner) reviews: the closed cases with their status, then one case pre-masked', async () => {
    for (const who of [mod, senior, helper]) {
      expect((await who.b.get('/staff/v1/training/review')).statusCode).toBe(403);
      expect((await who.b.get(`/staff/v1/training/review/${CID()}`)).statusCode).toBe(403);
      expect((await who.b.send('PUT', `/staff/v1/training/review/${CID()}`, { masks: [] })).statusCode).toBe(403);
    }
    const res = await owner.b.get('/staff/v1/training/review');
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: Array<Item & { status: string }> }).items;
    expect(items).toEqual([expect.objectContaining({ id: CID(), status: 'unmarked', closedMonth: '2026-11', xmr: '1300000000000' })]);
    expect(res.body).not.toContain(C.code);
    const one = (await owner.b.get(`/staff/v1/training/review/${CID()}`)).json() as Review;
    expect(one.status).toBe('unmarked');
    expect(one.manual).toEqual([]);
    expect(Object.keys(one.fields)).toEqual(['note', 'ruling.1.reason', 'ruling.1.evidence.0']);
    expect(one.fields.note!.text).toBe('Buyer never paid, call me on [phone]');
  });

  it('refuses masks that do not fit the pre-masked texts', async () => {
    const put = (masks: unknown) => owner.b.send('PUT', `/staff/v1/training/review/${CID()}`, { masks });
    for (const bad of [
      [{ field: 'nope', start: 0, end: 1 }],
      [{ field: 'note', start: 0, end: 999 }],
      [{ field: 'note', start: 2, end: 1 }],
      [{ field: 'note', start: 0, end: 3 }, { field: 'note', start: 2, end: 4 }],
      [{ field: 'note', start: 30, end: 32 }],
      [{ field: 'note', whole: false }],
      [{ field: 'note', start: 0, end: 1, text: 'x' }],
      'nope',
    ]) expect((await put(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    expect((await owner.b.send('PUT', `/staff/v1/training/review/${'0'.repeat(32)}`, { masks: [] })).statusCode).toBe(404);
    expect(await list(mod)).toEqual([]);
  });

  it('a curator marks the case with the masks they reviewed: stored as ranges and tags, never the text; logged for the owner only', async () => {
    const one = (await owner.b.get(`/staff/v1/training/review/${CID()}`)).json() as Review;
    const note = one.fields.note!.text;
    const start = note.indexOf('never paid');
    const res = await owner.b.send('PUT', `/staff/v1/training/review/${CID()}`, {
      masks: [{ field: 'note', start, end: start + 'never paid'.length }, { field: 'ruling.1.evidence.0', whole: true }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const { rows } = await deps.db.query<{ training_id: string; manual_masks: unknown; marked_by: string }>('select training_id, manual_masks, marked_by::text as marked_by from training_cases');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.training_id).toBe(CID());
    expect(rows[0]!.marked_by).toBe(owner.id);
    const stored = JSON.stringify(rows[0]!.manual_masks);
    for (const t of ['never paid', 'Screenshot', 'Seller', NOTE, sellerName]) expect(stored, t).not.toContain(t);
    const o = await page(owner.b, '?kind=staff');
    expect(o.entries[0]).toMatchObject({ action: 'staff.training-marked', tradeCode: null, detail: { trainingId: CID(), masks: 2 } });
    expect((await page(mod.b, '?limit=100')).entries.map((e) => e.action)).not.toContain('staff.training-marked');
    expect(((await owner.b.get(`/staff/v1/training/review/${CID()}`)).json() as Review).status).toBe('marked');
  });

  it('lists the marked case by its opaque id, with the month, method, rounded amount and outcome', async () => {
    for (const who of [mod, senior, owner]) {
      const res = await who.b.get('/staff/v1/training');
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as { items: Item[] }).items;
      // Review m1: the closing month only, and the amount rounded to 2 significant figures (1.25 XMR shows as 1.3).
      expect(items).toEqual([{
        id: CID(), closedMonth: '2026-11', method: 'REVOLUT', methodName: 'Revolut',
        xmr: '1300000000000', outcome: 'release-to-buyer', overturned: false, afterRefund: false,
      }]);
      expect(C.trade.amountAtomic).toBe(1_250_000_000_000n);
      expect(res.body).not.toContain(C.code);
      expect(res.body).not.toContain(C.code.replaceAll('-', ''));
    }
    expect((await helper.b.get('/staff/v1/training')).statusCode).toBe(403);
  });

  it('a case reads through the automatic and the curator\'s masks: no names, code, address, card, phone or date; times are offsets', async () => {
    const res = await mod.b.get(`/staff/v1/training/${CID()}`);
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json() as {
      tradeCode: string; openedBy: string; reason: string; note: Field; closedAt: string; chat: string;
      rulings: Array<{ round: number; outcome: string; at: string; reason: Field; evidence: Field[] }>;
      timeline: Array<{ at: string; who: string; action: string }>;
    };
    for (const s of [buyerName, sellerName, mod.name, C.code, C.code.replaceAll('-', ''), CARD, '+1 (555)', ...addresses]) expect(res.body, s.slice(0, 20)).not.toContain(s);
    expect(res.body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(c.tradeCode).toBe('XXXX-XXXX-XXXX-XXXX');
    expect(c.note.text).toBe('Buyer [hidden], call me on [phone]');
    expect(c.note.masks.map((m) => m.kind)).toEqual(['manual', 'phone']);
    expect(c.rulings).toHaveLength(1);
    // Re-review B1, now with fixed names, codes and addresses: the reason keeps its words.
    expect(c.rulings[0]!.reason.text).toBe(
      `${REASON}: Buyer's payment from card [card] shows in Seller's bank. Trade XXXX-XXXX-XXXX-XXXX. Refund address [address].`,
    );
    expect(c.rulings[0]!.reason.masks.map((m) => m.kind)).toEqual(['card', 'address']);
    expect(c.rulings[0]!.evidence.map((e) => e.text)).toEqual(['[hidden]']);
    expect(c.rulings[0]!.at).toBe('T+3:00');
    expect(c.closedAt).toBe('T+52:00');
    expect(c.timeline).toEqual([
      { at: 'T+0:00', who: 'Seller', action: 'dispute.opened' },
      { at: 'T+0:42', who: 'Senior moderator', action: 'case.opened' },
      { at: 'T+3:00', who: 'Moderator', action: 'ruling.published' },
    ]);
    // NEEDS_P4_CHAT_MEMBERSHIP: the API cannot read the chat.
    expect(c.chat).toBe('not-available');
  });

  it('the opaque id is an HMAC under the training id key, stored on the curation row (review m1, re-review m3)', async () => {
    const unkeyed = createHash('sha256').update(`x2f-training-v1|${C.code}|1`, 'utf8').digest('hex').slice(0, 32);
    expect(CID()).not.toBe(unkeyed);
    expect(createHmac('sha256', deps.config.trainingIdKey).update(`x2f/training-id\0${C.code}\0${1}`, 'utf8').digest('hex').slice(0, 32)).toBe(CID());
    // The key is the training id's own: no other secret of the config holds it.
    const others = [deps.config.serverKey, ...[deps.config.passwordPeppers, deps.config.recoveryCodeKeys, deps.config.totpKeys, deps.config.loginNameKeys].flatMap((r) => [...r.keys.values()])];
    for (const k of others) expect(Buffer.from(k).equals(Buffer.from(deps.config.trainingIdKey))).toBe(false);
    expect((await mod.b.get(`/staff/v1/training?before=${CID()}`)).statusCode).toBe(200);
    expect((await mod.b.get(`/staff/v1/training/${unkeyed}`)).statusCode).toBe(404);
  });

  it('rounds a shown amount to 2 significant figures (review m1)', () => {
    expect(roundXmrAtomic('1250000000000')).toBe('1300000000000');
    expect(roundXmrAtomic('1240000000000')).toBe('1200000000000');
    expect(roundXmrAtomic('123456000000000')).toBe('120000000000000');
    expect(roundXmrAtomic('12345678')).toBe('12000000');
    expect(roundXmrAtomic('99500000000000')).toBe('100000000000000');
    expect(roundXmrAtomic('7')).toBe('7');
    expect(roundXmrAtomic('0')).toBe('0');
  });

  it('fails closed: when the masked text no longer matches, the case is hidden until it is curated again', async () => {
    const before = await deps.db.query<{ note: string }>('select note from disputes where code = $1', [C.code]);
    // Stands for an anonymizer change that moves the pre-masked text under a stored range.
    await deps.db.query('update disputes set note = $2 where code = $1', [C.code, `Hello, ${before.rows[0]!.note}`]);
    expect(await list(mod)).toEqual([]);
    expect((await mod.b.get(`/staff/v1/training/${CID()}`)).statusCode).toBe(404);
    const r = (await owner.b.get(`/staff/v1/training/review/${CID()}`)).json() as Review;
    expect(r.status).toBe('stale');
    const note = r.fields.note!.text;
    const start = note.indexOf('never paid');
    expect((await owner.b.send('PUT', `/staff/v1/training/review/${CID()}`, { masks: [{ field: 'note', start, end: start + 10 }, { field: 'ruling.1.evidence.0', whole: true }] })).statusCode).toBe(200);
    expect((await list(mod)).map((i) => i.id)).toEqual([CID()]);
    expect(((await mod.b.get(`/staff/v1/training/${CID()}`)).json() as { note: Field }).note.text).toBe('Hello, Buyer [hidden], call me on [phone]');
  });

  it('an unknown or malformed id is not found; the only writes are the curator\'s mark and unmark', async () => {
    expect((await mod.b.get(`/staff/v1/training/${'0'.repeat(32)}`)).statusCode).toBe(404);
    expect((await mod.b.get('/staff/v1/training/not-an-id')).statusCode).toBe(404);
    expect((await mod.b.get('/staff/v1/training?before=zz')).statusCode).toBe(400);
    expect((await owner.b.post('/staff/v1/training', { previewId: 'x', manualMasks: [] })).statusCode).toBe(404);
    expect(app.staffRoutes.filter((r) => r.url.startsWith('/staff/v1/training') && r.method !== 'GET').map((r) => `${r.method} ${r.url}`).sort()).toEqual([
      'DELETE /staff/v1/training/review/:id', 'PUT /staff/v1/training/review/:id',
    ]);
  });

  it('a curator unmarks a case: it leaves the list at once, and it is logged', async () => {
    expect((await mod.b.send('DELETE', `/staff/v1/training/review/${CID()}`)).statusCode).toBe(403);
    const res = await owner.b.send('DELETE', `/staff/v1/training/review/${CID()}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await list(mod)).toEqual([]);
    expect((await mod.b.get(`/staff/v1/training/${CID()}`)).statusCode).toBe(404);
    expect((await page(owner.b, '?kind=staff')).entries[0]).toMatchObject({ action: 'staff.training-unmarked', tradeCode: null, detail: { trainingId: CID() } });
    expect((await owner.b.send('DELETE', `/staff/v1/training/review/${CID()}`)).statusCode).toBe(404);
    expect(((await owner.b.get(`/staff/v1/training/review/${CID()}`)).json() as Review).status).toBe('unmarked');
  });
});

describe('the staff-scope actor list (review m5)', () => {
  it('an owner-only entry on a disputed trade does not put its actor in a moderator\'s actor list', async () => {
    // A future owner-only action logged with a trade code (a clawback tied to a case).
    await log({ actor: staffActor(owner, 'owner'), tradeCode: A.code, action: 'pay.clawback', detail: { staffId: mod.id, usdCents: '100', rulingId: 'r-a' } });
    const m = (await mod.b.get('/staff/v1/log/filters')).json() as { actors: Array<{ id: string }> };
    expect(m.actors.map((a) => a.id)).not.toContain(owner.id);
    expect(m.actors.map((a) => a.id)).toEqual(expect.arrayContaining([mod.id, senior.id]));
    const o = (await owner.b.get('/staff/v1/log/filters')).json() as { actors: Array<{ id: string }> };
    expect(o.actors.map((a) => a.id)).toContain(owner.id);
    // And the log itself never shows it to the moderator.
    expect((await page(mod.b, `?code=${A.code}&limit=100`)).entries.map((e) => e.action)).not.toContain('pay.clawback');
  });
});
