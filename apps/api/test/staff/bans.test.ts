// Plan 4 Task 27 (Revision 2026-10-29, 2026-10-29b) with D-017's rule list (owner Q15) and D-020's
// notice (owner G39): a trade ban (no new trades or offers; open trades finish) and a site ban for a
// set time or for life, placed by a senior moderator or the owner with a tap, lifted automatically
// at its end, logged, and shown to the trader with the general reason only.
import { randomBytes, randomUUID } from 'node:crypto';
import type { KeyTapIntent } from '@x2f/staff';
import { newTradeCode } from '@x2f/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleEndedBans } from '../../src/staff/bans.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, logEntries } from '../helpers/staffApp.js';
import { attestedStaffApps, resetBudgets, staffWithKeys, tap, type AttestedStaffApps, type Person } from '../helpers/staffKeys.js';
import { addPgpKey } from '../helpers/staffKeys.js';
import { driveTo, seedOffer, seedTrade } from '../helpers/trades.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IN_A_WEEK = new Date(NOW.getTime() + 7 * DAY).toISOString();

let t: AttestedStaffApps;
let owner: Person;
let senior: Person;

beforeAll(async () => {
  t = await attestedStaffApps();
  t.setNow(NOW);
  owner = await staffWithKeys(t, { role: 'owner' });
  senior = await staffWithKeys(t, { role: 'senior' });
});
afterAll(async () => t.close());
beforeEach(() => {
  t.setNow(NOW);
  resetBudgets(t);
});

const trader = () => seedAccount(t.deps, { loginName: `bt${randomBytes(4).toString('hex')}`, kind: 'trader' });

