import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIENT_EVENTS, fiatCents } from '@x2f/trade';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { EventBus, type StreamSink } from '../src/events/bus.js';
import { tradeEventPublisher } from '../src/events/tradePublisher.js';
import { ACTION_ROLE, auditMember } from '../src/team/audit.js';
import { memberAccessOf } from '../src/auth/sessions.js';
import { purgeTeamLeftovers } from '../src/team/members.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { MAX_TEAM_MEMBERS, MEMBER_SIGNING_EVENTS, OWNER_DEVICE_ROUTES } from '../src/team/perms.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { openEvents, until, type SseStream } from './helpers/sse.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { Browser, ORIGIN } from './helpers/totp.js';
import { publishRuling } from './helpers/disputes.js';
import { driveTo, fakeAddress, markSellerNudged, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Plan 2 Task 18: team members (spec 6.7, R44). Real Postgres, one database for the file; each
// test makes its own team accounts.

// Every route the app registers, whatever the style (app.<verb>, app.route({...}), a plugin, a path
// in a variable), as Fastify's own onRoute hook sees it (review round 2, n4). Only recorded: the
// hook is added to each instance before any route.
const registered = vi.hoisted(() => [] as RouteOptions[]);
vi.mock('fastify', async (importOriginal) => {
  const m = await importOriginal<typeof import('fastify')>();
  const make = m.default as unknown as (...a: unknown[]) => FastifyInstance;
  const wrapped = Object.assign((...a: unknown[]) => {
    const app = make(...a);
    app.addHook('onRoute', (r) => {
      registered.push(r);
    });
    return app;
  }, m.default);
  return { ...m, default: wrapped, fastify: wrapped };
});

const DAY = 86_400_000;
const XMR = 1_000_000_000_000n;

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

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let setNow: (d: Date) => void;
let n = 0;
const streams: SseStream[] = [];
/** What X2F's node answers per refund tx (review round 2, n2); every other hash is unknown. */
const nodeCounts = new Map<string, number>();

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({ txConfirmations: async (h) => nodeCounts.get(h) ?? null }, { prices, db: await testDb({ max: 8 }) }));
  // GET /v1/events needs a real socket (review I1 and M2 tests).
  await app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  for (const st of streams) st.close();
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;
type Role = 'offers' | 'trades';

