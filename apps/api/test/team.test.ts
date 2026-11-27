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
import { ACTION_ABILITY, auditMember } from '../src/team/audit.js';
import { ABILITY_REQUIRES, HARD_OWNER_ONLY, legacyRoles, ROLE_ABILITIES, rolesToAbilities, sortAbilities } from '../src/team/abilities.js';
import { memberAccessOf } from '../src/auth/sessions.js';
import { openInvite, purgeTeamLeftovers } from '../src/team/members.js';
import { NOTES_PER_ACCOUNT } from '../src/team/notes.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { EVENT_ABILITY, eventAbility, MAX_TEAM_MEMBERS, MEMBER_CONFIRMED_EVENTS, MEMBER_SIGNING_EVENTS, OWNER_DEVICE_ROUTES } from '../src/team/perms.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { openEvents, until, type SseStream } from './helpers/sse.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { recordBannedValues } from '../src/bans.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { Browser, ORIGIN } from './helpers/totp.js';
import { publishRuling } from './helpers/disputes.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';
import { SIG } from './helpers/signature.js';
import { openTermsSignature } from '../src/termsSignature.js';
import { flexBody } from './helpers/offers.js';
import { newProofId } from '@x2f/proof';

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

/** A team account (a vendor with a usable wallet; owner 2 Nov 2026: teams are for vendors only). */
async function team(): Promise<Who & { wallet: string }> {
  const t = await trader();
  await makeVendor(deps, t.id);
  return { ...t, wallet: await addWallet(t.id) };
}

/**
 * A joined member of `teamId` with the boxes of the old `roles` (each role's ROLE_ABILITIES), or
 * the given `{ abilities }`, logged in (its login account is seeded directly; the real sign-up is
 * tested below).
 */
async function member(teamId: string, roles: Role[] | { abilities: string[] }): Promise<{ id: string; loginId: string; name: string; browser: Browser }> {
  const abilities = Array.isArray(roles) ? rolesToAbilities(roles) : roles.abilities;
  const name = `Member${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `mlogin${n}x`, tradeTag: `m-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const browser = new Browser(app);
  const res = await browser.post('/t/login', { accountId: loginId });
  expect(res.statusCode, res.body).toBe(200);
  return { id: rows[0]!.id, loginId, name, browser };
}

async function auditRows(teamId: string): Promise<{ action: string; member_id: string; trade_code: string | null }[]> {
  const { rows } = await deps.db.query<{ action: string; member_id: string; trade_code: string | null }>(
    "select action, member_id, trade_code from team_audit where account_id = $1 and category = 'work' order by id",
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

async function invite(owner: Who, tradeTag: string, roles: Role[]) {
  const action = { kind: 'team-invite' as const, name: tradeTag, roles: roles.join(',') };
  const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
  return owner.browser.post('/v1/team/invites', { tradeTag, roles, confirmToken });
}

const OFFER = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  // At most $5,000 (the launch cap, owner p11-6).
  minFiatCents: '1000', maxFiatCents: '500000', minTrades: null, terms: 'Zelle only.',
};

function takeBody(walletId: string, amountAtomic = XMR / 10n): Record<string, unknown> {
  return {
    amountAtomic: amountAtomic.toString(), walletId, centsPerXmr: '33000',
    fiatCents: fiatCents(amountAtomic, { currency: 'USD', centsPerXmr: 33_000n }).toString(), methodId: 'ZELLE', currency: 'USD',
  };
}

const err = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, error: (res.json() as { error?: string }).error });

describe('invites and the member limit', () => {
  it(`allows at most ${MAX_TEAM_MEMBERS} live members (open invites count); the next is too-many-members`, async () => {
    const owner = await team();
    for (let i = 0; i < MAX_TEAM_MEMBERS; i++) {
      const res = await invite(owner, `Sailor${n}${i}x`, ['offers']);
      expect(res.statusCode, res.body).toBe(201);
      expect((res.json() as { invite: string }).invite).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    const fourth = await invite(owner, `Sailor${n}9x`, ['trades']);
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
    const none = await owner.browser.post('/v1/team/invites', { tradeTag: `Plain${n}xx`, roles: ['offers'] });
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({ error: 'confirm-required', action: 'team-invite' });
    const action = { kind: 'team-invite' as const, name: `Plain${n}xy`, roles: 'offers' };
    const token = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const wrong = await owner.browser.post('/v1/team/invites', { tradeTag: `Plain${n}xy`, roles: ['offers', 'trades'], confirmToken: token });
    expect(err(wrong)).toEqual({ status: 403, error: 'confirm-invalid' });
    // Review M9(a): the token names the member too, so it cannot invite someone else with the same roles.
    const token2 = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const otherName = await owner.browser.post('/v1/team/invites', { tradeTag: `Mallory${n}x`, roles: ['offers'], confirmToken: token2 });
    expect(err(otherName)).toEqual({ status: 403, error: 'confirm-invalid' });
    const token3 = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    expect((await owner.browser.post('/v1/team/invites', { tradeTag: `Plain${n}xy`, roles: ['offers'], confirmToken: token3 })).statusCode).toBe(201);
  });
});

describe('the member sign-up (two factors, the staff rule)', () => {
  it('joins with a PGP key then a second PGP key, and the owner is told; the code is single-use', async () => {
    const owner = await team();
    const created = (await invite(owner, `Joiner${++n}x`, ['trades'])).json() as { id: string; invite: string };
    const b = new Browser(app);
    const view = await b.post('/v1/team/invite', { invite: created.invite });
    expect(view.statusCode, view.body).toBe(200);
    // Review 2026-11-08 F3: whoever holds the link, before joining, learns only what the invite
    // asks of them; the vendor is named only once they are inside.
    // Job 1c: the invite's boxes (and their preset) are what it asks of them too.
    expect(Object.keys(view.json() as object).sort()).toEqual(['abilities', 'expiresAt', 'preset', 'roles', 'tradeTag']);
    expect(view.json()).toMatchObject({ tradeTag: `Joiner${n}x`, roles: ['trades'] });
    expect(view.body).not.toContain(owner.tradeTag);
    // Review 6a5949a6 F6: the vendor's name is not even loaded, so no later spread can send it.
    const row = await openInvite(deps.db, { code: created.invite }, deps.clock());
    expect(Object.keys(row).sort()).toEqual(['abilities', 'account_id', 'id', 'invite_expires_at', 'trade_tag']);
    expect(Object.values(row)).not.toContain(owner.tradeTag);

    const k1 = await genKey();
    const k2 = await genKey();
    // Review 2026-11-08 F1: the member signs the Terms (the current version) before anything is made.
    for (const acceptedTerms of [undefined, '2020-01-01']) {
      const refused = await b.post('/v1/team/join/start', { invite: created.invite, loginName: `joinlogin${n}`, publicKey: k1.publicKey, acceptedTerms });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json()).toEqual({ error: 'terms-not-accepted', version: deps.config.termsVersion });
    }
    const s1 = await b.post('/v1/team/join/start', {
      invite: created.invite, loginName: `joinlogin${n}`, publicKey: k1.publicKey, acceptedTerms: deps.config.termsVersion,
    });
    expect(s1.statusCode, s1.body).toBe(200);
    const c1 = s1.json() as { challengeId: string; encryptedMessage: string };
    const code1 = codeOf(await decrypt(c1.encryptedMessage, k1.privateKey, undefined, deps.clock()));
    // Owner 9 Nov 2026 (p11-14): everyone who gets a login signs. The signature comes with the
    // finish and is checked before the code is used, so the same code still works after.
    for (const [termsSignature, error] of [[undefined, 'signature-required'], [{ kind: 'typed', name: '' }, 'signature-invalid']] as const) {
      const unsigned = await b.post('/v1/team/join/finish', { challengeId: c1.challengeId, code: code1, termsSignature });
      expect(unsigned.statusCode, unsigned.body).toBe(400);
      expect((unsigned.json() as { error: string }).error).toBe(error);
    }
    const f1 = await b.post('/v1/team/join/finish', { challengeId: c1.challengeId, code: code1, termsSignature: SIG });
    expect(f1.statusCode, f1.body).toBe(201);
    const { setupId, needs } = f1.json() as { setupId: string; needs: string[] };
    expect(needs).toEqual(['security-key', 'passkey', 'pgp']);
    // No session after one factor.
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
    // The code is used up, and a used invite never names the vendor to whoever holds the link
    // (front door, owner 8 Nov 2026; design board InviteInvalid).
    const used = await new Browser(app).post('/v1/team/invite', { invite: created.invite });
    expect(used.statusCode).toBe(404);
    expect(used.body).toBe('{"error":"not-found"}');
    expect(used.body).not.toContain(owner.tradeTag);

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
    const me = (await b.get('/v1/account/me')).json() as { tradeTag: string; member: unknown; termsCurrent: boolean };
    expect(me.tradeTag).toBe(owner.tradeTag);
    // Job 1c: the member's boxes (the old Trades role's), their preset (none: Custom) and the old roles they read as.
    // J-20 F8 (MEMBER_SEES_OWN_LIMITS, lead default on): and their own limits, none yet.
    expect(me.member).toEqual({
      name: `Joiner${n}x`, abilities: rolesToAbilities(['trades']), preset: null, roles: ['trades'],
      // S-105 (owner p11-25): how chats show them, the lead's name and their number; never their own name.
      chatLabel: `${owner.tradeTag} Assistant 1`,
      limits: { band: null, hours: 'any' },
    });
    // The member's own login account carries the Terms they signed, and they are inside.
    expect(me.termsCurrent).toBe(true);
    const signed = await deps.db.query<{ id: string; terms_version: string | null; terms_accepted_at: Date | null; terms_signature: Buffer | null }>(
      'select a.id, a.terms_version, a.terms_accepted_at, a.terms_signature from team_members tm join accounts a on a.id = tm.member_account_id where tm.id = $1',
      [created.id],
    );
    expect(signed.rows[0]!.terms_version).toBe(deps.config.termsVersion);
    expect(signed.rows[0]!.terms_accepted_at).not.toBeNull();
    // Sealed to the member's own login account, never the team account's.
    expect(openTermsSignature(deps.config, signed.rows[0]!.terms_signature!, signed.rows[0]!.id)).toEqual(SIG);
    expect(() => openTermsSignature(deps.config, signed.rows[0]!.terms_signature!, owner.id)).toThrow();
    expect((await b.get('/v1/news')).statusCode).toBe(200);
    const alerts = (await owner.browser.get('/v1/account/alerts')).json() as { kind: string }[];
    expect(alerts.map((a) => a.kind)).toContain('team-member-joined');
    // J-20 review F5 (p11-27): the join is the member's first login, and the lead gets one alert for it,
    // not joined + first login + login; the first login is recorded, so no later login re-announces it.
    expect(alerts.map((a) => a.kind).filter((k) => k.startsWith('team-member-'))).toEqual(['team-member-joined']);
    const fl = await deps.db.query<{ first_login_at: Date | null }>('select first_login_at from team_members where id = $1', [created.id]);
    expect(fl.rows[0]!.first_login_at).not.toBeNull();
    expect(((await owner.browser.get('/v1/team')).json() as { members: { status: string }[] }).members[0]!.status).toBe('active');
  });

  it('a banned key (lead review 2026-11-06 item 1): join start answers as for any key; finish reaches insertPgpKey and refuses 409 key-unavailable, nothing created', async () => {
    const owner = await team();
    const created = (await invite(owner, `Banjoin${++n}x`, ['trades'])).json() as { id: string; invite: string };
    const banned = await genKey();
    await recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [banned.fingerprint.toLowerCase()], accountId: null, now: deps.clock() });
    const b = new Browser(app);
    const s1 = await b.post('/v1/team/join/start', { invite: created.invite, loginName: `banjoin${n}`, publicKey: banned.publicKey, acceptedTerms: deps.config.termsVersion });
    expect(s1.statusCode, s1.body).toBe(200);
    const c1 = s1.json() as { challengeId: string; encryptedMessage: string };
    const f1 = await b.post('/v1/team/join/finish', { challengeId: c1.challengeId, code: codeOf(await decrypt(c1.encryptedMessage, banned.privateKey, undefined, deps.clock())), termsSignature: SIG });
    expect(err(f1)).toEqual({ status: 409, error: 'key-unavailable' });
    // The transaction rolled back: no member account, the key is nowhere, the invite is still open.
    expect((await deps.db.query('select 1 from pgp_keys where fingerprint = $1', [banned.fingerprint.toLowerCase()])).rowCount).toBe(0);
    expect((await deps.db.query('select member_account_id from team_members where id = $1', [created.id])).rows[0]).toEqual({ member_account_id: null });
    expect((await new Browser(app).post('/v1/team/invite', { invite: created.invite })).statusCode).toBe(200);

    // The second PGP factor goes through insertPgpKey as well.
    const k1 = await genKey();
    const s2 = await b.post('/v1/team/join/start', { invite: created.invite, loginName: `banjoin${n}`, publicKey: k1.publicKey, acceptedTerms: deps.config.termsVersion });
    const c2 = s2.json() as { challengeId: string; encryptedMessage: string };
    const f2 = await b.post('/v1/team/join/finish', { challengeId: c2.challengeId, code: codeOf(await decrypt(c2.encryptedMessage, k1.privateKey, undefined, deps.clock())), termsSignature: SIG });
    expect(f2.statusCode, f2.body).toBe(201);
    const { setupId } = f2.json() as { setupId: string };
    const s3 = await b.post('/v1/team/join/second/pgp/start', { setupId, publicKey: banned.publicKey });
    expect(s3.statusCode, s3.body).toBe(200);
    const c3 = s3.json() as { challengeId: string; encryptedMessage: string };
    const f3 = await b.post('/v1/team/join/second/pgp/finish', {
      setupId, challengeId: c3.challengeId, code: codeOf(await decrypt(c3.encryptedMessage, banned.privateKey, undefined, deps.clock())), deviceLabel: 'Test',
    });
    expect(err(f3)).toEqual({ status: 409, error: 'key-unavailable' });
    expect((await deps.db.query('select 1 from pgp_keys where fingerprint = $1', [banned.fingerprint.toLowerCase()])).rowCount).toBe(0);
  });

  it('there is no password login or password to add, for a member or anyone (owner 26 Nov 2026)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const res = await new Browser(app).post('/v1/login/password', { loginName: `mlogin${n}x`, password: 'correct horse battery staple', deviceLabel: 'x' });
    expect(res.statusCode).toBe(404);
    expect((await m.browser.put('/v1/account/password', { password: 'correct horse battery staple' })).statusCode).toBe(404);
  });
});

