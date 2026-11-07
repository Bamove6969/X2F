// Plan 5 Task 21: the feedback form behind every "can't do that" popup (spec 5.2, owner 2026-10-29).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { requireSession } from '../src/auth/sessions.js';
import { FEEDBACK_FORM_DAILY, FEEDBACK_FORM_MIN_GAP_S, SendGap, listFeedbackForm, purgeFeedbackForm } from '../src/feedback/form.js';
import { ApiError } from '../src/errors.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-29T15:30:00Z');
const SECRET = 'the starter limit stopped my trade with zebra-quokka-71';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];

async function login(name: string, o: { level?: 'full' | 'recovery'; kind?: 'trader' | 'staff' } = {}): Promise<{ b: Browser; id: string }> {
  const id = await seedAccount(deps, { loginName: name, ...(o.kind ? { kind: o.kind } : {}) });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id, ...(o.level ? { level: o.level } : {}) })).statusCode).toBe(200);
  return { b, id };
}

const rows = async () =>
  (await deps.db.query<Record<string, unknown>>('select kind, body, account_id, from_code, created_on::text as created_on from feedback_form order by body')).rows;

beforeAll(async () => {
  ({ app, deps, setNow, logs } = await testApp());
  addTestLogin(app, deps);
  // A recovery-allowed route without allowHeld, to show a held session really is held.
  app.post('/t/held-check', { preHandler: requireSession({ allowRecovery: true }) }, async () => ({}));
});
afterAll(async () => app.close());
beforeEach(async () => {
  setNow(T0);
  await deps.db.query('delete from feedback_form');
});