async function addWallet(accountId: string): Promise<string> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4) returning id`,
    [accountId, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return rows[0]!.id;
}

/** A team account (a trader with a usable wallet). */
async function team(): Promise<Who & { wallet: string }> {
  const t = await trader();
  return { ...t, wallet: await addWallet(t.id) };
}

/**
 * A joined member of `teamId` with `roles`, logged in (its login account is seeded directly; the
 * real sign-up is tested below).
 */
async function member(teamId: string, roles: Role[]): Promise<{ id: string; loginId: string; name: string; browser: Browser }> {
  const name = `Member${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `mlogin${n}x`, displayName: `m-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), roles, now, loginId],
  );
  const browser = new Browser(app);
  const res = await browser.post('/t/login', { accountId: loginId });
  expect(res.statusCode, res.body).toBe(200);
  return { id: rows[0]!.id, loginId, name, browser };
}

async function auditRows(teamId: string): Promise<{ action: string; member_id: string; trade_code: string | null }[]> {
  const { rows } = await deps.db.query<{ action: string; member_id: string; trade_code: string | null }>(
    'select action, member_id, trade_code from team_audit where account_id = $1 order by id',
    [teamId],
  );
  return rows;
}

async function sessionId(b: Browser): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>(
    'select id from sessions where token_hash = sha256(convert_to($1, \'utf8\'))',
    [b.cookies['__Host-x2f_session']],
  );
  return rows[0]!.id;
}

async function invite(owner: Who, displayName: string, roles: Role[]) {
  const action = { kind: 'team-invite' as const, name: displayName, roles: roles.join(',') };
  const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
  return owner.browser.post('/v1/team/invites', { displayName, roles, confirmToken });
}

const OFFER = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  minFiatCents: '1000', maxFiatCents: '1000000', minTrades: 0, terms: 'Zelle only.',
};

function takeBody(walletId: string, amountAtomic = XMR / 10n): Record<string, unknown> {
  return {
    amountAtomic: amountAtomic.toString(), walletId, centsPerXmr: '33000',
    fiatCents: fiatCents(amountAtomic, { currency: 'USD', centsPerXmr: 33_000n }).toString(),
  };
}

const err = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, error: (res.json() as { error?: string }).error });

describe('invites and the member limit', () => {
  it(`allows at most ${MAX_TEAM_MEMBERS} live members (open invites count); the next is too-many-members`, async () => {
    const owner = await team();
    for (let i = 0; i < MAX_TEAM_MEMBERS; i++) {
      const res = await invite(owner, `Helper${n}${i}x`, ['offers']);
      expect(res.statusCode, res.body).toBe(201);
      expect((res.json() as { invite: string }).invite).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    const fourth = await invite(owner, `Helper${n}9x`, ['trades']);
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json()).toEqual({ error: 'too-many-members', max: MAX_TEAM_MEMBERS });
    // Only the code's hash is stored.
    const { rows } = await deps.db.query<{ h: Buffer }>('select invite_hash as h from team_members where account_id = $1', [owner.id]);
    expect(rows.every((r) => r.h.length === 32)).toBe(true);
    const list = (await owner.browser.get('/v1/team')).json() as { members: { status: string }[]; max: number };
    expect(list.max).toBe(MAX_TEAM_MEMBERS);
    expect(list.members.map((m) => m.status)).toEqual(['invited', 'invited', 'invited']);
  });

  it('an invite needs confirm-it is-you bound to its roles', async () => {
    const owner = await team();
    const none = await owner.browser.post('/v1/team/invites', { displayName: `Plain${n}xx`, roles: ['offers'] });
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({ error: 'confirm-required', action: 'team-invite' });
    const action = { kind: 'team-invite' as const, name: `Plain${n}xy`, roles: 'offers' };
    const token = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const wrong = await owner.browser.post('/v1/team/invites', { displayName: `Plain${n}xy`, roles: ['offers', 'trades'], confirmToken: token });
    expect(err(wrong)).toEqual({ status: 403, error: 'confirm-invalid' });
    // Review M9(a): the token names the member too, so it cannot invite someone else with the same roles.
    const token2 = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const otherName = await owner.browser.post('/v1/team/invites', { displayName: `Mallory${n}x`, roles: ['offers'], confirmToken: token2 });
    expect(err(otherName)).toEqual({ status: 403, error: 'confirm-invalid' });
    const token3 = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    expect((await owner.browser.post('/v1/team/invites', { displayName: `Plain${n}xy`, roles: ['offers'], confirmToken: token3 })).statusCode).toBe(201);
  });
});

describe('the member sign-up (two factors, the staff rule)', () => {
  it('joins with a PGP key then a second PGP key, and the owner is told; the code is single-use', async () => {
    const owner = await team();
    const created = (await invite(owner, `Joiner${++n}x`, ['trades'])).json() as { id: string; invite: string };
    const b = new Browser(app);
    const view = await b.post('/v1/team/invite', { invite: created.invite });
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ team: owner.displayName, displayName: `Joiner${n}x`, roles: ['trades'] });

    const k1 = await genKey();
    const k2 = await genKey();
    const s1 = await b.post('/v1/team/join/start', { invite: created.invite, loginName: `joinlogin${n}`, publicKey: k1.publicKey });
    expect(s1.statusCode, s1.body).toBe(200);
    const c1 = s1.json() as { challengeId: string; encryptedMessage: string };
    const code1 = codeOf(await decrypt(c1.encryptedMessage, k1.privateKey, undefined, deps.clock()));
    const f1 = await b.post('/v1/team/join/finish', { challengeId: c1.challengeId, code: code1 });
    expect(f1.statusCode, f1.body).toBe(201);
    const { setupId, needs } = f1.json() as { setupId: string; needs: string[] };
    expect(needs).toEqual(['security-key', 'passkey', 'pgp']);
    // No session after one factor.
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
    // The code is used up.
    expect((await new Browser(app).post('/v1/team/invite', { invite: created.invite })).statusCode).toBe(404);

    // The same key again is not a second factor.
    const same = await b.post('/v1/team/join/second/pgp/start', { setupId, publicKey: k1.publicKey });
    const sc = same.json() as { challengeId: string; encryptedMessage: string };
    const sameFinish = await b.post('/v1/team/join/second/pgp/finish', {
      setupId, challengeId: sc.challengeId, code: codeOf(await decrypt(sc.encryptedMessage, k1.privateKey, undefined, deps.clock())), deviceLabel: 'Test',
    });
    expect(sameFinish.statusCode).toBeGreaterThanOrEqual(400);

    const s2 = await b.post('/v1/team/join/second/pgp/start', { setupId, publicKey: k2.publicKey });
    expect(s2.statusCode, s2.body).toBe(200);
    const c2 = s2.json() as { challengeId: string; encryptedMessage: string };
    const f2 = await b.post('/v1/team/join/second/pgp/finish', {
      setupId, challengeId: c2.challengeId, code: codeOf(await decrypt(c2.encryptedMessage, k2.privateKey, undefined, deps.clock())), deviceLabel: 'Test',
    });
    expect(f2.statusCode, f2.body).toBe(201);
    // Landing review M1: the member just proved two factors, so their first session is strong (as
    // every member login, login.ts), not the single PGP key's `pgp-single`.
    const first = await deps.db.query<{ strength: string }>('select strength from sessions where id = $1', [await sessionId(b)]);
    expect(first.rows[0]!.strength).toBe('strong');
    const me = (await b.get('/v1/account/me')).json() as { displayName: string; member: unknown };
    expect(me.displayName).toBe(owner.displayName);
    expect(me.member).toEqual({ name: `Joiner${n}x`, roles: ['trades'] });
    const alerts = (await owner.browser.get('/v1/account/alerts')).json() as { kind: string }[];
    expect(alerts.map((a) => a.kind)).toContain('team-member-joined');
    expect(((await owner.browser.get('/v1/team')).json() as { members: { status: string }[] }).members[0]!.status).toBe('active');
  });

  it('a member login with a password alone is refused (members never hold a password)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const res = await new Browser(app).post('/v1/login/password', { loginName: `mlogin${n}x`, password: 'correct horse battery staple', deviceLabel: 'x' });
    expect(res.statusCode).toBe(401);
    // And a member cannot add one (or any login method of the account owner's kinds).
    const add = await m.browser.put('/v1/account/password', { password: 'correct horse battery staple' });
    expect(err(add)).toEqual({ status: 403, error: 'owner-only' });
  });
});

describe('roles', () => {
  it('an Offers-only member posts and turns off an offer, but take is forbidden', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, ['offers']);
    const posted = await m.browser.post('/v1/offers', OFFER);
    expect(posted.statusCode, posted.body).toBe(201);
    const id = (posted.json() as { id: string }).id;
    const { rows } = await deps.db.query<{ account_id: string }>('select account_id from offers where id = $1', [id]);
    expect(rows[0]!.account_id).toBe(owner.id);
    expect((await m.browser.patch(`/v1/offers/${id}`, { status: 'paused' })).statusCode).toBe(200);
    const bulk = await m.browser.post('/v1/account/offers/status', { ids: [id], status: 'live' });
    expect(bulk.statusCode, bulk.body).toBe(200);
    const sellerOffer = (await seller.browser.post('/v1/offers', OFFER)).json() as { id: string };
    expect(err(await m.browser.post(`/v1/offers/${sellerOffer.id}/take`, takeBody(owner.wallet)))).toEqual({ status: 403, error: 'forbidden' });
  });

  it('a Trades-only member marks paid on the owner\'s trade, but taking (I2) and posting are refused', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, ['trades']);
    expect(err(await m.browser.post('/v1/offers', OFFER))).toEqual({ status: 403, error: 'forbidden' });
    // The account's wallet list, address ends only (review M7; adding or removing stays the owner's).
    const wallets = await m.browser.get('/v1/wallets');
    expect(wallets.statusCode).toBe(200);
    const listed = wallets.json() as Record<string, unknown>[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('address');
    expect(listed[0]!.addressEnd).toMatch(/^.{6}$/);
    expect(JSON.stringify(listed)).not.toContain(((await owner.browser.get('/v1/wallets')).json() as { address: string }[])[0]!.address);
    // Review I2 (lead 2026-10-30): a take makes the taking device the escrow party, and only the
    // owner's device can be one until Plan 3 Task 42; the refused take leaves nothing behind.
    const offer = (await seller.browser.post('/v1/offers', OFFER)).json() as { id: string };
    expect(err(await m.browser.post(`/v1/offers/${offer.id}/take`, takeBody(owner.wallet)))).toEqual({ status: 403, error: 'member-cannot-sign' });
    const none = await deps.db.query('select 1 from trades where buyer_account_id = $1', [owner.id]);
    expect(none.rowCount).toBe(0);
    expect(await auditRows(owner.id)).toEqual([]);

    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, t.trade, 'secured');
    const paid = await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
    expect(paid.statusCode, paid.body).toBe(200);
  });

  it('a role change applies at the next request', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    expect(err(await m.browser.post('/v1/offers', OFFER))).toEqual({ status: 403, error: 'forbidden' });
    const action = { kind: 'team-roles' as const, memberId: m.id, roles: 'offers,trades' };
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { roles: ['trades', 'offers'], confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { roles: string[] }).roles).toEqual(['offers', 'trades']);
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
  });
});

describe('owner-only', () => {
  it('a member adding a payout wallet, inviting, managing members, reading the audit log or changing security gets owner-only', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const refused = [
      await m.browser.post('/v1/wallets', { app: 'cake', label: 'Mine', address: fakeAddress() }),
      await m.browser.delete(`/v1/wallets/${owner.wallet}`),
      await m.browser.post('/v1/team/invites', { displayName: 'Sneaky01', roles: ['offers'] }),
      await m.browser.get('/v1/team'),
      await m.browser.patch(`/v1/team/members/${m.id}`, { roles: ['offers'] }),
      await m.browser.delete(`/v1/team/members/${m.id}`),
      await m.browser.get('/v1/team/audit'),
      await m.browser.put('/v1/account/security/logout-timer', { idleHours: 12 }),
      await m.browser.get('/v1/account/sessions'),
      await m.browser.post('/v1/account/login-name', { loginName: 'whatever1' }),
    ];
    for (const r of refused) expect(err(r)).toEqual({ status: 403, error: 'owner-only' });
    // Every member may read who they are (the overview of the account they work for).
    expect((await m.browser.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('no member signs escrow: release-started and registering a trade identity are member-cannot-sign', async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, ['trades']);
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'paid');
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'release-started' }))).toEqual({ status: 403, error: 'member-cannot-sign' });
    expect(err(await m.browser.post(`/v1/trades/${t.code}/identity`, {}))).toEqual({ status: 403, error: 'member-cannot-sign' });
  });
});

describe('the audit log', () => {
  it('each effectful member action writes exactly one row, a read writes none, the owner writes none', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const posted = (await m.browser.post('/v1/offers', OFFER)).json() as { id: string };
    expect((await auditRows(owner.id)).map((r) => r.action)).toEqual(['offer-posted']);
    await m.browser.get('/v1/account/offers');
    await m.browser.get('/v1/account/me');
    expect(await auditRows(owner.id)).toHaveLength(1);
    await m.browser.patch(`/v1/offers/${posted.id}`, { status: 'paused' });
    await m.browser.post('/v1/account/offers/status', { ids: [posted.id], status: 'live' });
    // Already live: nothing switched, nothing logged.
    await m.browser.post('/v1/account/offers/status', { ids: [posted.id], status: 'live' });
    await owner.browser.patch(`/v1/offers/${posted.id}`, { status: 'paused' });
    expect((await auditRows(owner.id)).map((r) => r.action)).toEqual(['offer-posted', 'offer-paused', 'offer-relisted']);
    expect((await auditRows(owner.id)).every((r) => r.member_id === m.id)).toBe(true);

    const other = await team();
    const t = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, t.trade, 'secured');
    await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
    const rows = await auditRows(owner.id);
    expect(rows.at(-1)).toMatchObject({ action: 'mark-paid', trade_code: t.code });

    const list = await owner.browser.get(`/v1/team/audit?member=${m.id}`);
    expect(list.statusCode).toBe(200);
    const entries = list.json() as { action: string; memberName: string }[];
    expect(entries.map((e) => e.action)).toEqual(['mark-paid', 'offer-relisted', 'offer-paused', 'offer-posted']);
    expect(entries.every((e) => e.memberName === m.name)).toBe(true);
    // A refused action logs nothing.
    await m.browser.post('/v1/wallets', { app: 'cake', label: 'x', address: fakeAddress() });
    expect(await auditRows(owner.id)).toHaveLength(rows.length);
  });

  it('is append-only: no update but clearing a trade code, no delete, no TRUNCATE (review M4)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    await deps.db.query(`insert into team_audit (account_id, member_id, at, action, trade_code) values ($1, $2, now(), 'mark-paid', 'AAAA-BBBB-CCCC-DDDD')`, [owner.id, m.id]);
    await expect(deps.db.query(`update team_audit set action = 'extend' where account_id = $1`, [owner.id])).rejects.toThrow(/append-only/);
    await expect(deps.db.query('delete from team_audit where account_id = $1', [owner.id])).rejects.toThrow(/append-only/);
    await expect(deps.db.query('truncate team_audit')).rejects.toThrow(/append-only/);
    await expect(deps.db.query('truncate team_members cascade')).rejects.toThrow(/append-only/);
    expect((await deps.db.query('update team_audit set trade_code = null where account_id = $1', [owner.id])).rowCount).toBe(1);
    expect((await auditRows(owner.id))[0]!.trade_code).toBeNull();
  });

  it('a deleted trade\'s code is cleared from the log by the database itself (R36, review M5)', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, ['trades']);
    const t = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    await deps.db.query(`insert into team_audit (account_id, member_id, at, action, trade_code) values ($1, $2, now(), 'mark-paid', $3)`, [owner.id, m.id, t.code]);
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      // trade_events only lets x2f_purge delete (104); then the trade itself, as Plan 7's purge will,
      // written as a schema-qualified name the old regex tripwire would have missed.
      await c.query('set local role x2f_purge');
      await c.query('delete from trade_events where code = $1', [t.code]);
      await c.query('reset role');
      for (const table of ['trade_identities', 'trade_attestations', 'trade_refusals', 'trade_work_served', 'disputes']) await c.query(`delete from ${table} where code = $1`, [t.code]);
      await c.query('delete from public.trades where code = $1', [t.code]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    const rows = await auditRows(owner.id);
    expect(rows).toEqual([{ action: 'mark-paid', member_id: m.id, trade_code: null }]);
  });
});

describe('removing a member', () => {
  it("ends the member's sessions at once (not-authenticated) and closes their login", async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    expect((await m.browser.get('/v1/account/me')).statusCode).toBe(200);
    const action = { kind: 'team-remove' as const, memberId: m.id };
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const del = await app.inject({
      method: 'DELETE', url: `/v1/team/members/${m.id}`, headers: { origin: 'https://x2f.test' }, cookies: owner.browser.cookies, payload: { confirmToken },
    });
    expect(del.statusCode, del.body).toBe(204);
    expect(err(await m.browser.get('/v1/account/me'))).toEqual({ status: 401, error: 'not-authenticated' });
    // Review M6: the member's login account (login name, keys) is deleted; the row keeps the name for the log.
    expect((await deps.db.query('select 1 from accounts where id = $1', [m.loginId])).rowCount).toBe(0);
    const { rows } = await deps.db.query<{ display_name: string; member_account_id: string | null; removed_at: Date | null }>(
      'select display_name, member_account_id, removed_at from team_members where id = $1', [m.id],
    );
    expect(rows[0]).toMatchObject({ display_name: m.name, member_account_id: null });
    expect(rows[0]!.removed_at).not.toBeNull();
    // The owner's own session is untouched.
    expect((await owner.browser.get('/v1/account/me')).statusCode).toBe(200);
  });
});

async function confirmed(owner: Who, action: Parameters<typeof issueConfirmToken>[1]['action']): Promise<string> {
  return issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
}

async function stream(b: Browser): Promise<SseStream> {
  const st = await openEvents(app, b.cookies);
  streams.push(st);
  return st;
}

const fakeSink = (): StreamSink & { got: string[] } => {
  const got: string[] = [];
  return { got, send: (d) => void got.push(d), close: () => undefined };
};

describe('live streams and pushes with members on the team (review I1)', () => {
  it('a member stream gets the events but never counts as the owner being reached', () => {
    const bus = new EventBus({ perAccount: 3, global: 10 });
    const m = fakeSink();
    bus.attach('team', m, 's-member', { member: true });
    expect(bus.publish('team', { type: 'trade', code: 'X', state: 'paid' })).toBe(0);
    expect(m.got).toHaveLength(1);
    expect(bus.delivered('team')).toBe(false);
    const o = fakeSink();
    const detach = bus.attach('team', o, 's-owner')!;
    expect(bus.publish('team', { type: 'trade', code: 'X', state: 'paid' })).toBe(1);
    expect(bus.delivered('team')).toBe(true);
    detach();
    expect(bus.delivered('team')).toBe(false);
  });

  it('members together never take the last per-account slot: the owner can always attach', () => {
    const bus = new EventBus({ perAccount: 3, global: 10 });
    expect(bus.attach('team', fakeSink(), 'a', { member: true })).not.toBeNull();
    expect(bus.attach('team', fakeSink(), 'b', { member: true })).not.toBeNull();
    expect(bus.attach('team', fakeSink(), 'c', { member: true })).toBeNull();
    expect(bus.attach('team', fakeSink(), 'owner')).not.toBeNull();
    expect(bus.attach('team', fakeSink(), 'owner2')).toBeNull();
  });

  it('a trade event pushes to the owner while only a member stream of theirs is open', async () => {
    const bus = new EventBus();
    const pushes: string[] = [];
    const publish = tradeEventPublisher({ events: bus, push: { send: async (id) => (pushes.push(id), true) } });
    bus.attach('owner-account', fakeSink(), 's', { member: true });
    const t = { code: 'X2F-AAAA-BBBB', state: 'paid', sellerId: 'owner-account', buyerId: 'buyer-account' } as never;
    await publish(t, { type: 'mark-paid', fiatCents: 1n } as never, 'buyer');
    expect(pushes).toEqual(['owner-account']);
  });

  it("over the API: a member's open tab neither suppresses the owner's push nor takes the owner's slot", async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, ['trades']);
    const send = vi.spyOn(app.push, 'send').mockResolvedValue(true);
    try {
      // The member fills every slot members may take (perAccount 5, one kept for the owner).
      const mine: SseStream[] = [];
      for (let i = 0; i < app.events.perAccount - 1; i++) mine.push(await stream(m.browser));
      expect(mine.map((st) => st.status)).toEqual(Array(app.events.perAccount - 1).fill(200));
      const fifth = await stream(m.browser);
      expect(fifth.status).toBe(429);
      expect(fifth.body).toEqual({ error: 'busy' });

      // A buyer takes the owner's offer: the "accepted" reaches the member's tabs, and the owner still gets the push.
      const offer = (await owner.browser.post('/v1/offers', OFFER)).json() as { id: string };
      const taken = await buyer.browser.post(`/v1/offers/${offer.id}/take`, takeBody(buyer.wallet));
      expect(taken.statusCode, taken.body).toBe(200);
      const code = (taken.json() as { code: string }).code;
      await mine[0]!.waitFor((e) => (e as { type?: string }).type === 'accepted');
      await until(() => send.mock.calls.some(([id]) => id === owner.id));

      // A trade event by the buyer: the owner gets the push too.
      send.mockClear();
      const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
      const secured = await driveTo(deps, t.trade, 'secured');
      const paid = await buyer.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
      expect(paid.statusCode, paid.body).toBe(200);
      await until(() => send.mock.calls.some(([id]) => id === owner.id));
      expect(code).toBeTruthy();

      // The owner's own stream still attaches, and from then on stands in for the push.
      const own = await stream(owner.browser);
      expect(own.status).toBe(200);
      expect(app.events.delivered(owner.id)).toBe(true);
    } finally {
      send.mockRestore();
      for (const st of streams.splice(0)) st.close();
      await until(() => !app.events.delivered(owner.id));
    }
  });
});

describe('role changes and removal reach a member in flight', () => {
  it("dropping Trades ends the member's live stream at once (review M2)", async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const st = await stream(m.browser);
    expect(st.status).toBe(200);
    const confirmToken = await confirmed(owner, { kind: 'team-roles', memberId: m.id, roles: 'offers' });
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { roles: ['offers'], confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    await st.ended;
    // And the reconnect is refused for the role.
    const again = await stream(m.browser);
    expect(again.status).toBe(403);
    expect(again.body).toEqual({ error: 'forbidden' });
  });

  /** Holds the member's row locked while `act` runs past the session gate, then applies `change` and lets it go. */
  async function racing(memberId: string, act: () => Promise<{ statusCode: number; json(): unknown }>, change: string) {
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('select 1 from team_members where id = $1 for update', [memberId]);
      const pending = act();
      // The request passed requireSession (a plain read) and now waits in auditMember's `for share`.
      for (let i = 0; i < 200; i++) {
        const w = await deps.db.query(
          `select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%team_members%for share%'`,
        );
        if ((w.rowCount ?? 0) > 0) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await c.query(change, [memberId]);
      await c.query('commit');
      return await pending;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  it('a removal that commits after the gate refuses the action and rolls it back (review M1)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const res = await racing(m.id, () => m.browser.post('/v1/offers', OFFER), 'update team_members set removed_at = now() where id = $1');
    expect(err(res)).toEqual({ status: 401, error: 'not-authenticated' });
    expect((await deps.db.query('select 1 from offers where account_id = $1', [owner.id])).rowCount).toBe(0);
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it('a role drop that commits after the gate refuses the action and rolls it back (review M1)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const res = await racing(m.id, () => m.browser.post('/v1/offers', OFFER), `update team_members set roles = '{trades}' where id = $1`);
    expect(err(res)).toEqual({ status: 403, error: 'forbidden' });
    expect((await deps.db.query('select 1 from offers where account_id = $1', [owner.id])).rowCount).toBe(0);
  });

  /** A trade of `owner`'s (the seller) cancelled by the buyer and refunded, its refund tx fully confirmed. */
  async function refundedCancel(owner: Who): Promise<string> {
    const other = await team();
    const { trade, code } = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    expect((await other.browser.post(`/v1/trades/${code}/events`, { type: 'buyer-cancel' })).statusCode).toBe(200);
    const tx = randomBytes(32).toString('hex');
    await applyEvent(deps, code, { type: 'settled', kind: 'buyer-cancel', txHash: tx }, 'system');
    nodeCounts.set(tx, 10);
    return code;
  }

  it("a removal that commits after the gate leaves a member's Confirm cancel no write at all, not even the 48 h start (review round 2, n2)", async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    const code = await refundedCancel(owner);
    const res = await racing(m.id, () => m.browser.post(`/v1/trades/${code}/events`, { type: 'confirm-cancel' }), 'update team_members set removed_at = now() where id = $1');
    expect(err(res)).toEqual({ status: 401, error: 'not-authenticated' });
    const t = (await loadTrade(deps.db, code))!;
    expect(t.cancelConfirmableAt).toBeNull();
    expect(t.cancelConfirmedAt).toBeNull();
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it("a role drop after the gate: the member's confirmations read records nothing either (review round 2, n2)", async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const code = await refundedCancel(owner);
    const res = await racing(m.id, () => m.browser.get(`/v1/trades/${code}/confirmations`), `update team_members set roles = '{offers}' where id = $1`);
    expect(err(res)).toEqual({ status: 403, error: 'forbidden' });
    expect((await loadTrade(deps.db, code))!.cancelConfirmableAt).toBeNull();
    // A live member's Confirm cancel still goes through, and records the 48 h start with it.
    const m2 = await member(owner.id, ['trades']);
    const ok = await m2.browser.post(`/v1/trades/${code}/events`, { type: 'confirm-cancel' });
    expect(ok.statusCode, ok.body).toBe(200);
    const t = (await loadTrade(deps.db, code))!;
    expect(t.cancelConfirmableAt).toBeInstanceOf(Date);
    expect(t.cancelConfirmedAt).toBeInstanceOf(Date);
    expect((await auditRows(owner.id)).map((r) => [r.action, r.member_id])).toEqual([['confirm-cancel', m2.id]]);
  });

  it('every trade event a member may send has an audit action and its role (a new client event fails here)', () => {
    const sendable = CLIENT_EVENTS.filter((e) => !MEMBER_SIGNING_EVENTS.has(e) && e !== 'open-dispute');
    for (const e of sendable) expect(ACTION_ROLE[e as keyof typeof ACTION_ROLE], e).toBe('trades');
  });

  it('auditMember checks every action against the role it needs', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    const actor = { accountId: owner.id, memberId: m.id };
    await expect(auditMember(deps.db, actor, { action: 'offer-posted' }, deps.clock())).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await auditMember(deps.db, actor, { action: 'mark-paid', tradeCode: null }, deps.clock());
    expect(Object.entries(ACTION_ROLE).filter(([a]) => a.startsWith('offer-')).every(([, r]) => r === 'offers')).toBe(true);
    // Another team's account id with this member: refused as gone.
    await expect(auditMember(deps.db, { accountId: (await team()).id, memberId: m.id }, { action: 'mark-paid' }, deps.clock())).rejects.toMatchObject({ status: 401, code: 'not-authenticated' });
  });
});

