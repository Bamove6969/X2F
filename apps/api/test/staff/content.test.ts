// Plan 4 Task 4 (from the tripwires it fired): News writing (Task 28) and the feedback lists
// (Plan 5 Tasks 4 and 21) on the staff API. Who may call them is the privilege matrix's job.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { SESSION_COOKIE } from '../../src/auth/sessions.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, staffApps, uniqueName } from '../helpers/staffApp.js';

let app: FastifyInstance;
let trader: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
let owner: StaffBrowser;
let ownerId: string;
let setNow: (d: Date) => void;

beforeAll(async () => {
  ({ app, trader, deps, setNow, close } = await staffApps());
  setNow(new Date('2026-11-02T12:00:00Z'));
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());

describe('News on the staff API (site.control)', () => {
  it('posts, edits and deletes a message, logging each change with its id only', async () => {
    const before = await Promise.all(['news.published', 'news.edited', 'news.deleted'].map((a) => logEntries(deps, a)));
    const posted = await owner.post('/staff/v1/news', { title: 'Maintenance tonight', body: 'Back by 02:00 UTC.' });
    expect(posted.statusCode).toBe(201);
    const item = posted.json() as { id: number; title: string };
    expect(item).toMatchObject({ title: 'Maintenance tonight', body: 'Back by 02:00 UTC.', editedAt: null });
    // Read on the trader API by a signed-in trader (GET /v1/news is behind the front door, owner 8 Nov 2026).
    const reader = await seedAccount(deps, { loginName: uniqueName('newsreader') });
    const { token } = await insertSession(deps, reader, 'trader');
    const read = (await trader.inject({ method: 'GET', url: '/v1/news', cookies: { [SESSION_COOKIE]: token } })).json().items as { id: number; title: string }[];
    expect(read.map((n) => n.id)).toContain(item.id);
    // The owner's NewsEditor reads the same list on the staff origin (Task 16).
    const listed = await owner.send('GET', '/staff/v1/news');
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: { id: number }[] }).items.map((n) => n.id)).toEqual(read.map((n) => n.id));

    const edited = await owner.send('PUT', `/staff/v1/news/${item.id}`, { title: 'Maintenance tonight', body: 'Back by 03:00 UTC.' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ id: item.id, body: 'Back by 03:00 UTC.' });
    expect((await owner.send('DELETE', `/staff/v1/news/${item.id}`)).statusCode).toBe(204);
    expect((await owner.send('DELETE', `/staff/v1/news/${item.id}`)).statusCode).toBe(404);

    const after = await Promise.all(['news.published', 'news.edited', 'news.deleted'].map((a) => logEntries(deps, a)));
    const added = after.map((rows, i) => rows.slice(before[i]!.length));
    const entry = (detail: string) => [{ actor_kind: 'staff', detail }];
    expect(added).toEqual([entry(`{"newsId":"${item.id}"}`), entry(`{"newsId":"${item.id}"}`), entry(`{"newsId":"${item.id}"}`)]);
    // Never the text.
    expect(JSON.stringify(after)).not.toContain('Maintenance');
  });

  it('refuses a bad draft or id and changes nothing', async () => {
    const count = async () => (await deps.db.query<{ n: number }>('select count(*)::int as n from news')).rows[0]!.n;
    const n = await count();
    for (const body of [{ title: '', body: 'x' }, { title: 'x', body: '' }, { title: 'x' }, { title: 'x', body: 'y', extra: 1 }, { title: 'a\u0007', body: 'y' }]) {
      const res = await owner.post('/staff/v1/news', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res)).toBe('bad-request');
    }
    expect((await owner.send('PUT', '/staff/v1/news/abc', { title: 'x', body: 'y' })).statusCode).toBe(404);
    expect((await owner.send('PUT', '/staff/v1/news/999999', { title: 'x', body: 'y' })).statusCode).toBe(404);
    expect(await count()).toBe(n);
  });
});

