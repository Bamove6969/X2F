// Plan 4 Task 30: support tickets (spec 6.6, Helper). A trader opens, follows, writes and closes
// their own tickets; staff the owner granted `tickets.handle` work the queue. Text is sealed at rest,
// never logged; retention follows TICKET_KEEP_DAYS, or the trade a ticket names.
import { randomBytes } from 'node:crypto';
import {
  TICKET_BODY_MAX, TICKET_CATEGORIES, TICKET_KEEP_DAYS, TICKET_OPEN_AT_ONCE, TICKET_OPEN_DAILY,
} from '@x2f/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { openBody, purgeTickets, sealBody } from '../src/tickets/store.js';
import { TICKET_REPLIES_DAILY, TICKET_WRITE_GAP_S } from '../src/tickets/traderRoutes.js';
import { TICKET_OPEN_LOG_WINDOW_MS } from '../src/tickets/staffRoutes.js';
import { seedAccount } from './helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, staffApps } from './helpers/staffApp.js';
import { seedTrade } from './helpers/trades.js';

const T0 = new Date('2026-11-02T12:00:00Z');
const SECRET = 'my bank is Zephyr Credit Union, account 99887766';
const GAP_MS = TICKET_WRITE_GAP_S * 1000;
const DAY_MS = 86_400_000;

let t: Awaited<ReturnType<typeof staffApps>>;
let now = T0;
const setNow = (d: Date) => {
  now = d;
  t.setNow(d);
};
/** Moves the clock past the write gap. */
const later = (ms = GAP_MS) => setNow(new Date(now.getTime() + ms));

beforeAll(async () => {
  t = await staffApps();
});
afterAll(async () => t.close());
beforeEach(async () => {
  setNow(T0);
  await t.deps.db.query('delete from tickets');
});

const traderId = () => seedAccount(t.deps, { loginName: `tk${randomBytes(4).toString('hex')}`, kind: 'trader' });

type Call = (method: 'GET' | 'POST', url: string, payload?: unknown) => Promise<{ statusCode: number; json(): any; body: string }>;

/** The trader app as the account (a live trader session, made at the current clock). */
async function asTrader(id: string): Promise<Call> {
  const { token } = await insertSession(t.deps, id, 'trader');
  return (method, url, payload) =>
    t.trader.inject({ method, url, headers: { origin: 'https://x2f.test' }, cookies: { '__Host-x2f_session': token }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

let ownerId: string | null = null;
async function asStaff(o: Parameters<typeof seedStaff>[1]): Promise<{ id: string; b: StaffBrowser }> {
  // There is only ever one owner.
  const s = o.role === 'owner' && ownerId !== null ? { id: ownerId } : await seedStaff(t.deps, o);
  if (o.role === 'owner') ownerId = s.id;
  const { token } = await insertSession(t.deps, s.id, 'staff');
  return { id: s.id, b: new StaffBrowser(t.app).withSession(token) };
}

async function open(call: Call, body: Record<string, unknown> = { category: 'trades', body: SECRET }): Promise<string> {
  const res = await call('POST', '/v1/tickets', body);
  expect(res.statusCode, res.body).toBe(201);
  later();
  return res.json().id as string;
}

describe('schema and storage', () => {
  it('the text is sealed at rest: no column holds it, and a blob opens only at its own ticket, place and sender', async () => {
    const me = await asTrader(await traderId());
    const id = await open(me);
    const dump = await t.deps.db.query<{ row: string }>("select row_to_json(x)::text as row from (select * from tickets) x union all select encode(body_sealed, 'escape') from ticket_messages");
    for (const r of dump.rows) expect(r.row).not.toContain('Zephyr');
    const { rows } = await t.deps.db.query<{ body_sealed: Buffer }>('select body_sealed from ticket_messages where ticket_id = $1', [id]);
    const blob = rows[0]!.body_sealed;
    expect(openBody(t.deps.config, id, 1, 'trader', blob)).toBe(SECRET);
    expect(() => openBody(t.deps.config, id, 2, 'trader', blob)).toThrow();
    expect(() => openBody(t.deps.config, id, 1, 'staff', blob)).toThrow();
    expect(() => openBody(t.deps.config, '00000000-0000-4000-8000-000000000000', 1, 'trader', blob)).toThrow();
    const other = sealBody(t.deps.config, id, 1, 'trader', SECRET);
    expect(other.equals(blob)).toBe(false);
  });

  it('holds no session, device, address or IP column', async () => {
    const cols = await t.deps.db.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_name in ('tickets', 'ticket_messages') order by table_name, ordinal_position",
    );
    expect(cols.rows.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      'ticket_messages.ticket_id', 'ticket_messages.seq', 'ticket_messages.sender', 'ticket_messages.staff_id', 'ticket_messages.body_sealed', 'ticket_messages.at',
      'tickets.id', 'tickets.account_id', 'tickets.category', 'tickets.trade_code', 'tickets.status', 'tickets.taken_by', 'tickets.created_at', 'tickets.updated_at', 'tickets.closed_at',
    ]);
  });

  it('the categories end with everything-else, and the table takes exactly them', async () => {
    expect(TICKET_CATEGORIES.at(-1)).toBe('everything-else');
    const { rows } = await t.deps.db.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'tickets'::regclass and pg_get_constraintdef(oid) like '%category%'");
    for (const c of TICKET_CATEGORIES) expect(rows[0]!.def).toContain(`'${c}'`);
    expect([...rows[0]!.def.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1])).toEqual([...TICKET_CATEGORIES]);
  });

  it('deleting the account deletes its tickets and messages', async () => {
    const id = await traderId();
    await open(await asTrader(id));
    await t.deps.db.query('delete from sessions where account_id = $1', [id]);
    await t.deps.db.query('delete from accounts where id = $1', [id]);
    expect((await t.deps.db.query('select 1 from tickets')).rowCount).toBe(0);
    expect((await t.deps.db.query('select 1 from ticket_messages')).rowCount).toBe(0);
  });
});

