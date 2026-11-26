import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { csvField, filterOf } from '../src/routes/teamAudit.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { TEAM_LOG_EXPORT_BUCKET, TEAM_LOG_INTEGRITY_BUCKET } from '../src/limits.js';
import { REFUSALS_PER_HOUR } from '../src/team/audit.js';
import { applyMemberRemoval, closeExpiredInvites, purgeTeamLeftovers } from '../src/team/members.js';
import { rolesToAbilities, ROLE_ABILITIES } from '../src/team/abilities.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { flexBody } from './helpers/offers.js';
import { Browser, ORIGIN } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';

const DAY = 86_400_000;

// Team audit v2 (migration 855; owner 26 Nov 2026): the team log is hash-chained per account,
// records the team's own changes, member logins and refused attempts, and is read through
// /v1/team/log with filters, paging, an integrity check, a summary and an export.

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let setNow: (d: Date) => void;
let n = 0;

function quote(currency: string): MarketQuote | null {
  if (currency !== 'USD') return null;
  return { price: { currency, centsPerXmr: 33_000n }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: 33_000n, fx: null };
}
const prices: MarketPrices = {
  current: (c) => quote(c)?.price ?? null,
  quote,
  health: () => ({}) as unknown as ReturnType<MarketPrices['health']>,
  poll: async () => {},
  start: () => {},
  stop: async () => {},
};

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices, db: await testDb({ max: 8 }) }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

const OFFER = flexBody({
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  amountUnit: 'fiat', minFiatCents: '1000', maxFiatCents: '500000', minTrades: null, terms: 'Zelle only.',
});

type Who = Awaited<ReturnType<typeof trader>>;