describe('the audit log covers every member action (review M3)', () => {
  it('trade-taken and trade-wallet-set are refused before anything is written (I2), final-alert-seen, dispute and appeal write one row each', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, ['trades']);
    // The owner posts a buy offer and another trader takes it: the owner (poster, buyer) must set the payout wallet.
    const buyOffer = (await owner.browser.post('/v1/offers', { ...OFFER, side: 'buy' })).json() as { id: string };
    const taken = await other.browser.post(`/v1/offers/${buyOffer.id}/take`, takeBody(other.wallet));
    expect(taken.statusCode, taken.body).toBe(200);
    const takenCode = (taken.json() as { code: string }).code;
    expect(err(await m.browser.post(`/v1/trades/${takenCode}/wallet`, { walletId: owner.wallet }))).toEqual({ status: 403, error: 'member-cannot-sign' });
    const offer = (await other.browser.post('/v1/offers', OFFER)).json() as { id: string };
    expect(err(await m.browser.post(`/v1/offers/${offer.id}/take`, takeBody(owner.wallet)))).toEqual({ status: 403, error: 'member-cannot-sign' });
    expect(await auditRows(owner.id)).toEqual([]);

    // A dispute on a secured trade (the owner is the buyer), then an appeal of its ruling.
    const d = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    await driveTo(deps, d.trade, 'secured');
    const opened = await m.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'a private note' });
    expect(opened.statusCode, opened.body).toBe(200);
    // A moderator's round-1 ruling, through the dispute machine (Plan 4 Task 12 is not built yet).
    await publishRuling(deps, d.code, { outcome: 'release-to-buyer' });
    const appealed = await m.browser.post(`/v1/trades/${d.code}/appeal`, { why: 'The moderator missed my bank statement.' });
    expect(appealed.statusCode, appealed.body).toBe(200);

    // The final alert on a trade where the owner is the buyer: a member's receipt is logged but does
    // not count as the owner seeing it (review M9(b)).
    const f = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const fs = await driveTo(deps, f.trade, 'secured');
    await markSellerNudged(deps, f.code);
    const base = deps.clock();
    try {
      setNow(new Date(fs.payBy!.getTime() + 60_000));
      expect((await other.browser.post(`/v1/trades/${f.code}/events`, { type: 'request-refund' })).statusCode).toBe(200);
      const seen = await m.browser.post(`/v1/trades/${f.code}/final-alert-seen`, {});
      expect(seen.statusCode, seen.body).toBe(204);
      const { rows } = await deps.db.query<{ d: boolean | null; at: Date | null }>(
        'select final_alert_delivered as d, final_alert_seen_at as at from trades where code = $1', [f.code],
      );
      expect(rows[0]).toEqual({ d: null, at: null });
    } finally {
      setNow(base);
    }

    const rows = await auditRows(owner.id);
    expect(rows.map((r) => [r.action, r.trade_code])).toEqual([
      ['dispute-opened', d.code],
      ['appeal-filed', d.code],
      ['final-alert-seen', f.code],
    ]);
    const { rows: detail } = await deps.db.query<{ detail: unknown }>('select detail from team_audit where account_id = $1 order by id', [owner.id]);
    expect(JSON.stringify(detail)).not.toContain('private note');
  });

  it('every member-allowed route that changes something writes an audit row, or is a recorded exemption', () => {
    // Static scan of apps/api/src: a route is member-allowed when its options name a guard built
    // with `requireSession({ ... member: ... })` (or build one inline). A non-GET one must call
    // `auditMember(` in its own handler, or be listed here with why it writes nothing.
    const EXEMPT: Record<string, string> = {
      'POST /v1/feedback/form': 'anonymous by design (Plan 5 Task 21): not an account action, and a row would tie the member to the text',
      'POST /v1/trades/:code/identity': 'refused to every member (ownerDeviceOnly, member-cannot-sign) until Plan 3 Task 42',
    };
    const found: string[] = [];
    const audited = new Set<string>();
    for (const f of sources(`${ROOT}apps/api/src`)) {
      const src = readFileSync(f, 'utf8');
      const guards = new Set<string>();
      for (const g of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\[?\s*requireSession\(\{[^)]*member:/g)) guards.add(g[1]!);
      const regs = [...src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g)];
      regs.forEach((r, i) => {
        const block = src.slice(r.index, i + 1 < regs.length ? regs[i + 1]!.index : src.length);
        const opts = block.slice(0, block.search(/async\s*\(/));
        const memberAllowed = /requireSession\(\{[^)]*member:/.test(opts) || [...guards].some((g) => new RegExp(`\\b${g}\\b`).test(opts));
        if (!memberAllowed || r[1] === 'get') return;
        const route = `${r[1]!.toUpperCase()} ${r[2]}`;
        found.push(route);
        if (EXEMPT[route]) return;
        expect(block, `${route} (${f}) lets members through and writes no audit row: call auditMember in its transaction, or record why not in EXEMPT`).toMatch(/auditMember\(/);
        audited.add(route);
      });
    }
    // The routes as registered (review round 2, n4): a member-allowed guard is one requireSession
    // built with `member` (memberAccessOf), in any of the route's hooks, whatever the route's
    // registration style. Each non-GET one calls auditMember in its handler, was audited in the
    // source scan above, or is a recorded exemption.
    const live = new Set<string>();
    for (const r of registered) {
      const hooks = [r.onRequest, r.preParsing, r.preValidation, r.preHandler].flat().filter(Boolean);
      if (!hooks.some((h) => memberAccessOf(h) !== undefined)) continue;
      for (const method of [r.method].flat()) {
        if (method === 'GET' || method === 'HEAD') continue;
        const route = `${method} ${r.url}`;
        live.add(route);
        if (EXEMPT[route] || audited.has(route)) continue;
        expect(String(r.handler), `${route} lets members through and writes no audit row: call auditMember in its transaction, or record why not in EXEMPT`).toMatch(/auditMember\(/);
      }
    }
    // The hook sees every route the source scan does (so the guard tag and the hook both work).
    for (const r of found) expect([...live], r).toContain(r);
    // The scan sees the routes it must (so a refactor that hides them fails here, not silently).
    for (const r of ['POST /v1/offers', 'PATCH /v1/offers/:id', 'POST /v1/account/offers/status', 'POST /v1/offers/:id/take', 'POST /v1/trades/:code/wallet',
      'POST /v1/trades/:code/events', 'POST /v1/trades/:code/final-alert-seen', 'POST /v1/trades/:code/dispute', 'POST /v1/trades/:code/appeal', ...Object.keys(EXEMPT)]) {
      expect(found, r).toContain(r);
    }
  });
});

describe('member logins (review M8, M9)', () => {
  it("a member's passkey as the first factor (discoverable login) is refused", async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const { rows } = await deps.db.query<{ h: Buffer }>('select webauthn_user_id as h from accounts where id = $1', [m.loginId]);
    await deps.db.query(
      `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
       values ($1, $2, $3, 0, 'passkey', true, 'multiDevice', false, 'k', $4)`,
      [m.loginId, Buffer.from(auth.credentialId, 'base64url'), auth.cosePublicKey, deps.clock()],
    );
    const b = new Browser(app);
    const start = await b.post('/v1/login/webauthn/start', {});
    expect(start.statusCode, start.body).toBe(200);
    const { challengeId, options } = start.json() as { challengeId: string; options: Parameters<typeof auth.authenticate>[0] };
    const response = auth.authenticate(options, ORIGIN, { userHandle: rows[0]!.h.toString('base64url') });
    const res = await b.post('/v1/login/webauthn/finish', { challengeId, response, deviceLabel: 'Phone' });
    expect(err(res)).toEqual({ status: 401, error: 'webauthn-failed' });
    expect(b.cookies['__Host-x2f_session']).toBeUndefined();
  });

  it('a session of a member login account itself is never valid (M9(c))', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const token = randomBytes(32).toString('base64url');
    const now = deps.clock();
    await deps.db.query(
      `insert into sessions (account_id, token_hash, level, device_label, created_at, last_seen_at, expires_at)
       values ($1, $2, 'full', 'x', $3, $3, $4)`,
      [m.loginId, createHash('sha256').update(token, 'utf8').digest(), now, new Date(now.getTime() + DAY)],
    );
    const res = await app.inject({ method: 'GET', url: '/v1/account/me', cookies: { '__Host-x2f_session': token } });
    expect(err(res)).toEqual({ status: 401, error: 'not-authenticated' });
  });
});