describe('roles', () => {
  it('an Offers-only member posts and turns off an offer, but take is forbidden', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, ['offers']);
    const posted = await m.browser.post('/v1/offers', flexBody(OFFER));
    expect(posted.statusCode, posted.body).toBe(201);
    const id = (posted.json() as { id: string }).id;
    const { rows } = await deps.db.query<{ account_id: string }>('select account_id from offers where id = $1', [id]);
    expect(rows[0]!.account_id).toBe(owner.id);
    expect((await m.browser.patch(`/v1/offers/${id}`, { status: 'paused' })).statusCode).toBe(200);
    const bulk = await m.browser.post('/v1/account/offers/status', { ids: [id], status: 'live' });
    expect(bulk.statusCode, bulk.body).toBe(200);
    const sellerOffer = (await seller.browser.post('/v1/offers', flexBody(OFFER))).json() as { id: string };
    expect(err(await m.browser.post(`/v1/offers/${sellerOffer.id}/take`, takeBody(owner.wallet)))).toEqual({ status: 403, error: 'forbidden' });
  });

  it('a Trades-only member marks paid on the owner\'s trade, but taking (I2) and posting are refused', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, ['trades']);
    expect(err(await m.browser.post('/v1/offers', flexBody(OFFER)))).toEqual({ status: 403, error: 'forbidden' });
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
    const offer = (await seller.browser.post('/v1/offers', flexBody(OFFER))).json() as { id: string };
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
    expect(err(await m.browser.post('/v1/offers', flexBody(OFFER)))).toEqual({ status: 403, error: 'forbidden' });
    const action = { kind: 'team-roles' as const, memberId: m.id, roles: 'offers,trades' };
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { roles: ['trades', 'offers'], confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { roles: string[] }).roles).toEqual(['offers', 'trades']);
    expect((await m.browser.post('/v1/offers', flexBody(OFFER))).statusCode).toBe(201);
  });
});

