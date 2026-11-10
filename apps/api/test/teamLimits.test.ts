import { WEEKDAYS } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { HOLD_MS } from '../src/auth/hold.js';
import { settleDueChanges } from '../src/auth/holdChanges.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import { endMemberSessionsOutsideHours } from '../src/team/limits.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { Browser } from './helpers/totp.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// J-20 (owner p7-4 / S-091, p7-11 / S-096, p11-27 / S-107; review S-m4): a member's trade-size
// band, working hours, and the lead's notice of a member's first login. Real Postgres.

const DAY = 86_400_000;
const HOUR = 3_600_000;
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
const START = new Date('2026-10-17T12:00:00Z');
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices, db: await testDb({ max: 8 }) }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;

async function addWallet(accountId: string): Promise<string> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4) returning id`,
    [accountId, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return rows[0]!.id;
}

async function team(): Promise<Who & { wallet: string }> {
  setNow(START);
  const t = await trader();
  await makeVendor(deps, t.id);
  return { ...t, wallet: await addWallet(t.id) };
}

/** A joined member seeded directly (the real sign-up is team.test.ts's), not yet logged in unless `login`. */
async function member(teamId: string, abilities: string[], o: { login?: boolean } = {}) {
  const name = `Lmember${String(++n).padStart(4, '0')}`;
  const loginId = await seedAccount(deps, { loginName: `lmlogin${n}x`, displayName: `lm-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const browser = new Browser(app);
  if (o.login !== false) {
    const res = await browser.post('/t/login', { accountId: loginId });
    expect(res.statusCode, res.body).toBe(200);
  }
  return { id: rows[0]!.id, loginId, name, browser };
}

async function sessionId(b: Browser): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>("select id from sessions where token_hash = sha256(convert_to($1, 'utf8'))", [b.cookies['__Host-x2f_session']]);
  return rows[0]!.id;
}

async function confirmed(owner: Who, action: Parameters<typeof issueConfirmToken>[1]['action']): Promise<string> {
  return issueConfirmToken(deps, { sessionId: await sessionId(owner.browser), accountId: owner.id, action, method: 'passkey' });
}

const err = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, error: (res.json() as { error?: string }).error });

type Band = { minAtomic: string; maxAtomic: string } | null;
type Hours = 'any' | { days: string[]; start: string; end: string; tz: string };

const bandKey = (b: Band) => (b === null ? 'none' : `${b.minAtomic}-${b.maxAtomic}`);
const hoursKey = (h: Hours) => (h === 'any' ? 'any' : `${h.days.join(',')} ${h.start}-${h.end} ${h.tz}`);

/** The lead sets a member's limits (strong session): PUT /v1/team/members/:id/limits. */
async function setLimits(owner: Who, memberId: string, band: Band, hours: Hours) {
  const confirmToken = await confirmed(owner, { kind: 'team-limits', memberId, band: bandKey(band), hours: hoursKey(hours) });
  return owner.browser.put(`/v1/team/members/${memberId}/limits`, { band, hours, confirmToken });
}

const today = () => WEEKDAYS[deps.clock().getUTCDay()]!;
const otherDay = () => WEEKDAYS[(deps.clock().getUTCDay() + 3) % 7]!;
/** A window that contains the test's now (12:00 UTC) and ends at 13:00, inside the unchosen 2-hour session. */
const OPEN: () => Hours = () => ({ days: [today()], start: '08:00', end: '13:00', tz: 'UTC' });
/** A window on another day only. */
const SHUT: () => Hours = () => ({ days: [otherDay()], start: '08:00', end: '14:00', tz: 'UTC' });

const XMR_OFFER = (min: bigint, max: bigint) => ({
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  amountUnit: 'xmr', minAtomic: min.toString(), maxAtomic: max.toString(), minTrades: null, terms: 'Zelle only.',
});
const FIAT_OFFER = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  minFiatCents: '1000', maxFiatCents: '1000000', minTrades: null, terms: 'Zelle only.',
};

async function auditCount(teamId: string): Promise<number> {
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from team_audit where account_id = $1', [teamId]);
  return rows[0]!.n;
}

