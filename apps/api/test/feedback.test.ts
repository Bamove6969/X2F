// Plan 5 Task 4: platform feedback, the one-tap "How's X2F doing?" prompt (P5-A19, spec 5.2).
// Unlinkable by design: the table has no account column and keeps only the day.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { FEEDBACK_DAILY, FEEDBACK_NOTE_MAX, feedbackMoodCounts, listFeedback, purgeFeedback } from '../src/feedback/mood.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-29T15:30:00Z');
const SECRET = 'the release took ages with walrus-pelican-42';

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
  (await deps.db.query<{ mood: string; note: string | null; created_on: string }>('select mood, note, created_on::text as created_on from platform_feedback order by mood, note'))
    .rows;

beforeAll(async () => {
  ({ app, deps, setNow, logs } = await testApp());
  addTestLogin(app, deps);
});
afterAll(async () => app.close());
beforeEach(async () => {
  setNow(T0);
  await deps.db.query('delete from platform_feedback');
});

describe('platform_feedback schema', () => {
  it('has no column about the sender (account, session, username, device, address) and no time finer than a day', async () => {
    const cols = await deps.db.query<{ column_name: string; data_type: string; column_default: string | null }>(
      "select column_name, data_type, column_default from information_schema.columns where table_name = 'platform_feedback' order by ordinal_position",
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual(['id', 'mood', 'note', 'created_on']);
    for (const c of cols.rows) {
      expect(c.column_name).not.toMatch(/account|session|user|name|device|ip|addr|_at$/);
      expect(c.column_default ?? '', c.column_name).not.toMatch(/nextval/);
      expect(c.data_type, c.column_name).not.toMatch(/timestamp|time|interval|serial|integer|bigint|inet|cidr/);
    }
    expect(cols.rows.find((c) => c.column_name === 'id')).toMatchObject({ data_type: 'uuid', column_default: 'gen_random_uuid()' });
    expect(cols.rows.find((c) => c.column_name === 'created_on')?.data_type).toBe('date');
    // No reference to any other table (accounts least of all).
    const fks = await deps.db.query(
      "select 1 from information_schema.table_constraints where table_name = 'platform_feedback' and constraint_type = 'FOREIGN KEY'",
    );
    expect(fks.rows).toEqual([]);
  });

  it('the database refuses a bad mood and a note over 500 characters', async () => {
    await expect(deps.db.query("insert into platform_feedback (mood, created_on) values ('meh', '2026-10-29')")).rejects.toMatchObject({ code: '23514' });
    await expect(
      deps.db.query("insert into platform_feedback (mood, note, created_on) values ('ok', $1, '2026-10-29')", ['x'.repeat(501)]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('POST /v1/feedback', () => {
  it('stores the mood, the note and the day, and nothing about the sender', async () => {
    const { b, id } = await login('mood1');
    const res = await b.post('/v1/feedback', { mood: 'needs-work', note: '  Slow release.  ' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({});
    expect((await b.post('/v1/feedback', { mood: 'great' })).statusCode).toBe(202);
    expect((await b.post('/v1/feedback', { mood: 'ok', note: '   ' })).statusCode).toBe(202);
    expect(await rows()).toEqual([
      { mood: 'great', note: null, created_on: '2026-10-29' },
      { mood: 'needs-work', note: 'Slow release.', created_on: '2026-10-29' },
      { mood: 'ok', note: null, created_on: '2026-10-29' },
    ]);
    const all = JSON.stringify((await deps.db.query('select * from platform_feedback')).rows);
    expect(all).not.toContain(id);
    expect(all).not.toContain('mood1');
  });

  it('logs nothing about the submission, the note least of all', async () => {
    const before = logs.length;
    const { b } = await login('quiet1');
    expect((await b.post('/v1/feedback', { mood: 'ok', note: SECRET })).statusCode).toBe(202);
    expect((await b.post('/v1/feedback', { mood: 'meh', note: SECRET })).statusCode).toBe(400);
    expect((await b.post('/v1/feedback', { mood: 'ok', note: SECRET + '‮' })).statusCode).toBe(400);
    const text = logs.slice(before).join('\n');
    expect(text).not.toContain('walrus-pelican');
    expect(text).not.toContain('/v1/feedback');
  });

  it(`takes ${FEEDBACK_DAILY} a day per account; the next is still 202 but stores nothing; a new UTC day starts over`, async () => {
    setNow(new Date('2026-12-01T15:30:00Z'));
    const { b } = await login('chatty1');
    const { b: other } = await login('chatty2');
    for (let i = 0; i < FEEDBACK_DAILY; i++) expect((await b.post('/v1/feedback', { mood: 'ok', note: `n${i}` })).statusCode).toBe(202);
    const over = await b.post('/v1/feedback', { mood: 'great', note: 'one more' });
    expect(over.statusCode).toBe(202);
    expect(over.json()).toEqual({});
    expect((await rows()).map((r) => r.note)).toEqual(['n0', 'n1', 'n2']);
    expect((await other.post('/v1/feedback', { mood: 'great', note: 'other' })).statusCode).toBe(202);
    expect(await rows()).toHaveLength(FEEDBACK_DAILY + 1);
    setNow(new Date('2026-12-02T00:00:01Z'));
    expect((await b.post('/v1/feedback', { mood: 'great', note: 'next day' })).statusCode).toBe(202);
    expect((await rows()).map((r) => r.note)).toContain('next day');
  });

  it('has no shared daily cap (owner 2026-11-01): a send is stored however many rows today already has', async () => {
    // Well beyond the old shared cap of 5000 a UTC day.
    await deps.db.query("insert into platform_feedback (mood, created_on) select 'ok', '2026-10-29' from generate_series(1, 6000)");
    const { b } = await login('nocap1');
    expect((await b.post('/v1/feedback', { mood: 'great', note: 'still stored' })).statusCode).toBe(202);
    expect((await deps.db.query("select created_on::text as d from platform_feedback where note = 'still stored'")).rows).toEqual([{ d: '2026-10-29' }]);
    const today = await deps.db.query<{ n: number }>("select count(*)::int as n from platform_feedback where created_on = '2026-10-29'");
    expect(today.rows[0]!.n).toBe(6001);
  });

  it('a failed insert does not use up a send', async () => {
    setNow(new Date('2026-11-15T12:00:00Z'));
    const { b } = await login('dbfail1');
    const before = logs.length;
    await deps.db.query('alter table platform_feedback rename to platform_feedback_away');
    try {
      for (let i = 0; i < FEEDBACK_DAILY; i++) expect((await b.post('/v1/feedback', { mood: 'ok', note: SECRET })).statusCode).toBe(500);
    } finally {
      await deps.db.query('alter table platform_feedback_away rename to platform_feedback');
    }
    // The error is logged (so the capture works), but never the note or its query parameters.
    const text = logs.slice(before).join('\n');
    expect(text).not.toBe('');
    expect(text).not.toContain('walrus-pelican');
    for (let i = 0; i < FEEDBACK_DAILY; i++) expect((await b.post('/v1/feedback', { mood: 'ok', note: `ok${i}` })).statusCode).toBe(202);
    expect(await rows()).toHaveLength(FEEDBACK_DAILY);
  });

  it.each([
    [{}],
    [{ mood: 'meh' }],
    [{ mood: 'Great' }],
    [{ mood: 3 }],
    [{ mood: 'ok', note: 'x'.repeat(FEEDBACK_NOTE_MAX + 1) }],
    [{ mood: 'ok', note: 42 }],
    [{ mood: 'ok', note: 'bidi‮text' }],
    [{ mood: 'ok', note: 'bell\u0007here' }],
    [{ mood: 'ok', note: 'zero​width' }],
    [{ mood: 'ok', extra: 1 }],
    [{ mood: 'ok', account: 'me' }],
    [['ok']],
  ])('refuses %j with 400 bad-request', async (body) => {
    const { b } = await login(`bad${Math.random().toString(36).slice(2, 8)}`);
    const res = await b.post('/v1/feedback', body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(await rows()).toEqual([]);
  });

  it('accepts 500 characters, counted as characters, a null note, a tab, ZWNJ and ZWJ', async () => {
    const { b } = await login('long1');
    expect((await b.post('/v1/feedback', { mood: 'ok', note: 'é'.repeat(FEEDBACK_NOTE_MAX) })).statusCode).toBe(202);
    expect((await b.post('/v1/feedback', { mood: 'great', note: null })).statusCode).toBe(202);
    expect((await b.post('/v1/feedback', { mood: 'needs-work', note: 'می‌خواهم\tfamily \u{1F468}‍\u{1F469}' })).statusCode).toBe(202);
    expect(await rows()).toHaveLength(3);
  });

  it('does not touch the session: no fresh last_seen_at beside the row', async () => {
    const { b, id } = await login('untouched1');
    const before = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [id]);
    setNow(new Date(T0.getTime() + 60_000));
    expect((await b.post('/v1/feedback', { mood: 'ok' })).statusCode).toBe(202);
    const after = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [id]);
    expect(after.rows[0]!.last_seen_at.getTime()).toBe(before.rows[0]!.last_seen_at.getTime());
  });

  it('needs a full trader session (requireTrader)', async () => {
    const anon = await app.inject({ method: 'POST', url: '/v1/feedback', headers: { origin: ORIGIN }, payload: { mood: 'ok' } });
    expect(anon.statusCode).toBe(401);
    const { b: staff } = await login('staff1', { kind: 'staff' });
    expect((await staff.post('/v1/feedback', { mood: 'ok' })).json()).toEqual({ error: 'wrong-account-kind' });
    const { b: backup } = await login('backup1', { level: 'recovery' });
    expect((await backup.post('/v1/feedback', { mood: 'ok' })).json()).toEqual({ error: 'recovery-session' });
    expect(await rows()).toEqual([]);
  });

  it('is refused without the exact Origin (CSRF)', async () => {
    const { b } = await login('csrf1');
    const res = await app.inject({ method: 'POST', url: '/v1/feedback', cookies: b.cookies, payload: { mood: 'ok' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('listFeedback, feedbackMoodCounts and purgeFeedback', () => {
  it('lists newest day first, 50 a page, and pages a day with more than a page of rows by a keyset cursor', async () => {
    await deps.db.query(`insert into platform_feedback (mood, note, created_on) select 'ok', 'r' || g, '2026-10-20' from generate_series(1, 80) g`);
    await deps.db.query(`insert into platform_feedback (mood, note, created_on) values ('great', 'newest', '2026-10-28'), ('needs-work', null, '2026-10-19')`);
    const first = await listFeedback(deps.db);
    expect(first).toHaveLength(50);
    expect(first[0]).toEqual({ id: expect.any(String), mood: 'great', note: 'newest', createdOn: '2026-10-28' });
    const seen: (string | null)[] = [];
    let page = first;
    while (page.length > 0) {
      seen.push(...page.map((r) => r.note));
      const last = page[page.length - 1]!;
      page = await listFeedback(deps.db, { before: { createdOn: last.createdOn, id: last.id } });
    }
    expect(seen).toHaveLength(82);
    expect(new Set(seen).size).toBe(82);
    expect(seen[81]).toBeNull();
  });

  it('counts Great / OK / Needs work over the last 30 days for the staff page', async () => {
    await deps.db.query(
      `insert into platform_feedback (mood, created_on) values
         ('great', '2026-10-29'), ('great', '2026-09-30'), ('ok', '2026-10-01'), ('needs-work', '2026-10-15'), ('needs-work', '2026-09-29')`,
    );
    // 30 days back from 2026-10-29: 2026-09-30 is in, 2026-09-29 is out.
    expect(await feedbackMoodCounts(deps.db, T0)).toEqual({ great: 2, ok: 1, needsWork: 1 });
  });

  it('deletes rows older than 365 days (P5-A19): a 366-day-old row goes, 365- and 364-day-old rows stay', async () => {
    await deps.db.query(
      `insert into platform_feedback (mood, note, created_on) values ('ok', 'd366', '2025-10-28'), ('ok', 'd365', '2025-10-29'), ('ok', 'd364', '2025-10-30')`,
    );
    expect(purgeFeedback.name).toBe('purgeFeedback');
    expect(await purgeFeedback.run(deps.db, T0)).toBe(1);
    expect((await rows()).map((r) => r.note)).toEqual(['d364', 'd365']);
  });

  it('purgeFeedback runs in the one retention scheduler', () => {
    expect(RETENTION_JOBS).toContain(purgeFeedback);
  });
});

// TRIPWIRE (local tree only, never red today): the staff API serves listFeedback and
// feedbackMoodCounts (staff/feedback.ts, Plan 4 Task 4); the staff web page is still owed. It fails
// once its piece lands in this checkout: then do what it says and delete it.
describe('Task 4 waits for the Plan 4 staff web app', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const has = (p: string): boolean => existsSync(ROOT + p);

  it('NEEDS_P4_STAFF_WEB_FEEDBACK_PAGE: the staff-web Feedback page (no board yet, NEEDS_DESIGN)', () => {
    // When apps/staff-web lands (Plan 4 Task 16): build src/screens/Feedback.tsx listing both
    // feedback kinds, with 30-day Great / OK / Needs work counts, from StaffLog's table styles,
    // `// COPY-UNSIGNED` (no board: Claude Design owns the look).
    expect(has('apps/staff-web/package.json'), 'apps/staff-web landed: build the Feedback page (see this test)').toBe(false);
  });
});