describe('purgeTeamLeftovers (review M6)', () => {
  it('closes expired sign-ups and deletes every member login no live member uses', async () => {
    const owner = await team();
    const live = await member(owner.id, ['offers']);
    // A sign-up that ran out: a login account with a key, never joined.
    const stale = await seedAccount(deps, { loginName: `stalelogin${++n}`, displayName: `m-${n}-stale`, kind: 'member' });
    const past = new Date(deps.clock().getTime() - DAY);
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, created_at)
       values ($1, $2, $3, '{trades}', $4, $5, $4)`,
      [owner.id, `Stale${n}xx`, `stale${n}xx`, past, stale],
    );
    // A member login whose team row is gone (as after the team account is deleted).
    const orphan = await seedAccount(deps, { loginName: `orphanlogin${++n}`, displayName: `m-${n}-orphan`, kind: 'member' });
    expect(await purgeTeamLeftovers.run(deps.db, deps.clock())).toBeGreaterThanOrEqual(3);
    const left = await deps.db.query<{ id: string }>('select id from accounts where id = any($1)', [[stale, orphan, live.loginId]]);
    expect(left.rows.map((r) => r.id)).toEqual([live.loginId]);
    expect((await live.browser.get('/v1/account/me')).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ removed: boolean }>(`select removed_at is not null as removed from team_members where display_key = $1`, [`stale${n - 1}xx`]);
    expect(rows[0]!.removed).toBe(true);
  });
});

// TRIPWIRES (local tree only).
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('team changes during a 24-hour hold (owner 2026-10-30)', () => {
  /** Starts a hold on `accountId` (an hour old, 23 hours to go); returns its end. */
  async function hold(accountId: string): Promise<Date> {
    const now = deps.clock();
    const until = new Date(now.getTime() + 23 * 3_600_000);
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, pending_change, started_methods, started_by)
       values ($1, $2, $3, 'weak-new-device', null, '{}', null)`,
      [accountId, new Date(now.getTime() - 3_600_000), until],
    );
    return until;
  }
  /** The hold's time is up (it ends at the next check, `holdInTx`). */
  const timeUp = (accountId: string) =>
    deps.db.query('update account_holds set hold_until = $2 where account_id = $1', [accountId, new Date(deps.clock().getTime() - 1000)]);
  const teamOf = async (accountId: string) =>
    (await deps.db.query<{ display_name: string; roles: string[]; removed_at: Date | null }>(
      'select display_name, roles, removed_at from team_members where account_id = $1 order by created_at, id', [accountId],
    )).rows;

  it('an invite is refused with recovery-hold, writes nothing and spends no confirm token; after the hold the same request goes through', async () => {
    const owner = await team();
    const until = await hold(owner.id);
    const displayName = `Held${++n}x`;
    const confirmToken = await confirmed(owner, { kind: 'team-invite', name: displayName, roles: 'offers' });
    const res = await owner.browser.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
    expect(await teamOf(owner.id)).toEqual([]);
    await timeUp(owner.id);
    const ok = await owner.browser.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await teamOf(owner.id)).map((r) => r.display_name)).toEqual([displayName]);
    expect((await deps.db.query('select 1 from account_holds where account_id = $1', [owner.id])).rowCount).toBe(0);
  });

  it("a role change is refused with recovery-hold and the member's roles stay; after the hold it applies", async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const until = await hold(owner.id);
    const confirmToken = await confirmed(owner, { kind: 'team-roles', memberId: m.id, roles: 'offers,trades' });
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { roles: ['offers', 'trades'], confirmToken });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
    expect((await teamOf(owner.id))[0]!.roles).toEqual(['offers']);
    await timeUp(owner.id);
    const ok = await owner.browser.patch(`/v1/team/members/${m.id}`, { roles: ['offers', 'trades'], confirmToken });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await teamOf(owner.id))[0]!.roles).toEqual(['offers', 'trades']);
  });

  it('a removal is refused with recovery-hold and the member stays logged in; after the hold it ends their sessions', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const until = await hold(owner.id);
    const confirmToken = await confirmed(owner, { kind: 'team-remove', memberId: m.id });
    const del = () => app.inject({
      method: 'DELETE', url: `/v1/team/members/${m.id}`, headers: { origin: 'https://x2f.test' }, cookies: owner.browser.cookies, payload: { confirmToken },
    });
    const res = await del();
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
    expect((await teamOf(owner.id))[0]!.removed_at).toBeNull();
    expect((await m.browser.get('/v1/account/me')).statusCode).toBe(200);
    await timeUp(owner.id);
    expect((await del()).statusCode).toBe(204);
    expect((await teamOf(owner.id))[0]!.removed_at).not.toBeNull();
    expect(err(await m.browser.get('/v1/account/me'))).toEqual({ status: 401, error: 'not-authenticated' });
  });

  it('a hold that starts after the preHandler check still refuses the write, under the account lock (ownerWriteGate)', async () => {
    const owner = await team();
    const displayName = `Late${++n}x`;
    const confirmToken = await confirmed(owner, { kind: 'team-invite', name: displayName, roles: 'offers' });
    // requireConfirm runs after requireNotHeld: the hold starts right after the token is spent.
    let until: Date | null = null;
    const orig = deps.db.query.bind(deps.db) as (...a: unknown[]) => Promise<unknown>;
    const q = vi.spyOn(deps.db, 'query').mockImplementation((async (...args: unknown[]) => {
      const out = await orig(...args);
      if (until === null && typeof args[0] === 'string' && args[0].includes('update confirm_tokens')) until = await hold(owner.id);
      return out;
    }) as never);
    let res;
    try {
      res = await owner.browser.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken });
    } finally {
      q.mockRestore();
    }
    expect(until).not.toBeNull();
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until!.toISOString() });
    expect(await teamOf(owner.id)).toEqual([]);
  });
});