describe('the limits route (lead only, confirm bound to the exact limits)', () => {
  it('sets and shows a band and hours; the member view carries them; defaults are no band and any time', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    const before = (await owner.browser.get('/v1/team')).json() as { members: { id: string; band: Band; hours: Hours }[] };
    expect(before.members.find((x) => x.id === m.id)).toMatchObject({ band: null, hours: 'any' });
    const band = { minAtomic: (XMR / 10n).toString(), maxAtomic: (2n * XMR).toString() };
    const res = await setLimits(owner, m.id, band, OPEN());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: m.id, band, hours: OPEN() });
    const after = (await owner.browser.get('/v1/team')).json() as { members: { id: string; band: Band; hours: Hours }[] };
    expect(after.members.find((x) => x.id === m.id)).toMatchObject({ band, hours: OPEN() });
  });

  it('a token for other limits is refused; bad bands and hours are 400 before the token is spent', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    const band = { minAtomic: '0', maxAtomic: XMR.toString() };
    const confirmToken = await confirmed(owner, { kind: 'team-limits', memberId: m.id, band: bandKey(band), hours: 'any' });
    const wider = { minAtomic: '0', maxAtomic: (10n * XMR).toString() };
    expect((await owner.browser.put(`/v1/team/members/${m.id}/limits`, { band: wider, hours: 'any', confirmToken })).statusCode).toBe(403);
    for (const bad of [
      { band: { minAtomic: '5', maxAtomic: '4' }, hours: 'any' },
      { band: { minAtomic: '0', maxAtomic: '0' }, hours: 'any' },
      { band: { minAtomic: '-1', maxAtomic: '4' }, hours: 'any' },
      { band: { minAtomic: 1, maxAtomic: 4 }, hours: 'any' },
      { band: { maxAtomic: '4' }, hours: 'any' },
      { band: null, hours: { days: ['Mon'], start: '08:00', end: '08:00', tz: 'UTC' } },
      { band: null, hours: { days: [], start: '08:00', end: '09:00', tz: 'UTC' } },
      { band: null, hours: { days: ['Mon'], start: '08:00', end: '09:00', tz: 'Mars/Base' } },
      { band: null },
    ]) {
      const t = await confirmed(owner, { kind: 'team-limits', memberId: m.id, band: 'none', hours: 'any' });
      const r = await owner.browser.put(`/v1/team/members/${m.id}/limits`, { ...bad, confirmToken: t });
      expect(err(r), JSON.stringify(bad)).toEqual({ status: 400, error: 'bad-request' });
    }
    // The right token still works: nothing above spent it.
    const ok = await owner.browser.put(`/v1/team/members/${m.id}/limits`, { band, hours: 'any', confirmToken });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('members never set limits (owner-only), not even their own', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers', 'trades', 'hold-end']));
    const r = await m.browser.put(`/v1/team/members/${m.id}/limits`, { band: null, hours: 'any', confirmToken: 'x' });
    expect(err(r)).toEqual({ status: 403, error: 'owner-only' });
  });

  it("a username-and-password session's limits change is staged and applies only 24 h after it is submitted", async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    await deps.db.query("update sessions set strength = 'weak-single' where id = $1", [await sessionId(owner.browser)]);
    const band = { minAtomic: '1', maxAtomic: XMR.toString() };
    const res = await setLimits(owner, m.id, band, OPEN());
    expect(res.statusCode, res.body).toBe(202);
    const changeId = (res.json() as { changeId: string }).changeId;
    const staged = await deps.db.query<{ change: unknown }>('select change from hold_changes where id = $1', [changeId]);
    expect(staged.rows[0]!.change).toEqual({ kind: 'team-limits', memberId: m.id, band, hours: OPEN() });
    const row = async () => (await deps.db.query<{ band_max_atomic: string | null; hours: unknown }>('select band_max_atomic::text, hours from team_members where id = $1', [m.id])).rows[0]!;
    expect(await row()).toEqual({ band_max_atomic: null, hours: 'any' });
    expect((await owner.browser.post('/v1/account/hold/changes/submit', { ids: [changeId] })).statusCode).toBe(200);
    const due = new Date(deps.clock().getTime() + HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, new Date(due.getTime() - 1000));
    expect(await row()).toEqual({ band_max_atomic: null, hours: 'any' });
    await settleDueChanges(deps.config, app.events).run(deps.db, due);
    expect(await row()).toEqual({ band_max_atomic: XMR.toString(), hours: OPEN() });
  });
});