describe('owner-only', () => {
  it('a member adding a payout wallet, inviting, managing members, reading the audit log or changing security gets owner-only', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const refused = [
      await m.browser.post('/v1/wallets', { app: 'cake', label: 'Mine', address: fakeAddress() }),
      await m.browser.delete(`/v1/wallets/${owner.wallet}`),
      await m.browser.post('/v1/team/invites', { tradeTag: 'Sneaky01', roles: ['offers'] }),
      await m.browser.get('/v1/team'),
      await m.browser.patch(`/v1/team/members/${m.id}`, { roles: ['offers'] }),
      await m.browser.delete(`/v1/team/members/${m.id}`),
      await m.browser.get('/v1/team/audit'),
      await m.browser.get('/v1/account/sessions'),
      // Owner Q73: a member confirms with their own methods for "Stay logged in" only.
      await m.browser.post('/v1/confirm/pgp/start', { action: { kind: 'new-recovery-codes' } }),
      await m.browser.post('/v1/confirm/webauthn/start', { action: { kind: 'team-remove', memberId: m.id } }),
      await m.browser.post('/v1/account/login-name', { loginName: 'whatever1' }),
    ];
    for (const [i, r] of refused.entries()) expect(err(r), String(i)).toEqual({ status: 403, error: 'owner-only' });
    // Owner Q73 (6 Nov 2026): a member extends their own session, with a proof of their own.
    expect(err(await m.browser.post('/v1/account/session/extend', {}))).toEqual({ status: 403, error: 'confirm-required' });
    // Every member may read who they are (the overview of the account they work for).
    expect((await m.browser.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('a member without Release coins never releases (forbidden), and no member registers a trade identity (member-cannot-sign)', async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, ['trades']);
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'paid');
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'release-started' }))).toEqual({ status: 403, error: 'forbidden' });
    expect(err(await m.browser.post(`/v1/trades/${t.code}/identity`, {}))).toEqual({ status: 403, error: 'member-cannot-sign' });
  });

  it('owner question trades-release: a member with Release coins and Hold trade keys releases only with a key confirm for that trade, logged under their name', async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, { abilities: [...rolesToAbilities(['trades']), 'trades-release', 'trades-escrow-keys'] });
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    const paid = await driveTo(deps, t.trade, 'paid');
    const tokenFor = async (action: Parameters<typeof issueConfirmToken>[1]['action'], method: 'passkey' | 'recovery-code' = 'passkey') =>
      issueConfirmToken(deps, { sessionId: await sessionId(m.browser), accountId: owner.id, action, method });
    const send = (body: Record<string, unknown>) => m.browser.post(`/v1/trades/${t.code}/events`, { type: 'release-started', ...body });
    // No token: confirm-required for release-trade. A token for another trade or action: confirm-invalid.
    expect(err(await send({}))).toEqual({ status: 403, error: 'confirm-required' });
    expect(err(await send({ confirmToken: await tokenFor({ kind: 'release-trade', tradeCode: 'OTHERCODE' }) }))).toEqual({ status: 403, error: 'confirm-invalid' });
    expect(err(await send({ confirmToken: await tokenFor({ kind: 'extend-session' }) }))).toEqual({ status: 403, error: 'confirm-invalid' });
    // Only a passkey, security key or PGP key counts (no authenticator code ever issues a token; a recovery-code one is refused too).
    expect(err(await send({ confirmToken: await tokenFor({ kind: 'release-trade', tradeCode: t.code }, 'recovery-code') }))).toEqual({ status: 403, error: 'method-not-allowed' });
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
    expect(await auditRows(owner.id)).toEqual([]);
    const ok = await send({ confirmToken: await tokenFor({ kind: 'release-trade', tradeCode: t.code }) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await auditRows(owner.id)).toEqual([{ action: 'release-started', member_id: m.id, trade_code: t.code }]);
    // The holder sees it in the trade's team activity, with the member's name and the amount.
    const list = (await owner.browser.get(`/v1/team/audit?trade=${t.code}`)).json() as { action: string; memberName: string | null; byLead: boolean; detail: Record<string, unknown> }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: 'release-started', memberName: m.name, byLead: false, tradeCode: t.code });
    expect(list[0]!.detail).toMatchObject({ amountAtomic: paid.amountAtomic.toString(), confirmedWith: 'passkey' });
    expect((await owner.browser.get('/v1/team/audit?trade=nope!')).statusCode).toBe(400);
    // Funding is its own box (owner 26 Nov 2026): Release coins does not open it.
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'fund-started' }))).toEqual({ status: 403, error: 'forbidden' });
  });

  it('owner 26 Nov 2026 18:41 UTC: a member with Fund the escrow and Hold trade keys funds the lead\'s sell trade only with a fund-trade key confirm for that trade, logged under their name', async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, { abilities: ['trades-see-active', 'trades-fund', 'trades-escrow-keys'] });
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'funding');
    const tokenFor = async (action: Parameters<typeof issueConfirmToken>[1]['action'], method: 'passkey' | 'pgp' | 'recovery-code' = 'pgp') =>
      issueConfirmToken(deps, { sessionId: await sessionId(m.browser), accountId: owner.id, action, method });
    const send = (body: Record<string, unknown>) => m.browser.post(`/v1/trades/${t.code}/events`, { type: 'fund-started', ...body });
    const noToken = await send({});
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json()).toMatchObject({ error: 'confirm-required', action: 'fund-trade' });
    // A release token, a token for another trade, or one earned with a recovery code: never.
    expect(err(await send({ confirmToken: await tokenFor({ kind: 'release-trade', tradeCode: t.code }) }))).toEqual({ status: 403, error: 'confirm-invalid' });
    expect(err(await send({ confirmToken: await tokenFor({ kind: 'fund-trade', tradeCode: 'OTHERCODE' }) }))).toEqual({ status: 403, error: 'confirm-invalid' });
    expect(err(await send({ confirmToken: await tokenFor({ kind: 'fund-trade', tradeCode: t.code }, 'recovery-code') }))).toEqual({ status: 403, error: 'method-not-allowed' });
    expect((await loadTrade(deps.db, t.code))!.fundStartedAt).toBeNull();
    expect(await auditRows(owner.id)).toEqual([]);
    const ok = await send({ confirmToken: await tokenFor({ kind: 'fund-trade', tradeCode: t.code }) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await loadTrade(deps.db, t.code))!.fundStartedAt).not.toBeNull();
    expect(await auditRows(owner.id)).toEqual([{ action: 'fund-started', member_id: m.id, trade_code: t.code }]);
    const list = (await owner.browser.get(`/v1/team/audit?trade=${t.code}`)).json() as { action: string; memberName: string | null; actorKind: string; detail: Record<string, unknown> }[];
    expect(list[0]).toMatchObject({ action: 'fund-started', memberName: m.name, actorKind: 'member' });
    expect(list[0]!.detail).toMatchObject({ confirmedWith: 'pgp' });
    // Fund the escrow opens no release, and the trade's take, accept and identity stay the owner's device's.
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'release-started' }))).toEqual({ status: 403, error: 'forbidden' });
    for (const path of ['identity', 'wallet']) expect((await m.browser.post(`/v1/trades/${t.code}/${path}`, {})).statusCode, path).toBe(403);
  });

  it('owner 26 Nov 2026: without Fund the escrow a member never funds (forbidden, even with Hold trade keys); Fund the escrow without Hold trade keys is refused by the API and the database', async () => {
    const owner = await team();
    const buyer = await team();
    const keysOnly = await member(owner.id, { abilities: ['trades-see-active', 'trades-escrow-keys'] });
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'funding');
    expect(err(await keysOnly.browser.post(`/v1/trades/${t.code}/events`, { type: 'fund-started' }))).toEqual({ status: 403, error: 'forbidden' });
    const m = await member(owner.id, ['trades']);
    const bad = sortAbilities([...rolesToAbilities(['trades']), 'trades-fund']);
    const confirmToken = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: bad.join(',') } as never);
    expect(err(await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities: bad, confirmToken }))).toEqual({ status: 400, error: 'fund-needs-trade-keys' });
    await expect(deps.db.query('update team_members set abilities = $2 where id = $1', [m.id, bad])).rejects.toThrow();
    // Unticking Hold trade keys while Fund the escrow stays ticked is refused the same way.
    const good = sortAbilities([...bad, 'trades-escrow-keys']);
    const t2 = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: good.join(',') } as never);
    expect((await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities: good, confirmToken: t2 })).statusCode).toBe(200);
    expect((await loadTrade(deps.db, t.code))!.fundStartedAt).toBeNull();
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it('owner question trades-release: Release coins without Hold trade keys is refused by the API and the database, and never met', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    const bad = sortAbilities([...rolesToAbilities(['trades']), 'trades-release']);
    const confirmToken = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: bad.join(',') } as never);
    expect(err(await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities: bad, confirmToken }))).toEqual({ status: 400, error: 'release-needs-trade-keys' });
    await expect(deps.db.query('update team_members set abilities = $2 where id = $1', [m.id, bad])).rejects.toThrow();
    const good = sortAbilities([...bad, 'trades-escrow-keys']);
    const t2 = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: good.join(',') } as never);
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities: good, confirmToken: t2 });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('the audit log', () => {
  it('each effectful member action writes exactly one row, a read writes none, the owner writes none', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const posted = (await m.browser.post('/v1/offers', flexBody(OFFER))).json() as { id: string };
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
    // Review 2026-11-09 M2 (the owner's "name and amount"): every offer row carries what the offer was,
    // in J-16's shape (migration 490): its side and unit, each currency with its bands (ranges in the
    // unit's minor units, margins, trade rule, method restriction) and each method with its
    // adjustment and the currencies it is offered in. Never its payment instructions.
    const terms = {
      offerId: posted.id, side: 'sell', amountUnit: 'fiat', priceMode: 'market',
      currencies: [{ currency: 'USD', bands: [{ min: '1000', max: '500000', marginBps: 0, minTrades: null, methodIds: null }] }],
      methods: [{ methodId: 'ZELLE', adjustBps: 0, currencies: ['USD'] }],
    };
    const offerRows = await deps.db.query<{ detail: unknown }>("select detail from team_audit where account_id = $1 and category = 'work' order by id", [owner.id]);
    expect(offerRows.rows.map((r) => r.detail)).toEqual([terms, terms, terms]);

    const other = await team();
    const t = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, t.trade, 'secured');
    await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
    const rows = await auditRows(owner.id);
    expect(rows.at(-1)).toMatchObject({ action: 'mark-paid', trade_code: t.code });

    const list = await owner.browser.get(`/v1/team/audit?member=${m.id}`);
    expect(list.statusCode).toBe(200);
    // Team audit v2: the member's filter also finds the team's changes about them (their invite, join, login).
    const entries = (list.json() as { action: string; memberName: string; category: string }[]).filter((e) => e.category === 'work');
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
    expect((await deps.db.query('update team_audit set trade_code = null where account_id = $1 and trade_code is not null', [owner.id])).rowCount).toBe(1);
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
    const { rows } = await deps.db.query<{ trade_tag: string; member_account_id: string | null; removed_at: Date | null }>(
      'select trade_tag, member_account_id, removed_at from team_members where id = $1', [m.id],
    );
    expect(rows[0]).toMatchObject({ trade_tag: m.name, member_account_id: null });
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
      const offer = (await owner.browser.post('/v1/offers', flexBody(OFFER))).json() as { id: string };
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
    const res = await racing(m.id, () => m.browser.post('/v1/offers', flexBody(OFFER)), 'update team_members set removed_at = now() where id = $1');
    expect(err(res)).toEqual({ status: 401, error: 'not-authenticated' });
    expect((await deps.db.query('select 1 from offers where account_id = $1', [owner.id])).rowCount).toBe(0);
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it('a role drop that commits after the gate refuses the action and rolls it back (review M1)', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const res = await racing(m.id, () => m.browser.post('/v1/offers', flexBody(OFFER)), `update team_members set abilities = '{${ROLE_ABILITIES.trades.join(',')}}' where id = $1`);
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
    const res = await racing(m.id, () => m.browser.get(`/v1/trades/${code}/confirmations`), `update team_members set abilities = '{${ROLE_ABILITIES.offers.join(',')}}' where id = $1`);
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

  it('every trade event a member may send has an audit action and its box, the same the route checks (a new client event fails here)', () => {
    const sendable = CLIENT_EVENTS.filter((e) => !MEMBER_SIGNING_EVENTS.has(e) && e !== 'open-dispute');
    for (const e of sendable) {
      expect(ACTION_ABILITY[e as keyof typeof ACTION_ABILITY], e).toMatch(/^trades-/);
      expect(EVENT_ABILITY[e as keyof typeof EVENT_ABILITY], e).toBe(ACTION_ABILITY[e as keyof typeof ACTION_ABILITY]);
    }
    // Owner question trades-release: release is a member's event now, behind Release coins (and Hold
    // trade keys, ABILITY_REQUIRES) and a key confirm.
    expect(sendable).toContain('release-started');
    expect(EVENT_ABILITY['release-started']).toBe('trades-release');
    expect(HARD_OWNER_ONLY.has('trades-release')).toBe(false);
    // Owner 26 Nov 2026 18:41 UTC: funding too, behind Fund the escrow (and Hold trade keys) and its own key confirm.
    expect(sendable).toContain('fund-started');
    expect(EVENT_ABILITY['fund-started']).toBe('trades-fund');
    expect([...MEMBER_CONFIRMED_EVENTS]).toEqual([['release-started', 'release-trade'], ['fund-started', 'fund-trade']]);
    // Review 2026-11-09 m2: an event with no box is a 400, never a 500.
    expect(() => eventAbility('a-future-event')).toThrow(expect.objectContaining({ status: 400, code: 'event-not-allowed' }));
    expect(eventAbility('mark-paid')).toBe('trades-mark-paid');
  });

  it('review 2026-11-09 m1: a trade event also needs a box that reads the trade', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, { abilities: ['trades-mark-paid'] });
    const t = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, t.trade, 'secured');
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() }))).toEqual({ status: 403, error: 'forbidden' });
    expect(await auditRows(owner.id)).toEqual([]);
    const m2 = await member(owner.id, { abilities: ['trades-see-active', 'trades-mark-paid'] });
    const ok = await m2.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('auditMember checks every action against the box it needs', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    const actor = { accountId: owner.id, memberId: m.id };
    await expect(auditMember(deps.db, actor, { action: 'offer-posted' }, deps.clock())).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await auditMember(deps.db, actor, { action: 'mark-paid', tradeCode: null }, deps.clock());
    expect(Object.entries(ACTION_ABILITY).filter(([a]) => a.startsWith('offer-')).every(([, r]) => r.startsWith('offers-'))).toBe(true);
    // Another team's account id with this member: refused as gone.
    await expect(auditMember(deps.db, { accountId: (await team()).id, memberId: m.id }, { action: 'mark-paid' }, deps.clock())).rejects.toMatchObject({ status: 401, code: 'not-authenticated' });
  });
});

