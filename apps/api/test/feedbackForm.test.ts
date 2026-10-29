// Plan 5 Task 21: the feedback form behind every "can't do that" popup (spec 5.2, owner 2026-10-29).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { FEEDBACK_FORM_BUCKET, FEEDBACK_FORM_DAILY, listFeedbackForm, purgeFeedbackForm } from '../src/feedback/form.js';
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
    [{ kind: 'feedback', text: 'bidi‮text', anonymous: true }],
    [{ kind: 'feedback', text: 'tab\there', anonymous: true }],
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
    const { b } = await login('chatty1');
    const { b: other } = await login('chatty2');
    for (let i = 0; i < FEEDBACK_FORM_DAILY; i++) {
      expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: `n${i}`, anonymous: i % 2 === 0 })).statusCode).toBe(202);
    }
    const over = await b.post('/v1/feedback/form', { kind: 'feedback', text: 'one more', anonymous: true });
    expect(over.statusCode).toBe(429);
    // 15:30 UTC → midnight is 8.5 hours away.
    expect(over.json()).toEqual({ error: 'slow-down', retryAfterSeconds: 8.5 * 3600 });
    expect(over.headers['retry-after']).toBe(String(8.5 * 3600));
    expect((await other.post('/v1/feedback/form', { kind: 'feedback', text: 'other', anonymous: true })).statusCode).toBe(202);
    expect(await rows()).toHaveLength(FEEDBACK_FORM_DAILY + 1);
    setNow(new Date('2026-10-30T00:00:01Z'));
    expect((await b.post('/v1/feedback/form', { kind: 'feedback', text: 'next day', anonymous: true })).statusCode).toBe(202);
  });

  // Last in this block: it empties the app's shared bucket.
  it('one shared budget for everyone on top of the daily count (503 busy when spent)', async () => {
    // A week on: the bucket has refilled whatever earlier tests took.
    setNow(new Date('2026-11-05T12:00:00Z'));
    const senders = await Promise.all(Array.from({ length: Math.ceil((FEEDBACK_FORM_BUCKET.capacity + 5) / FEEDBACK_FORM_DAILY) }, (_, i) => login(`flood${i}`)));
    const codes: number[] = [];
    for (const { b } of senders) {
      for (let i = 0; i < FEEDBACK_FORM_DAILY; i++) codes.push((await b.post('/v1/feedback/form', { kind: 'feedback', text: `f${i}`, anonymous: true })).statusCode);
    }
    expect(codes.filter((c) => c === 202)).toHaveLength(FEEDBACK_FORM_BUCKET.capacity);
    expect(codes.filter((c) => c !== 202 && c !== 503)).toEqual([]);
  });
});

describe('listFeedbackForm and purgeFeedbackForm', () => {
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
    expect((await listFeedbackForm(deps.db, { before: '2026-10-28' })).map((r) => r.text)).toEqual(['old']);
  });

  it('deletes rows older than 365 days (as P5-A19)', async () => {
    await deps.db.query(
      `insert into feedback_form (kind, body, created_on) values ('feedback', 'keep', '2025-10-29'), ('feedback', 'drop', '2025-10-28')`,
    );
    expect(await purgeFeedbackForm.run(deps.db, T0)).toBe(1);
    expect((await rows()).map((r) => r.body)).toEqual(['keep']);
  });
});

// TRIPWIRE (local tree only): Plan 4's staff API and Task 4's staff Feedback page are not on the main
// line yet, so no route lists feedback_form rows. When either lands, serve listFeedbackForm behind
// `feedback.read` (the staff list shows both kinds: Task 4's moods and these form rows, named rows
// with their account), then delete this tripwire.
describe('Task 21 waits for the staff Feedback page', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  it('NEEDS_PLAN_4_STAFF: no staff route lists the feedback form yet', () => {
    for (const p of ['apps/api/src/staff/feedback.ts', 'apps/staff-web/src/screens/Feedback.tsx']) {
      expect(existsSync(ROOT + p), `${p} landed: serve listFeedbackForm on the staff Feedback page (Task 21), then delete this tripwire`).toBe(false);
    }
  });
});