/** The trader app as the account (a live trader session). */
async function asTrader(id: string) {
  const { token } = await insertSession(t.deps, id, 'trader');
  return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    t.trader.inject({ method, url, headers: { origin: 'https://x2f.test' }, cookies: { '__Host-x2f_session': token }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

interface BanInput { kind: 'trade' | 'site'; ruleId: string; until: string | null; note?: string }

async function ban(by: Person, accountId: string, b: BanInput, o: { intent?: Partial<KeyTapIntent> } = {}) {
  const banId = randomUUID();
  const intent = { kind: 'ban-account', accountId, banId, banKind: b.kind, ruleId: b.ruleId, until: b.until, ...o.intent } as KeyTapIntent;
  const tapId = await tap(by, intent);
  const res = await by.browser.post(`/staff/v1/accounts/${accountId}/bans`, { banId, ...b, tapId });
  return { banId, tapId, res };
}

/** A chat row as the take or `POST /v1/chats` writes it: on a trade, or an offer chat (no trade). */
async function insertChat(o: { offerId: string; buyerId: string; sellerId: string; tradeCode: string | null }): Promise<string> {
  const code = newTradeCode();
  await t.deps.db.query(
    'insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, $6)',
    [code, o.offerId, o.buyerId, o.sellerId, o.tradeCode, t.deps.clock()],
  );
  return code;
}

const isBanned = (res: { statusCode: number; json(): unknown }) => res.statusCode === 403 && (res.json() as { error?: string } | null)?.error === 'banned';

async function lift(by: Person, accountId: string, banId: string) {
  const tapId = await tap(by, { kind: 'lift-ban', accountId, banId } as KeyTapIntent);
  return by.browser.post(`/staff/v1/accounts/${accountId}/bans/${banId}/lift`, { tapId });
}

describe('placing a ban (Task 27, D-017)', () => {
  it('a senior moderator places a timed trade ban with a tap; logged; the staff list has the note, the trader only the general reason', async () => {
    const id = await trader();
    const { banId, res } = await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK, note: 'Threatened a buyer in chat' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ id: banId, kind: 'trade', ruleId: 'abuse', reasonCode: 'abuse', until: IN_A_WEEK, permanent: false });
    expect((await logEntries(t.deps, 'account.trade-banned')).map((e) => JSON.parse(e.detail))).toContainEqual({
      accountId: id, banId, ruleId: 'abuse', reasonCode: 'abuse', until: IN_A_WEEK, permanent: false,
    });
    // The note never goes to the log (no staff notes there) nor to the trader.
    expect(JSON.stringify(await logEntries(t.deps, 'account.trade-banned'))).not.toContain('Threatened');
    const list = await senior.browser.get(`/staff/v1/accounts/${id}/bans`);
    expect(list.json()).toMatchObject({ priorOffences: 1, bans: [{ id: banId, kind: 'trade', note: 'Threatened a buyer in chat', active: true }] });
    const me = await asTrader(id);
    const notice = await me('GET', '/v1/account/ban');
    expect(notice.statusCode).toBe(200);
    expect(notice.json().bans).toEqual([{ kind: 'trade', reasonCode: 'abuse', until: IN_A_WEEK, permanent: false }]);
    expect(notice.body).not.toContain('Threatened');
  });

  it('a moderator or a helper cannot ban (accounts.ban: senior moderators and the owner)', async () => {
    const id = await trader();
    for (const role of ['mod', 'helper'] as const) {
      const p = await staffWithKeys(t, { role });
      const res = await p.browser.post(`/staff/v1/accounts/${id}/bans`, { banId: randomUUID(), kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK, tapId: 'x' });
      // The route's own perm refuses first (bans onto main: pinned apart from the tap's perm below).
      expect({ status: res.statusCode, error: (res.json() as { error?: string }).error }, role).toEqual({ status: 403, error: 'forbidden' });
      const lifted = await p.browser.post(`/staff/v1/accounts/${id}/bans/${randomUUID()}/lift`, { tapId: 'x' });
      expect({ status: lifted.statusCode, error: (lifted.json() as { error?: string }).error }, role).toEqual({ status: 403, error: 'forbidden' });
      // Nor can they start the tap itself (tapPermOf: accounts.ban).
      for (const intent of [
        { kind: 'ban-account', accountId: id, banId: randomUUID(), banKind: 'trade', ruleId: 'abuse', until: IN_A_WEEK },
        { kind: 'lift-ban', accountId: id, banId: randomUUID() },
      ]) {
        expect((await p.browser.post('/staff/v1/taps/start', intent)).statusCode, `${role} ${intent.kind}`).toBe(403);
      }
    }
  });

  it('the tap binds the account, the kind, the rule and the end: a tap for another is refused and nothing is placed', async () => {
    const id = await trader();
    const banId = randomUUID();
    const tapId = await tap(senior, { kind: 'ban-account', accountId: id, banId, banKind: 'trade', ruleId: 'abuse', until: IN_A_WEEK } as KeyTapIntent);
    for (const body of [
      { banId, kind: 'site', ruleId: 'abuse', until: IN_A_WEEK },
      { banId, kind: 'trade', ruleId: 'terms', until: IN_A_WEEK },
      { banId, kind: 'trade', ruleId: 'abuse', until: new Date(NOW.getTime() + 8 * DAY).toISOString() },
    ]) {
      expect(errorOf(await senior.browser.post(`/staff/v1/accounts/${id}/bans`, { ...body, tapId })), JSON.stringify(body)).toBe('tap-invalid');
    }
    expect((await t.deps.db.query('select 1 from account_bans where account_id = $1', [id])).rows).toEqual([]);
  });

  it('D-017: lifetime only for scamming before the third offence, and the third offence is always lifetime', async () => {
    const id = await trader();
    const first = await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: null });
    expect([first.res.statusCode, errorOf(first.res)]).toEqual([409, 'lifetime-not-allowed']);
    expect((await t.deps.db.query('select used_at from key_taps where id = $1', [first.tapId])).rows).toEqual([{ used_at: null }]);
    // Two offences, each lifted.
    for (let i = 0; i < 2; i++) {
      const b = await ban(senior, id, { kind: 'trade', ruleId: 'terms', until: IN_A_WEEK });
      expect(b.res.statusCode, b.res.body).toBe(201);
      expect((await lift(senior, id, b.banId)).statusCode).toBe(200);
    }
    const third = await ban(senior, id, { kind: 'trade', ruleId: 'terms', until: IN_A_WEEK });
    expect([third.res.statusCode, errorOf(third.res)]).toEqual([409, 'lifetime-required']);
    const life = await ban(senior, id, { kind: 'site', ruleId: 'terms', until: null });
    expect(life.res.statusCode, life.res.body).toBe(201);
    expect(life.res.json()).toMatchObject({ permanent: true, until: null });
    // Scamming may be lifetime at once.
    const scammer = await trader();
    expect((await ban(senior, scammer, { kind: 'site', ruleId: 'scamming', until: null })).res.statusCode).toBe(201);
  });

  it('checks the input: an unknown rule, a past or malformed end, a long note, a second active ban of the same kind, a target that is not a trader', async () => {
    const id = await trader();
    expect(errorOf((await ban(senior, id, { kind: 'trade', ruleId: 'nope', until: IN_A_WEEK })).res)).toBe('bad-request');
    expect(errorOf((await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: new Date(NOW.getTime() - HOUR).toISOString() })).res)).toBe('bad-request');
    expect(errorOf((await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK, note: 'x'.repeat(501) })).res)).toBe('bad-request');
    expect((await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const again = await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK });
    expect([again.res.statusCode, errorOf(again.res)]).toEqual([409, 'already-banned']);
    // A site ban may stand beside a trade ban.
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const staffTarget = senior.id;
    expect((await ban(owner, staffTarget, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(404);
    expect((await senior.browser.post(`/staff/v1/accounts/${randomUUID()}/bans`, { banId: randomUUID(), kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK, tapId: 'x' })).statusCode).toBe(404);
  });

  it('a lifetime site ban puts the account\'s identifiers on the ban list; a timed one does not', async () => {
    const timed = await trader();
    expect((await ban(senior, timed, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    expect((await t.deps.db.query('select 1 from banned_identifiers where account_id = $1', [timed])).rows).toEqual([]);
    const life = await trader();
    expect((await ban(senior, life, { kind: 'site', ruleId: 'scamming', until: null })).res.statusCode).toBe(201);
    expect((await t.deps.db.query('select kind from banned_identifiers where account_id = $1 order by kind', [life])).rows.map((r) => r.kind)).toEqual(['login-name', 'trade-tag']);
  });

  it('MF2 (lead call): lifting a lifetime site ban takes the account\'s and its members\' identifiers off the ban list, and only theirs', async () => {
    const id = await trader();
    await addPgpKey(t.deps, id);
    const member = await seedAccount(t.deps, { loginName: `bm${randomBytes(4).toString('hex')}`, kind: 'member' });
    await addPgpKey(t.deps, member);
    const memberName = `Bm${randomBytes(3).toString('hex')}`;
    await t.deps.db.query(
      `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, '{trades-see-active}', $4, $5, $4, $4)`,
      [id, memberName, memberName.toLowerCase(), t.deps.clock(), member],
    );
    const bystander = await trader();
    expect((await ban(senior, bystander, { kind: 'site', ruleId: 'scamming', until: null })).res.statusCode).toBe(201);
    const b = await ban(senior, id, { kind: 'site', ruleId: 'scamming', until: null });
    expect(b.res.statusCode).toBe(201);
    const rowsOf = async (acc: string) => (await t.deps.db.query('select kind from banned_identifiers where account_id = $1 order by kind', [acc])).rows.map((r) => r.kind);
    expect([...new Set(await rowsOf(id))]).toEqual(['login-name', 'pgp-fingerprint', 'trade-tag']);
    expect([...new Set(await rowsOf(member))]).toEqual(['login-name', 'pgp-fingerprint']);
    const recorded = (await rowsOf(id)).length + (await rowsOf(member)).length;
    expect((await lift(senior, id, b.banId)).statusCode).toBe(200);
    expect(await rowsOf(id)).toEqual([]);
    expect(await rowsOf(member)).toEqual([]);
    // Someone else's ban stays.
    expect(await rowsOf(bystander)).toEqual(['login-name', 'trade-tag']);
    expect((await logEntries(t.deps, 'account.ban-lifted')).map((e) => JSON.parse(e.detail))).toContainEqual({ accountId: id, banId: b.banId, kind: 'site', identifiersRemoved: recorded });
  });

  it('lifting is tapped and logged; the trader sees no ban after it', async () => {
    const id = await trader();
    const b = await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK });
    expect(errorOf(await senior.browser.post(`/staff/v1/accounts/${id}/bans/${b.banId}/lift`, { tapId: 'x' }))).toBe('tap-invalid');
    const res = await lift(senior, id, b.banId);
    expect(res.statusCode, res.body).toBe(200);
    // S6: the lift names the ban it lifted.
    expect((await logEntries(t.deps, 'account.ban-lifted')).map((e) => JSON.parse(e.detail))).toContainEqual({ accountId: id, banId: b.banId, kind: 'site' });
    expect((await (await asTrader(id))('GET', '/v1/account/ban')).json().bans).toEqual([]);
    expect((await lift(senior, id, b.banId)).statusCode).toBe(409);
  });

  it('lead call (18 Nov): the ban\'s tap and the lift\'s tap carry the signed issuedAt, their start time, like the other tapped actions', async () => {
    const id = await trader();
    const b = await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK });
    expect(b.res.statusCode, b.res.body).toBe(201);
    t.setNow(new Date(NOW.getTime() + 60_000));
    const liftTap = await tap(senior, { kind: 'lift-ban', accountId: id, banId: b.banId } as KeyTapIntent);
    expect((await senior.browser.post(`/staff/v1/accounts/${id}/bans/${b.banId}/lift`, { tapId: liftTap })).statusCode).toBe(200);
    const stored = async (tapId: string) => {
      const { rows } = await t.deps.db.query<{ intent: string; used: boolean }>('select intent, used_at is not null as used from key_taps where id = $1', [tapId]);
      return { intent: JSON.parse(rows[0]!.intent) as Record<string, unknown>, used: rows[0]!.used };
    };
    expect(await stored(b.tapId)).toEqual({ intent: expect.objectContaining({ kind: 'ban-account', issuedAt: NOW.toISOString() }), used: true });
    expect(await stored(liftTap)).toEqual({ intent: expect.objectContaining({ kind: 'lift-ban', issuedAt: new Date(NOW.getTime() + 60_000).toISOString() }), used: true });
  });
});