describe('team changes need a strong session (owner 1 Nov 2026; landing review I1)', () => {
  const teamOf = async (accountId: string) =>
    (await deps.db.query<{ display_name: string; roles: string[]; removed_at: Date | null }>(
      'select display_name, roles, removed_at from team_members where account_id = $1 order by created_at, id', [accountId],
    )).rows;
  const weaken = async (b: Browser, strength: 'weak-single' | 'pgp-single') =>
    deps.db.query('update sessions set strength = $2 where id = $1', [await sessionId(b), strength]);
  const unspent = async (token: string) =>
    (await deps.db.query('select 1 from confirm_tokens where token_hash = sha256(convert_to($1, \'utf8\')) and used_at is null', [token])).rowCount;

  for (const strength of ['weak-single', 'pgp-single'] as const) {
    it(`a ${strength} session's invite gets weak-session, writes nothing and spends no confirm token`, async () => {
      const owner = await team();
      await weaken(owner.browser, strength);
      const displayName = `Weak${++n}x`;
      const bare = await owner.browser.post('/v1/team/invites', { displayName, roles: ['offers'] });
      expect(err(bare)).toEqual({ status: 403, error: 'weak-session' });
      const confirmToken = await confirmed(owner, { kind: 'team-invite', name: displayName, roles: 'offers' });
      const res = await owner.browser.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken });
      expect(err(res)).toEqual({ status: 403, error: 'weak-session' });
      expect(await teamOf(owner.id)).toEqual([]);
      expect(await unspent(confirmToken)).toBe(1);
    });
  }

  it("a weak session's role change gets weak-session (adding or dropping a role) and the roles stay", async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    await weaken(owner.browser, 'weak-single');
    for (const roles of [['offers'], ['trades'], ['offers', 'trades']]) {
      const confirmToken = await confirmed(owner, { kind: 'team-roles', memberId: m.id, roles: roles.join(',') });
      const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { roles, confirmToken });
      expect(err(res)).toEqual({ status: 403, error: 'weak-session' });
    }
    expect((await teamOf(owner.id))[0]!.roles).toEqual(['offers', 'trades']);
  });

  it("a weak session may still remove a member outside a hold (it only takes access away)", async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    await weaken(owner.browser, 'weak-single');
    const confirmToken = await confirmed(owner, { kind: 'team-remove', memberId: m.id });
    const res = await app.inject({
      method: 'DELETE', url: `/v1/team/members/${m.id}`, headers: { origin: 'https://x2f.test' }, cookies: owner.browser.cookies, payload: { confirmToken },
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(err(await m.browser.get('/v1/account/me'))).toEqual({ status: 401, error: 'not-authenticated' });
  });

  it('a strong session invites and changes roles as before', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    expect((await invite(owner, `Strong${++n}x`, ['offers'])).statusCode).toBe(201);
    const confirmToken = await confirmed(owner, { kind: 'team-roles', memberId: m.id, roles: 'offers,trades' });
    expect((await owner.browser.patch(`/v1/team/members/${m.id}`, { roles: ['offers', 'trades'], confirmToken })).statusCode).toBe(200);
  });

  it('a session read weak only under the account lock (after the preHandler) is still refused, nothing written (ownerWriteGate)', async () => {
    const owner = await team();
    const sid = await sessionId(owner.browser);
    const displayName = `LateWeak${++n}x`;
    const confirmToken = await confirmed(owner, { kind: 'team-invite', name: displayName, roles: 'offers' });
    let weakened = false;
    const orig = deps.db.query.bind(deps.db) as (...a: unknown[]) => Promise<unknown>;
    const q = vi.spyOn(deps.db, 'query').mockImplementation((async (...args: unknown[]) => {
      const out = await orig(...args);
      if (!weakened && typeof args[0] === 'string' && args[0].includes('update confirm_tokens')) {
        weakened = true;
        await orig('update sessions set strength = $2 where id = $1', [sid, 'weak-single']);
      }
      return out;
    }) as never);
    let res;
    try {
      res = await owner.browser.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken });
    } finally {
      q.mockRestore();
    }
    expect(weakened).toBe(true);
    expect(err(res)).toEqual({ status: 403, error: 'weak-session' });
    expect(await teamOf(owner.id)).toEqual([]);
  });
});

