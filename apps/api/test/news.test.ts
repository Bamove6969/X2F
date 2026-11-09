// Plan 4 Task 28: the News inbox (owner, 2026-10-29; spec 6.6). Reading needs a signed-in, set-up
// trader (the front door, owner 8 Nov 2026; it needed no session before); writing is
// the operator's CLI until Plan 4's staff screen lands (news-tripwire.test.ts).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { runNewsCommand, type NewsCliDeps } from '../src/news/cli.js';
import {
  NEWS_BODY_MAX,
  NEWS_LIST_LIMIT,
  NEWS_TITLE_MAX,
  NewsInputError,
  addNews,
  cleanDraft,
  deleteNews,
  editNews,
  listNews,
} from '../src/news/store.js';
import type { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { spySql } from './helpers/sqlSpy.js';
import { MAINTENANCE_GATE_SQL } from '../src/site/routes.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-29T09:00:00Z');
const DAY = 86_400_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let reader: Browser;

beforeAll(async () => {
  let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
  ({ app, deps, setNow, logs, trader } = await tradeApp());
  setNow(T0);
  reader = (await trader()).browser;
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await deps.db.query('truncate news restart identity');
  setNow(T0);
});

const at = (d: number) => () => new Date(T0.getTime() + d * DAY);

describe('GET /v1/news', () => {
  it('is 401 with no data without a session (the front door, owner 8 Nov 2026)', async () => {
    await addNews(deps.db, at(0), { title: 'Welcome', body: 'Hello from X2F.' });
    const res = await app.inject({ method: 'GET', url: '/v1/news' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-authenticated' });
  });

  it('newest first, each with its posted date, and the server time', async () => {
    await addNews(deps.db, at(0), { title: 'Welcome', body: 'Hello from X2F.' });
    await addNews(deps.db, at(2), { title: 'Upgrade done', body: 'All systems are back.' });
    await addNews(deps.db, at(1), { title: 'Planned upgrade', body: 'Tomorrow at 10:00 UTC.\nTrades in escrow are safe.' });

    const res = await reader.get('/v1/news');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as { items: { id: number; title: string; body: string; publishedAt: string; editedAt: string | null }[]; serverNow: string };
    expect(body.serverNow).toBe(T0.toISOString());
    expect(body.items.map((i) => [i.title, i.publishedAt])).toEqual([
      ['Upgrade done', at(2)().toISOString()],
      ['Planned upgrade', at(1)().toISOString()],
      ['Welcome', at(0)().toISOString()],
    ]);
    expect(body.items[1]).toEqual({
      id: 3,
      title: 'Planned upgrade',
      body: 'Tomorrow at 10:00 UTC.\nTrades in escrow are safe.',
      publishedAt: at(1)().toISOString(),
      editedAt: null,
    });
  });

  it('an empty inbox is an empty list', async () => {
    const res = await reader.get('/v1/news');
    expect(res.json()).toEqual({ items: [], serverNow: T0.toISOString() });
  });

  it(`lists at most the newest ${NEWS_LIST_LIMIT}`, async () => {
    for (let i = 0; i < NEWS_LIST_LIMIT + 3; i++) await addNews(deps.db, at(i / 100), { title: `N${i}`, body: 'b' });
    const items = (await reader.get('/v1/news')).json().items as { title: string }[];
    expect(items).toHaveLength(NEWS_LIST_LIMIT);
    expect(items[0]!.title).toBe(`N${NEWS_LIST_LIMIT + 2}`);
    expect(items.at(-1)!.title).toBe('N3');
  });

  it('a read writes nothing: seen state stays on the device, so the server stores nothing per reader', async () => {
    await addNews(deps.db, at(0), { title: 'Welcome', body: 'Hello.' });
    const spy = spySql(deps.db);
    try {
      await reader.get('/v1/news');
      // Plan 4 Task 8's maintenance gate reads site_flags first (a read, on every /v1 route), and
      // the front door's session check reads the session (and never touches it: no write).
      const reads = spy.sql().filter((q) => q !== MAINTENANCE_GATE_SQL);
      expect(reads.filter((q) => !/^\s*select/i.test(q))).toEqual([]);
      expect(reads.filter((q) => !/from sessions s join accounts a/.test(q))).toEqual(['select id, title, body, published_at, edited_at from news order by published_at desc, id desc limit $1']);
    } finally {
      spy.restore();
    }
    const tables = await deps.db.query(`select table_name from information_schema.tables where table_name like 'news%' order by 1`);
    expect(tables.rows).toEqual([{ table_name: 'news' }]);
    expect((await app.inject({ method: 'POST', url: '/v1/news/seen', headers: { origin: ORIGIN }, payload: {} })).statusCode).toBe(404);
  });

  it('there is no web write route yet: nobody, a moderator included, can post, edit or delete over HTTP', async () => {
    await addNews(deps.db, at(0), { title: 'Welcome', body: 'Hello.' });
    for (const [method, url] of [
      ['POST', '/v1/news'],
      ['PUT', '/v1/news/1'],
      ['PATCH', '/v1/news/1'],
      ['DELETE', '/v1/news/1'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { origin: ORIGIN }, payload: { title: 'x', body: 'y' } });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(await listNews(deps.db)).toHaveLength(1);
  });

  it('logs no message text', async () => {
    await addNews(deps.db, at(0), { title: 'Secret-ish title', body: 'Body text 7781' });
    logs.length = 0;
    await reader.get('/v1/news');
    expect(logs.filter((l) => l.includes('7781') || l.includes('Secret-ish'))).toEqual([]);
  });
});

describe('the store', () => {
  it('cleanDraft trims, normalises line endings and refuses empty, long or control-character input', () => {
    expect(cleanDraft({ title: '  Hi  ', body: '\r\nLine 1\r\nLine 2\r ' })).toEqual({ title: 'Hi', body: 'Line 1\nLine 2' });
    const bad = (title: unknown, body: unknown) => {
      try {
        cleanDraft({ title, body });
        return null;
      } catch (e) {
        return e instanceof NewsInputError ? e.field : 'other';
      }
    };
    expect(bad('', 'b')).toBe('title');
    expect(bad('   ', 'b')).toBe('title');
    expect(bad('x'.repeat(NEWS_TITLE_MAX + 1), 'b')).toBe('title');
    expect(bad('x'.repeat(NEWS_TITLE_MAX), 'b')).toBeNull();
    expect(bad('a\nb', 'b')).toBe('title');
    expect(bad('a‮b', 'b')).toBeNull();
    expect(bad(7, 'b')).toBe('title');
    expect(bad('t', '')).toBe('body');
    expect(bad('t', 'x'.repeat(NEWS_BODY_MAX + 1))).toBe('body');
    expect(bad('t', 'x'.repeat(NEWS_BODY_MAX))).toBeNull();
    expect(bad('t', 'a\u0000b')).toBe('body');
    expect(bad('t', 'tab\there')).toBe('body');
    expect(bad('t', null)).toBe('body');
  });

  it('the table refuses what cleanDraft would (a write that skips it)', async () => {
    await expect(deps.db.query(`insert into news (title, body, published_at) values ('', 'b', now())`)).rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query(`insert into news (title, body, published_at) values ($1, 'b', now())`, ['x'.repeat(121)])).rejects.toMatchObject({ code: '23514' });
  });

  it('an edit keeps the posted date and the place in the list; a delete removes it', async () => {
    const a = await addNews(deps.db, at(0), { title: 'A', body: 'a' });
    const b = await addNews(deps.db, at(1), { title: 'B', body: 'b' });
    const edited = await editNews(deps.db, at(5), a.id, { title: 'A2', body: 'a2' });
    expect(edited).toEqual({ id: a.id, title: 'A2', body: 'a2', publishedAt: a.publishedAt, editedAt: at(5)().toISOString() });
    expect((await listNews(deps.db)).map((i) => i.title)).toEqual(['B', 'A2']);
    expect(await editNews(deps.db, at(5), 999, { title: 'x', body: 'y' })).toBeNull();
    expect(await deleteNews(deps.db, b.id)).toBe(true);
    expect(await deleteNews(deps.db, b.id)).toBe(false);
    expect((await listNews(deps.db)).map((i) => i.title)).toEqual(['A2']);
  });

  it('ids only count up, so a higher id is always a newer message (what the device compares)', async () => {
    const a = await addNews(deps.db, at(0), { title: 'A', body: 'a' });
    await deleteNews(deps.db, a.id);
    const b = await addNews(deps.db, at(1), { title: 'B', body: 'b' });
    expect(b.id).toBeGreaterThan(a.id);
  });
});

describe('the operator CLI (until the staff screen lands)', () => {
  const cli = (files: Record<string, string> = {}): NewsCliDeps => ({
    db: deps.db,
    clock: () => T0,
    readFile: async (p) => {
      const f = files[p];
      if (f === undefined) throw new Error('no such file');
      return f;
    },
  });

  it('add, list, edit and delete', async () => {
    const added = await runNewsCommand(['add', '--title', 'Planned upgrade', '--body-file', 'msg.txt'], cli({ 'msg.txt': 'Line 1\nLine 2\n' }));
    expect(added.code).toBe(0);
    expect(JSON.parse(added.out)).toEqual({ added: { id: 1, title: 'Planned upgrade', body: 'Line 1\nLine 2', publishedAt: T0.toISOString(), editedAt: null } });
    expect((await runNewsCommand(['add', '--title', 'Second', '--body', 'Two'], cli())).code).toBe(0);
    expect(JSON.parse((await runNewsCommand(['list'], cli())).out).items.map((i: { title: string }) => i.title)).toEqual(['Second', 'Planned upgrade']);
    expect(JSON.parse((await runNewsCommand(['edit', '1', '--title', 'Upgrade', '--body', 'Moved'], cli())).out).edited.title).toBe('Upgrade');
    expect(JSON.parse((await runNewsCommand(['delete', '2'], cli())).out)).toEqual({ deleted: 2 });
    expect((await listNews(deps.db)).map((i) => i.title)).toEqual(['Upgrade']);
  });

  it('refuses bad input, unknown ids and bad usage with exit code 1', async () => {
    expect(await runNewsCommand(['add', '--title', '', '--body', 'b'], cli())).toEqual({ code: 1, out: JSON.stringify({ error: 'bad-input', field: 'title' }) });
    expect(await runNewsCommand(['delete', '9'], cli())).toEqual({ code: 1, out: JSON.stringify({ error: 'not-found' }) });
    expect(await runNewsCommand(['edit', '9', '--title', 't', '--body', 'b'], cli())).toEqual({ code: 1, out: JSON.stringify({ error: 'not-found' }) });
    for (const argv of [[], ['nope'], ['add', '--title', 't'], ['delete', '0'], ['delete', 'x'], ['edit', '1', '--body', 'b']]) {
      const r = await runNewsCommand(argv, cli());
      expect(r.code, argv.join(' ')).toBe(1);
      expect(JSON.parse(r.out).error).toBe('usage');
    }
    expect(await listNews(deps.db)).toEqual([]);
  });
});