describe('trader routes', () => {
  it('opens a ticket, lists it, reads the thread, writes more and closes it', async () => {
    const me = await asTrader(await traderId());
    const id = await open(me, { category: 'everything-else', body: '  Line one\r\nLine two  ' });
    const list = (await me('GET', '/v1/tickets')).json();
    expect(list).toEqual({ items: [{ id, category: 'everything-else', status: 'open', tradeCode: null, createdAt: T0.toISOString(), updatedAt: T0.toISOString(), lastFrom: 'trader' }] });
    const thread = (await me('GET', `/v1/tickets/${id}`)).json();
    expect(thread).toEqual({
      id, category: 'everything-else', status: 'open', tradeCode: null, createdAt: T0.toISOString(), updatedAt: T0.toISOString(),
      messages: [{ from: 'trader', body: 'Line one\nLine two', at: T0.toISOString() }],
    });
    const more = await me('POST', `/v1/tickets/${id}/messages`, { body: 'And a third.' });
    expect(more.statusCode, more.body).toBe(200);
    expect(more.json().messages.map((m: { body: string }) => m.body)).toEqual(['Line one\nLine two', 'And a third.']);
    const closed = await me('POST', `/v1/tickets/${id}/close`, {});
    expect(closed.json().status).toBe('closed');
    later();
    const after = await me('POST', `/v1/tickets/${id}/messages`, { body: 'Too late.' });
    expect([after.statusCode, errorOf(after as never)]).toEqual([409, 'ticket-closed']);
    // Closing again answers it as it is.
    expect((await me('POST', `/v1/tickets/${id}/close`, {})).json().status).toBe('closed');
  });

  it('a trader sees only their own tickets: anyone else\'s id is 404, as an unknown one', async () => {
    const alice = await asTrader(await traderId());
    const bob = await asTrader(await traderId());
    const id = await open(alice);
    expect((await bob('GET', '/v1/tickets')).json()).toEqual({ items: [] });
    for (const [m, url, body] of [
      ['GET', `/v1/tickets/${id}`, undefined], ['POST', `/v1/tickets/${id}/messages`, { body: 'hi' }], ['POST', `/v1/tickets/${id}/close`, {}],
      ['GET', '/v1/tickets/00000000-0000-4000-8000-000000000000', undefined], ['GET', '/v1/tickets/not-a-uuid', undefined],
    ] as const) {
      const res = await bob(m, url, body);
      expect([res.statusCode, errorOf(res as never)], url).toEqual([404, 'not-found']);
      later();
    }
    expect((await alice('GET', `/v1/tickets/${id}`)).json().status).toBe('open');
  });

  it('a category outside the list, a bad body, an extra key or a hidden character is 400', async () => {
    const me = await asTrader(await traderId());
    for (const body of [
      { category: 'disputes', body: 'x' }, { category: 'Everything else', body: 'x' }, { body: 'x' }, { category: 'trades' }, { category: 'trades', body: '   ' },
      { category: 'trades', body: 'x'.repeat(TICKET_BODY_MAX + 1) }, { category: 'trades', body: 'a‮b' }, { category: 'trades', body: 'x', subject: 'y' },
      { category: 'trades', body: 'x', tradeCode: 'nope' }, { category: 'trades', body: 7 },
    ]) {
      const res = await me('POST', '/v1/tickets', body);
      expect([res.statusCode, errorOf(res as never)], JSON.stringify(body).slice(0, 60)).toEqual([400, 'bad-request']);
    }
    expect((await me('POST', '/v1/tickets', { category: 'trades', body: 'x'.repeat(TICKET_BODY_MAX) })).statusCode).toBe(201);
  });

  it('a ticket may name one of the caller\'s own trades, never anyone else\'s', async () => {
    const sellerId = await traderId();
    const buyerId = await traderId();
    const outsider = await asTrader(await traderId());
    const { code } = await seedTrade(t.deps, { sellerId, buyerId, poster: 'seller' });
    const buyer = await asTrader(buyerId);
    const id = await open(buyer, { category: 'trades', body: 'About my trade', tradeCode: code.replaceAll('-', '').toLowerCase() });
    expect((await buyer('GET', `/v1/tickets/${id}`)).json().tradeCode).toBe(code);
    const res = await outsider('POST', '/v1/tickets', { category: 'trades', body: 'Not mine', tradeCode: code });
    expect([res.statusCode, errorOf(res as never)]).toEqual([404, 'not-found']);
  });

  it('they need a session', async () => {
    const anon = await t.trader.inject({ method: 'GET', url: '/v1/tickets', headers: { origin: 'https://x2f.test' } });
    expect(anon.statusCode).toBe(401);
  });
});