describe('the audit log covers every member action (review M3)', () => {
  it('trade-taken and trade-wallet-set are refused before anything is written (I2); opening a dispute is the lead\'s (D-066); appeal writes one row', async () => {
    const owner = await team();
    const other = await team();
    const m = await member(owner.id, ['trades']);
    // The owner posts a buy offer and another trader takes it: the owner (poster, buyer) must set the payout wallet.
    const buyOffer = (await owner.browser.post('/v1/offers', flexBody({ ...OFFER, side: 'buy' }))).json() as { id: string };
    const taken = await other.browser.post(`/v1/offers/${buyOffer.id}/take`, takeBody(other.wallet));
    expect(taken.statusCode, taken.body).toBe(200);
    const takenCode = (taken.json() as { code: string }).code;
    expect(err(await m.browser.post(`/v1/trades/${takenCode}/wallet`, { walletId: owner.wallet }))).toEqual({ status: 403, error: 'member-cannot-sign' });
    const offer = (await other.browser.post('/v1/offers', flexBody(OFFER))).json() as { id: string };
    expect(err(await m.browser.post(`/v1/offers/${offer.id}/take`, takeBody(owner.wallet)))).toEqual({ status: 403, error: 'member-cannot-sign' });
    expect(await auditRows(owner.id)).toEqual([]);

    // A dispute on a paid trade once the seller's confirm window is over (the owner is the buyer;
    // never before "I've paid", design proto review P1), then an appeal of its ruling.
    const d = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    // The confirm window (120 min) outlives the unchosen 2-hour session (batch 2): the member and the lead take 6 hours (a vendor's choice) at login.
    expect((await m.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    expect((await owner.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    const dp = await driveTo(deps, d.trade, 'paid');
    setNow(dp.confirmBy!);
    // The confirm window (2 hours) outlasts the member's session: log in again at its end.
    expect((await m.browser.post('/t/login', { accountId: m.loginId })).statusCode).toBe(200);
    // Owner D-066 (p7-7): only trade parties open disputes; the member is refused and the lead opens it.
    expect(err(await m.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'a private note' }))).toEqual({ status: 403, error: 'owner-only' });
    const opened = await owner.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'a private note' });
    expect(opened.statusCode, opened.body).toBe(200);
    // A moderator's round-1 ruling, through the dispute machine (Plan 4 Task 12 is not built yet).
    await publishRuling(deps, d.code, { outcome: 'release-to-buyer' });
    const appealed = await m.browser.post(`/v1/trades/${d.code}/appeal`, { why: 'The moderator missed my bank statement.' });
    expect(appealed.statusCode, appealed.body).toBe(200);

    const rows = await auditRows(owner.id);
    expect(rows.map((r) => [r.action, r.trade_code])).toEqual([
      ['appeal-filed', d.code],
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
      'PUT /v1/account/session/length': "the member's own session length after their own login (owner, 2 Nov 2026): not an account action",
      // Owner Q73 (6 Nov 2026): a member extends their own session with their own login methods.
      'POST /v1/account/session/extend': "the member's own session, re-proved with their own login method: not an account action",
      'POST /v1/confirm/pgp/start': "a confirm challenge to the member's own keys, extend-session, release-trade and fund-trade only (confirmerOf): writes a challenge row, not an account action",
      'POST /v1/confirm/pgp/finish': 'a confirm token for the calling session, extend-session, release-trade and fund-trade only: not an account action',
      'POST /v1/confirm/webauthn/start': "a confirm challenge for the member's own credentials, extend-session, release-trade and fund-trade only: not an account action",
      'POST /v1/confirm/webauthn/finish': 'a confirm token for the calling session, extend-session, release-trade and fund-trade only: not an account action',
      // Owner Q75: the member's own idle reminder, on their own login account.
      'PUT /v1/account/idle-reminder': "the member's own reminder preference on their own login: not an account action",
      'POST /v1/account/terms': "the member's own agreement to the Terms, written to their own login account (review 2026-11-08 F1); it changes nothing of the team account",
      // Review PC1 (P-012/P-013): the blur check is anonymous by design ("never the trade, the proof
      // id or who answered"), so a team-audit row naming the member and the trade would undo that.
      'POST /v1/trades/:code/blur-checks/:proofId': 'the blur-check answer is anonymous by design (P-012): a row would tie the member and the trade to the answer',
      'POST /v1/trades/:code/proofs/:proofId/blur-check': 'only counts a proof for the blur-check sample (P-013): the proof itself is the chat upload; a row would tie the member to the ask',
      // S-085: renewing the calling session's short-lived bound cookie with its own device key.
      'POST /v1/account/session/proof/challenge': "a single-use challenge for the member's own bound session: writes the session row only, not an account action",
      'POST /v1/account/session/proof': "renews the member's own bound-session cookie with their own device key: not an account action",
      // Escrow-key sync (migration 864): the lead's tick of "Hold trade keys" is the audited team change.
      'PUT /v1/escrow-keys/reader': "the member's own reader public key and unlock envelopes (ciphertext the API cannot open): opens nothing by itself and changes nothing of the team account",
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
        // The transformed handler calls an import as `(0, mod.auditMember)(` (PUT .../proofs/:id, registered on a scope).
        expect(String(r.handler), `${route} lets members through and writes no audit row: call auditMember in its transaction, or record why not in EXEMPT`).toMatch(/auditMember\)?\(/);
      }
    }
    // The hook sees every route the source scan does (so the guard tag and the hook both work).
    for (const r of found) expect([...live], r).toContain(r);
    // The scan sees the routes it must (so a refactor that hides them fails here, not silently).
    for (const r of ['POST /v1/offers', 'PATCH /v1/offers/:id', 'POST /v1/account/offers/status', 'POST /v1/offers/:id/take', 'POST /v1/trades/:code/wallet',
      'POST /v1/trades/:code/events', 'POST /v1/trades/:code/appeal', ...Object.keys(EXEMPT)]) {
      expect(found, r).toContain(r);
    }
    // D-066: opening a dispute lets no member through (the scan and the hook agree).
    expect(found).not.toContain('POST /v1/trades/:code/dispute');
    expect([...live]).not.toContain('POST /v1/trades/:code/dispute');
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
    const stale = await seedAccount(deps, { loginName: `stalelogin${++n}`, tradeTag: `m-${n}-stale`, kind: 'member' });
    const past = new Date(deps.clock().getTime() - DAY);
    await deps.db.query(
      `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, created_at)
       values ($1, $2, $3, '{trades-see-active}', $4, $5, $4)`,
      [owner.id, `Stale${n}xx`, `stale${n}xx`, past, stale],
    );
    // A member login whose team row is gone (as after the team account is deleted).
    const orphan = await seedAccount(deps, { loginName: `orphanlogin${++n}`, tradeTag: `m-${n}-orphan`, kind: 'member' });
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

describe('Task 18 seams', () => {
  it('Task 42 escrow-key sync (migration 864): an assigned member may hold an encrypted copy of the trade keys, and signs only a release or a funding, with Release coins or Fund the escrow (owner 26 Nov 2026)', () => {
    // The tripwire NEEDS_PLAN3_TASK42_MEMBER_KEY is retired by the escrow-key sync (owner 26 Nov
    // 2026: "accessible only to the person they are assigned to and the person who they are assigned
    // to also assigns them to"): apps/api/src/escrowSync/routes.ts, tested in escrowSync.test.ts.
    // The lead assigns a member by ticking "Hold trade keys" (trades-escrow-keys, row 67), and the
    // lead's device then seals each trade's keys to that member's own reader key as well.
    // Owner question trades-release (26 Nov 2026, pending his final yes; migration 870): a member
    // the lead gives "Release coins" (which needs Hold trade keys) may release, with a key confirm
    // per trade (the release tests above), and so may one given "Fund the escrow" (owner 26 Nov 18:41 UTC).
    // Everything else stays: `ownerDeviceOnly` refuses the take, the poster's wallet and the trade
    // identity (member-cannot-sign). To back out, put release-started back in MEMBER_SIGNING_EVENTS
    // and row 22 back to hard owner-only, and restore this check.
    // Owner 26 Nov 2026 18:41 UTC: funding left the list too (Fund the escrow, with Hold trade keys and a fund-trade key confirm).
    expect([...MEMBER_SIGNING_EVENTS]).toEqual([]);
    expect(ABILITY_REQUIRES['trades-fund']).toEqual(['trades-escrow-keys']);
    expect([...OWNER_DEVICE_ROUTES]).toEqual(['POST /v1/offers/:id/take', 'POST /v1/trades/:code/wallet', 'POST /v1/trades/:code/identity']);
    expect(readFileSync(`${ROOT}apps/api/src/trades/identity.ts`, 'utf8')).toMatch(/requireSigner = \[requireSession\(\{[^}]*\}\), ownerDeviceOnly\]/);
    expect(readFileSync(`${ROOT}apps/api/src/trades/take.ts`, 'utf8')).toMatch(/requireTrader = \[requireSession\(\{[^}]*\}\), ownerDeviceOnly\]/);
    expect(HARD_OWNER_ONLY.has('trades-release')).toBe(false);
    expect(ABILITY_REQUIRES['trades-release']).toEqual(['trades-escrow-keys']);
    expect(HARD_OWNER_ONLY.has('trades-escrow-keys')).toBe(false);
    expect(existsSync(`${ROOT}apps/api/src/escrowSync/routes.ts`)).toBe(true);
    // No member trade identity yet: the escrow party is still only ever the owner's device.
    expect(/member_id/.test(
      readdirSync(`${ROOT}apps/api/migrations`).filter((f) => /identit/.test(f)).map((f) => readFileSync(`${ROOT}apps/api/migrations/${f}`, 'utf8')).join('\n'),
    )).toBe(false);
  });

  it('NEEDS_PLAN7_PURGE_AUDIT: the team log stays owner-only data until Plan 7 decides its retention and roles', () => {
    // R36 is the database's job now (migration 199: deleting a trade clears its code from
    // team_audit, tested above), so a purge cannot forget it. Still open for Plan 7 (review M4):
    // (1) the API's database user owns team_audit, so its append-only triggers stop code bugs, not
    // a compromised API role (that needs a separate schema-owner role); (2) deleting an account
    // (Plan 7) deletes its team log by cascade: decide the log's retention then; (3) a removed
    // member's login is deleted at removal (review M6) and purgeTeamLeftovers clears the rest.
    // Plan 7's whole-trade purge (701, wip/lead-retention) landed and deletes trades as x2f_purge, so
    // 199's trigger now runs on every purged trade (tradePurge.test.ts). Points (1) and (2) are still
    // open and belong to Plan 7 Task 18 (Delete my account): revisit them when it lands.
    expect(readFileSync(`${ROOT}apps/api/migrations/199_team_audit_trades.sql`, 'utf8')).toMatch(/after delete on trades/);
    expect(existsSync(`${ROOT}apps/api/src/account/delete.ts`), 'Plan 7 Task 18 landed: decide the team log retention and roles').toBe(false);
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
    // A dispute opens on a paid trade once the seller's confirm window is over (batch 2/3 rules); the
    // window outlives the unchosen 2-hour session, so both logins take 6 hours.
    for (const b of [m.browser, owner.browser]) expect((await b.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    const dp = await driveTo(deps, d.trade, 'paid');
    setNow(dp.confirmBy!);
    expect(err(await m.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' }))).toEqual({ status: 403, error: 'owner-only' });
    expect((await deps.db.query('select 1 from disputes where code = $1', [d.code])).rowCount).toBe(0);
    expect(await auditRows(owner.id)).toEqual([]);
    const opened = await owner.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' });
    expect(opened.statusCode, opened.body).toBe(200);
    // The disputes box: the member sees the whole dispute.
    const seen = await m.browser.get(`/v1/trades/${d.code}/dispute`);
    expect(seen.statusCode, seen.body).toBe(200);
  });

  it('p10-2 (T-076): with every preset box ticked a member still never releases, funds or confirms payment on the lead\'s sell trade (Release coins is in no preset)', async () => {
    const owner = await team();
    const buyer = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const t = await seedTrade(deps, { sellerId: owner.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'paid');
    // Owner question trades-release: releasing needs the Release coins box, which no role or preset ticks.
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'release-started' }))).toEqual({ status: 403, error: 'forbidden' });
    // Owner 26 Nov 2026: funding needs the Fund the escrow box, which no role or preset ticks either.
    expect(err(await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'fund-started' }))).toEqual({ status: 403, error: 'forbidden' });
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it('no box can be stored that grants a hard owner-only ability: the API refuses it and so does the database', async () => {
    const owner = await team();
    const m = await member(owner.id, ['trades']);
    for (const bad of ['trades-confirm-received', 'disputes-open', 'wallets-manage', 'team-invite', 'team-remove', 'team-change-abilities', 'account-security', 'sessions-end-others', 'devices-approve', 'account-delete']) {
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
    expect((await m.browser.post('/v1/offers', flexBody(OFFER))).statusCode).toBe(201);
    expect(err(await m.browser.get('/v1/wallets'))).toEqual({ status: 403, error: 'forbidden' });
  });

  it('payout wallets, members, the team log and security settings stay owner-only for a member with every box', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers', 'trades']);
    const refused = [
      await m.browser.post('/v1/wallets', { app: 'cake', label: 'Mine', address: fakeAddress() }),
      await m.browser.delete(`/v1/wallets/${owner.wallet}`),
      await m.browser.post('/v1/team/invites', { tradeTag: 'Sneaky02', abilities: ['offers-see'] }),
      await m.browser.patch(`/v1/team/members/${m.id}`, { abilities: ['offers-see'] }),
      await m.browser.delete(`/v1/team/members/${m.id}`),
      // (The logout timer of this test's base is retired on hold v3: migration 307.)
      await m.browser.put('/v1/account/security/one-device', { on: true }),
      await m.browser.get('/v1/account/sessions'),
    ];
    for (const [i, r] of refused.entries()) expect(err(r), String(i)).toEqual({ status: 403, error: 'owner-only' });
  });

  it('a member, even one who sees the wallet list, cannot rename a payout wallet (owner-only; owner demo note #226, security review)', async () => {
    const owner = await team();
    for (const m of [await member(owner.id, ['offers', 'trades']), await member(owner.id, { abilities: ['wallets-see'] })]) {
      expect(err(await m.browser.put(`/v1/wallets/${owner.wallet}/label`, { label: 'Savings' }))).toEqual({ status: 403, error: 'owner-only' });
    }
    const { rows } = await deps.db.query<{ label: string }>('select label from wallets where id = $1', [owner.wallet]);
    expect(rows[0]!.label).not.toBe('Savings');
  });

  it('a member, even one who sees the wallet list, cannot choose the default payout wallet (owner-only; review 17 Nov M2)', async () => {
    const owner = await team();
    for (const m of [await member(owner.id, ['offers', 'trades']), await member(owner.id, { abilities: ['wallets-see'] })]) {
      expect(err(await m.browser.put(`/v1/wallets/${owner.wallet}/default`, {}))).toEqual({ status: 403, error: 'owner-only' });
    }
    const { rows } = await deps.db.query('select is_default from wallets where id = $1', [owner.wallet]);
    expect(rows).toEqual([{ is_default: false }]);
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
  it('every member-allowed route names only boxes from the catalogue, never a hard owner-only one', async () => {
    const { GRANTABLE } = await import('../src/team/abilities.js');
    const named = new Map<string, string[]>();
    for (const r of registered) {
      for (const h of [r.onRequest, r.preParsing, r.preValidation, r.preHandler].flat().filter(Boolean)) {
        const need = memberAccessOf(h);
        if (need === undefined || need === 'any') continue;
        named.set(`${[r.method].flat().join(',')} ${r.url}`, typeof need === 'string' ? [need] : [...need]);
      }
    }
    expect(named.size).toBeGreaterThan(10);
    for (const [route, needs] of named) {
      for (const id of needs) {
        expect(GRANTABLE.has(id), `${route} names ${id}, not a box`).toBe(true);
        expect(HARD_OWNER_ONLY.has(id), `${route} names ${id}, an owner-only rule`).toBe(false);
      }
    }
  });

  it('migration 360 moved the old roles to exactly ROLE_ABILITIES and refuses exactly HARD_OWNER_ONLY', () => {
    const sql = readFileSync(`${ROOT}apps/api/migrations/360_team_abilities.sql`, 'utf8');
    const lists = [...sql.matchAll(/'\{([a-z,-]+)\}'::text\[\]/g)].map((m) => m[1]!.split(','));
    expect(lists[0]).toEqual([...ROLE_ABILITIES.offers]);
    expect(lists[1]).toEqual([...ROLE_ABILITIES.trades]);
    // lists[2..4] were hold v3's three member rights (migration 016); migration 862 removed them.
    // Release coins was a hard rule then; migration 870 lifted it (owner question trades-release).
    expect(new Set(lists[5])).toEqual(new Set([...HARD_OWNER_ONLY, 'trades-release']));
  });

  it('migration 870 refuses exactly HARD_OWNER_ONLY, and Release coins only together with Hold trade keys', () => {
    const sql = readFileSync(`${ROOT}apps/api/migrations/870_trades_release.sql`, 'utf8').replace(/^--.*$/gm, '');
    const lists = [...sql.matchAll(/'\{([a-z,-]+)\}'::text\[\]/g)].map((m) => m[1]!.split(','));
    expect(lists).toHaveLength(1);
    expect(new Set(lists[0])).toEqual(HARD_OWNER_ONLY);
    expect(sql).toMatch(/not \('trades-release' = any \(abilities\)\) or 'trades-escrow-keys' = any \(abilities\)/);
    expect(sql).toMatch(/not \('trades-fund' = any \(abilities\)\) or 'trades-escrow-keys' = any \(abilities\)/);
  });

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
    expect(all).toHaveLength(65);
    // Owner 26 Nov 2026 18:41 UTC: funding and the buyer's payment proof are boxes too, in no preset.
    expect(all.find((a) => a.id === 'trades-fund')).toMatchObject({ availability: 'grantable', presets: [] });
    expect(all.find((a) => a.id === 'trades-upload-proof')).toMatchObject({ no: 68, availability: 'grantable', presets: [] });
    // Owner question trades-release: a box now, in no preset (off for every member by default).
    expect(all.find((a) => a.id === 'trades-release')).toMatchObject({ availability: 'grantable', presets: [] });
    expect(all.find((a) => a.id === 'trades-confirm-received')).toMatchObject({ availability: 'owner-only', presets: [] });
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
    const subjectName = ((await subject.browser.get('/v1/account/me')).json() as { tradeTag: string }).tradeTag;
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
    // Another account never sees them, and nobody notes their own account.
    const third = await team();
    const theirs = await third.browser.get(`/v1/account/notes/${subjectName}`);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json()).toEqual([]);
    expect(err(await subject.browser.post('/v1/account/notes', { about: subjectName, text: 'me' }))).toEqual({ status: 400, error: 'bad-request' });
  });

  it('review 2026-11-09 m4: an account holds at most NOTES_PER_ACCOUNT notes, the lead\'s and members\' together', async () => {
    const owner = await team();
    const subject = await team();
    const subjectName = ((await subject.browser.get('/v1/account/me')).json() as { tradeTag: string }).tradeTag;
    await deps.db.query(
      `insert into trader_notes (account_id, about_account_id, text, created_at) select $1, $2, 'n' || g, $3 from generate_series(1, $4::int) g`,
      [owner.id, subject.id, deps.clock(), NOTES_PER_ACCOUNT - 1],
    );
    expect((await owner.browser.post('/v1/account/notes', { about: subjectName, text: 'The last one.' })).statusCode).toBe(201);
    const full = await owner.browser.post('/v1/account/notes', { about: subjectName, text: 'One more.' });
    expect([full.statusCode, full.json()]).toEqual([409, { error: 'too-many-notes', max: NOTES_PER_ACCOUNT }]);
    const m = await member(owner.id, { abilities: ['notes-add'] });
    expect(err(await m.browser.post('/v1/account/notes', { about: subjectName, text: 'Mine.' }))).toEqual({ status: 409, error: 'too-many-notes' });
    expect(await auditRows(owner.id)).toEqual([]);
  });

  it('S-093 review m1: a note refuses control and format characters and the line and paragraph separators; a new line is allowed', async () => {
    const owner = await team();
    const subject = await team();
    const subjectName = ((await subject.browser.get('/v1/account/me')).json() as { tradeTag: string }).tradeTag;
    for (const bad of ['a\u2028b', 'a\u2029b', 'a\u202eb', 'a\u200bb', 'a\u0085b', 'a\tb']) {
      expect(err(await owner.browser.post('/v1/account/notes', { about: subjectName, text: bad })), JSON.stringify(bad)).toEqual({ status: 400, error: 'bad-request' });
    }
    expect((await owner.browser.post('/v1/account/notes', { about: subjectName, text: 'one\ntwo' })).statusCode).toBe(201);
  });
});

describe('invites carry their boxes at once (owner 26 Nov 2026: no holds)', () => {
  const boxesOf = async (memberId: string) =>
    (await deps.db.query<{ abilities: string[] }>('select abilities from team_members where id = $1', [memberId])).rows[0]!.abilities;
  const unspent = async (token: string) =>
    (await deps.db.query('select 1 from confirm_tokens where token_hash = sha256(convert_to($1, \'utf8\')) and used_at is null', [token])).rowCount;

  /** The member's real sign-up with an invite code (a PGP key, then a second PGP key); their browser, logged in. */
  async function join(code: string): Promise<Browser> {
    const b = new Browser(app);
    const k1 = await genKey();
    const k2 = await genKey();
    const s1 = await b.post('/v1/team/join/start', { invite: code, loginName: `s104login${++n}`, publicKey: k1.publicKey, acceptedTerms: deps.config.termsVersion });
    expect(s1.statusCode, s1.body).toBe(200);
    const c1 = s1.json() as { challengeId: string; encryptedMessage: string };
    const f1 = await b.post('/v1/team/join/finish', { challengeId: c1.challengeId, code: codeOf(await decrypt(c1.encryptedMessage, k1.privateKey, undefined, deps.clock())), termsSignature: SIG });
    expect(f1.statusCode, f1.body).toBe(201);
    const { setupId } = f1.json() as { setupId: string };
    const s2 = await b.post('/v1/team/join/second/pgp/start', { setupId, publicKey: k2.publicKey });
    expect(s2.statusCode, s2.body).toBe(200);
    const c2 = s2.json() as { challengeId: string; encryptedMessage: string };
    const f2 = await b.post('/v1/team/join/second/pgp/finish', {
      setupId, challengeId: c2.challengeId, code: codeOf(await decrypt(c2.encryptedMessage, k2.privateKey, undefined, deps.clock())), deviceLabel: 'Test',
    });
    expect(f2.statusCode, f2.body).toBe(201);
    return b;
  }

  it('migration 390 lets a set be empty and still refuses exactly HARD_OWNER_ONLY', async () => {
    const sql = readFileSync(`${ROOT}apps/api/migrations/390_team_assistants.sql`, 'utf8');
    const lists = [...sql.matchAll(/'\{([a-z,-]+)\}'::text\[\]/g)].map((m) => m[1]!.split(','));
    expect(lists).toHaveLength(1);
    // Plus Release coins, a hard rule until migration 870 (owner question trades-release).
    expect(new Set(lists[0])).toEqual(new Set([...HARD_OWNER_ONLY, 'trades-release']));
    const owner = await team();
    for (const id of HARD_OWNER_ONLY) {
      await expect(deps.db.query(
        `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, created_at) values ($1, 'Hardrule1', 'hardrule1', $2, $3, $3)`,
        [owner.id, [id], deps.clock()],
      )).rejects.toThrow();
    }
    // The API never takes an empty set from a request.
    const confirmToken = await confirmed(owner, { kind: 'team-invite-abilities', name: `Empty${++n}x`, abilities: '' });
    expect(err(await owner.browser.post('/v1/team/invites', { tradeTag: `Empty${n}x`, abilities: [], confirmToken }))).toEqual({ status: 400, error: 'bad-request' });
  });

  it('an invite carries its boxes at once (no staging)', async () => {
    const owner = await team();
    const res = await invite(owner, `StrongInv${++n}x`, ['offers']);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'id', 'invite']);
    expect(await boxesOf(body.id as string)).toEqual(rolesToAbilities(['offers']));
  });

  it('the member accepting tells the lead over secure Jabber too (the team_members trigger, behind the opt-in)', async () => {
    const owner = await team();
    await deps.db.query('insert into jabber_contacts (account_id, jid_sealed, verified_at, enabled) values ($1, $2, $3, true)', [owner.id, Buffer.from('sealed'), deps.clock()]);
    const created = (await invite(owner, `JabberInv${++n}x`, ['offers'])).json() as { invite: string };
    await deps.db.query('delete from jabber_outbox where account_id = $1', [owner.id]);
    await join(created.invite);
    const { rows } = await deps.db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1', [owner.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind === 'account-change' || r.kind === 'team-member-first-login')).toBe(true);
  });
});

