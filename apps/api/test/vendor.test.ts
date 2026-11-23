import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { HOLD_BLOCKED_ROUTES, LIVE_SESSION_ROUTES } from '../src/auth/hold.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { genKey } from './helpers/pgpKeys.js';
import { Browser } from './helpers/totp.js';
import { fakeAddress } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';
import { flexBody, insertOffer } from './helpers/offers.js';

// Owner, 2 Nov 2026 (docs/design-hold-model-2026-11-02.md, board BecomeVendor): Trader (default;
// takes offers) and Vendor (posts offers) accounts. Becoming a vendor is a switch in Settings that
// needs the account holder to have a passkey, security key or PGP key and to confirm with one of
// them. Only vendors post offers or have team members. Real Postgres, one database for the file.

const DAY = 86_400_000;

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

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { prices }));
});
afterAll(async () => {
  await app.close();
});

type Who = Awaited<ReturnType<typeof trader>>;

const BODY = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 50 },
  minFiatCents: '5000', maxFiatCents: '200000', minTrades: null, terms: 'Zelle only.',
};

async function addWallet(accountId: string): Promise<void> {
  const now = deps.clock();
  await deps.db.query(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4)`,
    [accountId, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
}

async function sessionId(b: Browser): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>("select id from sessions where token_hash = sha256(convert_to($1, 'utf8'))", [
    b.cookies['__Host-x2f_session'],
  ]);
  return rows[0]!.id;
}

/** A trader with a usable wallet and a PGP key (the vendor requirement), still a trader. */
async function withKey(): Promise<Who> {
  const t = await trader();
  await addWallet(t.id);
  const key = await genKey();
  await insertPgpKey(deps.db, deps.config, { accountId: t.id, fingerprint: key.fingerprint, armored: key.publicKey, now: deps.clock() });
  return t;
}

async function token(who: Who, method: 'pgp' | 'passkey' | 'security-key' | 'password'): Promise<string> {
  return issueConfirmToken(deps, { sessionId: await sessionId(who.browser), accountId: who.id, action: { kind: 'become-vendor' }, method });
}

const typeOf = async (id: string): Promise<string> =>
  (await deps.db.query<{ account_type: string }>('select account_type from accounts where id = $1', [id])).rows[0]!.account_type;

const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

describe('account type', () => {
  it('a new account is a trader; GET /v1/account/me says so', async () => {
    const t = await trader();
    expect(await typeOf(t.id)).toBe('trader');
    const me = (await t.browser.get('/v1/account/me')).json() as { accountType?: string };
    expect(me.accountType).toBe('trader');
  });

  it('a trader cannot post an offer (403 not-vendor) and nothing is written; a vendor can', async () => {
    const t = await trader();
    await addWallet(t.id);
    const res = await t.browser.post('/v1/offers', flexBody(BODY));
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('not-vendor');
    const { rows } = await deps.db.query('select 1 from offers where account_id = $1', [t.id]);
    expect(rows).toHaveLength(0);
    await makeVendor(deps, t.id);
    expect((await t.browser.post('/v1/offers', flexBody(BODY))).statusCode).toBe(201);
  });

  it("a trader's existing offers stay (migration rule): pausing and removing work, turning one on is refused", async () => {
    const t = await trader();
    await addWallet(t.id);
    await makeVendor(deps, t.id);
    const id = ((await t.browser.post('/v1/offers', flexBody(BODY))).json() as { id: string }).id;
    await deps.db.query("update accounts set account_type = 'trader', vendor_since = null where id = $1", [t.id]);
    expect((await t.browser.patch(`/v1/offers/${id}`, { status: 'paused' })).statusCode).toBe(200);
    const on = await t.browser.patch(`/v1/offers/${id}`, { status: 'live' });
    expect(on.statusCode, on.body).toBe(403);
    expect(errorOf(on)).toBe('not-vendor');
    const bulk = await t.browser.post('/v1/account/offers/status', { ids: [id], status: 'live' });
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect((bulk.json() as { results: unknown[] }).results).toEqual([{ id, status: 'paused', refused: 'not-vendor' }]);
    expect((await t.browser.patch(`/v1/offers/${id}`, { status: 'removed' })).statusCode).toBe(200);
  });

  it('a trader cannot invite a team member (403 not-vendor) and the confirm token is not spent', async () => {
    const t = await trader();
    const action = { kind: 'team-invite' as const, name: 'Sailor001', roles: 'offers' };
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionId(t.browser), accountId: t.id, action, method: 'passkey' });
    const res = await t.browser.post('/v1/team/invites', { displayName: 'Sailor001', roles: ['offers'], confirmToken });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('not-vendor');
    const { rows } = await deps.db.query('select used_at from confirm_tokens where account_id = $1', [t.id]);
    expect(rows[0]).toEqual({ used_at: null });
    await makeVendor(deps, t.id);
    expect((await t.browser.post('/v1/team/invites', { displayName: 'Sailor001', roles: ['offers'], confirmToken })).statusCode).toBe(201);
  });
});

describe('PUT /v1/account/type (switch to vendor)', () => {
  it('needs a passkey, security key or PGP key on the account (403 vendor-needs-key), checked before any confirm', async () => {
    const t = await trader();
    const res = await t.browser.put('/v1/account/type', { type: 'vendor' });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('vendor-needs-key');
    expect(await typeOf(t.id)).toBe('trader');
  });

  it('asks to confirm become-vendor; a password confirm is refused (403 method-not-allowed); a PGP confirm switches', async () => {
    const t = await withKey();
    const ask = await t.browser.put('/v1/account/type', { type: 'vendor' });
    expect(ask.statusCode, ask.body).toBe(403);
    expect(ask.json()).toEqual({ error: 'confirm-required', action: 'become-vendor' });

    const weak = await t.browser.put('/v1/account/type', { type: 'vendor', confirmToken: await token(t, 'password') });
    expect(weak.statusCode, weak.body).toBe(403);
    expect(errorOf(weak)).toBe('method-not-allowed');
    expect(await typeOf(t.id)).toBe('trader');

    const ok = await t.browser.put('/v1/account/type', { type: 'vendor', confirmToken: await token(t, 'pgp') });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ accountType: 'vendor' });
    expect(await typeOf(t.id)).toBe('vendor');
    const me = (await t.browser.get('/v1/account/me')).json() as { accountType?: string };
    expect(me.accountType).toBe('vendor');
    const { rows } = await deps.db.query<{ kind: string }>("select kind from alerts where account_id = $1 and kind = 'became-vendor'", [t.id]);
    expect(rows).toHaveLength(1);
    expect((await t.browser.post('/v1/offers', flexBody(BODY))).statusCode).toBe(201);
  });

  it('a passkey or security key confirm switches too', async () => {
    for (const method of ['passkey', 'security-key'] as const) {
      const t = await withKey();
      const ok = await t.browser.put('/v1/account/type', { type: 'vendor', confirmToken: await token(t, method) });
      expect(ok.statusCode, `${method} ${ok.body}`).toBe(200);
    }
  });

  it('POST /v1/confirm/password refuses to issue a become-vendor token (403 method-not-allowed)', async () => {
    const t = await withKey();
    const res = await t.browser.post('/v1/confirm/password', { password: 'irrelevant password here', action: { kind: 'become-vendor' } });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('method-not-allowed');
  });

  it('there is no switching back to trader (owner answer Q77, 2026-11-06: open a new account): 400 bad-request; an unknown type too', async () => {
    const t = await withKey();
    await makeVendor(deps, t.id);
    for (const type of ['trader', 'staff', 1, null]) {
      const res = await t.browser.put('/v1/account/type', { type });
      expect(res.statusCode, String(type)).toBe(400);
    }
    expect(await typeOf(t.id)).toBe('vendor');
  });

  it('an account that is already a vendor gets 200 without spending a confirm', async () => {
    const t = await withKey();
    await makeVendor(deps, t.id);
    const res = await t.browser.put('/v1/account/type', { type: 'vendor' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ accountType: 'vendor' });
  });

  it('is refused during the 24-hour hold (403 recovery-hold), before the confirm token is spent', async () => {
    const t = await withKey();
    const now = deps.clock();
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'weak-new-device', '{}')`,
      [t.id, now, new Date(now.getTime() + DAY)],
    );
    const confirmToken = await token(t, 'pgp');
    const res = await t.browser.put('/v1/account/type', { type: 'vendor', confirmToken });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('recovery-hold');
    expect(await typeOf(t.id)).toBe('trader');
    await deps.db.query('delete from account_holds where account_id = $1', [t.id]);
  });

  it("a team member gets 403 owner-only (account type is the account holder's only)", async () => {
    const t = await withKey();
    await makeVendor(deps, t.id);
    const loginId = await seedAccount(deps, { loginName: 'vendormember1', displayName: 'vm-1-placeholder', kind: 'member' });
    const now = deps.clock();
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Vm1', 'vm1', '{offers-see}', $2, $3, $2, $2)`,
      [t.id, now, loginId],
    );
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    const res = await mb.put('/v1/account/type', { type: 'vendor' });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('owner-only');
    // The member of a vendor sees the account it works for as a vendor.
    expect(((await mb.get('/v1/account/me')).json() as { accountType?: string }).accountType).toBe('vendor');
  });

  it('is classified: a live-session route and a hold-blocked route', () => {
    expect(LIVE_SESSION_ROUTES).toContain('PUT /v1/account/type');
    expect(HOLD_BLOCKED_ROUTES).toContain('PUT /v1/account/type');
  });
});