describe('the trade-size band limits every member action on a trade or an offer (p7-4)', () => {
  it('a member acts on a trade inside the band; outside it (above or below) the action is refused and nothing is written', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    expect((await setLimits(owner, m.id, { minAtomic: (XMR / 2n).toString(), maxAtomic: (2n * XMR).toString() }, 'any')).statusCode).toBe(200);
    for (const [amount, ok] of [[XMR, true], [3n * XMR, false], [XMR / 4n, false]] as const) {
      const t = await seedTrade(deps, { sellerId: seller.id, buyerId: owner.id, poster: 'seller', amountAtomic: amount, maxFiatCents: 10_000_000n, minFiatCents: 100n });
      const secured = await driveTo(deps, t.trade, 'secured');
      const before = await auditCount(owner.id);
      const res = await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
      if (ok) {
        expect(res.statusCode, res.body).toBe(200);
        expect(await auditCount(owner.id)).toBe(before + 1);
      } else {
        expect(err(res), String(amount)).toEqual({ status: 403, error: 'outside-trade-band' });
        expect(res.json()).toMatchObject({ minAtomic: (XMR / 2n).toString(), maxAtomic: (2n * XMR).toString() });
        expect(await auditCount(owner.id)).toBe(before);
        const { rows } = await deps.db.query<{ state: string }>('select state from trades where code = $1', [t.code]);
        expect(rows[0]!.state).toBe('secured');
        // The lead acts on it as before (the band is the member's, never the account's).
        const lead = await owner.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
        expect(lead.statusCode, lead.body).toBe(200);
      }
    }
  });

  it('a member without a band is not limited', async () => {
    const owner = await team();
    const seller = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: owner.id, poster: 'seller', amountAtomic: 5n * XMR, maxFiatCents: 10_000_000n, minFiatCents: 100n });
    const secured = await driveTo(deps, t.trade, 'secured');
    const res = await m.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("offers: a banded member posts, pauses and removes an XMR offer whose whole range is inside; one reaching outside, or a fiat one, is refused", async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers']));
    expect((await setLimits(owner, m.id, { minAtomic: (XMR / 10n).toString(), maxAtomic: XMR.toString() }, 'any')).statusCode).toBe(200);
    const inside = await m.browser.post('/v1/offers', XMR_OFFER(XMR / 10n, XMR));
    expect(inside.statusCode, inside.body).toBe(201);
    const over = await m.browser.post('/v1/offers', XMR_OFFER(XMR / 10n, 2n * XMR));
    expect(err(over)).toEqual({ status: 403, error: 'outside-trade-band' });
    const under = await m.browser.post('/v1/offers', XMR_OFFER(XMR / 100n, XMR));
    expect(err(under)).toEqual({ status: 403, error: 'outside-trade-band' });
    const fiat = await m.browser.post('/v1/offers', FIAT_OFFER);
    expect(err(fiat)).toEqual({ status: 403, error: 'outside-trade-band' });
    const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from offers where account_id = $1', [owner.id]);
    expect(rows[0]!.n).toBe(1);
    // The lead's own offer outside the band: the member cannot pause or remove it.
    const big = (await owner.browser.post('/v1/offers', XMR_OFFER(XMR, 5n * XMR))).json() as { id: string };
    expect(err(await m.browser.patch(`/v1/offers/${big.id}`, { status: 'paused' }))).toEqual({ status: 403, error: 'outside-trade-band' });
    const id = (inside.json() as { id: string }).id;
    expect((await m.browser.patch(`/v1/offers/${id}`, { status: 'paused' })).statusCode).toBe(200);
  });
});

