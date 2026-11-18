// Plan 4 Task 19: the Activity log page's reads (filters by trade, actor, kind and date, paging,
// the staff scope, the chain check and the log alarm) and the training library (closed cases read
// through the anonymizer). The Global Constraint "entries never contain chat text, ruling reasons,
// addresses or IP addresses" is checked on every answer, including after a row is tampered with.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@x2f/staff';
import type { Deps } from '../../src/app.js';
import { appendLog } from '../../src/log/append.js';
import { LOG_ACTIONS, kindOf } from '../../src/log/actions.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, seedStaff, staffApps, uniqueName } from '../helpers/staffApp.js';
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
let helper: { b: StaffBrowser };
let A: SeededTrade;
let B: SeededTrade;
let C: SeededTrade;
const addresses: string[] = [];
const buyerName = uniqueName('mira');
const sellerName = uniqueName('quietfox');

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
  const s = await seedStaff(deps, { role });
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
  const buyer = await seedAccount(deps, { loginName: uniqueName('mlogin'), displayName: buyerName });
  const seller = await seedAccount(deps, { loginName: uniqueName('qlogin'), displayName: sellerName });
  // A: disputed and open. B: never disputed. C: disputed and closed (the training case).
  A = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller', methodId: 'ZELLE' });
  B = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  C = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller', methodId: 'REVOLUT' });
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
      const p = await page(who.b, '?limit=200');
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

  it('pages with `before`: no entry twice, none missed', async () => {
    const whole = await page(owner.b, '?limit=200');
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
       values ($1, 'staff', $2, 'mod', $3, 'chat.read', $4, (select hash from activity_log order by id desc limit 1), '\\x00')
       returning id::text as id`,
      [deps.clock(), mod.id, A.code, JSON.stringify({ text: CHAT, ip: IP, address: addresses[0] })],
    );
    await deps.db.query(
      `insert into activity_log (at, actor_kind, trade_code, action, detail, prev_hash, hash)
       values ($1, 'system', $2, 'trade.chain', 'not json', '\\x00', '\\x01')`,
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
  type Item = { id: string; closedOn: string; method: string; methodName: string; xmr: string; outcome: string; overturned: boolean; afterRefund: boolean };

  it('lists the closed cases only, by an opaque id, with day, method, amount and outcome', async () => {
    for (const who of [mod, senior, owner]) {
      const res = await who.b.get('/staff/v1/training');
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as { items: Item[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{32}$/), closedOn: '2026-11-13', method: 'REVOLUT', methodName: 'Revolut',
        xmr: C.trade.amountAtomic.toString(), outcome: 'release-to-buyer', overturned: false, afterRefund: false,
      });
      expect(res.body).not.toContain(C.code);
      expect(res.body).not.toContain(C.code.replaceAll('-', ''));
    }
    expect((await helper.b.get('/staff/v1/training')).statusCode).toBe(403);
  });

  it('a case reads through the anonymizer: no names, code, address, card, phone or date; times are offsets', async () => {
    const id = ((await mod.b.get('/staff/v1/training')).json() as { items: Item[] }).items[0]!.id;
    const res = await mod.b.get(`/staff/v1/training/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json() as {
      tradeCode: string; openedBy: string; reason: string; note: { text: string; masks: unknown[] }; closedAt: string; chat: string;
      rulings: Array<{ round: number; outcome: string; at: string; reason: { text: string; masks: Array<{ kind: string }> }; evidence: Array<{ text: string }> }>;
      timeline: Array<{ at: string; who: string; action: string }>;
    };
    for (const s of [buyerName, sellerName, mod.name, C.code, C.code.replaceAll('-', ''), CARD, '+1 (555)', ...addresses]) expect(res.body, s.slice(0, 20)).not.toContain(s);
    expect(res.body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(c.tradeCode).toBe('XXXX-XXXX-XXXX-XXXX');
    expect(c.note.text).toBe('Buyer never paid, call me on [phone]');
    expect(c.rulings).toHaveLength(1);
    expect(c.rulings[0]!.reason.text).toBe(
      `${REASON}: Buyer's payment from card [card] shows in Seller's bank. Trade XXXX-XXXX-XXXX-XXXX. Refund address [address].`,
    );
    expect(c.rulings[0]!.reason.masks.map((m) => m.kind)).toEqual(['card', 'address']);
    expect(c.rulings[0]!.evidence.map((e) => e.text)).toEqual(['Screenshot sent by Seller']);
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

  it('an unknown or malformed id is not found; no route stores a training copy', async () => {
    expect((await mod.b.get(`/staff/v1/training/${'0'.repeat(32)}`)).statusCode).toBe(404);
    expect((await mod.b.get('/staff/v1/training/not-an-id')).statusCode).toBe(404);
    expect((await mod.b.get('/staff/v1/training?before=zz')).statusCode).toBe(400);
    expect((await owner.b.post('/staff/v1/training', { previewId: 'x', manualMasks: [] })).statusCode).toBe(404);
    expect(app.staffRoutes.filter((r) => r.url.startsWith('/staff/v1/training') && r.method !== 'GET')).toEqual([]);
  });
});