describe('migration 198: existing accounts', () => {
  // The backfill between the markers runs again here on seeded rows (the template database ran it on none).
  const sql = readFileSync(new URL('../migrations/198_account_type.sql', import.meta.url), 'utf8');
  const backfill = /-- backfill:start\n([\s\S]*?)-- backfill:end/.exec(sql)![1]!;

  it('only accounts with offers or team members that also hold a passkey, security key or PGP key become vendors', async () => {
    const now = deps.clock();
    const mk = async (o: { offer?: 'live' | 'paused' | 'removed'; team?: boolean; key?: boolean }) => {
      const id = await seedAccount(deps, { loginName: `mig${Math.random().toString(36).slice(2, 10)}` });
      if (o.offer) {
        await insertOffer(deps.db, { accountId: id, side: 'sell', methodId: 'ZELLE', currency: 'USD', min: 100, max: 200, status: o.offer, at: now });
      }
      if (o.team) {
        await deps.db.query(
          `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, created_at) values ($1, 'Mx', 'mx', '{offers-see}', $2, $2)`,
          [id, now],
        );
      }
      if (o.key) {
        const key = await genKey();
        await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: key.fingerprint, armored: key.publicKey, now });
      }
      return id;
    };
    const cases = {
      offerKey: await mk({ offer: 'live', key: true }),
      pausedKey: await mk({ offer: 'paused', key: true }),
      teamKey: await mk({ team: true, key: true }),
      offerNoKey: await mk({ offer: 'live' }),
      teamNoKey: await mk({ team: true }),
      removedKey: await mk({ offer: 'removed', key: true }),
      keyOnly: await mk({ key: true }),
      nothing: await mk({}),
    };
    await deps.db.query(backfill);
    const got: Record<string, string> = {};
    for (const [k, id] of Object.entries(cases)) got[k] = await typeOf(id);
    expect(got).toEqual({
      offerKey: 'vendor', pausedKey: 'vendor', teamKey: 'vendor',
      offerNoKey: 'trader', teamNoKey: 'trader', removedKey: 'trader', keyOnly: 'trader', nothing: 'trader',
    });
    // A grandfathered offer of a trader stays where it was.
    const { rows } = await deps.db.query<{ status: string }>('select status from offers where account_id = $1', [cases.offerNoKey]);
    expect(rows).toEqual([{ status: 'live' }]);
  });

  it('only a trader-kind account can be a vendor (database check)', async () => {
    const staff = await seedAccount(deps, { loginName: 'vendorstaff1', kind: 'staff' });
    await expect(deps.db.query("update accounts set account_type = 'vendor', vendor_since = now() where id = $1", [staff])).rejects.toThrow();
  });
});