async function team(): Promise<Who> {
  const t = await trader();
  await makeVendor(deps, t.id);
  const now = deps.clock();
  await deps.db.query(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4)`,
    [t.id, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return t;
}

async function member(teamId: string, abilities: string[]): Promise<{ id: string; loginId: string; name: string; browser: Browser }> {
  const name = `Logger${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `lglogin${n}x`, displayName: `lg-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const browser = new Browser(app);
  const res = await browser.post('/t/login', { accountId: loginId });
  expect(res.statusCode, res.body).toBe(200);
  return { id: rows[0]!.id, loginId, name, browser };
}

interface Entry { id: string; action: string; category: string; actorKind: string; memberId: string | null; subjectId: string | null; subjectName: string | null; tradeCode: string | null; detail: Record<string, unknown>; hash: string; prevHash: string | null }

async function sessionId(b: Browser): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>("select id from sessions where token_hash = sha256(convert_to($1, 'utf8'))", [b.cookies['__Host-x2f_session']]);
  return rows[0]!.id;
}

async function log(b: Browser, qs = ''): Promise<{ entries: Entry[]; next: string | null }> {
  const res = await b.get(`/v1/team/log${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { entries: Entry[]; next: string | null };
}

/** The refused-attempt row is written after the answer: wait for it. */
async function until<T>(f: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await f();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return f();
}

describe('the chain', () => {
  it('links every row of an account to the one before; the check passes and a kept fingerprint matches', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers']));
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    const { entries } = await log(owner.browser);
    const asc = [...entries].reverse();
    expect(asc[0]!.prevHash).toBeNull();
    for (let i = 1; i < asc.length; i++) expect(asc[i]!.prevHash).toBe(asc[i - 1]!.hash);
    const check = (await owner.browser.get('/v1/team/log/integrity')).json() as { ok: boolean; entries: number; head: { id: string; hash: string } };
    expect(check).toMatchObject({ ok: true, entries: asc.length, brokenAt: null });
    expect(check.head).toEqual({ id: asc.at(-1)!.id, hash: asc.at(-1)!.hash });
    const kept = (await owner.browser.get(`/v1/team/log/integrity?id=${asc[0]!.id}&hash=${asc[0]!.hash}`)).json() as { fingerprint: unknown };
    expect(kept.fingerprint).toEqual({ id: asc[0]!.id, matches: true });
    const wrong = (await owner.browser.get(`/v1/team/log/integrity?id=${asc[0]!.id}&hash=${'0'.repeat(64)}`)).json() as { fingerprint: unknown };
    expect(wrong.fingerprint).toEqual({ id: asc[0]!.id, matches: false });
  });

  it('a row changed behind the triggers breaks the chain from that row, and fingerprints after it no longer vouch', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers']));
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    const asc = [...(await log(owner.browser)).entries].reverse();
    const target = asc.find((e) => e.action === 'offer-posted')!;
    const head = asc.at(-1)!;
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('alter table team_audit disable trigger team_audit_append_only');
      await c.query(`update team_audit set detail = detail || '{"side":"buy"}' where id = $1`, [target.id]);
      await c.query('alter table team_audit enable trigger team_audit_append_only');
      await c.query('commit');
    } finally {
      c.release();
    }
    const check = (await owner.browser.get(`/v1/team/log/integrity?id=${head.id}&hash=${head.hash}`)).json() as Record<string, unknown>;
    expect(check).toMatchObject({ ok: false, brokenAt: target.id, fingerprint: { id: head.id, matches: false } });
  });

  it('clearing a deleted trade\'s code keeps the chain whole, and the code still finds its rows', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    const t = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, t.trade, 'secured');
    expect((await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() })).statusCode).toBe(200);
    await deps.db.query('update team_audit set trade_code = null where account_id = $1 and trade_code is not null', [owner.id]);
    expect(((await owner.browser.get('/v1/team/log/integrity')).json() as { ok: boolean }).ok).toBe(true);
    const found = await log(owner.browser, `?trade=${t.code}`);
    expect(found.entries.map((e) => [e.action, e.tradeCode])).toEqual([['mark-paid', null]]);
  });

  it("an insert's id is drawn under the account's lock, so a waiting insert never links behind a later id (review 26 Nov, finding 1)", async () => {
    const a = await team();
    const b = await team();
    const m = await member(a.id, ['offers-see']);
    const holder = await deps.db.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(7240002, hashtext($1::text))', [a.id]);
      const waiting = deps.db.query<{ id: string }>(
        `insert into team_audit (account_id, member_id, at, action) values ($1, $2, now(), 'mark-paid') returning id::text as id`,
        [a.id, m.id],
      );
      await new Promise((r) => setTimeout(r, 100));
      // Another account's insert meanwhile draws the next id.
      await member(b.id, ['offers-see']);
      const { rows: other } = await deps.db.query<{ id: string }>('select max(id)::text as id from team_audit where account_id = $1', [b.id]);
      await holder.query('commit');
      const late = (await waiting).rows[0]!.id;
      expect(BigInt(late)).toBeGreaterThan(BigInt(other[0]!.id));
    } finally {
      holder.release();
    }
    expect(((await a.browser.get('/v1/team/log/integrity')).json() as { ok: boolean }).ok).toBe(true);
  });

  it('two accounts have separate chains; each starts from nothing', async () => {
    const a = await team();
    const b = await team();
    await member(a.id, ['offers-see']);
    await member(b.id, ['offers-see']);
    for (const o of [a, b]) {
      const asc = [...(await log(o.browser)).entries].reverse();
      expect(asc[0]!.prevHash).toBeNull();
    }
  });
});