describe('Task 18 seams', () => {
  it('NEEDS_PLAN3_TASK42_MEMBER_KEY: members still never sign escrow until the per-member key scheme lands', () => {
    // R44 / spec 6.7 OPEN (design): releasing needs the trade's escrow key on the member's device;
    // today it lives only on the account owner's. Plan 3 Task 42 designs a per-member key scheme
    // (3.1: X2F holds at most one key per trade). Until then `MEMBER_SIGNING_EVENTS` refuses
    // release-started and trades/identity.ts refuses registering a trade identity (member-cannot-sign),
    // so a Trades member can mark paid, cancel and dispute but the escrow steps wait for the owner's
    // device. Review I2 (lead 2026-10-30): taking an offer and the poster's accept step (the trade's
    // payout wallet) make the device that does them the trade's escrow party, so `ownerDeviceOnly`
    // refuses those too (OWNER_DEVICE_ROUTES), and the web's AcceptedSheet is never offered on a
    // member's device. When Task 42's key scheme lands (apps/api/src/team/memberKeys.ts or a
    // `member_id` on trade_identities), lift these refusals there, with tests (a member's take,
    // accept and room through to release), and delete this check.
    expect([...MEMBER_SIGNING_EVENTS]).toEqual(['release-started', 'fund-started']);
    expect([...OWNER_DEVICE_ROUTES]).toEqual(['POST /v1/offers/:id/take', 'POST /v1/trades/:code/wallet', 'POST /v1/trades/:code/identity']);
    expect(readFileSync(`${ROOT}apps/api/src/trades/identity.ts`, 'utf8')).toMatch(/requireSigner = \[requireSession\(\{[^}]*\}\), ownerDeviceOnly\]/);
    expect(readFileSync(`${ROOT}apps/api/src/trades/take.ts`, 'utf8')).toMatch(/requireTrader = \[requireSession\(\{[^}]*\}\), ownerDeviceOnly\]/);
    const landed = existsSync(`${ROOT}apps/api/src/team/memberKeys.ts`) || /member_id/.test(
      readdirSync(`${ROOT}apps/api/migrations`).filter((f) => /identit/.test(f)).map((f) => readFileSync(`${ROOT}apps/api/migrations/${f}`, 'utf8')).join('\n'),
    );
    expect(landed, 'Plan 3 Task 42 member keys landed: lift member-cannot-sign where the scheme allows, then delete this check').toBe(false);
  });

  it('NEEDS_PLAN7_PURGE_AUDIT: the team log stays owner-only data until Plan 7 decides its retention and roles', () => {
    // R36 is the database's job now (migration 199: deleting a trade clears its code from
    // team_audit, tested above), so a purge cannot forget it. Still open for Plan 7 (review M4):
    // (1) the API's database user owns team_audit, so its append-only triggers stop code bugs, not
    // a compromised API role (that needs a separate schema-owner role); (2) deleting an account
    // (Plan 7) deletes its team log by cascade: decide the log's retention then; (3) a removed
    // member's login is deleted at removal (review M6) and purgeTeamLeftovers clears the rest. When
    // Plan 7's purge migration (701) lands, revisit these and delete this check.
    expect(readFileSync(`${ROOT}apps/api/migrations/199_team_audit_trades.sql`, 'utf8')).toMatch(/after delete on trades/);
    expect(existsSync(`${ROOT}apps/api/migrations/701_trade_purge.sql`), 'Plan 7 purge landed: decide the team log retention and roles').toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Job 1c (J-10): the granular abilities and the owner's hard rules (S-087, S-092, S-094, S-097,
// T-076, D-066, C-019). Every hard rule below is the owner's: no box and no preset grants it.

describe('the owner\'s hard rules no box can grant (J-10)', () => {
  it('D-066 (p7-7): a member never opens a dispute, whatever their boxes; the trade party (the lead) still does', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const d = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    await driveTo(deps, d.trade, 'secured');
    expect(err(await m.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' }))).toEqual({ status: 403, error: 'owner-only' });
    expect((await deps.db.query('select 1 from disputes where code = $1', [d.code])).rowCount).toBe(0);
    expect(await auditRows(owner.id)).toEqual([]);
    const opened = await owner.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' });
    expect(opened.statusCode, opened.body).toBe(200);
    // The disputes box: the member sees the whole dispute.
    const seen = await m.browser.get(`/v1/trades/${d.code}/dispute`);
    expect(seen.statusCode, seen.body).toBe(200);
  });

  it('p10-2 (T-076): with every box ticked a member still never releases, funds or confirms payment on the lead\'s sell trade', async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'paid');
    for (const type of ['release-started', 'fund-started']) {
      expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type })), type).toEqual({ status: 403, error: 'member-cannot-sign' });
    }
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it('no box can be stored that grants a hard owner-only ability: the API refuses it and so does the database', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    for (const bad of ['trades-release', 'trades-confirm-received', 'disputes-open', 'wallets-manage', 'team-invite', 'team-remove', 'team-change-abilities', 'account-security', 'sessions-end-others', 'devices-approve', 'account-delete']) {
      const abilities = ['offers-see', bad];
      const confirmToken = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: abilities.join(',') } as never);
      expect(err(await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities, confirmToken })), bad).toEqual({ status: 400, error: 'bad-request' });
      await expect(deps.db.query('update team_members set abilities = $2 where id = $1', [m.id, abilities]), bad).rejects.toThrow();
    }
    // A good set is stored as a set and applies at the next request.
    const abilities = ['offers-see', 'offers-post'];
    const confirmToken = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: abilities.join(',') } as never);
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities, confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { abilities: string[] }).abilities).toEqual(['offers-see', 'offers-post']);
    expect((await m.browser.post('/v1/offers', OFFER)).statusCode).toBe(201);
    expect(err(await m.browser.get('/v1/wallets'))).toEqual({ status: 403, error: 'forbidden' });
  });

  it('payout wallets, members, the team log and security settings stay owner-only for a member with every box', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const refused = [
      await m.browser.post('/v1/wallets', { app: 'cake', label: 'Mine', address: fakeAddress() }),
      await m.browser.delete(`/v1/wallets/${owner.wallet}`),
      await m.browser.post('/v1/team/invites', { displayName: 'Sneaky02', abilities: ['offers-see'] }),
      await m.browser.patch(`/v1/team/members/${m.id}`, { abilities: ['offers-see'] }),
      await m.browser.delete(`/v1/team/members/${m.id}`),
      await m.browser.put('/v1/account/security/logout-timer', { idleHours: 12 }),
      await m.browser.get('/v1/account/sessions'),
    ];
    for (const r of refused) expect(err(r)).toEqual({ status: 403, error: 'owner-only' });
  });

  it('every effectful member action is logged with the member\'s name and, on a trade, its amount', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, ['trades']);
    const t = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, t.trade, 'secured');
    expect((await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() })).statusCode).toBe(200);
    const list = (await owner.browser.get('/v1/team/audit')).json() as { action: string; memberName: string; detail: Record<string, unknown> }[];
    expect(list[0]).toMatchObject({ action: 'mark-paid', memberName: m.name });
    expect(list[0]!.detail).toMatchObject({ amountAtomic: secured.amountAtomic.toString(), fiatCents: secured.fiatCents.toString(), currency: 'USD' });
  });

  it('T-076: on a team account every release is logged with the name (the lead\'s) and the amount', async () => {
    const owner = await team();
    const buyer = await team();
    await member(owner.id, ['trades']);
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    const paid = await driveTo(deps, t.trade, 'paid');
    const rel = await owner.browser.post(`/v1/trades/${t.code}/events`, { type: 'release-started' });
    expect(rel.statusCode, rel.body).toBe(200);
    const list = (await owner.browser.get('/v1/team/audit')).json() as { action: string; memberId: string | null; memberName: string | null; byLead: boolean; detail: Record<string, unknown> }[];
    expect(list[0]).toMatchObject({ action: 'release-started', memberId: null, byLead: true, tradeCode: t.code });
    expect(list[0]!.detail).toMatchObject({ amountAtomic: paid.amountAtomic.toString(), fiatCents: paid.fiatCents.toString() });
  });

  it('C-019: team chat stays hidden until a member chat key exists: a member gets owner-only on every chat route, whatever their boxes', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const fake = '00000000-0000-4000-8000-000000000000';
    for (const r of [
      await m.browser.get('/v1/chats'),
      await m.browser.post('/v1/chats', { offerId: fake }),
      await m.browser.get(`/v1/chats/${fake}`),
      await m.browser.get(`/v1/chats/${fake}/envelopes`),
      await m.browser.post(`/v1/chats/${fake}/envelopes`, {}),
      await m.browser.post('/v1/trades/AAAA-BBBB-CCCC-DDDD/chat', {}),
    ]) {
      expect(err(r)).toEqual({ status: 403, error: 'owner-only' });
    }
  });
});