describe('feedback_form schema', () => {
  it('holds an account id and nothing else about the sender: no session, device, address or time finer than a day', async () => {
    const cols = await deps.db.query<{ column_name: string; data_type: string; column_default: string | null }>(
      "select column_name, data_type, column_default from information_schema.columns where table_name = 'feedback_form' order by ordinal_position",
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual(['id', 'kind', 'body', 'account_id', 'from_code', 'created_on']);
    for (const c of cols.rows) {
      expect(c.column_default ?? '', c.column_name).not.toMatch(/nextval/);
      expect(c.data_type, c.column_name).not.toMatch(/timestamp|time|interval|serial|integer|bigint|inet|cidr/);
    }
    expect(cols.rows.find((c) => c.column_name === 'id')?.data_type).toBe('uuid');
    expect(cols.rows.find((c) => c.column_name === 'created_on')?.data_type).toBe('date');
    // The only reference is to accounts (named rows), and deleting the account nulls it.
    const fks = await deps.db.query<{ table_name: string; delete_rule: string }>(
      `select ccu.table_name, rc.delete_rule from information_schema.referential_constraints rc
         join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
         join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.constraint_name
        where tc.table_name = 'feedback_form'`,
    );
    expect(fks.rows).toEqual([{ table_name: 'accounts', delete_rule: 'SET NULL' }]);
  });
});

describe('POST /v1/feedback/form', () => {
  it('an anonymous row has no account id and no refusal code', async () => {
    const { b } = await login('shy1');
    const res = await b.post('/v1/feedback/form', { kind: 'complaint', text: '  Too strict.  ', anonymous: true, from: 'starter-limit' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({});
    expect(await rows()).toEqual([{ kind: 'complaint', body: 'Too strict.', account_id: null, from_code: null, created_on: '2026-10-29' }]);
  });

  it('a named row holds the account id and the refusal code, so staff can reach out', async () => {
    const { b, id } = await login('named1');
    expect((await b.post('/v1/feedback/form', { kind: 'recommendation', text: 'Line one\r\nLine two', anonymous: false, from: 'offer-cap' })).statusCode).toBe(202);
    // One send per FEEDBACK_FORM_MIN_GAP_S per person: space them out.
    setNow(new Date(T0.getTime() + FEEDBACK_FORM_MIN_GAP_S * 1000));
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'No code', anonymous: false })).statusCode).toBe(202);
    expect(await rows()).toEqual([
      { kind: 'recommendation', body: 'Line one\nLine two', account_id: id, from_code: 'offer-cap', created_on: '2026-10-29' },
      { kind: 'feedback', body: 'No code', account_id: id, from_code: null, created_on: '2026-10-29' },
    ].sort((x, y) => String(x.body).localeCompare(String(y.body))));
  });

  it('deleting the account makes its named rows anonymous instead of blocking the delete', async () => {
    const { b, id } = await login('leaver1');
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'Bye', anonymous: false, from: 'trading-hold' })).statusCode).toBe(202);
    await deps.db.query('delete from sessions where account_id = $1', [id]);
    await deps.db.query('delete from accounts where id = $1', [id]);
    expect((await rows())[0]).toMatchObject({ account_id: null });
  });

  it('logs nothing about the submission', async () => {
    const before = logs.length;
    const { b } = await login('quiet1');
    expect((await b.post('/v1/feedback/form', { kind: 'complaint', text: SECRET, anonymous: false, from: 'starter-limit' })).statusCode).toBe(202);
    expect((await b.post('/v1/feedback/form', { kind: 'complaint', text: SECRET, anonymous: 'yes' })).statusCode).toBe(400);
    const text = logs.slice(before).join('\n');
    expect(text).not.toContain('zebra-quokka');
    expect(text).not.toContain('starter-limit');
  });

  it.each([
    [{}],
    [{ kind: 'praise', text: 'x', anonymous: true }],
    [{ kind: 'feedback', text: '', anonymous: true }],
    [{ kind: 'feedback', text: '   \n ', anonymous: true }],
    [{ kind: 'feedback', text: 'x'.repeat(2001), anonymous: true }],
    [{ kind: 'feedback', text: 42, anonymous: true }],
    [{ kind: 'feedback', text: 'ok' }],
    [{ kind: 'feedback', text: 'ok', anonymous: 'true' }],
    [{ kind: 'feedback', text: 'bidi\u202etext', anonymous: true }],
    [{ kind: 'feedback', text: 'isolate\u2066text', anonymous: true }],
    [{ kind: 'feedback', text: 'bell\u0007here', anonymous: true }],
    [{ kind: 'feedback', text: 'zero\u200bwidth space', anonymous: true }],
    [{ kind: 'feedback', text: 'ok', anonymous: true, from: 'Starter Limit' }],
    [{ kind: 'feedback', text: 'ok', anonymous: true, from: 'x'.repeat(41) }],
    [{ kind: 'feedback', text: 'ok', anonymous: true, from: 7 }],
    [{ kind: 'feedback', text: 'ok', anonymous: true, extra: 1 }],
    [['feedback']],
  ])('refuses %j with 400', async (body) => {
    const { b } = await login(`bad${Math.random().toString(36).slice(2, 8)}`);
    const res = await b.post('/v1/feedback/form', body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await rows()).toEqual([]);
  });

  it('takes a tab, ZWNJ (Persian) and ZWJ (emoji sequences): review M5', async () => {
    const { b } = await login('script1');
    for (const [i, text] of ['tab\there', 'می\u200cخواهم', 'family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}'].entries()) {
      // One send per FEEDBACK_FORM_MIN_GAP_S per person: space them out.
      setNow(new Date(T0.getTime() + i * FEEDBACK_FORM_MIN_GAP_S * 1000));
      expect((await b.post('/v1/feedback/form', { kind: 'feedback', text, anonymous: true })).statusCode, JSON.stringify(text)).toBe(202);
    }
  });

  it('does not touch the session: no fresh last_seen_at beside the row (review M1)', async () => {
    const { b, id } = await login('untouched1');
    const before = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [id]);
    setNow(new Date(T0.getTime() + 60_000));
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'x', anonymous: true })).statusCode).toBe(202);
    const after = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [id]);
    expect(after.rows[0]!.last_seen_at.getTime()).toBe(before.rows[0]!.last_seen_at.getTime());
  });

  it('takes a HELD backup session too: the recorded allowHeld exception (review M2)', async () => {
    const { b, id } = await login('held1', { level: 'recovery' });
    await deps.db.query("update sessions set hold_until = $2 where account_id = $1", [id, new Date(T0.getTime() + 86_400_000)]);
    // The hold is real: a held route refuses this session.
    expect((await b.post('/t/held-check')).json()).toMatchObject({ error: 'recovery-hold' });
    expect((await b.post('/v1/feedback/form', { kind: 'complaint', text: 'held', anonymous: false })).statusCode).toBe(202);
    expect((await rows()).map((r) => r.account_id)).toEqual([id]);
  });

  it('a failed insert does not use up a send (review M3)', async () => {
    const base = Date.parse('2026-11-15T12:00:00Z');
    // One send per FEEDBACK_FORM_MIN_GAP_S per person: every try below is spaced out.
    let tries = 0;
    const next = () => setNow(new Date(base + tries++ * FEEDBACK_FORM_MIN_GAP_S * 1000));
    next();
    const { b } = await login('dbfail1');
    await deps.db.query('alter table feedback_form rename to feedback_form_away');
    try {
      for (let i = 0; i < FEEDBACK_FORM_DAILY; i++) {
        next();
        expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'x', anonymous: true })).statusCode).toBe(500);
      }
    } finally {
      await deps.db.query('alter table feedback_form_away rename to feedback_form');
    }
    for (let i = 0; i < FEEDBACK_FORM_DAILY; i++) {
      next();
      expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: `ok${i}`, anonymous: true })).statusCode).toBe(202);
    }
  });

  it('a failed insert gives the 30 s gap back: a retry straight after a 500 is taken (review m3)', async () => {
    setNow(new Date('2026-11-20T12:00:00Z'));
    const { b } = await login('dbfail2');
    await deps.db.query('alter table feedback_form rename to feedback_form_away');
    try {
      expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'x', anonymous: true })).statusCode).toBe(500);
    } finally {
      await deps.db.query('alter table feedback_form_away rename to feedback_form');
    }
    // Same instant: no gap was used up by the failed send.
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'retry', anonymous: true })).statusCode).toBe(202);
    // And the retry did start a gap.
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'again', anonymous: true })).json()).toEqual({
      error: 'slow-down',
      retryAfterSeconds: FEEDBACK_FORM_MIN_GAP_S,
    });
  });

  it('accepts 2000 characters, counted as characters, and a null from', async () => {
    const { b } = await login('long1');
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'é'.repeat(2000), anonymous: true, from: null })).statusCode).toBe(202);
  });

  it('needs a trader session, but takes a backup (recovery) session: a refused person may want to say so', async () => {
    const anon = await app.inject({ method: 'POST', url: '/v1/feedback/form', headers: { origin: ORIGIN }, payload: { kind: 'feedback', text: 'x', anonymous: true } });
    expect(anon.statusCode).toBe(401);
    const { b: staff } = await login('staff1', { kind: 'staff' });
    expect((await staff.post('/v1/feedback/form', { kind: 'feedback', text: 'x', anonymous: true })).json()).toEqual({ error: 'wrong-account-kind' });
    const { b: backup } = await login('backup1', { level: 'recovery' });
    expect((await backup.post('/v1/feedback/form', { kind: 'feedback', text: 'x', anonymous: true })).statusCode).toBe(202);
  });

  it('is refused without the exact Origin (CSRF)', async () => {
    const { b } = await login('csrf1');
    const res = await app.inject({ method: 'POST', url: '/v1/feedback/form', cookies: b.cookies, payload: { kind: 'feedback', text: 'x', anonymous: true } });
    expect(res.statusCode).toBe(403);
  });

  it(`takes ${FEEDBACK_FORM_DAILY} a day per account, named or not, then 429 until midnight UTC; the count is not stored`, async () => {
    setNow(new Date('2026-12-01T15:30:00Z'));
    const { b, id } = await login('chatty1');
    const { b: other } = await login('chatty2');
    for (let i = 0; i < FEEDBACK_FORM_DAILY; i++) {
      // One send per FEEDBACK_FORM_MIN_GAP_S per person: space them out.
      setNow(new Date(Date.parse('2026-12-01T15:30:00Z') + i * FEEDBACK_FORM_MIN_GAP_S * 1000));
      expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: `n${i}`, anonymous: i % 2 === 0 })).statusCode).toBe(202);
    }
    setNow(new Date('2026-12-01T15:30:00Z'));
    const over = await b.post('/v1/feedback/form', { kind: 'feedback', text: 'one more', anonymous: true });
    expect(over.statusCode).toBe(429);
    // 15:30 UTC → midnight is 8.5 hours away.
    expect(over.json()).toEqual({ error: 'slow-down', retryAfterSeconds: 8.5 * 3600 });
    expect(over.headers['retry-after']).toBe(String(8.5 * 3600));
    expect((await other.post('/v1/feedback/form', { kind: 'feedback', text: 'other', anonymous: true })).statusCode).toBe(202);
    expect(await rows()).toHaveLength(FEEDBACK_FORM_DAILY + 1);
    setNow(new Date('2026-12-02T00:00:01Z'));
    // That session has ended (session length, owner 2 Nov 2026: 2 hours until one is chosen), so log in
    // again: the daily count is per account, not per session.
    expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'next day', anonymous: true })).statusCode).toBe(202);
  });

  it(`one send per ${FEEDBACK_FORM_MIN_GAP_S} s per person (owner 2026-11-02; no shared budget): 429 slow-down in between, others unaffected`, async () => {
    setNow(new Date('2027-01-05T12:00:00Z'));
    const { b } = await login('gap1');
    const { b: other } = await login('gap2');
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'first', anonymous: true })).statusCode).toBe(202);
    // Straight after a send: the whole gap is left.
    const now = await b.post('/v1/feedback/form', { kind: 'feedback', text: 'at once', anonymous: true });
    expect(now.statusCode).toBe(429);
    expect(now.json()).toEqual({ error: 'slow-down', retryAfterSeconds: FEEDBACK_FORM_MIN_GAP_S });
    setNow(new Date(Date.parse('2027-01-05T12:00:00Z') + (FEEDBACK_FORM_MIN_GAP_S - 1) * 1000));
    const soon = await b.post('/v1/feedback/form', { kind: 'feedback', text: 'too soon', anonymous: true });
    expect(soon.statusCode).toBe(429);
    expect(soon.json()).toEqual({ error: 'slow-down', retryAfterSeconds: 1 });
    expect(soon.headers['retry-after']).toBe('1');
    expect((await other.post('/v1/feedback/form', { kind: 'feedback', text: 'someone else', anonymous: true })).statusCode).toBe(202);
    setNow(new Date(Date.parse('2027-01-05T12:00:00Z') + FEEDBACK_FORM_MIN_GAP_S * 1000));
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'later', anonymous: true })).statusCode).toBe(202);
    // Many people at once are never refused for each other (no shared cap).
    const crowd = await Promise.all(Array.from({ length: 40 }, (_, i) => login(`crowd${i}`)));
    const codes = await Promise.all(crowd.map(({ b: c }, i) => c.post('/v1/feedback/form', { kind: 'feedback', text: `c${i}`, anonymous: true }).then((r) => r.statusCode)));
    expect(codes.every((c) => c === 202)).toBe(true);
  });

  it('a parallel burst from one person (a double click) gets exactly one 202 (review m4)', async () => {
    setNow(new Date('2027-01-06T12:00:00Z'));
    const { b } = await login('double1');
    const codes = await Promise.all(
      ['one', 'two'].map((text) => b.post('/v1/feedback/form', { kind: 'feedback', text, anonymous: true }).then((r) => r.statusCode)),
    );
    expect(codes.sort()).toEqual([202, 429]);
    expect(await rows()).toHaveLength(1);
  });
});

