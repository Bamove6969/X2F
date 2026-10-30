import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fiatCents } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { forgetAuditTrade } from '../src/team/audit.js';
import { MAX_TEAM_MEMBERS, MEMBER_SIGNING_EVENTS } from '../src/team/perms.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { Browser } from './helpers/totp.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Plan 2 Task 18: team members (spec 6.7, R44). Real Postgres, one database for the file; each
// test makes its own team accounts.

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
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { prices, db: await testDb({ max: 8 }) }));
});
afterAll(async () => {
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
  const action = { kind: 'team-invite' as const, roles: roles.join(',') };
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
    const action = { kind: 'team-invite' as const, roles: 'offers' };
    const token = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const wrong = await owner.browser.post('/v1/team/invites', { displayName: `Plain${n}xy`, roles: ['offers', 'trades'], confirmToken: token });
    expect(err(wrong)).toEqual({ status: 403, error: 'confirm-invalid' });
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

  it('a Trades-only member takes and marks paid, but posting an offer is forbidden', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, ['trades']);
    expect(err(await m.browser.post('/v1/offers', OFFER))).toEqual({ status: 403, error: 'forbidden' });
    // The account's wallet list, to pick one at take (adding or removing stays the owner's).
    expect((await m.browser.get('/v1/wallets')).statusCode).toBe(200);
    const offer = (await seller.browser.post('/v1/offers', OFFER)).json() as { id: string };
    const taken = await m.browser.post(`/v1/offers/${offer.id}/take`, takeBody(owner.wallet));
    expect(taken.statusCode, taken.body).toBe(200);
    const code = (taken.json() as { code: string }).code;
    const { rows } = await deps.db.query<{ buyer_account_id: string }>('select buyer_account_id from trades where code = $1', [code]);
    expect(rows[0]!.buyer_account_id).toBe(owner.id);

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

  it('is append-only; only a trade code may be cleared (R36)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    await deps.db.query(`insert into team_audit (account_id, member_id, at, action, trade_code) values ($1, $2, now(), 'mark-paid', 'AAAA-BBBB-CCCC-DDDD')`, [owner.id, m.id]);
    await expect(deps.db.query(`update team_audit set action = 'extend' where account_id = $1`, [owner.id])).rejects.toThrow(/append-only/);
    await expect(deps.db.query('delete from team_audit where account_id = $1', [owner.id])).rejects.toThrow(/append-only/);
    expect(await forgetAuditTrade(deps.db, 'AAAA-BBBB-CCCC-DDDD')).toBe(1);
    expect((await auditRows(owner.id))[0]!.trade_code).toBeNull();
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
    const { rows } = await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [m.loginId]);
    expect(rows[0]!.disabled_at).not.toBeNull();
    // The owner's own session is untouched.
    expect((await owner.browser.get('/v1/account/me')).statusCode).toBe(200);
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

describe('Task 18 seams', () => {
  it('NEEDS_PLAN3_TASK42_MEMBER_KEY: members still never sign escrow until the per-member key scheme lands', () => {
    // R44 / spec 6.7 OPEN (design): releasing needs the trade's escrow key on the member's device;
    // today it lives only on the account owner's. Plan 3 Task 42 designs a per-member key scheme
    // (3.1: X2F holds at most one key per trade). Until then `MEMBER_SIGNING_EVENTS` refuses
    // release-started and trades/identity.ts refuses registering a trade identity (member-cannot-sign),
    // so a Trades member can take, mark paid and dispute but the escrow steps wait for the owner's
    // device. When Task 42's key scheme lands (apps/api/src/team/memberKeys.ts or a `member_id` on
    // trade_identities), lift these refusals there, with tests, and delete this check.
    expect([...MEMBER_SIGNING_EVENTS]).toEqual(['release-started']);
    expect(readFileSync(`${ROOT}apps/api/src/trades/identity.ts`, 'utf8')).toMatch(/member-cannot-sign/);
    const landed = existsSync(`${ROOT}apps/api/src/team/memberKeys.ts`) || /member_id/.test(
      readdirSync(`${ROOT}apps/api/migrations`).filter((f) => /identit/.test(f)).map((f) => readFileSync(`${ROOT}apps/api/migrations/${f}`, 'utf8')).join('\n'),
    );
    expect(landed, 'Plan 3 Task 42 member keys landed: lift member-cannot-sign where the scheme allows, then delete this check').toBe(false);
  });

  it('NEEDS_PLAN7_PURGE_AUDIT: any code that deletes trades also clears their codes from team_audit (R36)', () => {
    for (const f of [...sources(`${ROOT}apps/api/src`), ...sources(`${ROOT}apps/moderation/src`)]) {
      const s = readFileSync(f, 'utf8');
      if (/delete\s+from\s+trades\b/i.test(s)) expect(s, `${f} deletes trades: call forgetAuditTrade in the same transaction`).toMatch(/forgetAuditTrade\(/);
    }
  });

  it('NEEDS_TASKS_16_17_MEMBERS: device approval and the login-strength hold cover members once they land', () => {
    // Plan 2 Tasks 16 (new-device approval, 3-device limit; migration 013) and 17 (24-hour hold by
    // login strength; 014) are not on this tree. Member sessions are rows of the team account, so an
    // account-keyed hold or ban already covers them, but: Task 16 must count member sessions toward the
    // account's device limit and must never let a member session approve the owner's logins (approval
    // routes are owner-only by requireSession's fail-closed default: keep them without `member`), and
    // member logins (always two factors) are strong for Task 17. When either lands, add those tests here
    // and delete this check.
    const has = readdirSync(`${ROOT}apps/api/migrations`).some((f) => /^01[34]_/.test(f));
    expect(has, 'Task 16 or 17 landed: test that member sessions count toward the device limit and never approve').toBe(false);
  });
});