describe('placing a site ban ends the live streams; settling an ended ban logs it (review S2, S5)', () => {
  it('S2: a site ban closes the account\'s open event streams; a trade ban does not', async () => {
    const spy = vi.spyOn(t.trader.events, 'closeAccount');
    try {
      const tradeOnly = await trader();
      expect((await ban(senior, tradeOnly, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
      expect(spy).not.toHaveBeenCalledWith(tradeOnly);
      const id = await trader();
      expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
      expect(spy).toHaveBeenCalledWith(id);
    } finally {
      spy.mockRestore();
    }
  });

  it('S5: a new ban that closes out an ended, unsettled one logs account.reinstated for it once', async () => {
    const id = await trader();
    // A timed site ban whose end passed before the settle job ran.
    await t.deps.db.query(
      `insert into account_bans (id, account_id, kind, rule_id, reason_code, until, placed_by, created_at) values ($1, $2, 'site', 'abuse', 'abuse', $3, $4, $5)`,
      [randomUUID(), id, new Date(NOW.getTime() - HOUR), senior.id, new Date(NOW.getTime() - 2 * HOUR)],
    );
    const before = (await logEntries(t.deps, 'account.reinstated')).filter((e) => JSON.parse(e.detail).accountId === id).length;
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: new Date(NOW.getTime() + 9 * DAY).toISOString() })).res.statusCode).toBe(201);
    await settleEndedBans.run(t.deps.db, t.deps.clock());
    const after = (await logEntries(t.deps, 'account.reinstated')).filter((e) => JSON.parse(e.detail).accountId === id);
    expect(after.length - before).toBe(1);
  });
});