describe('rate limits', () => {
  it('one write per TICKET_WRITE_GAP_S per account (open and reply alike), given back on a refusal', async () => {
    const me = await asTrader(await traderId());
    const first = await me('POST', '/v1/tickets', { category: 'trades', body: 'one' });
    expect(first.statusCode).toBe(201);
    const soon = await me('POST', `/v1/tickets/${first.json().id}/messages`, { body: 'two' });
    expect([soon.statusCode, soon.json()]).toEqual([429, { error: 'slow-down', retryAfterSeconds: TICKET_WRITE_GAP_S }]);
    later();
    // A refused write (404) does not use up the gap.
    expect((await me('POST', '/v1/tickets/00000000-0000-4000-8000-000000000000/messages', { body: 'x' })).statusCode).toBe(404);
    expect((await me('POST', `/v1/tickets/${first.json().id}/messages`, { body: 'two' })).statusCode).toBe(200);
  });

  it('a parallel burst of opens makes exactly one ticket', async () => {
    const me = await asTrader(await traderId());
    const all = await Promise.all(Array.from({ length: 5 }, () => me('POST', '/v1/tickets', { category: 'offers', body: 'burst' })));
    expect(all.map((r) => r.statusCode).sort()).toEqual([201, 429, 429, 429, 429]);
  });

  it(`at most ${TICKET_OPEN_AT_ONCE} tickets not closed at once (409 too-many-tickets); closing one frees a place`, async () => {
    const me = await asTrader(await traderId());
    const ids: string[] = [];
    for (let i = 0; i < TICKET_OPEN_AT_ONCE; i++) ids.push(await open(me));
    const res = await me('POST', '/v1/tickets', { category: 'trades', body: 'one more' });
    expect([res.statusCode, errorOf(res as never)]).toEqual([409, 'too-many-tickets']);
    later();
    await me('POST', `/v1/tickets/${ids[0]}/close`, {});
    await open(me);
  });

  it(`at most ${TICKET_OPEN_DAILY} new tickets in any 24 hours (429 daily, until the oldest leaves the window)`, async () => {
    const accountId = await traderId();
    let me = await asTrader(accountId);
    for (let i = 0; i < TICKET_OPEN_DAILY; i++) {
      const id = await open(me);
      await me('POST', `/v1/tickets/${id}/close`, {});
    }
    const res = await me('POST', '/v1/tickets', { category: 'trades', body: 'eleventh' });
    expect(res.statusCode).toBe(429);
    const wait = DAY_MS - TICKET_OPEN_DAILY * GAP_MS;
    expect(res.json()).toEqual({ error: 'slow-down', limit: 'daily', retryAfterSeconds: Math.ceil(wait / 1000) });
    setNow(new Date(T0.getTime() + DAY_MS + 1000));
    me = await asTrader(accountId);
    expect((await me('POST', '/v1/tickets', { category: 'trades', body: 'next day' })).statusCode).toBe(201);
  });

  it(`at most ${TICKET_REPLIES_DAILY} more messages in any 24 hours`, async () => {
    const me = await asTrader(await traderId());
    const id = await open(me);
    for (let i = 0; i < TICKET_REPLIES_DAILY; i++) {
      // Inserted at the write gap's pace, straight into the table (the route's own count reads them).
      await t.deps.db.query("insert into ticket_messages (ticket_id, seq, sender, body_sealed, at) values ($1, $2, 'trader', $3, $4)", [id, i + 2, sealBody(t.deps.config, id, i + 2, 'trader', 'x'), now]);
    }
    const res = await me('POST', `/v1/tickets/${id}/messages`, { body: 'one too many' });
    expect([res.statusCode, res.json().limit]).toEqual([429, 'daily']);
  });
});