describe('S-105 (owner p11-25): a member shows in chats as "<lead Trade Tag> Assistant N", never by their own name', () => {
  type Listed = { id: string; tradeTag: string; chatLabel: string };
  const listed = async (owner: Who) => ((await owner.browser.get('/v1/team')).json() as { members: Listed[] }).members;

  it('members are numbered 1, 2, 3 in the order they were added; the label never carries the member\'s name', async () => {
    const owner = await team();
    const names = [0, 1, 2].map((i) => `Aide${n}${i}x`);
    for (const name of names) expect((await invite(owner, name, ['offers'])).statusCode).toBe(201);
    const ms = await listed(owner);
    // (The test clock stands still, so the list's own order is by id; each name keeps its number.)
    expect(Object.fromEntries(ms.map((m) => [m.tradeTag, m.chatLabel]))).toEqual(
      Object.fromEntries(names.map((name, i) => [name, `${owner.tradeTag} Assistant ${i + 1}`])),
    );
    for (const m of ms) expect(m.chatLabel).not.toContain(m.tradeTag);
  });

  it('a freed number is used again by the next member (the lowest free one)', async () => {
    const owner = await team();
    for (let i = 0; i < 3; i++) expect((await invite(owner, `SlotName${++n}x`, ['offers'])).statusCode).toBe(201);
    const first = (await listed(owner))[0]!;
    const confirmToken = await confirmed(owner, { kind: 'team-remove', memberId: first.id });
    const del = await app.inject({
      method: 'DELETE', url: `/v1/team/members/${first.id}`, headers: { origin: 'https://x2f.test' }, cookies: owner.browser.cookies, payload: { confirmToken },
    });
    expect(del.statusCode, del.body).toBe(204);
    expect((await invite(owner, `SlotName${++n}x`, ['offers'])).statusCode).toBe(201);
    expect((await listed(owner)).map((m) => m.chatLabel).sort()).toEqual([1, 2, 3].map((k) => `${owner.tradeTag} Assistant ${k}`));
  });

  it('a member sees their own label on /v1/account/me (a member seeded straight into the table is numbered too)', async () => {
    const owner = await team();
    const m1 = await member(owner.id, ['offers']);
    const m2 = await member(owner.id, ['trades']);
    const me1 = (await m1.browser.get('/v1/account/me')).json() as { member: { name: string; chatLabel: string } };
    const me2 = (await m2.browser.get('/v1/account/me')).json() as { member: { name: string; chatLabel: string } };
    expect(me1.member.chatLabel).toBe(`${owner.tradeTag} Assistant 1`);
    expect(me2.member.chatLabel).toBe(`${owner.tradeTag} Assistant 2`);
    expect(me1.member.chatLabel).not.toContain(m1.name);
    // The owner's own overview has no member part.
    expect(((await owner.browser.get('/v1/account/me')).json() as { member: unknown }).member).toBeNull();
  });

  it('the database keeps one live member per number in a team', async () => {
    const owner = await team();
    const m = await member(owner.id, ['offers']);
    const { rows } = await deps.db.query<{ assistant_no: number }>('select assistant_no from team_members where id = $1', [m.id]);
    expect(rows[0]!.assistant_no).toBe(1);
    await expect(deps.db.query(
      `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, created_at, assistant_no)
       values ($1, 'Clashing1', 'clashing1', '{offers-see}', $2, $2, 1)`,
      [owner.id, deps.clock()],
    )).rejects.toThrow();
  });
});