describe('feedback on the staff API (feedback.read)', () => {
  it('lists platform feedback with the 30-day counts, and the feedback form rows, newest first with a cursor', async () => {
    const loginName = uniqueName('trader');
    const traderId = await seedAccount(deps, { loginName, displayName: uniqueName('Shown'), kind: 'trader' });
    await deps.db.query(
      `insert into platform_feedback (mood, note, created_on) values ('great', 'Smooth', '2026-11-02'), ('needs-work', null, '2026-11-01'), ('ok', null, '2026-09-01')`,
    );
    await deps.db.query(
      `insert into feedback_form (kind, body, account_id, from_code, created_on) values ('complaint', 'Too slow', $1, 'take-offer', '2026-11-02'), ('feedback', 'Nice', null, null, '2026-10-30')`,
      [traderId],
    );
    const moods = await owner.get('/staff/v1/feedback');
    expect(moods.statusCode).toBe(200);
    const m = moods.json();
    expect(m.items.map((i: { mood: string; note: string | null; createdOn: string }) => [i.mood, i.note, i.createdOn])).toEqual([
      ['great', 'Smooth', '2026-11-02'], ['needs-work', null, '2026-11-01'], ['ok', null, '2026-09-01'],
    ]);
    expect(m.counts).toEqual({ great: 1, ok: 0, needsWork: 1 });
    expect(m.next).toBeNull();
    const first = m.items[0] as { id: string; createdOn: string };
    const page2 = (await owner.get(`/staff/v1/feedback?before=${first.createdOn}_${first.id}`)).json();
    expect(page2.items).toHaveLength(2);

    const opened = (await logEntries(deps, 'feedback.form-opened')).length;
    const form = (await owner.get('/staff/v1/feedback/form')).json();
    expect(form.items.map((i: { kind: string; text: string; from: string | null }) => [i.kind, i.text, i.from])).toEqual([
      ['complaint', 'Too slow', 'take-offer'], ['feedback', 'Nice', null],
    ]);
    // S-026/D-058 review m1 (lead 12 Nov): the list never carries the raw account id, named or not.
    for (const i of form.items as object[]) expect(Object.keys(i).sort()).toEqual(['accountName', 'createdOn', 'from', 'id', 'kind', 'text']);
    expect(JSON.stringify(form)).not.toContain(traderId);
    // D-058 (owner G20): a named row shows the sender's account (its public display name, never the
    // login name), so staff can follow up; an anonymous row shows nothing.
    const shown = (await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [traderId])).rows[0]!.display_name;
    expect(form.items.map((i: { accountName: string | null }) => i.accountName)).toEqual([shown, null]);
    expect(shown).not.toBe(loginName);
    expect(JSON.stringify(form)).not.toContain(loginName);
    expect(form.next).toBeNull();
    // D-058 (lead 12 Nov): each opening of the list is logged, with how many named rows it showed.
    const log = await logEntries(deps, 'feedback.form-opened');
    expect(log).toHaveLength(opened + 1);
    expect(log.at(-1)).toEqual({ actor_kind: 'staff', detail: JSON.stringify({ namedRows: 1 }) });
  });

  it('review m2: the list opening is logged at most once per staff session per 5 minutes (the first read of the window)', async () => {
    const t0 = new Date('2026-11-02T12:00:00Z');
    setNow(t0);
    const named = await seedAccount(deps, { loginName: uniqueName('m2trader'), displayName: uniqueName('M2Shown'), kind: 'trader' });
    await deps.db.query("insert into feedback_form (kind, body, account_id, from_code, created_on) values ('feedback', 'm2 named', $1, null, '2026-11-02')", [named]);
    const a = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
    const b = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
    const count = async () => (await logEntries(deps, 'feedback.form-opened')).length;
    const n0 = await count();
    // The first read of a session logs; reads again (any page, at once or in parallel) in the window do not.
    const first = await a.get('/staff/v1/feedback/form');
    expect(first.statusCode).toBe(200);
    expect(await count()).toBe(n0 + 1);
    const items = first.json().items as Array<{ id: string; createdOn: string; accountName: string | null }>;
    expect((await logEntries(deps, 'feedback.form-opened')).at(-1)).toEqual({ actor_kind: 'staff', detail: JSON.stringify({ namedRows: items.filter((i) => i.accountName !== null).length }) });
    const last = items.at(-1)!;
    const again = await Promise.all([a.get('/staff/v1/feedback/form'), a.get('/staff/v1/feedback/form'), a.get(`/staff/v1/feedback/form?before=${last.createdOn}_${last.id}`)]);
    for (const r of again) expect(r.statusCode).toBe(200);
    expect(await count()).toBe(n0 + 1);
    // Another session of the same person is its own window.
    expect((await b.get('/staff/v1/feedback/form')).statusCode).toBe(200);
    expect(await count()).toBe(n0 + 2);
    // Just under 5 minutes later: still the same window; at 5 minutes: logged again.
    setNow(new Date(t0.getTime() + 5 * 60_000 - 1));
    expect((await a.get('/staff/v1/feedback/form')).statusCode).toBe(200);
    expect(await count()).toBe(n0 + 2);
    setNow(new Date(t0.getTime() + 5 * 60_000));
    expect((await a.get('/staff/v1/feedback/form')).statusCode).toBe(200);
    expect(await count()).toBe(n0 + 3);
    setNow(t0);
  });

  it('refuses a malformed cursor', async () => {
    for (const q of ['before=yesterday', 'before=2026-11-02_nope', 'before=2026-13-45_00000000-0000-4000-8000-000000000000']) {
      const res = await owner.get(`/staff/v1/feedback?${q}`);
      expect(res.statusCode, q).toBe(400);
      expect((await owner.get(`/staff/v1/feedback/form?${q}`)).statusCode, q).toBe(400);
    }
  });
});