describe('staff routes', () => {
  it('a staff member without tickets.handle gets forbidden; a helper, a moderator or a senior with the grant, and the owner, get the queue', async () => {
    for (const role of ['helper', 'mod', 'senior'] as const) {
      const { b } = await asStaff({ role });
      const res = await b.get('/staff/v1/tickets');
      expect([res.statusCode, errorOf(res)], role).toEqual([403, 'forbidden']);
      const granted = await asStaff({ role, grants: ['tickets.handle'] });
      expect((await granted.b.get('/staff/v1/tickets')).statusCode, role).toBe(200);
    }
    expect((await (await asStaff({ role: 'owner' })).b.get('/staff/v1/tickets')).statusCode).toBe(200);
  });

  it('the queue lists no text and no trader, oldest first, by category', async () => {
    const me = await asTrader(await traderId());
    const a = await open(me, { category: 'wallets', body: SECRET });
    const b = await open(me, { category: 'trades', body: SECRET });
    const helper = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    const q = await helper.b.get('/staff/v1/tickets');
    expect(q.body).not.toContain('Zephyr');
    expect(q.json().items.map((i: { id: string }) => i.id)).toEqual([a, b]);
    expect(Object.keys(q.json().items[0]).sort()).toEqual(['category', 'createdAt', 'id', 'status', 'taken', 'updatedAt', 'waiting']);
    expect((await helper.b.get('/staff/v1/tickets?category=trades')).json().items.map((i: { id: string }) => i.id)).toEqual([b]);
    expect((await helper.b.get('/staff/v1/tickets?category=nope')).statusCode).toBe(400);
  });

  it('a helper takes, reads, answers and closes; the trader sees the answer with no staff name; only the taker reads the thread', async () => {
    const trader = await asTrader(await traderId());
    const id = await open(trader);
    const helper = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    const other = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    // Before taking, nobody reads it.
    expect([(await helper.b.get(`/staff/v1/tickets/${id}`)).statusCode, errorOf(await helper.b.get(`/staff/v1/tickets/${id}`))]).toEqual([403, 'forbidden-case']);
    const took = await helper.b.post(`/staff/v1/tickets/${id}/take`);
    expect(took.statusCode, took.body).toBe(200);
    expect(took.json().messages).toEqual([{ from: 'trader', body: SECRET, at: T0.toISOString(), mine: false }]);
    // Another helper cannot take it over, nor read it.
    const steal = await other.b.post(`/staff/v1/tickets/${id}/take`);
    expect([steal.statusCode, errorOf(steal)]).toEqual([409, 'ticket-taken']);
    expect(errorOf(await other.b.get(`/staff/v1/tickets/${id}`))).toBe('forbidden-case');
    expect(errorOf(await other.b.post(`/staff/v1/tickets/${id}/messages`, { body: 'hi' }))).toBe('forbidden-case');
    expect((await other.b.get('/staff/v1/tickets')).json().items[0].taken).toBe('other');
    expect((await helper.b.get('/staff/v1/tickets')).json().items[0].taken).toBe('me');

    const answer = await helper.b.post(`/staff/v1/tickets/${id}/messages`, { body: 'Thanks, we are looking into it.' });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json().status).toBe('answered');
    expect(answer.json().messages.at(-1)).toMatchObject({ from: 'staff', mine: true });
    const seen = (await trader('GET', `/v1/tickets/${id}`)).json();
    expect(seen.status).toBe('answered');
    expect(seen.messages.at(-1)).toEqual({ from: 'staff', body: 'Thanks, we are looking into it.', at: now.toISOString() });
    expect(JSON.stringify(seen)).not.toContain(helper.id);
    expect((await trader('GET', '/v1/tickets')).json().items[0].lastFrom).toBe('staff');
    // The trader writes again: back to waiting for staff.
    later();
    await trader('POST', `/v1/tickets/${id}/messages`, { body: 'Any news?' });
    expect((await helper.b.get('/staff/v1/tickets')).json().items[0]).toMatchObject({ status: 'open', waiting: 'staff' });

    const closed = await helper.b.post(`/staff/v1/tickets/${id}/close`);
    expect(closed.json().status).toBe('closed');
    expect((await helper.b.get('/staff/v1/tickets')).json().items).toEqual([]);
    expect(errorOf(await helper.b.post(`/staff/v1/tickets/${id}/messages`, { body: 'x' }))).toBe('ticket-closed');
    expect(errorOf(await other.b.post(`/staff/v1/tickets/${id}/take`))).toBe('ticket-closed');
  });

  it('a released ticket goes back to the queue; a taker who lost the grant or was switched off no longer holds it; the owner may take over', async () => {
    const trader = await asTrader(await traderId());
    const id = await open(trader);
    const a = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    const b = await asStaff({ role: 'mod', grants: ['tickets.handle'] });
    await a.b.post(`/staff/v1/tickets/${id}/take`);
    expect((await a.b.post(`/staff/v1/tickets/${id}/release`)).json()).toEqual({ released: true });
    expect((await b.b.post(`/staff/v1/tickets/${id}/take`)).statusCode).toBe(200);
    // b loses the grant: a can take it.
    await t.deps.db.query("update staff_members set grants = '{}' where account_id = $1", [b.id]);
    expect((await a.b.post(`/staff/v1/tickets/${id}/take`)).statusCode).toBe(200);
    // The owner takes over from a live taker.
    const owner = await asStaff({ role: 'owner' });
    expect((await owner.b.post(`/staff/v1/tickets/${id}/take`)).statusCode).toBe(200);
    expect(errorOf(await a.b.get(`/staff/v1/tickets/${id}`))).toBe('forbidden-case');
    // Switched off: someone else may take it.
    await owner.b.post(`/staff/v1/tickets/${id}/release`);
    const c = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    expect((await c.b.post(`/staff/v1/tickets/${id}/take`)).statusCode).toBe(200);
    expect(errorOf(await a.b.post(`/staff/v1/tickets/${id}/take`))).toBe('ticket-taken');
    await t.deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [c.id, now]);
    expect((await a.b.post(`/staff/v1/tickets/${id}/take`)).statusCode).toBe(200);
  });

  it('every staff action is logged with the ticket id only: never the text, the trader or the trade', async () => {
    const sellerId = await traderId();
    const { code } = await seedTrade(t.deps, { sellerId, buyerId: await traderId(), poster: 'seller' });
    const seller = await asTrader(sellerId);
    const id = await open(seller, { category: 'trades', body: SECRET, tradeCode: code });
    const helper = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    const before = (await t.deps.db.query<{ n: number }>("select count(*)::int as n from activity_log where action like 'ticket.%'")).rows[0]!.n;
    await helper.b.post(`/staff/v1/tickets/${id}/take`);
    await helper.b.get(`/staff/v1/tickets/${id}`);
    // A reload within TICKET_OPEN_LOG_WINDOW_MS is not logged again.
    await helper.b.get(`/staff/v1/tickets/${id}`);
    await helper.b.post(`/staff/v1/tickets/${id}/messages`, { body: 'The reply mentions Zephyr too.' });
    await helper.b.post(`/staff/v1/tickets/${id}/release`);
    await helper.b.post(`/staff/v1/tickets/${id}/take`);
    await helper.b.post(`/staff/v1/tickets/${id}/close`);
    const { rows } = await t.deps.db.query<{ action: string; actor_id: string; trade_code: string | null; detail: unknown }>(
      "select action, actor_id, trade_code, detail from activity_log where action like 'ticket.%' order by id offset $1",
      [before],
    );
    expect(rows.map((r) => r.action)).toEqual(['ticket.taken', 'ticket.opened', 'ticket.replied', 'ticket.released', 'ticket.taken', 'ticket.closed']);
    for (const r of rows) {
      expect(r.actor_id).toBe(helper.id);
      expect(r.trade_code).toBeNull();
      expect(JSON.parse(r.detail as string)).toEqual({ ticketId: id });
    }
    const all = JSON.stringify((await t.deps.db.query('select * from activity_log')).rows);
    expect(all).not.toContain('Zephyr');
    expect(all).not.toContain(sellerId);
    expect(t.logs.join('\n')).not.toContain('Zephyr');
    // After the window, a read is logged again.
    setNow(new Date(now.getTime() + TICKET_OPEN_LOG_WINDOW_MS));
    const n = (await logEntries(t.deps, 'ticket.opened')).length;
    await helper.b.get(`/staff/v1/tickets/${id}`);
    expect((await logEntries(t.deps, 'ticket.opened')).length).toBe(n + 1);
  });

  it('a staff reply body is checked as a trader\'s (400)', async () => {
    const id = await open(await asTrader(await traderId()));
    const helper = await asStaff({ role: 'helper', grants: ['tickets.handle'] });
    await helper.b.post(`/staff/v1/tickets/${id}/take`);
    for (const body of [{}, { body: '' }, { body: 'x'.repeat(TICKET_BODY_MAX + 1) }, { body: 'ok', extra: 1 }]) {
      expect((await helper.b.post(`/staff/v1/tickets/${id}/messages`, body)).statusCode).toBe(400);
    }
  });
});