describe('the abilities catalogue on the API (J-10)', () => {
  it('GET /v1/team/permissions lists the groups, every ability with its risk, rule and preset defaults, and the presets', async () => {
    const owner = await team();
    const res = await owner.browser.get('/v1/team/permissions');
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json() as {
      groups: { id: string; abilities: { id: string; no: number; risk: string; availability: string; presets: string[] }[] }[];
      presets: { id: string; abilities: string[] }[];
    };
    expect(c.groups).toHaveLength(9);
    const all = c.groups.flatMap((g) => g.abilities);
    expect(all).toHaveLength(66);
    expect(all.find((a) => a.id === 'trades-release')).toMatchObject({ availability: 'owner-only', presets: [] });
    expect(c.presets.map((p) => p.id)).toEqual(['offers', 'trades', 'manager', 'start']);
    // A member may read it too (what they may and may not do).
    const m = await member(owner.id, ['trades']);
    expect((await m.browser.get('/v1/team/permissions')).statusCode).toBe(200);
  });
});

describe('notes on traders (S-094, p7-8)', () => {
  it('a member with "view notes" reads, with "add notes" adds (logged, signed with name and time), and no member deletes', async () => {
    const owner = await team();
    const subject = await team();
    const subjectName = ((await subject.browser.get('/v1/account/me')).json() as { displayName: string }).displayName;
    const m = await member(owner.id, ['trades']);
    // Without the boxes: refused.
    expect(err(await m.browser.get(`/v1/account/notes/${subjectName}`))).toEqual({ status: 403, error: 'forbidden' });
    expect(err(await m.browser.post('/v1/account/notes', { about: subjectName, text: 'Pays fast.' }))).toEqual({ status: 403, error: 'forbidden' });
    // The lead adds one.
    const lead = await owner.browser.post('/v1/account/notes', { about: subjectName, text: 'Pays fast.' });
    expect(lead.statusCode, lead.body).toBe(201);
    const confirmToken = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: 'notes-view,notes-add' } as never);
    expect((await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities: ['notes-view', 'notes-add'], confirmToken })).statusCode).toBe(200);
    const added = await m.browser.post('/v1/account/notes', { about: subjectName, text: 'Asked for more time once.' });
    expect(added.statusCode, added.body).toBe(201);
    const list = await m.browser.get(`/v1/account/notes/${subjectName}`);
    expect(list.statusCode).toBe(200);
    const notes = list.json() as { id: string; text: string; by: string | null; byLead: boolean; at: string }[];
    expect(notes.map((x) => [x.text, x.by, x.byLead])).toEqual([['Asked for more time once.', m.name, false], ['Pays fast.', null, true]]);
    // Logged without the text.
    const rows = await auditRows(owner.id);
    expect(rows.map((r) => r.action)).toEqual(['note-added']);
    const { rows: detail } = await deps.db.query<{ detail: unknown }>('select detail from team_audit where account_id = $1', [owner.id]);
    expect(JSON.stringify(detail)).not.toContain('more time');
    // No member deletes a note (owner-only), and the database refuses to change a note's text.
    expect(err(await m.browser.delete(`/v1/account/notes/${notes[0]!.id}`))).toEqual({ status: 403, error: 'owner-only' });
    await expect(deps.db.query(`update trader_notes set text = 'x' where id = $1`, [notes[0]!.id])).rejects.toThrow();
    // Another account never sees them.
    expect(((await subject.browser.get(`/v1/account/notes/${subjectName}`)).json() as unknown[]).length).toBe(0);
  });
});