describe('a site ban on the trader app (Task 27, 2026-10-29b)', () => {
  it('with nothing unfinished the person reaches only the notice and who they are; everything else is 403 banned with the reason and end', async () => {
    const id = await trader();
    expect((await ban(senior, id, { kind: 'site', ruleId: 'trade-problems', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const me = await asTrader(id);
    expect((await me('GET', '/v1/account/me')).statusCode).toBe(200);
    const notice = await me('GET', '/v1/account/ban');
    expect(notice.json()).toMatchObject({ bans: [{ kind: 'site', reasonCode: 'trade-problems', until: IN_A_WEEK, permanent: false }], contacts: expect.any(Object) });
    for (const [method, url] of [['GET', '/v1/wallets'], ['GET', '/v1/account/alerts'], ['GET', '/v1/chats']] as const) {
      const res = await me(method, url);
      expect([res.statusCode, res.json()], url).toEqual([403, { error: 'banned', kind: 'site', reasonCode: 'trade-problems', until: IN_A_WEEK }]);
    }
  });

  it('with an open trade the person may finish it (trade, chats, wallets) but still nothing new', async () => {
    const id = await trader();
    const other = await trader();
    const { trade } = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const me = await asTrader(id);
    expect((await me('GET', `/v1/trades/${trade.code}`)).statusCode).toBe(200);
    expect((await me('GET', '/v1/wallets')).statusCode).toBe(200);
    const post = await me('POST', '/v1/offers', {});
    expect([post.statusCode, post.json().error]).toEqual([403, 'banned']);
    const settings = await me('GET', '/v1/account/sessions');
    expect([settings.statusCode, settings.json().error]).toEqual([403, 'banned']);
  });

  it('MF1: an open trade opens only itself and its chat; a closed trade, its chat, an offer chat and the chat list stay 403 banned', async () => {
    const id = await trader();
    const other = await trader();
    const { rows } = await t.deps.db.query<{ trade_tag: string }>('select trade_tag from accounts where id = $1', [other]);
    const otherName = rows[0]!.trade_tag;
    const open = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    const closed = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    await driveTo(t.deps, closed.trade, 'released');
    const openChat = await insertChat({ offerId: open.trade.offerId, buyerId: other, sellerId: id, tradeCode: open.code });
    const closedChat = await insertChat({ offerId: closed.trade.offerId, buyerId: other, sellerId: id, tradeCode: closed.code });
    const offerChat = await insertChat({ offerId: await seedOffer(t.deps, id, 'seller'), buyerId: other, sellerId: id, tradeCode: null });
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const me = await asTrader(id);
    // Allowed: the open trade's own routes and its chat (the handler then answers as it would).
    for (const [method, url, body] of [
      ['GET', `/v1/trades/${open.code}`, undefined],
      ['GET', `/v1/trades/${open.code.toLowerCase().replace(/-/g, '')}`, undefined],
      ['POST', `/v1/trades/${open.code}/events`, {}],
      ['POST', `/v1/trades/${open.code}/chat`, {}],
      ['GET', `/v1/chats/${openChat}`, undefined],
      ['POST', `/v1/chats/${openChat}/envelopes`, {}],
      ['POST', '/v1/nudges', { to: otherName, context: open.code }],
      ['POST', '/v1/nudges', { to: otherName, context: openChat }],
    ] as const) {
      const res = await me(method, url, body);
      expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(false);
    }
    // Refused: everything that is not the open trade.
    for (const [method, url, body] of [
      ['GET', `/v1/trades/${closed.code}`, undefined],
      ['POST', `/v1/trades/${closed.code}/chat`, {}],
      ['POST', `/v1/trades/${closed.code}/events`, {}],
      ['GET', `/v1/trades/${newTradeCode()}`, undefined],
      ['GET', '/v1/trades/not-a-code', undefined],
      ['GET', `/v1/chats/${closedChat}`, undefined],
      ['POST', `/v1/chats/${closedChat}/envelopes`, {}],
      ['GET', `/v1/chats/${offerChat}`, undefined],
      ['POST', `/v1/chats/${offerChat}/envelopes`, {}],
      ['POST', `/v1/chats/${offerChat}/identity`, {}],
      ['GET', '/v1/chats', undefined],
      ['POST', '/v1/nudges', { to: otherName, context: closed.code }],
      ['POST', '/v1/nudges', { to: otherName, context: offerChat }],
      ['POST', '/v1/nudges', { to: otherName }],
    ] as const) {
      const res = await me(method, url, body);
      expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(true);
    }
  });

  it('MF1: a closed trade whose dispute is still open (an appeal) is reachable; once the dispute closes it is not', async () => {
    const id = await trader();
    const other = await trader();
    const done = await seedTrade(t.deps, { sellerId: other, buyerId: id, poster: 'seller' });
    await driveTo(t.deps, done.trade, 'released');
    await t.deps.db.query(`insert into disputes (code, seq, opened_by, reason, opened_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, status) values ($1, 1, 'buyer', 'other', $2, $2, $2::timestamptz + interval '1 day', 0, 100000, 'appealed')`, [done.code, t.deps.clock()]);
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const me = await asTrader(id);
    expect(isBanned(await me('GET', `/v1/trades/${done.code}`))).toBe(false);
    expect(isBanned(await me('GET', `/v1/trades/${done.code}/dispute`))).toBe(false);
    await t.deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [done.code, t.deps.clock()]);
    expect(isBanned(await me('GET', `/v1/trades/${done.code}`))).toBe(true);
  });

  it('S1, S3, S4: with an open trade the shell, the room\'s reads, nudges, push, chat keys and login approvals pass; the feedback form always does', async () => {
    const id = await trader();
    const other = await trader();
    await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const me = await asTrader(id);
    for (const [method, url] of [
      ['GET', '/v1/news'], ['GET', '/v1/methods'], ['GET', '/v1/price?currency=USD'], ['GET', '/v1/currencies'], ['GET', '/v1/account/hold'],
      ['GET', '/v1/account/push'], ['POST', '/v1/account/push'], ['DELETE', '/v1/account/push'],
      ['GET', '/v1/account/chat-keys'], ['POST', '/v1/account/chat-keys'],
      ['GET', '/v1/account/approvals'], ['GET', `/v1/account/approvals/${randomUUID()}`], ['POST', `/v1/account/approvals/${randomUUID()}`],
      ['POST', '/v1/feedback/form'],
    ] as const) {
      const res = await me(method, url, method === 'GET' ? undefined : {});
      expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(false);
    }
    // Still nothing new: browsing offers, posting, taking, settings.
    for (const [method, url] of [['GET', '/v1/offers?side=sell&method=zelle'], ['POST', '/v1/offers'], ['GET', '/v1/account/sessions'], ['POST', '/v1/chats']] as const) {
      expect(isBanned(await me(method, url, method === 'GET' ? undefined : {})), url).toBe(true);
    }
    // S4: with nothing unfinished the feedback form still passes (owner: everyone refused can say so); approvals do not.
    const idle = await trader();
    expect((await ban(senior, idle, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const them = await asTrader(idle);
    expect(isBanned(await them('POST', '/v1/feedback/form', {}))).toBe(false);
    expect(isBanned(await them('GET', '/v1/account/approvals'))).toBe(true);
    expect(isBanned(await them('GET', '/v1/news'))).toBe(true);
  });

  it('S1: the notice lists the open trades and disputes, each with its own link target', async () => {
    const id = await trader();
    const other = await trader();
    const open = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    const done = await seedTrade(t.deps, { sellerId: other, buyerId: id, poster: 'seller' });
    await driveTo(t.deps, done.trade, 'released');
    await t.deps.db.query(`insert into disputes (code, seq, opened_by, reason, opened_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, status) values ($1, 1, 'buyer', 'other', $2, $2, $2::timestamptz + interval '1 day', 0, 100000, 'published')`, [done.code, t.deps.clock()]);
    const finished = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    await driveTo(t.deps, finished.trade, 'released');
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const notice = (await (await asTrader(id))('GET', '/v1/account/ban')).json();
    expect(notice.unfinished).toEqual(expect.arrayContaining([{ code: open.code, dispute: false }, { code: done.code, dispute: true }]));
    expect(notice.unfinished).toHaveLength(2);
    // Nothing unfinished: an empty list.
    const idle = await trader();
    expect((await ban(senior, idle, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    expect((await (await asTrader(idle))('GET', '/v1/account/ban')).json().unfinished).toEqual([]);
  });

  it('ends on its own at the exact time: a second later everything works; the settle job logs the reinstatement once', async () => {
    const id = await trader();
    const until = new Date(NOW.getTime() + 2 * HOUR).toISOString();
    const b = await ban(senior, id, { kind: 'site', ruleId: 'abuse', until });
    expect(b.res.statusCode).toBe(201);
    // A fresh session at each moment (a test session's own life is shorter than the ban).
    t.setNow(new Date(Date.parse(until) - 1000));
    expect((await (await asTrader(id))('GET', '/v1/wallets')).statusCode).toBe(403);
    t.setNow(new Date(Date.parse(until) + 1000));
    expect((await (await asTrader(id))('GET', '/v1/wallets')).statusCode).toBe(200);
    const job = settleEndedBans;
    expect(await job.run(t.deps.db, t.deps.clock())).toBeGreaterThanOrEqual(1);
    expect(await job.run(t.deps.db, t.deps.clock())).toBe(0);
    expect((await t.deps.db.query('select ended_at from account_bans where id = $1', [b.banId])).rows[0]!.ended_at).not.toBeNull();
    expect((await logEntries(t.deps, 'account.reinstated')).map((e) => JSON.parse(e.detail))).toContainEqual({ accountId: id, kind: 'site' });
  });

  it('a lifetime ban is never ended by the clock', async () => {
    const id = await trader();
    expect((await ban(senior, id, { kind: 'site', ruleId: 'scamming', until: null })).res.statusCode).toBe(201);
    t.setNow(new Date(NOW.getTime() + 3650 * DAY));
    await settleEndedBans.run(t.deps.db, t.deps.clock());
    const me = await asTrader(id);
    expect((await me('GET', '/v1/wallets')).statusCode).toBe(403);
    expect((await me('GET', '/v1/account/ban')).json().bans).toEqual([{ kind: 'site', reasonCode: 'trade-problems', until: null, permanent: true }]);
  });

  it('a trade ban alone leaves the rest of the app open', async () => {
    const id = await trader();
    expect((await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    expect((await (await asTrader(id))('GET', '/v1/wallets')).statusCode).toBe(200);
  });
});

// Batch 10a lead call 1 (option (a), widened on purpose): the trade room's later routes. A
// site-banned trader still finishes their open trades and nothing else: each route is scoped to
// their own account while something is unfinished, or to a trade they are a party to that is still
// open or disputed; offers and posting stay refused.
describe('a site ban and the trade room\'s later routes (batch 10a, lead call 1)', () => {
  /** A valid proof id (26 Crockford base32 characters, packages/proof isProofId). */
  const PROOF = '0123456789ABCDEFGHJKMNPQR0';
  /** A raw PUT of 40 octets, as the proof upload sends (the proof routes read octets only). */
  async function putProof(id: string, code: string) {
    const { token } = await insertSession(t.deps, id, 'trader');
    return t.trader.inject({
      method: 'PUT', url: `/v1/trades/${code}/proofs/${PROOF}?kind=proof`,
      headers: { origin: 'https://x2f.test', 'content-type': 'application/octet-stream' },
      cookies: { '__Host-x2f_session': token }, payload: Buffer.alloc(40),
    });
  }
  const tradeRoutes = (code: string) => [
    ['GET', `/v1/trades/${code}/blur-checks`, undefined],
    ['POST', `/v1/trades/${code}/proofs/${PROOF}/blur-check`, { blur: true }],
    ['POST', `/v1/trades/${code}/blur-checks/${PROOF}`, { correct: true }],
    ['GET', `/v1/trades/${code}/proofs/${PROOF}`, undefined],
  ] as const;

  async function bannedWithTrades() {
    const id = await trader();
    const other = await trader();
    const third = await trader();
    const open = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    const closed = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    await driveTo(t.deps, closed.trade, 'released');
    const disputed = await seedTrade(t.deps, { sellerId: other, buyerId: id, poster: 'seller' });
    await driveTo(t.deps, disputed.trade, 'released');
    await t.deps.db.query(`insert into disputes (code, seq, opened_by, reason, opened_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, status) values ($1, 1, 'buyer', 'other', $2, $2, $2::timestamptz + interval '1 day', 0, 100000, 'appealed')`, [disputed.code, t.deps.clock()]);
    const theirs = await seedTrade(t.deps, { sellerId: other, buyerId: third, poster: 'seller' });
    expect((await ban(senior, id, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    return { id, open, closed, disputed, theirs, me: await asTrader(id) };
  }

  it('the blur checks and the proofs pass on the person\'s own open or disputed trade, and are 403 banned on a closed trade or someone else\'s', async () => {
    const { id, open, closed, disputed, theirs, me } = await bannedWithTrades();
    for (const code of [open.code, disputed.code]) {
      for (const [method, url, body] of tradeRoutes(code)) {
        const res = await me(method, url, body);
        expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(false);
      }
      const put = await putProof(id, code);
      expect(isBanned(put), `PUT proofs on ${code} ${put.body}`).toBe(false);
    }
    for (const code of [closed.code, theirs.code, newTradeCode()]) {
      for (const [method, url, body] of tradeRoutes(code)) {
        const res = await me(method, url, body);
        expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(true);
      }
      const put = await putProof(id, code);
      expect(isBanned(put), `PUT proofs on ${code} ${put.body}`).toBe(true);
    }
  });

  // D-005 (banState.ts, was NEEDS_TRADES_LIST): GET /v1/trades passes the gate while something is
  // unfinished, and then lists only the unfinished trades: open ones, and closed ones whose dispute
  // is not closed. The finished history is left out, for the account owner and its members alike.
  type Row = { code: string; lastActedBy?: unknown };
  const list = async (call: Awaited<ReturnType<typeof asTrader>>, q = '') => {
    const res = await call('GET', `/v1/trades${q}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { trades: Row[] }).trades;
  };
  const codes = (rows: Row[]) => rows.map((r) => r.code).sort();
  /** A joined team member of `teamId` with these boxes, as a trader-app caller (its own session row). */
  async function asMember(teamId: string, abilities: string[]) {
    const name = `Bm${randomBytes(4).toString('hex')}`;
    const loginId = await seedAccount(t.deps, { loginName: name.toLowerCase(), kind: 'member' });
    const now = t.deps.clock();
    const m = await t.deps.db.query<{ id: string }>(
      `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
      [teamId, name, name.toLowerCase(), abilities, now, loginId],
    );
    const { token, sessionId } = await insertSession(t.deps, teamId, 'trader');
    await t.deps.db.query('update sessions set member_id = $2 where id = $1', [sessionId, m.rows[0]!.id]);
    return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
      t.trader.inject({ method, url, headers: { origin: 'https://x2f.test' }, cookies: { '__Host-x2f_session': token }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  }

  it('D-005: a site-banned owner lists only their unfinished trades (open, or a dispute not closed); lastActedBy stays the owner\'s', async () => {
    const { open, closed, disputed, theirs, me } = await bannedWithTrades();
    const all = await list(me);
    expect(codes(all)).toEqual([open.code, disputed.code].sort());
    expect(codes(await list(me, '?status=open'))).toEqual([open.code]);
    // The owner's open row still says which member last acted (none here).
    expect((await list(me, '?status=open'))[0]).toHaveProperty('lastActedBy', null);
    const body = JSON.stringify(all);
    for (const c of [closed.code, theirs.code]) expect(body).not.toContain(c);
  });

  it('D-005: the history tab under a site ban: the finished trades are left out; a closed trade whose dispute is open stays', async () => {
    const { closed, disputed, me } = await bannedWithTrades();
    const done = await list(me, '?status=completed');
    expect(codes(done)).toEqual([disputed.code]);
    expect(JSON.stringify(done)).not.toContain(closed.code);
    // With nothing unfinished the list is behind the gate like every account-wide read: 403 banned.
    const idle = await trader();
    const other = await trader();
    const past = await seedTrade(t.deps, { sellerId: idle, buyerId: other, poster: 'seller' });
    await driveTo(t.deps, past.trade, 'released');
    expect((await ban(senior, idle, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const none = await (await asTrader(idle))('GET', '/v1/trades?status=completed');
    expect(isBanned(none), none.body).toBe(true);
  });

  it("D-005: a site-banned account's team members get the same unfinished trades, by their boxes, and never lastActedBy", async () => {
    const { id, open, closed, disputed } = await bannedWithTrades();
    const both = await asMember(id, ['trades-see-active', 'trades-see-history']);
    const rows = await list(both);
    expect(codes(rows)).toEqual([open.code, disputed.code].sort());
    for (const r of rows) expect(r).not.toHaveProperty('lastActedBy');
    expect(JSON.stringify(rows)).not.toContain(closed.code);
    // The part boxes still hold: See active trades only gets the open trade, and the history tab is 403 forbidden.
    const active = await asMember(id, ['trades-see-active']);
    expect(codes(await list(active))).toEqual([open.code]);
    const refused = await active('GET', '/v1/trades?status=completed');
    expect({ status: refused.statusCode, error: errorOf(refused) }).toEqual({ status: 403, error: 'forbidden' });
    const history = await asMember(id, ['trades-see-history']);
    expect(codes(await list(history, '?status=completed'))).toEqual([disputed.code]);
  });

  it('D-005: a trade ban alone changes nothing in the list: the whole history, both tabs', async () => {
    const id = await trader();
    const other = await trader();
    const open = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    const closed = await seedTrade(t.deps, { sellerId: id, buyerId: other, poster: 'seller' });
    await driveTo(t.deps, closed.trade, 'released');
    expect((await ban(senior, id, { kind: 'trade', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const me = await asTrader(id);
    expect(codes(await list(me))).toEqual([open.code, closed.code].sort());
    expect(codes(await list(me, '?status=completed'))).toEqual([closed.code]);
  });

  // The session-proof pair (S-085) is not a route yet (banState.ts NEEDS_DEVICE_BOUND), so lead call
  // 1's other account-wide addition here is the freeze read.
  it('the freeze read passes while something is unfinished, and is 403 banned with nothing unfinished', async () => {
    const { me } = await bannedWithTrades();
    const idle = await trader();
    expect((await ban(senior, idle, { kind: 'site', ruleId: 'abuse', until: IN_A_WEEK })).res.statusCode).toBe(201);
    const them = await asTrader(idle);
    const res = await me('GET', '/v1/account/freeze');
    expect(res.statusCode, res.body).toBe(200);
    const none = await them('GET', '/v1/account/freeze');
    expect(isBanned(none), `nothing unfinished: ${none.body}`).toBe(true);
  });

  // Bans onto main (lead default, 21 Nov): main's trade-room routes that came after bans, scoped
  // as lead call 1 scoped the others: the chat key record and the fallback grant (chat membership
  // design tasks 4 and 6) for an unfinished trade's chat only; the signed ruling statement
  // (Haveno review finding 2) and the seller's payment proof for a ruling (Plan 4 Task 12, A6) for
  // an unfinished trade only.
  it('main\'s later room routes: the chat key and grant on an unfinished trade\'s chat, the ruling statement and the payment proof on an unfinished trade; 403 banned anywhere else', async () => {
    const { id, open, closed, disputed, theirs, me } = await bannedWithTrades();
    const other = (await t.deps.db.query<{ buyer: string }>('select buyer_account_id::text as buyer from trades where code = $1', [open.code])).rows[0]!.buyer;
    const chatOf = async (code: string, trade: { offerId: string }, sellerId: string, buyerId: string) =>
      insertChat({ offerId: trade.offerId, buyerId, sellerId, tradeCode: code });
    const openChat = await chatOf(open.code, open.trade, id, other);
    const disputedChat = await chatOf(disputed.code, disputed.trade, other, id);
    const closedChat = await chatOf(closed.code, closed.trade, id, other);
    const offerChat = await insertChat({ offerId: await seedOffer(t.deps, id, 'seller'), buyerId: other, sellerId: id, tradeCode: null });
    const chatRoutes = (chat: string) => [
      ['GET', `/v1/chats/${chat}/key`, undefined],
      ['POST', `/v1/chats/${chat}/key`, {}],
      ['POST', `/v1/chats/${chat}/grant`, {}],
    ] as const;
    const tradeRoutes2 = (code: string) => [
      ['GET', `/v1/trades/${code}/ruling-statement`, undefined],
      ['POST', `/v1/trades/${code}/payment-proof`, {}],
    ] as const;
    for (const chat of [openChat, disputedChat]) {
      for (const [method, url, body] of chatRoutes(chat)) {
        const res = await me(method, url, body);
        expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(false);
      }
    }
    for (const code of [open.code, disputed.code]) {
      for (const [method, url, body] of tradeRoutes2(code)) {
        const res = await me(method, url, body);
        expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(false);
      }
    }
    for (const chat of [closedChat, offerChat]) {
      for (const [method, url, body] of chatRoutes(chat)) {
        const res = await me(method, url, body);
        expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(true);
      }
    }
    for (const code of [closed.code, theirs.code, newTradeCode()]) {
      for (const [method, url, body] of tradeRoutes2(code)) {
        const res = await me(method, url, body);
        expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(true);
      }
    }
  });

  it('offers, posting and taking stay 403 banned with an open trade', async () => {
    const { me } = await bannedWithTrades();
    const offerId = await seedOffer(t.deps, await trader(), 'seller');
    for (const [method, url] of [
      ['GET', '/v1/offers?side=sell&method=zelle'], ['GET', `/v1/offers/${offerId}`], ['POST', '/v1/offers'],
      ['POST', `/v1/offers/${offerId}/take`], ['GET', '/v1/account/offers'], ['POST', '/v1/account/offers/status'], ['PATCH', `/v1/offers/${offerId}`],
    ] as const) {
      const res = await me(method, url, method === 'GET' ? undefined : {});
      expect(isBanned(res), `${method} ${url} ${res.body}`).toBe(true);
    }
  });
});

describe('staff route table', () => {
  it('a staff session is not a trader session (the notice route is the trader app\'s)', async () => {
    const res = await new StaffBrowser(t.app).withSession((await insertSession(t.deps, senior.id, 'staff')).token).get('/v1/account/ban');
    expect(res.statusCode).toBe(404);
  });
});