describe('what the log records', () => {
  it("the team's own changes: invite, boxes added and removed, limits, removal, and the member's login and session end", async () => {
    const owner = await team();
    const m = await member(owner.id, ROLE_ABILITIES.offers.slice());
    await deps.db.query(`update team_members set abilities = $2 where id = $1`, [m.id, [...ROLE_ABILITIES.offers.filter((a) => a !== 'offers-delete'), 'notes-view']]);
    await deps.db.query(`update team_members set band_min_atomic = 1, band_max_atomic = 1000 where id = $1`, [m.id]);
    await deps.db.query(`update team_members set removed_at = now() where id = $1`, [m.id]);
    await deps.db.query(`update sessions set revoked_at = now() where member_id = $1 and revoked_at is null`, [m.id]);
    const asc = [...(await log(owner.browser)).entries].reverse();
    expect(asc.map((e) => [e.category, e.action, e.actorKind])).toEqual([
      ['team', 'member-invited', 'lead'],
      ['access', 'member-login', 'member'],
      ['team', 'abilities-changed', 'lead'],
      ['team', 'limits-changed', 'lead'],
      ['team', 'member-removed', 'lead'],
      ['access', 'session-ended', 'system'],
    ]);
    expect(asc.every((e) => e.subjectId === m.id && e.subjectName === m.name)).toBe(true);
    expect(asc[2]!.detail).toMatchObject({ added: ['notes-view'], removed: ['offers-delete'] });
    expect(asc[3]!.detail).toMatchObject({ before: { bandMinAtomic: null }, after: { bandMinAtomic: '1', bandMaxAtomic: '1000' } });
  });

  it('a refused member request is logged with the route pattern and reason, never the URL; a flood is capped', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers-see']);
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(403);
    expect((await m.browser.post('/v1/wallets', { app: 'cake', label: 'x', address: fakeAddress() })).statusCode).toBe(403);
    // A refused read is not logged (review 26 Nov, finding 2: the member's screens read owner-only data in passing).
    expect((await m.browser.get('/v1/team')).statusCode).toBe(403);
    const refused = await until(
      async () => (await log(owner.browser, '?action=attempt-refused')).entries,
      (e) => e.length === 2,
    );
    expect(refused.map((e) => e.detail).reverse()).toEqual([
      { method: 'POST', route: '/v1/offers', reason: 'forbidden' },
      { method: 'POST', route: '/v1/wallets', reason: 'owner-only' },
    ]);
    expect(refused.every((e) => e.memberId === m.id && e.category === 'access')).toBe(true);
    for (let i = 0; i < REFUSALS_PER_HOUR + 5; i++) {
      expect((await m.browser.post('/v1/wallets', { app: 'cake', label: 'x', address: fakeAddress() })).statusCode).toBe(403);
    }
    const all = await until(
      async () => (await log(owner.browser, '?action=attempt-refused,attempts-throttled')).entries,
      (e) => e.some((x) => x.action === 'attempts-throttled'),
    );
    expect(all.filter((e) => e.action === 'attempt-refused')).toHaveLength(REFUSALS_PER_HOUR);
    expect(all.filter((e) => e.action === 'attempts-throttled')).toHaveLength(1);
  });
});