describe('SendGap (review M2: keeps only "blocked until", and only while it blocks)', () => {
  const GAP = FEEDBACK_FORM_MIN_GAP_S * 1000;
  const refusal = (f: () => void): unknown => {
    try {
      f();
    } catch (e) {
      return e instanceof ApiError ? { status: e.status, code: e.code, ...e.extra } : e;
    }
    return 'taken';
  };

  it('forgets an account once its gap has run out, on the next request from anyone', () => {
    const g = new SendGap(GAP);
    g.take('a', 0);
    expect(g.size).toBe(1);
    expect(refusal(() => g.take('a', GAP - 1))).toEqual({ status: 429, code: 'slow-down', retryAfterSeconds: 1 });
    g.take('b', GAP);
    // a's entry expired at GAP and was dropped; only b's remains.
    expect(g.size).toBe(1);
    expect(g.blockedUntil('a')).toBeUndefined();
    expect(g.blockedUntil('b')).toBe(2 * GAP);
    g.sweep(3 * GAP);
    expect(g.size).toBe(0);
  });

  it('give() hands the gap back, but only the gap that take() set', () => {
    const g = new SendGap(GAP);
    const until = g.take('a', 0);
    g.give('a', until);
    expect(g.size).toBe(0);
    expect(refusal(() => g.take('a', 0))).toBe('taken');
    // A stale give (from an earlier take) does not clear a newer gap.
    g.give('a', until - 1);
    expect(g.blockedUntil('a')).toBe(GAP);
  });

  it('is bounded: past maxKeys the oldest entry is dropped (that account may send early, nothing worse)', () => {
    const g = new SendGap(GAP, 3);
    for (const k of ['a', 'b', 'c', 'd']) g.take(k, 0);
    expect(g.size).toBe(3);
    expect(g.blockedUntil('a')).toBeUndefined();
    expect(g.blockedUntil('d')).toBe(GAP);
  });
});