describe('retention', () => {
  it('runs in the one retention scheduler, right after the trade purge', () => {
    const names = RETENTION_JOBS.map((j) => j.name);
    expect(names).toContain('purgeTickets');
    expect(names.indexOf('purgeTickets')).toBe(names.indexOf('purgeTrades') + 1);
  });

  it(`deletes a ticket ${TICKET_KEEP_DAYS} days after its last activity, whatever its status, with its messages`, async () => {
    const me = await asTrader(await traderId());
    const closed = await open(me);
    await me('POST', `/v1/tickets/${closed}/close`, {});
    const abandoned = await open(me);
    const kept = await open(me);
    // `kept` has a newer message.
    setNow(new Date(T0.getTime() + 10 * DAY_MS));
    await (await asTrader((await t.deps.db.query<{ account_id: string }>('select account_id from tickets where id = $1', [kept])).rows[0]!.account_id))('POST', `/v1/tickets/${kept}/messages`, { body: 'still here' });
    const edge = new Date(T0.getTime() + TICKET_KEEP_DAYS * DAY_MS + 3 * GAP_MS);
    expect(await purgeTickets.run(t.deps.db, new Date(T0.getTime() + TICKET_KEEP_DAYS * DAY_MS - 1))).toBe(0);
    expect(await purgeTickets.run(t.deps.db, edge)).toBe(2);
    const left = (await t.deps.db.query<{ id: string }>('select id from tickets')).rows.map((r) => r.id);
    expect(left).toEqual([kept]);
    expect(left).not.toContain(abandoned);
    expect((await t.deps.db.query('select 1 from ticket_messages where ticket_id <> $1', [kept])).rowCount).toBe(0);
  });

  it('a ticket naming a trade goes as soon as that trade is purged', async () => {
    const sellerId = await traderId();
    const { code } = await seedTrade(t.deps, { sellerId, buyerId: await traderId(), poster: 'seller' });
    const me = await asTrader(sellerId);
    const named = await open(me, { category: 'trades', body: 'about it', tradeCode: code });
    const plain = await open(me);
    expect(await purgeTickets.run(t.deps.db, now)).toBe(0);
    // As the whole-trade purge would (retention/tradePurge.ts): the trade row is gone.
    await t.deps.db.query('delete from trade_events where code = $1', [code]).catch(() => undefined);
    await t.deps.db.query('delete from trades where code = $1', [code]);
    expect(await purgeTickets.run(t.deps.db, now)).toBe(1);
    expect((await t.deps.db.query<{ id: string }>('select id from tickets')).rows.map((r) => r.id)).toEqual([plain]);
    expect(named).not.toBe(plain);
  });
});