describe('reading the log', () => {
  it('filters by member, category, action and dates, and pages with next', async () => {
    const owner = await team();
    const a = await member(owner.id, rolesToAbilities(['offers']));
    const b = await member(owner.id, rolesToAbilities(['offers']));
    expect((await a.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    expect((await b.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    const onlyA = await log(owner.browser, `?member=${a.id}&category=work`);
    expect(onlyA.entries.map((e) => [e.action, e.memberId])).toEqual([['offer-posted', a.id]]);
    const logins = await log(owner.browser, '?action=member-login');
    expect(logins.entries.map((e) => e.subjectId).sort()).toEqual([a.id, b.id].sort());
    const future = await log(owner.browser, `?from=${new Date(Date.now() + 86_400_000).toISOString()}`);
    expect(future.entries).toEqual([]);
    const all = (await log(owner.browser)).entries;
    const p1 = await log(owner.browser, '?limit=2');
    expect(p1.entries.map((e) => e.id)).toEqual(all.slice(0, 2).map((e) => e.id));
    const p2 = await log(owner.browser, `?limit=2&before=${p1.next}`);
    expect(p2.entries.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
    let cursor: string | null = p1.next;
    let seen = 2;
    while (cursor !== null) {
      const p = await log(owner.browser, `?limit=2&before=${cursor}`);
      seen += p.entries.length;
      cursor = p.next;
    }
    expect(seen).toBe(all.length);
  });

  it('a member with "See the team log" sees only their own rows; without it, 403; the rest stays owner-only', async () => {
    const owner = await team();
    const reader = await member(owner.id, [...rolesToAbilities(['offers']), 'team-see-log']);
    const other = await member(owner.id, rolesToAbilities(['offers']));
    expect((await other.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    expect((await reader.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    const mine = await log(reader.browser);
    expect(mine.entries.length).toBeGreaterThan(0);
    expect(mine.entries.every((e) => e.memberId === reader.id || e.subjectId === reader.id)).toBe(true);
    // Asking for the other member cannot widen it.
    expect((await log(reader.browser, `?member=${other.id}`)).entries.every((e) => e.subjectId === reader.id || e.memberId === reader.id)).toBe(true);
    expect((await other.browser.get('/v1/team/log')).statusCode).toBe(403);
    for (const path of ['/v1/team/log/integrity', '/v1/team/log/summary', '/v1/team/log/export']) {
      expect((await reader.browser.get(path)).statusCode).toBe(403);
    }
  });

  it('refuses malformed filters', async () => {
    expect(() => filterOf({ member: 'nope' })).toThrow();
    expect(() => filterOf({ category: 'secrets' })).toThrow();
    expect(() => filterOf({ action: 'drop-table' })).toThrow();
    expect(() => filterOf({ trade: 'ABCD' })).toThrow();
    expect(() => filterOf({ before: '-1' })).toThrow();
    expect(() => filterOf({ limit: '201' })).toThrow();
    expect(() => filterOf({ from: 'yesterday' })).toThrow();
    expect(filterOf({ category: 'work,team', trade: 'abcd-efgh-jkmn-pqrs' })).toEqual({ categories: ['work', 'team'], tradeCode: 'ABCD-EFGH-JKMN-PQRS' });
  });

  it('the summary counts each member\'s work, logins, refusals and changes', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers']));
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    await m.browser.post('/v1/wallets', { app: 'cake', label: 'x', address: fakeAddress() });
    await deps.db.query(`update team_members set abilities = $2 where id = $1`, [m.id, ['offers-see']]);
    const s = await until(
      async () => ((await owner.browser.get('/v1/team/log/summary?days=7')).json() as { members: Record<string, unknown>[] }).members,
      (x) => x[0]?.refused === 1,
    );
    expect(s).toEqual([expect.objectContaining({ memberId: m.id, name: m.name, status: 'active', work: 1, logins: 1, refused: 1, changes: 2 })]);
  });
});

describe('the export', () => {
  it('JSON: every row with the exact line its hash covers; the chain re-checks without X2F', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers']));
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    const res = await owner.browser.get('/v1/team/log/export?format=json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="x2f-team-log-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = res.json() as { integrity: { ok: boolean }; truncated: boolean; rows: (Entry & { line: string })[] };
    expect(body.integrity.ok).toBe(true);
    expect(body.truncated).toBe(false);
    let prev: Buffer | null = null;
    for (const r of body.rows) {
      expect(r.prevHash).toBe(prev?.toString('hex') ?? null);
      const h: Buffer = createHash('sha256').update(prev ?? Buffer.alloc(0)).update(r.line, 'utf8').digest();
      expect(h.toString('hex')).toBe(r.hash);
      expect(r.line.startsWith(`${r.id}|`)).toBe(true);
      prev = h;
    }
  });

  it('CSV: a header, one line per row, and no cell a spreadsheet would run as a formula', async () => {
    const owner = await team();
    await member(owner.id, ['offers-see']);
    const res = await owner.browser.get('/v1/team/log/export?format=csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toBe('id,at,category,action,actorKind,memberName,subjectName,tradeCode,detail,prevHash,hash,line');
    expect(lines.length).toBeGreaterThan(1);
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-1')).toBe(`"'-1"`);
    expect(csvField(null)).toBe('""');
    expect((await owner.browser.get('/v1/team/log/export?format=xml')).statusCode).toBe(400);
  });
});

describe('who closed an unused invite (migration 857)', () => {
  async function expiredInvite(accountId: string, q: Pick<Deps['db'], 'query'> = deps.db): Promise<string> {
    const name = `Expired${String(++n).padStart(4, '0')}`;
    const past = new Date(deps.clock().getTime() - DAY);
    const { rows } = await q.query<{ id: string }>(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_hash, invite_expires_at, created_at)
       values ($1, $2, $3, '{offers-see}', $4, $5, $5) returning id`,
      [accountId, name, name.toLowerCase(), createHash('sha256').update(name).digest(), past],
    );
    return rows[0]!.id;
  }
  const closedBy = async (subjectId: string) =>
    (await deps.db.query<{ actor_kind: string }>(`select actor_kind from team_audit where subject_id = $1 and action = 'invite-closed'`, [subjectId])).rows.map((r) => r.actor_kind);

  it('the owner cancelling an invite that already ran out is the owner (lead), not X2F', async () => {
    const owner = await team();
    const id = await expiredInvite(owner.id);
    const action = { kind: 'team-remove' as const, memberId: id };
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const del = await app.inject({
      method: 'DELETE', url: `/v1/team/members/${id}`, headers: { origin: ORIGIN }, cookies: owner.browser.cookies, payload: { confirmToken },
    });
    expect(del.statusCode, del.body).toBe(204);
    expect(await closedBy(id)).toEqual(['lead']);
    const row = (await log(owner.browser, '?action=invite-closed')).entries.find((e) => e.subjectId === id);
    expect(row).toMatchObject({ actorKind: 'lead', memberId: null });
  });

  it("X2F's own sweeps are X2F (system): the leftovers job, and the sweep before a new invite", async () => {
    const owner = await team();
    const swept = await expiredInvite(owner.id);
    await purgeTeamLeftovers.run(deps.db, deps.clock());
    expect(await closedBy(swept)).toEqual(['system']);
    // In one transaction: the sweep's mark is cleared at once, so the owner's removal after it is still the owner's.
    const second = await expiredInvite(owner.id);
    const c = await deps.db.connect();
    let cancelled = '';
    try {
      await c.query('begin');
      expect(await closeExpiredInvites(c, deps.clock(), owner.id)).toBe(1);
      // Written on the same connection: the sweep holds the account's log lock until commit.
      cancelled = await expiredInvite(owner.id, c);
      await applyMemberRemoval(c, owner.id, cancelled, deps.clock());
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await closedBy(second)).toEqual(['system']);
    expect(await closedBy(cancelled)).toEqual(['lead']);
    expect(((await owner.browser.get('/v1/team/log/integrity')).json() as { ok: boolean }).ok).toBe(true);
  });
});

describe('per-account budgets on the chain walks', () => {
  it(`integrity: ${TEAM_LOG_INTEGRITY_BUCKET.capacity} an hour, then 429 slow-down with retryAfterSeconds; other accounts are unaffected`, async () => {
    const owner = await team();
    const other = await team();
    for (let i = 0; i < TEAM_LOG_INTEGRITY_BUCKET.capacity; i++) expect((await owner.browser.get('/v1/team/log/integrity')).statusCode, `try ${i}`).toBe(200);
    const refused = await owner.browser.get('/v1/team/log/integrity');
    expect(refused.statusCode).toBe(429);
    const body = refused.json() as { error: string; retryAfterSeconds: number };
    expect(body).toEqual({ error: 'slow-down', retryAfterSeconds: Math.ceil(60 / TEAM_LOG_INTEGRITY_BUCKET.perMinute) });
    expect((await other.browser.get('/v1/team/log/integrity')).statusCode).toBe(200);
    // The summary and the list are not budgeted.
    expect((await owner.browser.get('/v1/team/log/summary')).statusCode).toBe(200);
    expect((await owner.browser.get('/v1/team/log')).statusCode).toBe(200);
    setNow(new Date(deps.clock().getTime() + body.retryAfterSeconds * 1000));
    expect((await owner.browser.get('/v1/team/log/integrity')).statusCode).toBe(200);
    expect((await owner.browser.get('/v1/team/log/integrity')).statusCode).toBe(429);
  });

  it(`export: ${TEAM_LOG_EXPORT_BUCKET.capacity} an hour across both formats, then 429 slow-down`, async () => {
    const owner = await team();
    for (let i = 0; i < TEAM_LOG_EXPORT_BUCKET.capacity; i++) {
      expect((await owner.browser.get(`/v1/team/log/export?format=${i % 2 === 0 ? 'json' : 'csv'}`)).statusCode, `try ${i}`).toBe(200);
    }
    const refused = await owner.browser.get('/v1/team/log/export?format=csv');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: 'slow-down', retryAfterSeconds: Math.ceil(60 / TEAM_LOG_EXPORT_BUCKET.perMinute) });
    // The export's budget is its own: the integrity check still answers, and another account still downloads.
    expect((await owner.browser.get('/v1/team/log/integrity')).statusCode).toBe(200);
    expect((await (await team()).browser.get('/v1/team/log/export')).statusCode).toBe(200);
  });

  it('a member is refused (403) before the budget is touched', async () => {
    const owner = await team();
    const reader = await member(owner.id, ['team-see-log']);
    for (let i = 0; i <= TEAM_LOG_EXPORT_BUCKET.capacity; i++) expect((await reader.browser.get('/v1/team/log/export')).statusCode).toBe(403);
    expect((await owner.browser.get('/v1/team/log/export')).statusCode).toBe(200);
  });
});