describe('listFeedbackForm and purgeFeedbackForm', () => {
  it('pages a day with more than a page of rows without losing any (review M4)', async () => {
    await deps.db.query(
      `insert into feedback_form (kind, body, created_on) select 'feedback', 'r' || g, '2026-10-20' from generate_series(1, 80) g`,
    );
    await deps.db.query(`insert into feedback_form (kind, body, created_on) values ('feedback', 'older', '2026-10-19')`);
    const seen: string[] = [];
    let page = await listFeedbackForm(deps.db);
    while (page.length > 0) {
      seen.push(...page.map((r) => r.text));
      const last = page[page.length - 1]!;
      page = await listFeedbackForm(deps.db, { before: { createdOn: last.createdOn, id: last.id } });
    }
    expect(seen).toHaveLength(81);
    expect(new Set(seen).size).toBe(81);
    expect(seen[80]).toBe('older');
  });

  it('lists newest day first with both kinds of row, and pages by day', async () => {
    const id = await seedAccount(deps, { loginName: 'lister1' });
    await deps.db.query(
      `insert into feedback_form (kind, body, account_id, from_code, created_on) values
         ('complaint', 'old', null, null, '2026-10-01'), ('feedback', 'new', $1, 'offer-cap', '2026-10-28')`,
      [id],
    );
    const all = await listFeedbackForm(deps.db);
    expect(all.map((r) => [r.text, r.accountId, r.from, r.createdOn])).toEqual([
      ['new', id, 'offer-cap', '2026-10-28'],
      ['old', null, null, '2026-10-01'],
    ]);
    expect((await listFeedbackForm(deps.db, { before: { createdOn: all[0]!.createdOn, id: all[0]!.id } })).map((r) => r.text)).toEqual(['old']);
  });

  it('deletes rows older than 365 days (as P5-A19)', async () => {
    await deps.db.query(
      `insert into feedback_form (kind, body, created_on) values ('feedback', 'keep', '2025-10-29'), ('feedback', 'drop', '2025-10-28')`,
    );
    expect(await purgeFeedbackForm.run(deps.db, T0)).toBe(1);
    expect((await rows()).map((r) => r.body)).toEqual(['keep']);
  });
});