describe('working hours (p7-11; review S-m4)', () => {
  it('outside the hours a member cannot log in; inside they can', async () => {
    const owner = await team();
    const shut = await member(owner.id, rolesToAbilities(['trades']), { login: false });
    expect((await setLimits(owner, shut.id, null, SHUT())).statusCode).toBe(200);
    expect(err(await shut.browser.post('/t/login', { accountId: shut.loginId }))).toEqual({ status: 403, error: 'outside-login-hours' });
    const open = await member(owner.id, rolesToAbilities(['trades']), { login: false });
    expect((await setLimits(owner, open.id, null, OPEN())).statusCode).toBe(200);
    expect((await open.browser.post('/t/login', { accountId: open.loginId })).statusCode).toBe(200);
  });

  it("when the window closes the member's session ends at its next request, and the sweep ends the rest", async () => {
    const owner = await team();
    const a = await member(owner.id, rolesToAbilities(['trades']));
    const b = await member(owner.id, rolesToAbilities(['trades']));
    expect((await setLimits(owner, a.id, null, OPEN())).statusCode).toBe(200);
    expect((await setLimits(owner, b.id, null, OPEN())).statusCode).toBe(200);
    expect((await a.browser.get('/v1/account/me')).statusCode).toBe(200);
    // 13:30 UTC: the window is over (the 2-hour session itself still runs).
    setNow(new Date(START.getTime() + 1.5 * HOUR));
    expect(err(await a.browser.get('/v1/account/me'))).toEqual({ status: 401, error: 'outside-login-hours' });
    const sa = await deps.db.query<{ revoked_at: Date | null }>('select revoked_at from sessions where member_id = $1', [a.id]);
    expect(sa.rows[0]!.revoked_at).not.toBeNull();
    expect(await endMemberSessionsOutsideHours(app.events).run(deps.db, deps.clock(), deps)).toBeGreaterThanOrEqual(1);
    const sb = await deps.db.query<{ revoked_at: Date | null }>('select revoked_at from sessions where member_id = $1', [b.id]);
    expect(sb.rows[0]!.revoked_at).not.toBeNull();
    // The lead is never limited by a member's hours.
    expect((await owner.browser.get('/v1/account/me')).statusCode).toBe(200);
    setNow(START);
  });

  it('limits that shut a logged-in member out now end their sessions at once', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    expect((await setLimits(owner, m.id, null, SHUT())).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ revoked_at: Date | null }>('select revoked_at from sessions where member_id = $1', [m.id]);
    expect(rows[0]!.revoked_at).not.toBeNull();
    expect(err(await m.browser.get('/v1/account/me'))).toEqual({ status: 401, error: 'not-authenticated' });
  });

  it('S-m4: a member cannot extend their session or choose a length past the window end; inside it they can', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']));
    // The window ends at 13:00, an hour from now.
    expect((await setLimits(owner, m.id, null, OPEN())).statusCode).toBe(200);
    const six = await m.browser.put('/v1/account/session/length', { hours: 6 });
    expect(err(six)).toEqual({ status: 403, error: 'past-working-hours' });
    expect(six.json()).toMatchObject({ workingUntil: new Date(START.getTime() + HOUR).toISOString() });
    const sid = await sessionId(m.browser);
    const t = await issueConfirmToken(deps, { sessionId: sid, accountId: owner.id, action: { kind: 'extend-session' }, method: 'passkey' });
    const ext = await m.browser.post('/v1/account/session/extend', { hours: 6, confirmToken: t });
    expect(err(ext)).toEqual({ status: 403, error: 'past-working-hours' });
    // A member with "any" hours picks freely.
    const free = await member(owner.id, rolesToAbilities(['trades']));
    expect((await free.browser.put('/v1/account/session/length', { hours: 6 })).statusCode).toBe(200);
  });

  it("outside the hours a member's action is refused in its own transaction (a session that passed the gate just before)", async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['offers']));
    expect((await setLimits(owner, m.id, null, OPEN())).statusCode).toBe(200);
    // The window stored now closes before the action's transaction (the gate read it as open).
    const { assertLiveMember } = await import('../src/team/audit.js');
    await expect(assertLiveMember(deps.db, { accountId: owner.id, memberId: m.id }, 'offers-post', new Date(START.getTime() + 3 * HOUR))).rejects.toMatchObject({
      status: 401, code: 'outside-login-hours',
    });
    await expect(assertLiveMember(deps.db, { accountId: owner.id, memberId: m.id }, 'offers-post', START)).resolves.toBeUndefined();
  });
});

describe("a member's first login (p11-27, S-107: no approval; the lead is told)", () => {
  it('needs no approval and raises one team-member-first-login alert to the lead; later logins only the usual one', async () => {
    const owner = await team();
    const m = await member(owner.id, rolesToAbilities(['trades']), { login: false });
    const first = await m.browser.post('/t/login', { accountId: m.loginId });
    expect(first.statusCode, first.body).toBe(200);
    expect((await m.browser.get('/v1/account/me')).statusCode).toBe(200);
    const again = new Browser(app);
    expect((await again.post('/t/login', { accountId: m.loginId })).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ kind: string; detail: { member?: string } }>(
      "select kind, detail from alerts where account_id = $1 and kind like 'team-member-%' order by kind",
      [owner.id],
    );
    expect(rows.map((r) => r.kind)).toEqual(['team-member-first-login', 'team-member-login', 'team-member-login']);
    expect(rows[0]!.detail.member).toBe(m.name);
  });
});