// Review trades-list I1, applied to every per-trade read (lead, 12 Nov 2026): a member reads an open
// trade's attestation, confirmations and dispute with See active trades, and a completed trade's
// with See trade history, as the room and the trades list do; the live stream carries a member only
// the events of the parts their boxes allow.
describe('a member reads each part of the trades only with its box (review trades-list I1)', () => {
  const ACTIVE = ['trades-see-active'];
  const HISTORY = ['trades-see-history'];
  /** A well-formed proof id no trade has (the blur-check routes check the trade first). */
  const PROOF_ID = newProofId();
  const status = (res: { statusCode: number; json(): unknown }) => (res.statusCode === 403 ? (res.json() as { error: string }).error : res.statusCode);

  /** An open trade of `owner`'s (secured) and a completed one (refunded on a buyer's cancel, its tx confirmed). */
  async function twoTrades(owner: Who): Promise<{ open: string; done: string }> {
    const other = await team();
    const o = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, o.trade, 'secured');
    const d = await seedTrade(deps, { sellerId: owner.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, d.trade, 'secured');
    expect((await other.browser.post(`/v1/trades/${d.code}/events`, { type: 'buyer-cancel' })).statusCode).toBe(200);
    const tx = randomBytes(32).toString('hex');
    await applyEvent(deps, d.code, { type: 'settled', kind: 'buyer-cancel', txHash: tx }, 'system');
    nodeCounts.set(tx, 10);
    expect((await loadTrade(deps.db, d.code))!.closedAt).not.toBeNull();
    return { open: o.code, done: d.code };
  }

  it('the bus: a member sink gets an event of a part only with its box; an event of no part needs See active trades', () => {
    const bus = new EventBus({ perAccount: 5, global: 10 });
    const owner = fakeSink();
    const a = fakeSink();
    const h = fakeSink();
    const both = fakeSink();
    const legacy = fakeSink();
    bus.attach('team', owner, 'o');
    bus.attach('team', a, 'a', { member: true, abilities: ACTIVE });
    bus.attach('team', h, 'h', { member: true, abilities: HISTORY });
    bus.attach('team', both, 'b', { member: true, abilities: [...ACTIVE, ...HISTORY] });
    expect(bus.publish('team', { type: 'trade', code: 'O', state: 'paid' }, { closed: false })).toBe(1);
    bus.publish('team', { type: 'trade', code: 'C', state: 'released' }, { closed: true });
    bus.publish('team', { type: 'nudge', from: 'x', context: 'offer' });
    const seen = (k: { got: string[] }) => k.got.map((d) => (JSON.parse(d.slice(6)) as { code?: string; type: string }).code ?? 'nudge');
    expect(seen(owner)).toEqual(['O', 'C', 'nudge']);
    expect(seen(a)).toEqual(['O', 'nudge']);
    expect(seen(h)).toEqual(['C']);
    expect(seen(both)).toEqual(['O', 'C', 'nudge']);
    // A sink attached with no boxes named (an older caller) is not widened: it gets none of a part's.
    bus.attach('team', legacy, 'l', { member: true, abilities: [] });
    bus.publish('team', { type: 'trade', code: 'C2', state: 'released' }, { closed: true });
    expect(legacy.got).toEqual([]);
  });

  it('the trade event publisher says which part each event is: open or completed', async () => {
    const calls: Array<[string, unknown, unknown]> = [];
    const events = { publish: (id: string, ev: unknown, o?: unknown) => (calls.push([id, ev, o]), 0) };
    const publish = tradeEventPublisher({ events: events as never, push: { send: async () => true } });
    await publish({ code: 'A', state: 'paid', sellerId: 's', buyerId: 'b', closedAt: null } as never, { type: 'mark-paid' } as never, 'buyer');
    await publish({ code: 'B', state: 'released', sellerId: 's', buyerId: 'b', closedAt: new Date() } as never, { type: 'settled' } as never, 'system');
    await publish({ code: 'C', state: 'refunded', sellerId: 's', buyerId: 'b', closedAt: new Date() } as never, { type: 'return-confirmed' } as never, 'system');
    expect(calls.map(([, ev, o]) => [(ev as { code: string }).code, o])).toEqual([
      ['A', { closed: false }], ['A', { closed: false }],
      ['B', { closed: true }], ['B', { closed: true }],
      ['C', { closed: true }], ['C', { closed: true }],
    ]);
  });

  it('the attestation: open with See active trades, completed with See trade history', async () => {
    const owner = await team();
    const { open, done } = await twoTrades(owner);
    const active = await member(owner.id, { abilities: ACTIVE });
    const history = await member(owner.id, { abilities: HISTORY });
    expect(status(await active.browser.get(`/v1/trades/${open}/attestation`))).not.toBe('forbidden');
    expect(status(await active.browser.get(`/v1/trades/${done}/attestation`))).toBe('forbidden');
    expect(status(await history.browser.get(`/v1/trades/${done}/attestation`))).not.toBe('forbidden');
    expect(status(await history.browser.get(`/v1/trades/${open}/attestation`))).toBe('forbidden');
  });

  it('review lead-trades-list-2 B1: the signed ruling statement needs the box for the part; a stranger gets 404', async () => {
    const owner = await team();
    const { open, done } = await twoTrades(owner);
    const active = await member(owner.id, { abilities: ACTIVE });
    const history = await member(owner.id, { abilities: HISTORY });
    // No statement is stored, so a read that gets through is 204.
    expect(status(await active.browser.get(`/v1/trades/${open}/ruling-statement`))).toBe(204);
    expect(status(await active.browser.get(`/v1/trades/${done}/ruling-statement`))).toBe('forbidden');
    expect(status(await history.browser.get(`/v1/trades/${done}/ruling-statement`))).toBe(204);
    expect(status(await history.browser.get(`/v1/trades/${open}/ruling-statement`))).toBe('forbidden');
    const stranger = await twoTrades(await team());
    expect(status(await active.browser.get(`/v1/trades/${stranger.open}/ruling-statement`))).toBe(404);
  });

  it("review lead-trades-list-2 m2: 404 before 403: a member whose box does not match a stranger's trade's part gets 404 on every trade route", async () => {
    const owner = await team();
    const stranger = await twoTrades(await team());
    const acts = ['trades-mark-paid', 'disputes-appeal', 'disputes-answer', 'chat-reply'];
    // See active trades only, on the stranger's completed trade; See trade history only, on its open one.
    const cases = [
      { m: await member(owner.id, { abilities: [...ACTIVE, ...acts] }), code: stranger.done },
      { m: await member(owner.id, { abilities: [...HISTORY, ...acts] }), code: stranger.open },
    ];
    for (const { m, code } of cases) {
      expect((await m.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
      const b = m.browser;
      const got = {
        room: status(await b.get(`/v1/trades/${code}`)),
        attestation: status(await b.get(`/v1/trades/${code}/attestation`)),
        confirmations: status(await b.get(`/v1/trades/${code}/confirmations`)),
        rulingStatement: status(await b.get(`/v1/trades/${code}/ruling-statement`)),
        dispute: status(await b.get(`/v1/trades/${code}/dispute`)),
        blurChecks: status(await b.get(`/v1/trades/${code}/blur-checks`)),
        blurAnswer: status(await b.post(`/v1/trades/${code}/blur-checks/${PROOF_ID}`, { correct: true })),
        announce: status(await b.post(`/v1/trades/${code}/proofs/${PROOF_ID}/blur-check`, { blur: 'auto' })),
        events: status(await b.post(`/v1/trades/${code}/events`, { type: 'mark-paid', fiatCents: '1' })),
        appeal: status(await b.post(`/v1/trades/${code}/appeal`, { why: 'The moderator missed my bank statement.' })),
      };
      expect(got).toEqual(Object.fromEntries(Object.keys(got).map((k) => [k, 404])));
    }
  });

  it("review lead-trades-list-2 m3 (G20): the dispute store's publish says the trade's part", async () => {
    const owner = await team();
    const other = await team();
    const d = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    expect((await owner.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    const dp = await driveTo(deps, d.trade, 'paid');
    setNow(dp.confirmBy!);
    const opened = await owner.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' });
    expect(opened.statusCode, opened.body).toBe(200);
    await publishRuling(deps, d.code, { outcome: 'release-to-buyer' });
    const closed = (await loadTrade(deps.db, d.code))!.closedAt !== null;
    // The appeal is a dispute-store change (withDispute), published to both sides with the part.
    const spy = vi.spyOn(app.events, 'publish');
    try {
      const appealed = await owner.browser.post(`/v1/trades/${d.code}/appeal`, { why: 'The moderator missed my bank statement.' });
      expect(appealed.statusCode, appealed.body).toBe(200);
      const mine = spy.mock.calls.filter(([, ev]) => (ev as { code?: string }).code === d.code);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      for (const [, , o] of mine) expect(o).toEqual({ closed });
    } finally {
      spy.mockRestore();
    }
  });

  it('the confirmations of a completed trade need See trade history', async () => {
    const owner = await team();
    const { done } = await twoTrades(owner);
    const active = await member(owner.id, { abilities: ACTIVE });
    const history = await member(owner.id, { abilities: HISTORY });
    expect(status(await active.browser.get(`/v1/trades/${done}/confirmations`))).toBe('forbidden');
    // Nothing recorded by the refused read.
    expect((await loadTrade(deps.db, done))!.cancelConfirmableAt).toBeNull();
    expect(status(await history.browser.get(`/v1/trades/${done}/confirmations`))).toBe(200);
    expect(status(await owner.browser.get(`/v1/trades/${done}/confirmations`))).toBe(200);
  });

  it("the dispute of an open (disputed) trade needs See active trades besides the disputes box", async () => {
    const owner = await team();
    const other = await team();
    const d = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    expect((await owner.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    const withActive = await member(owner.id, { abilities: ['disputes-answer', ...ACTIVE] });
    const withHistory = await member(owner.id, { abilities: ['disputes-answer', ...HISTORY] });
    for (const m of [withActive, withHistory]) expect((await m.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    const dp = await driveTo(deps, d.trade, 'paid');
    setNow(dp.confirmBy!);
    const opened = await owner.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(status(await withActive.browser.get(`/v1/trades/${d.code}/dispute`))).toBe(200);
    expect(status(await withHistory.browser.get(`/v1/trades/${d.code}/dispute`))).toBe('forbidden');
  });

  it('re-verify m3: a member acts on a trade (POST events) only with the box for its part, besides the event\'s own', async () => {
    const owner = await team();
    const seller = await team();
    // An open trade where the owner is the buyer, secured: mark-paid is the owner side's event.
    const o = await seedTrade(deps, { sellerId: seller.id, buyerId: owner.id, poster: 'seller' });
    const secured = await driveTo(deps, o.trade, 'secured');
    const paidHistory = await member(owner.id, { abilities: ['trades-mark-paid', ...HISTORY] });
    const paidActive = await member(owner.id, { abilities: ['trades-mark-paid', ...ACTIVE] });
    const markPaid = { type: 'mark-paid', fiatCents: secured.fiatCents.toString() };
    expect(err(await paidHistory.browser.post(`/v1/trades/${o.code}/events`, markPaid))).toEqual({ status: 403, error: 'forbidden' });
    expect((await loadTrade(deps.db, o.code))!.state).toBe('secured');
    const ok = await paidActive.browser.post(`/v1/trades/${o.code}/events`, markPaid);
    expect(ok.statusCode, ok.body).toBe(200);

    // A completed trade (refunded on the buyer's cancel): Confirm cancel needs See trade history.
    const { done } = await twoTrades(owner);
    const cancelActive = await member(owner.id, { abilities: ['trades-confirm-cancel', ...ACTIVE] });
    const cancelHistory = await member(owner.id, { abilities: ['trades-confirm-cancel', ...HISTORY] });
    expect(err(await cancelActive.browser.post(`/v1/trades/${done}/events`, { type: 'confirm-cancel' }))).toEqual({ status: 403, error: 'forbidden' });
    expect((await loadTrade(deps.db, done))!.cancelConfirmedAt).toBeNull();
    const confirmed = await cancelHistory.browser.post(`/v1/trades/${done}/events`, { type: 'confirm-cancel' });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
  });

  it('re-verify m3: a member appeals only with the box for the trade\'s part, besides the appeal box', async () => {
    const owner = await team();
    const other = await team();
    const d = await seedTrade(deps, { sellerId: other.id, buyerId: owner.id, poster: 'seller' });
    const withActive = await member(owner.id, { abilities: ['disputes-appeal', ...ACTIVE] });
    const withHistory = await member(owner.id, { abilities: ['disputes-appeal', ...HISTORY] });
    for (const b of [owner.browser, withActive.browser, withHistory.browser]) expect((await b.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
    const dp = await driveTo(deps, d.trade, 'paid');
    setNow(dp.confirmBy!);
    const opened = await owner.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: 'x' });
    expect(opened.statusCode, opened.body).toBe(200);
    await publishRuling(deps, d.code, { outcome: 'release-to-buyer' });
    // Whichever part the ruled trade is in now, the other part's box alone is refused, and writes nothing.
    const closed = (await loadTrade(deps.db, d.code))!.closedAt !== null;
    const [right, wrong] = closed ? [withHistory, withActive] : [withActive, withHistory];
    const why = { why: 'The moderator missed my bank statement.' };
    expect(err(await wrong.browser.post(`/v1/trades/${d.code}/appeal`, why))).toEqual({ status: 403, error: 'forbidden' });
    expect((await deps.db.query('select 1 from dispute_appeals where code = $1', [d.code])).rowCount).toBe(0);
    const appealed = await right.browser.post(`/v1/trades/${d.code}/appeal`, why);
    // Main's appeals review S1: a member without the Answer the moderator box gets 204, no dispute view.
    expect(appealed.statusCode, appealed.body).toBe(204);
    expect((await deps.db.query('select 1 from dispute_appeals where code = $1', [d.code])).rowCount).toBe(1);
  });

  it("a trade's review stays the account owner's: a member is refused whatever their boxes", async () => {
    const owner = await team();
    const { done } = await twoTrades(owner);
    const m = await member(owner.id, { abilities: [...ACTIVE, ...HISTORY] });
    expect(err(await m.browser.get(`/v1/trades/${done}/review`))).toEqual({ status: 403, error: 'owner-only' });
  });

  it('the live stream: a member with See trade history only may open it, and gets only completed trades\' events', async () => {
    const owner = await team();
    const history = await member(owner.id, { abilities: HISTORY });
    const active = await member(owner.id, { abilities: ACTIVE });
    try {
      const h = await stream(history.browser);
      expect(h.status).toBe(200);
      const a = await stream(active.browser);
      expect(a.status).toBe(200);
      const own = await stream(owner.browser);
      app.events.publish(owner.id, { type: 'trade', code: 'OPEN-ONE', state: 'secured' }, { closed: false });
      app.events.publish(owner.id, { type: 'trade', code: 'DONE-ONE', state: 'refunded' }, { closed: true });
      // An event of no part (a nudge) goes where it always went: the See active trades box.
      app.events.publish(owner.id, { type: 'nudge', from: 'someone', context: 'offer' });
      app.events.publish(owner.id, { type: 'trade', code: 'LAST', state: 'paid' }, { closed: false });
      await own.waitFor((e) => (e as { code?: string }).code === 'LAST');
      await a.waitFor((e) => (e as { code?: string }).code === 'LAST');
      app.events.publish(owner.id, { type: 'trade', code: 'LAST-DONE', state: 'released' }, { closed: true });
      await h.waitFor((e) => (e as { code?: string }).code === 'LAST-DONE');
      await own.waitFor((e) => (e as { code?: string }).code === 'LAST-DONE');
      const codes = (st: SseStream) => st.events.map((e) => (e as { code?: string; type: string }).code ?? (e as { type: string }).type);
      expect(codes(own)).toEqual(['OPEN-ONE', 'DONE-ONE', 'nudge', 'LAST', 'LAST-DONE']);
      expect(codes(a)).toEqual(['OPEN-ONE', 'nudge', 'LAST']);
      expect(codes(h)).toEqual(['DONE-ONE', 'LAST-DONE']);
    } finally {
      for (const st of streams.splice(0)) st.close();
      await until(() => !app.events.delivered(owner.id));
    }
  });

  it("a change to a member's trades boxes ends their live stream, so it reopens with the new parts", async () => {
    const owner = await team();
    const m = await member(owner.id, { abilities: [...ACTIVE, ...HISTORY] });
    const st = await stream(m.browser);
    expect(st.status).toBe(200);
    // Dropping See trade history keeps See active trades, so the stream may reopen, with the new parts.
    const confirmToken = await confirmed(owner, { kind: 'team-abilities', memberId: m.id, abilities: ACTIVE.join(',') });
    const res = await owner.browser.patch(`/v1/team/members/${m.id}`, { abilities: ACTIVE, confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    await st.ended;
    expect((await stream(m.browser)).status).toBe(200);
    for (const s of streams.splice(0)) s.close();
  });
});
