// Plan 4 Task 11: the moderator's queue and case view, messages to the parties, the
// unblurred-proof request, and the freeze. Design build task 9 (landed): the moderator's chat READ is
// the chat key re-wrapped by the moderation process to the staff member's certified device (no
// staff route ever returns chat text), and the moderator's MESSAGE is ciphertext that device sealed
// and countersigned, which the moderation process signs as the moderator. Owner 2026-11-02 (binding): a dispute
// alone never blocks trading; a moderator freezes an account only as a separate later action, when
// a party ignores the dispute (~48 h with no reply) or ignores a ruling, and the freeze has no end
// time: a moderator lifts it once the person has done what the dispute asks.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chatKeyHash, encryptChat, makeModCountersign, newChatKey, openChat, ReplayGuard, signChatEnvelope, unwrapChatKey, wrapChatKey, type ChatEnvelopeV2, type Identity, type Participants } from '@x2f/protocol';
import { channelFor } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { isIncidentId } from '@x2f/staff';
import { ModerationError, NO_MODERATION, type ModCaseCall, type ModCountersigned } from '../../src/disputes/moderationClient.js';
import { disputeSettings } from '../../src/disputes/settings.js';
import { getMethod } from '../../src/methods/profiles.js';
import { loadDispute } from '../../src/disputes/store.js';
import { buildStaffApi, type ModerationClient } from '../../src/staff/app.js';
import { CHAT_READ_MAX } from '../../src/disputes/staffRoutes.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { seedAccount } from '../helpers/accounts.js';
import { Browser } from '../helpers/totp.js';
import { rolesToAbilities } from '../../src/team/abilities.js';
import { insertOffer } from '../helpers/offers.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff, seedTap } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { driveTo, seedTrade } from '../helpers/trades.js';
import { applyEvent } from '../../src/trades/store.js';
import { traderSummaries } from '../../src/traders/summary.js';

const START = new Date('2026-11-02T12:00:00Z');

/**
 * A chat identity for the test's stand-in moderation process, made the way chat.test.ts does (the
 * API's tree may not name the protocol's identity maker: tools/separation-check.ts).
 */
async function keyPair(): Promise<Identity> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}
const MIN = 60_000;
const H = 60 * MIN;

/** One trade's chat as the test's stand-in for the moderation process holds it. */
interface ChatSetup {
  chat: string;
  channel: string;
  ids: Record<'buyer' | 'seller' | 'mod', Identity>;
  participants: Participants;
  seq: number;
  /** The chat key (design task 5): the stand-in holds it to re-wrap; a real moderation process opens it from the grant. */
  tk: Uint8Array;
}

/** The staff member's certified device (staff-web's key), as the stand-in's gate would know it. */
let DEVICE: Identity;
const DEVICE_KEY_ID = 'd'.repeat(32);

/**
 * The moderation process as the API sees it. Every call first checks that the API wrote and
 * committed the log entry it names (the real process refuses otherwise; apps/moderation's
 * internal.test.ts tests that side), so a call made before the log entry exists fails the test.
 */
class FakeModeration implements ModerationClient {
  readonly name = 'moderation' as const;
  calls: Array<{ op: string; code: string; logEntryId: string }> = [];
  chats = new Map<string, ChatSetup>();
  constructor(private readonly db: Deps['db']) {}

  private async logged(id: string, action: string, code: string): Promise<void> {
    const { rows } = await this.db.query<{ action: string; trade_code: string }>('select action, trade_code from activity_log where id = $1', [id]);
    if (rows[0]?.action !== action || rows[0]?.trade_code !== code) throw new ModerationError(403, 'log-entry-invalid');
  }

  async chatGrant(a: ModCaseCall) {
    await this.logged(a.logEntryId, 'chat.read', a.code);
    this.calls.push({ op: 'grant', code: a.code, logEntryId: a.logEntryId });
    const c = this.chats.get(a.code);
    if (!c) throw new ModerationError(404, 'no-chat');
    if (a.deviceKeyId !== DEVICE_KEY_ID) throw new ModerationError(403, 'device-not-certified');
    return { wrap: await wrapChatKey(DEVICE.boxPublic, c.tk), tkh: (await deps.db.query<{ tkh: string }>('select tkh from chat_keys where chat = $1', [c.chat])).rows[0]!.tkh, boxPublic: DEVICE.boxPublic, nextSeq: c.seq };
  }

  async chatSend(a: ModCaseCall & ModCountersigned) {
    // Review 8 Nov M-2: the API asks under `chat.message-requested`; `chat.message-sent` comes after.
    await this.logged(a.logEntryId, 'chat.message-requested', a.code);
    this.calls.push({ op: 'send', code: a.code, logEntryId: a.logEntryId });
    const c = this.chats.get(a.code);
    if (!c) throw new ModerationError(404, 'no-chat');
    if (a.seq !== c.seq) throw new ModerationError(409, 'stale-seq', c.seq);
    c.seq++;
    return { envelope: await signChatEnvelope({ v: 2, trade: c.channel, from: 'mod', seq: a.seq, nonce: a.nonce, ct: a.ct }, c.ids.mod) };
  }
}

let trader: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let newTrader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let moderation: FakeModeration;

beforeAll(async () => {
  const t = await tradeApp();
  ({ app: trader, deps, setNow } = t);
  newTrader = t.trader;
  moderation = new FakeModeration(deps.db);
  DEVICE = await keyPair();
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation, traderEvents: trader.events });
});
afterAll(async () => {
  await staffApp.close();
  await trader.close();
});

const errorOf = (res: { body: string }) => (res.body === '' ? undefined : (JSON.parse(res.body) as { error?: string }).error);

async function staff(role: 'mod' | 'senior' | 'owner' | 'helper', app = staffApp) {
  const s = await seedStaff(deps, { role });
  const { token } = await insertSession(deps, s.id, 'staff');
  const name = (await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [s.id])).rows[0]!.display_name;
  const b = new StaffBrowser(app).withSession(token);
  /** A new session at the current test clock (staff sessions last 2 hours). */
  const fresh = async () => {
    b.withSession((await insertSession(deps, s.id, 'staff')).token);
  };
  return { id: s.id, name, b, fresh };
}

/** The one owner (the database allows one), made on first use. */
let theOwner: Awaited<ReturnType<typeof staff>> | null = null;
const ownerOnce = async () => (theOwner ??= await staff('owner'));

/** The seller's confirm window seedTrade gives every trade (its `confirmWindowMin`). */
const CONFIRM_WINDOW_MIN = 120;

/**
 * A trade the buyer disputed at `at`, with its chat (both traders' identities and the mod's). The
 * buyer marked it paid one confirm window before `at`: trade-rules P1 (owner p9-4, proto review P1)
 * lets the buyer open a dispute only after "I've paid" and the method's full wait, so `at` is the
 * first moment the dispute may open.
 */
async function disputed(at = START, o: { methodId?: string; seller?: Awaited<ReturnType<typeof newTrader>>; buyer?: Awaited<ReturnType<typeof newTrader>> } = {}) {
  setNow(new Date(at.getTime() - CONFIRM_WINDOW_MIN * MIN));
  const seller = o.seller ?? (await newTrader());
  const buyer = o.buyer ?? (await newTrader());
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', ...(o.methodId ? { methodId: o.methodId } : {}) });
  expect(trade.confirmWindowMin).toBe(CONFIRM_WINDOW_MIN);
  const t = await driveTo(deps, trade, 'paid');
  expect(t.confirmBy).toEqual(at);
  setNow(at);
  for (const p of [seller, buyer]) expect((await p.browser.post('/t/login', { accountId: p.id })).statusCode).toBe(200);
  const res = await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
  expect(res.statusCode, res.body).toBe(200);
  const opened = await buyer.browser.post(`/v1/trades/${t.code}/chat`, {});
  expect(opened.statusCode, opened.body).toBe(200);
  const chat = (opened.json() as { chat: string }).chat;
  const ids = { buyer: await keyPair(), seller: await keyPair(), mod: await keyPair() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  // The chat's key record (design task 4), filed directly: these routes only need it to exist.
  const tk = await newChatKey();
  await deps.db.query(
    `insert into chat_keys (chat, tkh, created_by_role, wrap_buyer, wrap_seller, sig, created_at) values ($1, $2, 'buyer', 'AAAA', 'AAAA', $3, now())`,
    [chat, await chatKeyHash(tk), 'a'.repeat(128)],
  );
  await deps.db.query('insert into chat_attestations (chat, attestation, sig) values ($1, $2, $3) on conflict do nothing', [chat, { v: 1, trade: chat, participants }, 'aa']);
  moderation.chats.set(t.code, { chat, channel: await channelFor(chat, 'chat'), ids, participants, seq: 0, tk });
  return { seller, buyer, code: t.code, chat };
}

/**
 * A moderator message as staff-web sends it (design build task 9): sealed under the chat key as
 * `from: 'mod'` at the chat's next moderator seq, countersigned by the staff device key.
 */
async function msg(code: string, text: string, o: { seq?: number } = {}) {
  const c = moderation.chats.get(code)!;
  const body = await encryptChat({ trade: c.channel, from: 'mod', seq: o.seq ?? c.seq, type: 'chat.msg', payload: { text }, tk: c.tk });
  const cs = await makeModCountersign({ body, requestId: randomUUID().replace(/-/g, ''), issuedAt: new Date(deps.clock().getTime()).toISOString(), me: DEVICE });
  return { deviceKeyId: DEVICE_KEY_ID, seq: body.seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig };
}

const url = (code: string, tail = '') => `/staff/v1/disputes/${code}${tail}`;

async function logOf(code: string) {
  const { rows } = await deps.db.query<{ id: string; action: string; actor_kind: string; actor_id: string | null; detail: string }>(
    'select id::text as id, action, actor_kind, actor_id::text as actor_id, detail from activity_log where trade_code = $1 order by id',
    [code],
  );
  return rows;
}

/** The frames one trader's open streams receive (the trader API's own event bus). */
function stream(accountId: string): { frames: string[]; stop(): void } {
  const frames: string[] = [];
  const detach = trader.events.attach(accountId, { send: (f) => frames.push(f), close: () => {} });
  if (detach === null) throw new Error('stream cap');
  return { frames, stop: detach };
}
const eventsOf = (frames: string[], type: string) =>
  frames.map((f) => JSON.parse(f.slice('data: '.length)) as { type: string }).filter((e) => e.type === type);

async function activeFreezes(accountId: string) {
  const { rows } = await deps.db.query('select kind, side, reason, dispute_code from trading_holds where account_id = $1 and lifted_at is null', [accountId]);
  return rows;
}

describe('the queue', () => {
  it('lists open disputes closest deadline first, with the counts; mine and free filter; next assigns the oldest unassigned', async () => {
    const a = await disputed(new Date(START.getTime() - 3 * H));
    const b = await disputed(new Date(START.getTime() - 5 * H));
    setNow(START);
    const mod = await staff('mod');
    const all = await mod.b.get('/staff/v1/disputes?filter=all');
    expect(all.statusCode, all.body).toBe(200);
    const body = all.json() as { rows: Array<Record<string, unknown>>; counts: Record<string, number> };
    const mine = body.rows.filter((r) => r.code === a.code || r.code === b.code);
    expect(mine.map((r) => r.code)).toEqual([b.code, a.code]);
    expect(mine[0]).toMatchObject({
      code: b.code, xmr: '1250000000000', usd: '412.50', method: 'zelle', openedBy: 'buyer', waitingMs: 5 * H,
      replyDueAt: new Date(START.getTime() - H).toISOString(), deadlineTone: 'overdue', approval: 'not-needed', assignee: null,
    });
    expect(mine[1]).toMatchObject({ deadlineTone: 'due', waitingMs: 3 * H });
    expect(body.counts.open).toBeGreaterThanOrEqual(2);
    expect(body.counts.overdue).toBeGreaterThanOrEqual(1);
    expect(body.counts.unassigned).toBeGreaterThanOrEqual(2);
    expect(body.counts).toHaveProperty('needApproval');
    // Plan 4 Task 18 (ModQueue): the header's reply time and the footer's large-trade limit.
    expect((all.json() as { settings: unknown }).settings).toEqual({
      firstResponseH: (await disputeSettings(deps.db)).firstResponseH,
      largeTradeLimitUsd: (await disputeSettings(deps.db)).largeTradeLimitUsd,
    });

    // `next` takes the unassigned dispute due first (here: b or an older one from another test).
    const next = await mod.b.post('/staff/v1/disputes/next', {});
    expect(next.statusCode, next.body).toBe(200);
    const took = (next.json() as { code: string | null }).code!;
    expect((await loadDispute(deps.db, took))!.assignee).toBe(mod.id);
    const m = (await mod.b.get('/staff/v1/disputes?filter=mine')).json() as { rows: Array<{ code: string; assignee: string }> };
    expect(m.rows.map((r) => r.code)).toEqual([took]);
    expect(m.rows[0]!.assignee).toBe(mod.name);
    const free = (await mod.b.get('/staff/v1/disputes?filter=free')).json() as { rows: Array<{ code: string }> };
    expect(free.rows.map((r) => r.code)).not.toContain(took);
    expect((await mod.b.get('/staff/v1/disputes?filter=sideways')).statusCode).toBe(400);
  });

  it('take assigns the caller and logs dispute.assigned; a second mod cannot take an assigned case', async () => {
    const mod = await staff('mod');
    const other = await staff('mod');
    const { code } = await disputed();
    const res = await mod.b.post(url(code, '/take'), {});
    expect(res.statusCode, res.body).toBe(200);
    expect((await loadDispute(deps.db, code))!.assignee).toBe(mod.id);
    expect((await logOf(code)).filter((e) => e.action === 'dispute.assigned')).toEqual([
      expect.objectContaining({ actor_kind: 'staff', actor_id: mod.id }),
    ]);
    // G37: who, when (the entry's time) and when the trade was opened.
    const taken = (await deps.db.query<{ taken_at: Date }>('select taken_at from trades where code = $1', [code])).rows[0]!.taken_at;
    expect(JSON.parse((await logOf(code)).find((e) => e.action === 'dispute.assigned')!.detail)).toEqual({ staffId: mod.id, tradeOpenedAt: taken.toISOString() });
    const again = await other.b.post(url(code, '/take'), {});
    expect({ status: again.statusCode, error: errorOf(again) }).toEqual({ status: 409, error: 'wrong-state' });
    expect((await mod.b.post(url('0000-0000-0000-0000', '/take'), {})).statusCode).toBe(404);
  });

  it('NEEDS_P4_CASE_ASSIGNEE: a taken case counts as the member\'s open case; switching them off puts it back in the queue for another moderator', async () => {
    const owner = await ownerOnce();
    const mod = await staff('mod');
    const other = await staff('mod');
    const { code } = await disputed();
    for (const s of [owner, mod, other]) await s.fresh();
    expect((await mod.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    const members = async () => ((await owner.b.get('/staff/v1/members')).json() as { members: Array<{ accountId: string | null; openCases: number }> }).members;
    expect((await members()).find((m) => m.accountId === mod.id)!.openCases).toBe(1);
    expect((await owner.b.post(`/staff/v1/members/${mod.id}/switch-off`, {})).statusCode).toBe(200);
    expect((await members()).find((m) => m.accountId === mod.id)!.openCases).toBe(0);
    const free = (await other.b.get('/staff/v1/disputes?filter=free')).json() as { rows: Array<{ code: string; assignee: string | null }> };
    expect(free.rows.find((r) => r.code === code)).toMatchObject({ assignee: null });
    expect((await other.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    expect((await loadDispute(deps.db, code))!.assignee).toBe(other.id);
  });

  it('a dispute alone places no hold and no freeze: both traders can still trade', async () => {
    const mod = await staff('mod');
    const { seller, buyer, code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    await mod.b.post(url(code, '/messages'), await msg(code, 'Hello'));
    expect(await activeFreezes(seller.id)).toEqual([]);
    expect(await activeFreezes(buyer.id)).toEqual([]);
  });
});

describe('the case view', () => {
  it('names the payment method from the catalog (data/payment-methods.json), and gives the id where the catalog has none', async () => {
    const { code } = await disputed();
    const mod = await staff('mod');
    const first = await mod.b.get(url(code));
    expect(first.statusCode, first.body).toBe(200);
    // The trade helper seeds `zelle`, which is not a catalog id: the id is shown as it is.
    expect(((await mod.b.get(url(code))).json() as { escrow: { methodName: string } }).escrow.methodName).toBe('zelle');
    // A trade's deal never changes, so the catalog case is its own dispute, on the catalog's id.
    const named = (await disputed(START, { methodId: 'ZELLE' })).code;
    await mod.fresh();
    const v = (await mod.b.get(url(named))).json() as { escrow: { methodId: string; methodName: string } };
    expect(v.escrow).toMatchObject({ methodId: 'ZELLE', methodName: getMethod('ZELLE')!.name });
    expect(getMethod('ZELLE')!.name).toBe('Zelle');
    const q = (await mod.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string; method: string; methodName: string }> };
    expect(q.rows.find((r) => r.code === named)).toMatchObject({ method: 'ZELLE', methodName: 'Zelle' });
    expect(q.rows.find((r) => r.code === code)).toMatchObject({ method: 'zelle', methodName: 'zelle' });
  });

  it('shows the header, both traders, the escrow and the ruling state; logs case.opened once per person; returns no chat', async () => {
    const mod = await staff('mod');
    const { code, seller } = await disputed();
    const res = await mod.b.get(url(code));
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json() as Record<string, unknown>;
    expect(v).toMatchObject({
      code, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', afterRefund: false, assignee: null,
      escrow: { state: 'disputed', amountAtomic: '1250000000000', methodId: 'zelle', currency: 'USD', fiatCents: '41250' },
      ruling: { draft: null, publishedAt: null, appealEndsAt: null, appeal: null },
      freezes: { buyer: false, seller: false },
    });
    expect((v.traders as { seller: { displayName: string } }).seller.displayName).toBe(seller.displayName);
    expect(JSON.stringify(v)).not.toMatch(/messages|envelope/);
    await mod.b.get(url(code));
    expect((await logOf(code)).filter((e) => e.action === 'case.opened').map((e) => e.actor_id)).toEqual([mod.id]);
    expect((await loadDispute(deps.db, code))!.seen).toContain(mod.id);
  });

  it("J-21 (owner T-017): each trader's ONE cancel figure, every kind together, is in the case view only, beside the public summaries", async () => {
    const mod = await staff('mod');
    const { code, seller, buyer } = await disputed();
    // Earlier trades between them: the buyer cancelled two, the seller walked away from one.
    const cancelled = async (by: 'buyer' | 'seller') => {
      const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      await applyEvent(deps, t.code, by === 'buyer' ? { type: 'buyer-cancel' } : { type: 'walk-away' }, by);
    };
    await cancelled('buyer');
    await cancelled('buyer');
    await cancelled('seller');
    const v = (await mod.b.get(url(code))).json() as { cancels: unknown; traders: Record<string, Record<string, unknown>> };
    expect(v.cancels).toEqual({ buyer: 2, seller: 1 });
    // The summaries are what any trader sees: no cancel figure in them.
    for (const side of ['buyer', 'seller']) expect(Object.keys(v.traders[side]!).some((k) => /cancel/i.test(k))).toBe(false);
  });
});

// D-049 (owner 28 Oct, leaning yes; lead default): profiles show "Disputes: N won, M lost". The
// public summary (offer cards, the trade view's counterparty, the profile) carries both counts,
// each dispute by its latest ruling (an appeal's final ruling replaces round 1); an open dispute,
// and an after-refund "no action" ruling (owner question), count for neither side.
describe('disputes won and lost (D-049)', () => {
  it('counts each ruled dispute once for the winner and once for the loser, by the latest ruling', async () => {
    const pair = { seller: await newTrader(), buyer: await newTrader() };
    const a = await disputed(START, pair);
    await publishRuling(deps, a.code, { outcome: 'release-to-buyer' });
    const b = await disputed(new Date(START.getTime() + 3 * H), pair);
    await publishRuling(deps, b.code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, b.code, 'seller');
    await publishRuling(deps, b.code, { outcome: 'refund-to-seller' });
    const c = await disputed(new Date(START.getTime() + 6 * H), pair);
    await publishRuling(deps, c.code, { outcome: 'refund-to-seller' });
    await disputed(new Date(START.getTime() + 9 * H), pair);
    const s = await traderSummaries(deps.db, [pair.buyer.id, pair.seller.id], deps.clock(), null);
    expect(s.get(pair.buyer.id)!.disputes).toEqual({ won: 1, lost: 2 });
    expect(s.get(pair.seller.id)!.disputes).toEqual({ won: 2, lost: 1 });
    // What a trader sees of the other side: the trade view's counterparty is the same summary.
    const view = (await pair.seller.browser.get(`/v1/trades/${a.code}`)).json() as { counterparty: { disputes: unknown } };
    expect(view.counterparty.disputes).toEqual({ won: 1, lost: 2 });
    const fresh = await newTrader();
    expect((await traderSummaries(deps.db, [fresh.id], deps.clock(), null)).get(fresh.id)!.disputes).toEqual({ won: 0, lost: 0 });
  });
});

describe('who works a case', () => {
  it('an unassigned mod gets forbidden-case; the assignee and a senior may write', async () => {
    const mod = await staff('mod');
    const stranger = await staff('mod');
    const senior = await staff('senior');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    for (const route of ['/messages', '/proof-request', '/freeze']) {
      const res = await stranger.b.post(url(code, route), route === '/messages' ? await msg(code, 'Hello') : route === '/proof-request' ? { side: 'buyer' } : route === '/freeze' ? { side: 'seller', on: true, reason: 'no-reply' } : {});
      expect({ route, status: res.statusCode, error: errorOf(res) }).toEqual({ route, status: 403, error: 'forbidden-case' });
    }
    expect((await mod.b.post(url(code, '/messages'), await msg(code, 'One.'))).statusCode).toBe(201);
    expect((await senior.b.post(url(code, '/messages'), await msg(code, 'Two.'))).statusCode).toBe(201);
  });

  it('landed (was NEEDS_P4_MOD_COUNTERSIGN): a chat with no key record takes no moderator message (409 no-key), and a text body is refused before anything is logged', async () => {
    const mod = await staff('mod');
    const { code, chat } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const before = moderation.calls.length;
    let res = await mod.b.post(url(code, '/messages'), { text: 'Seller, release now.' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 400, error: 'bad-request' });
    const body = await msg(code, 'Hello');
    await deps.db.query('delete from chat_keys where chat = $1', [chat]);
    res = await mod.b.post(url(code, '/messages'), body);
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'no-key' });
    expect(moderation.calls.length).toBe(before);
    expect((await logOf(code)).filter((e) => e.action === 'chat.message-requested')).toEqual([]);
    const src = await (await import('node:fs/promises')).readFile(new URL('../../src/disputes/staffRoutes.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/NEEDS_P4_MOD_COUNTERSIGN|NEEDS_P4_CHAT_MEMBERSHIP|X2F_DEV_MOD_CHAT|chat-keyed/);
  });

  it('with logging failing, no message is sealed and the moderation process is never asked', async () => {
    const broken = await buildStaffApi({
      ...deps, staffOrigin: STAFF_ORIGIN, moderation, traderEvents: trader.events,
      appendLog: async () => {
        throw new Error('log down');
      },
    });
    try {
      const mod = await staff('mod', broken);
      const { code } = await disputed();
      // Assign directly: the take route logs too.
      await deps.db.query('update disputes set assignee = $2 where code = $1', [code, mod.id]);
      const before = moderation.calls.length;
      const res = await mod.b.post(url(code, '/messages'), await msg(code, 'Hello'));
      expect(res.statusCode).toBe(500);
      expect(moderation.calls.length).toBe(before);
    } finally {
      await broken.close();
    }
  });

  it('the first message by each moderator tells both traders once: moderator-joined and the moderator in the dispute view', async () => {
    const mod = await staff('mod');
    const senior = await staff('senior');
    const { code, buyer, seller } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const sb = stream(buyer.id);
    const ss = stream(seller.id);
    try {
      await mod.b.post(url(code, '/messages'), await msg(code, 'One.'));
      await mod.b.post(url(code, '/messages'), await msg(code, 'Two.'));
      for (const s of [sb, ss]) expect(eventsOf(s.frames, 'moderator-joined')).toEqual([{ type: 'moderator-joined', code, username: mod.name }]);
      await senior.b.post(url(code, '/messages'), await msg(code, 'Three.'));
      await senior.b.post(url(code, '/messages'), await msg(code, 'Four.'));
      expect(eventsOf(sb.frames, 'moderator-joined')).toEqual([
        { type: 'moderator-joined', code, username: mod.name },
        { type: 'moderator-joined', code, username: senior.name },
      ]);
    } finally {
      sb.stop();
      ss.stop();
    }
    const view = (await buyer.browser.get(`/v1/trades/${code}/dispute`)).json() as { moderator: { name: string } | null };
    expect(view.moderator?.name).toBe(senior.name);
  });

  it('round 2: a moderator involved in round 1 gets forbidden-case, even as a senior', async () => {
    const senior = await staff('senior');
    const { code } = await disputed();
    await senior.b.post(url(code, '/take'), {});
    await senior.b.get(url(code));
    await deps.db.query('update disputes set assignee = null where code = $1', [code]);
    await publishRuling(deps, code, { outcome: 'release-to-buyer', staffId: senior.id });
    // The appeal makes everyone seen on round 1 involved (R37): the senior took and opened it.
    await appealDirect(deps, code, 'seller');
    expect((await loadDispute(deps.db, code))!.round1!.involved).toContain(senior.id);
    const res = await senior.b.post(url(code, '/messages'), await msg(code, 'Hello'));
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden-case' });
    const fresh = await staff('senior');
    expect((await fresh.b.post(url(code, '/messages'), await msg(code, 'Hello'))).statusCode).toBe(201);
  });

  it('landed (was NEEDS_P4_CHAT_MEMBERSHIP): the read commits one chat.read per read before the moderation process re-wraps the key to the device; the answer is ciphertext only', async () => {
    const mod = await staff('mod');
    const { code, chat } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    await mod.b.post(url(code, '/messages'), await msg(code, 'Before the read.'));
    const res = await mod.b.post(url(code, '/chat'), { deviceKeyId: DEVICE_KEY_ID });
    expect(res.statusCode, res.body).toBe(200);
    const a = res.json() as { chat: string; channel: string; wrap: string; tkh: string; nextSeq: number; attestation: unknown; record: { tkh: string }; envelopes: Array<{ senderRole: string; envelope: ChatEnvelopeV2 }> };
    const c = moderation.chats.get(code)!;
    const tkh = await chatKeyHash(c.tk);
    expect({ chat: a.chat, channel: a.channel, nextSeq: a.nextSeq, tkh: a.tkh, recordTkh: a.record.tkh }).toEqual({ chat, channel: c.channel, nextSeq: 1, tkh, recordTkh: tkh });
    // Only the device's own key opens the wrap, to the chat's key.
    expect(sodium.memcmp(await unwrapChatKey(DEVICE, a.wrap, tkh), c.tk)).toBe(true);
    await expect(unwrapChatKey(c.ids.buyer, a.wrap, tkh)).rejects.toBeDefined();
    const mine = a.envelopes.filter((e) => e.senderRole === 'mod');
    expect(await openChat(mine[0]!.envelope, { tk: c.tk, trade: c.channel, participants: c.participants, guard: new ReplayGuard(c.channel) })).toEqual({ from: 'mod', type: 'chat.msg', payload: { text: 'Before the read.' } });
    expect(JSON.stringify(a)).not.toContain('Before the read.');
    // One chat.read per read, the staff member as its actor, committed before the grant was asked.
    const reads = (await logOf(code)).filter((e) => e.action === 'chat.read');
    expect(reads.map((e) => [e.actor_kind, e.actor_id])).toEqual([['staff', mod.id]]);
    expect(moderation.calls.filter((x) => x.op === 'grant').map((x) => x.logEntryId)).toEqual([reads[0]!.id]);
    // The staff member's copy is filed against the chat (the API cannot open it).
    const { rows } = await deps.db.query("select member_ref, trigger, log_entry_id::text as entry from chat_members where chat = $1 and member_kind = 'staff'", [chat]);
    expect(rows).toEqual([{ member_ref: `${mod.id}/${DEVICE_KEY_ID}`, trigger: 'assigned', entry: reads[0]!.id }]);
    // A device the moderation process does not know as certified: refused, the read still logged.
    const bad = await mod.b.post(url(code, '/chat'), { deviceKeyId: 'e'.repeat(32) });
    expect({ status: bad.statusCode, error: errorOf(bad) }).toEqual({ status: 403, error: 'device-not-certified' });
    expect((await mod.b.post(url(code, '/chat'), {})).statusCode).toBe(400);
  });

  it('review N11 (e), design section 7: a revoked device\'s copy of the chat key is marked removed, by its revoke-device tap or with its person\'s switch-off', async () => {
    const owner = await ownerOnce();
    const { code, chat } = await disputed();
    const a = await staff('mod');
    const b = await staff('senior');
    await a.b.post(url(code, '/take'), {});
    for (const p of [a, b]) expect((await p.b.post(url(code, '/chat'), { deviceKeyId: DEVICE_KEY_ID })).statusCode).toBe(200);
    const removed = async () => (await deps.db.query<{ member_ref: string; removed: boolean }>(
      "select member_ref, removed_at is not null as removed from chat_members where chat = $1 and member_kind = 'staff' order by member_ref", [chat],
    )).rows;
    expect((await removed()).every((r) => !r.removed)).toBe(true);
    // a revokes the device with its own tap (the API's record of the certification, then the revoke).
    const cert = await seedTap(deps, a.id, { kind: 'certify-device', accountId: a.id, deviceKeyId: DEVICE_KEY_ID, signPublic: DEVICE.signPublic, boxPublic: DEVICE.boxPublic });
    await deps.db.query('update key_taps set used_at = $2 where id = $1', [cert, deps.clock()]);
    const rv = await seedTap(deps, a.id, { kind: 'revoke-device', accountId: a.id, deviceKeyId: DEVICE_KEY_ID });
    expect((await a.b.post(`/staff/v1/devices/${DEVICE_KEY_ID}/revoke`, { tapId: rv })).statusCode).toBe(204);
    expect(await removed()).toEqual([
      { member_ref: `${a.id}/${DEVICE_KEY_ID}`, removed: true },
      { member_ref: `${b.id}/${DEVICE_KEY_ID}`, removed: false },
    ].sort((x, y) => x.member_ref.localeCompare(y.member_ref)));
    // b is switched off: every copy of theirs.
    await owner.fresh();
    expect((await owner.b.post(`/staff/v1/members/${b.id}/switch-off`, {})).statusCode).toBe(200);
    expect((await removed()).every((r) => r.removed)).toBe(true);
  });

  it('review N11 (f): a chat longer than CHAT_READ_MAX returns its newest envelopes and says older ones are not shown', async () => {
    const mod = await staff('mod');
    const { code, chat } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const short = (await mod.b.post(url(code, '/chat'), { deviceKeyId: DEVICE_KEY_ID })).json() as { olderNotShown: boolean };
    expect(short.olderNotShown).toBe(false);
    await deps.db.query(
      `insert into chat_envelopes (chat, sender_role, seq, envelope, created_at)
       select $1, 'buyer', 1000 + g, jsonb_build_object('n', g), $2 from generate_series(0, $3) g`,
      [chat, deps.clock(), CHAT_READ_MAX],
    );
    const { rows } = await deps.db.query<{ id: string }>('select id::text as id from chat_envelopes where chat = $1 order by id', [chat]);
    const res = await mod.b.post(url(code, '/chat'), { deviceKeyId: DEVICE_KEY_ID });
    const a = res.json() as { olderNotShown: boolean; envelopes: Array<{ id: string }> };
    expect(a.olderNotShown).toBe(true);
    expect(a.envelopes).toHaveLength(CHAT_READ_MAX);
    // The newest, oldest first.
    expect(a.envelopes.map((e) => e.id)).toEqual(rows.slice(-CHAT_READ_MAX).map((r) => r.id));
  });

  it('reads are logged before any key is granted: with logging failing nothing is granted, and someone not on the case is refused first', async () => {
    const broken = await buildStaffApi({
      ...deps, staffOrigin: STAFF_ORIGIN, moderation, traderEvents: trader.events,
      appendLog: async () => {
        throw new Error('log down');
      },
    });
    try {
      const mod = await staff('mod', broken);
      const { code } = await disputed();
      await deps.db.query('update disputes set assignee = $2 where code = $1', [code, mod.id]);
      const before = moderation.calls.length;
      expect((await mod.b.post(url(code, '/chat'), { deviceKeyId: DEVICE_KEY_ID })).statusCode).toBe(500);
      expect(moderation.calls.length).toBe(before);
    } finally {
      await broken.close();
    }
    const stranger = await staff('mod');
    const { code } = await disputed();
    await (await staff('mod')).b.post(url(code, '/take'), {});
    const res = await stranger.b.post(url(code, '/chat'), { deviceKeyId: DEVICE_KEY_ID });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden-case' });
    expect((await logOf(code)).filter((e) => e.action === 'chat.read')).toEqual([]);
  });
});

describe('messages to the parties', () => {
  it('a mod message is logged, stored as a mod envelope that opens for buyer and seller, and counts as the first reply', async () => {
    const mod = await staff('mod');
    const { code, chat, buyer, seller } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const sb = stream(buyer.id);
    try {
      const res = await mod.b.post(url(code, '/messages'), await msg(code, 'Please upload your bank statement.'));
      expect(res.statusCode, res.body).toBe(201);
      expect(eventsOf(sb.frames, 'chat')).toEqual([{ type: 'chat', chat }]);
    } finally {
      sb.stop();
    }
    // Review 8 Nov M-2: the request is logged before sealing, and the send (with the envelope id)
    // in the transaction that stores it.
    const entries = (await logOf(code)).filter((e) => e.action.startsWith('chat.message-'));
    const stored = (await deps.db.query<{ id: string }>("select id::text as id from chat_envelopes where chat = $1 and sender_role = 'mod'", [chat])).rows;
    expect(entries.map((e) => [e.action, e.actor_id, JSON.parse(e.detail)])).toEqual([
      ['chat.message-requested', mod.id, {}],
      ['chat.message-sent', mod.id, { envelopeId: stored[0]!.id }],
    ]);
    expect((await loadDispute(deps.db, code))!.firstReplyAt).toEqual(START);

    const c = moderation.chats.get(code)!;
    for (const who of [buyer, seller]) {
      const got = await who.browser.get(`/v1/chats/${chat}/envelopes?after=0`);
      expect(got.statusCode, got.body).toBe(200);
      const list = (got.json() as { envelopes: { senderRole: string; envelope: ChatEnvelopeV2 }[] }).envelopes.filter((e) => e.senderRole === 'mod');
      expect(list).toHaveLength(1);
      const opened = await openChat(list[0]!.envelope, { tk: c.tk, trade: c.channel, participants: c.participants, guard: new ReplayGuard(c.channel) });
      // The trader app's chat contract (chatCrypto: payload exactly { text }); the badge comes from
      // the verified sender `mod` and the server's moderator name, never from the payload.
      expect(opened).toEqual({ from: 'mod', type: 'chat.msg', payload: { text: 'Please upload your bank statement.' } });
    }
  });

  it('refuses a malformed sealed message, a stale seq (with the next one), and a closed dispute', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const good = await msg(code, 'Hello');
    for (const bad of [{ ...good, seq: -1 }, { ...good, ct: '' }, { ...good, sig: 'x' }, { ...good, requestId: 'r' }, { ...good, issuedAt: 'today' }, { ...good, extra: 1 }, { text: 'Hello' }]) {
      expect((await mod.b.post(url(code, '/messages'), bad)).statusCode, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    const stale = await mod.b.post(url(code, '/messages'), await msg(code, 'Hello', { seq: 5 }));
    expect({ status: stale.statusCode, error: errorOf(stale), next: (stale.json() as { nextSeq?: number }).nextSeq }).toEqual({ status: 409, error: 'stale-seq', next: 0 });
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, START]);
    const res = await mod.b.post(url(code, '/messages'), await msg(code, 'Hello'));
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'wrong-state' });
  });
});

describe('the unblurred proof', () => {
  it('the request is logged and goes only to the trader named', async () => {
    const mod = await staff('mod');
    const { code, buyer, seller } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const sb = stream(buyer.id);
    const ss = stream(seller.id);
    try {
      const res = await mod.b.post(url(code, '/proof-request'), { side: 'seller' });
      expect(res.statusCode, res.body).toBe(204);
      expect(eventsOf(ss.frames, 'proof-requested')).toEqual([{ type: 'proof-requested', code, username: mod.name }]);
      expect(eventsOf(sb.frames, 'proof-requested')).toEqual([]);
    } finally {
      sb.stop();
      ss.stop();
    }
    expect((await logOf(code)).filter((e) => e.action === 'proof.unblurred-requested').map((e) => e.detail)).toEqual([JSON.stringify({ side: 'seller' })]);
    expect((await mod.b.post(url(code, '/proof-request'), { side: 'mod' })).statusCode).toBe(400);
  });

  it('NEEDS_P5_PROOF_ENVELOPE: no staff route reads the unblurred proof through the API (review 8 Nov I-1)', async () => {
    // The plan's `POST /staff/v1/disputes/:code/proof` relayed the unblurred image from the
    // moderation process through this API: the same plaintext gap as the chat read. The design
    // (2.4 step 5) re-wraps the proof key to the staff device key instead; build that, then replace
    // this test.
    const mod = await staff('mod');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const res = await mod.b.post(url(code, '/proof'), {});
    expect(res.statusCode).toBe(404);
    expect((await logOf(code)).filter((e) => e.action === 'proof.unblurred-opened')).toEqual([]);
    expect(staffApp.printRoutes({ commonPrefix: false })).not.toMatch(/proof\b(?!-)/);
    expect((moderation as unknown as Record<string, unknown>).proofRead).toBeUndefined();
  });
});

describe('the freeze', () => {
  it('is refused before the party has ignored the dispute for 48 hours, or after they wrote in the chat', async () => {
    const mod = await staff('mod');
    const { code, chat } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    setNow(new Date(START.getTime() + 47 * H));
    await mod.fresh();
    let res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    // The seller wrote in the chat 47 h in: 48 h after that they have not ignored the dispute.
    await deps.db.query(
      `insert into chat_envelopes (chat, sender_role, seq, envelope, created_at) values ($1, 'seller', 0, '{}'::jsonb, $2)`,
      [chat, new Date(START.getTime() + 47 * H)],
    );
    setNow(new Date(START.getTime() + 50 * H));
    await mod.fresh();
    res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    // No ruling to ignore.
    res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'ignored-ruling' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    for (const bad of [{ side: 'seller', on: true }, { side: 'mod', on: true, reason: 'no-reply' }, { side: 'seller', on: 'yes', reason: 'no-reply' }, { side: 'seller', on: true, reason: 'no-reply', until: 'x' }]) {
      expect((await mod.b.post(url(code, '/freeze'), bad)).statusCode).toBe(400);
    }
    setNow(START);
  });

  it('freezes a party who ignored the dispute: no new trades, an open escrow trade still finishes, no end time, lifted only by a moderator', async () => {
    const mod = await staff('mod');
    const { code, seller } = await disputed();
    await mod.fresh();
    expect((await mod.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    // Another trade of the same seller, already paid: it must still release under the freeze.
    const buyer2 = await newTrader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer2.id, poster: 'seller' });
    await driveTo(deps, trade, 'paid');

    setNow(new Date(START.getTime() + 49 * H));
    await mod.fresh();
    const res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await activeFreezes(seller.id)).toEqual([{ kind: 'freeze', side: 'seller', reason: 'no-reply', dispute_code: code }]);
    expect((await logOf(code)).filter((e) => e.action === 'account.frozen').map((e) => JSON.parse(e.detail))).toEqual([
      { accountId: seller.id, side: 'seller', reason: 'no-reply' },
    ]);
    const twice = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect({ status: twice.statusCode, error: errorOf(twice) }).toEqual({ status: 409, error: 'wrong-state' });
    expect((await mod.b.get(url(code))).json()).toMatchObject({ freezes: { seller: true, buyer: false } });

    // A take by the frozen seller is refused.
    const poster = await newTrader();
    // No minimum is null (migration 315: min_trades is one of 5, 10, 25, 50 or null; owner 8 Nov);
    // migration 490's shape (J-16): the offer, its currency, one band and one method.
    const offerId = await insertOffer(deps.db, { accountId: poster.id, side: 'buy', methodId: 'ZELLE', currency: 'USD', min: 1000, max: 100000, minTrades: null, at: deps.clock() });
    expect((await seller.browser.post('/t/login', { accountId: seller.id })).statusCode).toBe(200);
    // The take names the method and the currency (J-16); the hold is judged before anything else about the deal.
    const take = await seller.browser.post(`/v1/offers/${offerId}/take`, {
      amountAtomic: '1000000000000', walletId: randomUUID(), centsPerXmr: '33000', fiatCents: '33000', methodId: 'ZELLE', currency: 'USD',
    });
    expect({ status: take.statusCode, error: errorOf(take) }).toEqual({ status: 409, error: 'trading-hold' });
    // The open escrow trade still releases.
    const rel = await seller.browser.post(`/v1/trades/${trade.code}/events`, { type: 'release-started' });
    expect(rel.statusCode, rel.body).toBe(200);

    // No end time: closing the dispute (and any amount of time) leaves it in place.
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, deps.clock()]);
    setNow(new Date(START.getTime() + 400 * 24 * H));
    await mod.fresh();
    expect(await activeFreezes(seller.id)).toHaveLength(1);
    // A moderator lifts it once the person has done what the dispute asks.
    const lift = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: false });
    expect(lift.statusCode, lift.body).toBe(200);
    expect(await activeFreezes(seller.id)).toEqual([]);
    expect((await logOf(code)).filter((e) => e.action === 'account.freeze-lifted').map((e) => JSON.parse(e.detail))).toEqual([{ accountId: seller.id, side: 'seller' }]);
    const again = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: false });
    expect({ status: again.statusCode, error: errorOf(again) }).toEqual({ status: 409, error: 'wrong-state' });
    setNow(START);
  });

  it('freezes a seller who ignored a ruling (the payment was due and never proven)', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    await deps.db.query(`update disputes set status = 'complying', complied_at = null, comply_by = $2 where code = $1`, [code, new Date(START.getTime() + 24 * H)]);
    setNow(new Date(START.getTime() + 23 * H));
    await mod.fresh();
    let res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'ignored-ruling' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    setNow(new Date(START.getTime() + 25 * H));
    await mod.fresh();
    // Only the side the ruling ordered to pay.
    res = await mod.b.post(url(code, '/freeze'), { side: 'buyer', on: true, reason: 'ignored-ruling' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'ignored-ruling' });
    expect(res.statusCode, res.body).toBe(200);
    setNow(START);
  });
});

describe('D-016: the frozen trader reads their freeze (GET /v1/account/freeze)', () => {
  const freezeOf = async (p: Awaited<ReturnType<typeof newTrader>>) => {
    expect((await p.browser.post('/t/login', { accountId: p.id })).statusCode).toBe(200);
    const res = await p.browser.get('/v1/account/freeze');
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { freezes: unknown[] };
  };

  it('none before a freeze; the frozen side then reads since, the dispute, its incident ID, their side, the amount and the partner; the partner reads none; lifted, none', async () => {
    const mod = await staff('mod');
    const { code, seller, buyer } = await disputed();
    await mod.fresh();
    expect((await mod.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    expect(await freezeOf(seller)).toEqual({ freezes: [] });

    setNow(new Date(START.getTime() + 49 * H));
    await mod.fresh();
    expect((await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' })).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ incident_id: string; amount_atomic: string; name: string }>(
      `select d.incident_id, t.amount_atomic::text as amount_atomic, b.display_name as name
         from disputes d join trades t on t.code = d.code join accounts b on b.id = t.buyer_account_id where d.code = $1`,
      [code],
    );
    expect(await freezeOf(seller)).toEqual({
      freezes: [{
        since: new Date(START.getTime() + 49 * H).toISOString(),
        dispute: { code, incidentId: rows[0]!.incident_id, side: 'seller', amountAtomic: rows[0]!.amount_atomic, counterparty: rows[0]!.name },
      }],
    });
    // A dispute alone never blocks trading (D-013): the partner is not frozen.
    expect(await freezeOf(buyer)).toEqual({ freezes: [] });

    const lift = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: false });
    expect(lift.statusCode, lift.body).toBe(200);
    expect(await freezeOf(seller)).toEqual({ freezes: [] });
    setNow(START);
  });

  it('a freeze that outlived its trade (R36 whole-record delete) still reads, with no dispute details', async () => {
    const mod = await staff('mod');
    const { code, seller } = await disputed();
    await mod.fresh();
    expect((await mod.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    setNow(new Date(START.getTime() + 49 * H));
    await mod.fresh();
    expect((await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' })).statusCode).toBe(200);
    // As if the trade's record were gone: the freeze names a dispute code no trade has.
    await deps.db.query(`update trading_holds set dispute_code = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' where account_id = $1 and lifted_at is null`, [seller.id]);
    expect(await freezeOf(seller)).toEqual({ freezes: [{ since: new Date(START.getTime() + 49 * H).toISOString(), dispute: null }] });
    await deps.db.query('update trading_holds set lifted_at = $2 where account_id = $1 and lifted_at is null', [seller.id, deps.clock()]);
    setNow(START);
  });

  it('needs a trader session', async () => {
    const res = await trader.inject({ method: 'GET', url: '/v1/account/freeze' });
    expect(res.statusCode).toBe(401);
  });

  it('T1: a team member is refused (owner-only); a backup session and a held one read it', async () => {
    const mod = await staff('mod');
    const { code, seller } = await disputed();
    await mod.fresh();
    expect((await mod.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    setNow(new Date(START.getTime() + 49 * H));
    await mod.fresh();
    expect((await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' })).statusCode).toBe(200);
    const since = new Date(START.getTime() + 49 * H).toISOString();

    const loginId = await seedAccount(deps, { loginName: `fzmember${randomUUID().slice(0, 8)}`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'FzMember', 'fzmember', $2, $3, $4, $3, $3)`,
      [seller.id, rolesToAbilities(['offers', 'trades']), deps.clock(), loginId],
    );
    const mb = new Browser(trader);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    const asMember = await mb.get('/v1/account/freeze');
    expect({ status: asMember.statusCode, error: errorOf(asMember) }).toEqual({ status: 403, error: 'owner-only' });

    const backup = new Browser(trader);
    const login = await backup.post('/t/login', { accountId: seller.id, level: 'recovery' });
    expect(login.statusCode, login.body).toBe(200);
    const sessionId = (login.json() as { sessionId: string }).sessionId;
    const read = async () => {
      const res = await backup.get('/v1/account/freeze');
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { freezes: Array<{ since: string }> }).freezes.map((f) => f.since);
    };
    expect(await read()).toEqual([since]);
    await deps.db.query('update sessions set hold_until = $2 where id = $1', [sessionId, new Date(deps.clock().getTime() + 24 * H)]);
    expect(await read()).toEqual([since]);
    await deps.db.query('update trading_holds set lifted_at = $2 where account_id = $1 and lifted_at is null', [seller.id, deps.clock()]);
    setNow(START);
  });
});

describe('F1 (D-014): a moderator lifts a freeze by its id (POST /staff/v1/freezes/:id/lift)', () => {
  /** A dispute whose seller a mod froze (the mod took the case); the freeze's id. */
  async function frozen() {
    const mod = await staff('mod');
    const d = await disputed();
    await mod.fresh();
    expect((await mod.b.post(url(d.code, '/take'), {})).statusCode).toBe(200);
    setNow(new Date(START.getTime() + 49 * H));
    await mod.fresh();
    expect((await mod.b.post(url(d.code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' })).statusCode).toBe(200);
    const id = (await deps.db.query<{ id: string }>('select id::text as id from trading_holds where account_id = $1 and lifted_at is null', [d.seller.id])).rows[0]!.id;
    return { ...d, mod, id };
  }
  const lift = (b: StaffBrowser, id: string) => b.post(`/staff/v1/freezes/${id}/lift`, {});
  const liftLogs = async (accountId: string) =>
    (await deps.db.query<{ trade_code: string | null; detail: string; actor_id: string }>(
      `select trade_code, detail, actor_id::text as actor_id from activity_log where action = 'account.freeze-lifted' and detail like '%' || $1 || '%' order by id`,
      [accountId],
    )).rows;

  it('while the case exists: the same check as the case route (the assignee, a senior or the owner), logged on the case; once only', async () => {
    const { id, mod, seller, code } = await frozen();
    const other = await staff('mod');
    const refused = await lift(other.b, id);
    expect({ status: refused.statusCode, error: errorOf(refused) }).toEqual({ status: 403, error: 'forbidden-case' });
    expect(await activeFreezes(seller.id)).toHaveLength(1);
    const ok = await lift(mod.b, id);
    expect(ok.statusCode, ok.body).toBe(204);
    expect(await activeFreezes(seller.id)).toEqual([]);
    expect((await liftLogs(seller.id)).map((r) => ({ ...r, detail: JSON.parse(r.detail) }))).toEqual([
      { trade_code: code, detail: { accountId: seller.id, side: 'seller' }, actor_id: mod.id },
    ]);
    const again = await lift(mod.b, id);
    expect({ status: again.statusCode, error: errorOf(again) }).toEqual({ status: 409, error: 'wrong-state' });
    // Nothing new for the trader: the freeze is simply gone from their view.
    expect((await seller.browser.post('/t/login', { accountId: seller.id })).statusCode).toBe(200);
    expect((await seller.browser.get('/v1/account/freeze')).json()).toEqual({ freezes: [] });
    setNow(START);
  });

  it('once the trade record is gone (R36): only a senior or the owner (there is no case to be assigned), logged against the account', async () => {
    const { id, mod, seller } = await frozen();
    await deps.db.query(`update trading_holds set dispute_code = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' where id = $1`, [id]);
    const refused = await lift(mod.b, id);
    expect({ status: refused.statusCode, error: errorOf(refused) }).toEqual({ status: 403, error: 'forbidden-case' });
    const senior = await staff('senior');
    const ok = await lift(senior.b, id);
    expect(ok.statusCode, ok.body).toBe(204);
    expect(await activeFreezes(seller.id)).toEqual([]);
    expect((await liftLogs(seller.id)).map((r) => ({ ...r, detail: JSON.parse(r.detail) }))).toEqual([
      { trade_code: null, detail: { accountId: seller.id, side: 'seller' }, actor_id: senior.id },
    ]);
    setNow(START);
  });

  it('an unknown or malformed id is not-found; a helper is refused', async () => {
    const mod = await staff('mod');
    for (const bad of [randomUUID(), 'not-a-uuid']) {
      const res = await lift(mod.b, bad);
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 404, error: 'not-found' });
    }
    const helper = await staff('helper');
    expect((await lift(helper.b, randomUUID())).statusCode).toBe(403);
  });
});

describe('helpers', () => {
  it('a helper is refused on every dispute route', async () => {
    const helper = await staff('helper');
    const { code } = await disputed();
    const routes: Array<[string, string]> = [
      ['GET', '/staff/v1/disputes'], ['POST', '/staff/v1/disputes/next'], ['POST', url(code, '/take')], ['GET', url(code)],
      ['POST', url(code, '/messages')], ['POST', url(code, '/proof-request')], ['POST', url(code, '/freeze')],
    ];
    for (const [m, u] of routes) {
      const res = await helper.b.send(m, u, m === 'POST' ? {} : undefined);
      expect({ u, status: res.statusCode, error: errorOf(res) }).toEqual({ u, status: 403, error: 'forbidden' });
    }
  });
});

describe('G37: incident IDs and taking a case', () => {
  it('every dispute has a nine-character incident ID with a good check character, shown to both traders, in the queue and the case', async () => {
    const mod = await staff('mod');
    const { code, buyer, seller } = await disputed();
    const { rows } = await deps.db.query<{ incident_id: string }>('select incident_id from disputes where code = $1', [code]);
    const id = rows[0]!.incident_id;
    expect(isIncidentId(id)).toBe(true);
    for (const p of [buyer, seller]) {
      expect(((await p.browser.get(`/v1/trades/${code}/dispute`)).json() as { incidentId: string }).incidentId).toBe(id);
    }
    const q = (await mod.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string; incidentId: string }> };
    expect(q.rows.find((r) => r.code === code)!.incidentId).toBe(id);
    // A moderator can open the case by the ID a trader quotes, typed loosely.
    const byId = await mod.b.get(url(`${id.slice(0, 4).toLowerCase()}-${id.slice(4)}`));
    expect(byId.statusCode, byId.body).toBe(200);
    expect(byId.json()).toMatchObject({ code, incidentId: id });
    // A wrong check character finds nothing.
    const wrong = id.slice(0, 8) + (id[8] === '0' ? '1' : '0');
    expect((await mod.b.get(url(wrong))).statusCode).toBe(404);
    // Many IDs: all well formed and distinct.
    const many = await deps.db.query<{ id: string }>('select x2f_incident_id() as id from generate_series(1, 200)');
    expect(many.rows.every((r) => isIncidentId(r.id))).toBe(true);
    expect(new Set(many.rows.map((r) => r.id)).size).toBe(200);
  });

  it('the case shows who took it and when, and when they first opened it, from the log', async () => {
    const { code } = await disputed();
    const mod = await staff('mod');
    expect((await mod.b.post(url(code, '/take'), {})).statusCode).toBe(200);
    setNow(new Date(START.getTime() + 7 * MIN));
    await mod.fresh();
    const v = (await mod.b.get(url(code))).json() as Record<string, unknown>;
    expect(v).toMatchObject({
      assignee: mod.name, assignedToYou: true, mayWork: true,
      // Plan 4 Task 18 (ModCase "Above the 1,000 USD limit"): the limit the dispute snapshotted when it opened.
      limitUsd: Number((await loadDispute(deps.db, code))!.limitUsdCents / 100n),
      taken: { by: mod.name, at: START.toISOString(), openedAt: new Date(START.getTime() + 7 * MIN).toISOString() },
    });
    const other = await staff('mod');
    expect((await other.b.get(url(code))).json()).toMatchObject({ assignedToYou: false, mayWork: false, taken: { by: mod.name } });
    setNow(START);
  });
});

describe('a frozen party still works the disputed trade (G7, G33)', () => {
  it('reads the dispute and the chat, and posts in it', async () => {
    const mod = await staff('mod');
    const { code, chat, seller } = await disputed();
    await mod.fresh();
    await mod.b.post(url(code, '/take'), {});
    setNow(new Date(START.getTime() + 49 * H));
    await mod.fresh();
    expect((await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' })).statusCode).toBe(200);
    expect((await seller.browser.post('/t/login', { accountId: seller.id })).statusCode).toBe(200);
    expect((await seller.browser.get(`/v1/trades/${code}/dispute`)).statusCode).toBe(200);
    expect((await seller.browser.get(`/v1/chats/${chat}/envelopes?after=0`)).statusCode).toBe(200);
    // The chat is attested (stood in here); the seller's message goes through.
    const c = moderation.chats.get(code)!;
    await deps.db.query('insert into chat_attestations (chat, attestation, sig) values ($1, $2, $3) on conflict do nothing', [chat, { v: 1 }, 'aa']);
    const envelope = await signChatEnvelope(await encryptChat({ trade: c.channel, from: 'seller', seq: 0, type: 'chat.msg', payload: { text: 'Here is more context.' }, tk: c.tk }), c.ids.seller);
    const posted = await seller.browser.post(`/v1/chats/${chat}/envelopes`, envelope);
    expect(posted.statusCode, posted.body).toBe(201);
    setNow(START);
  });
});

describe('the proof request in the trader view', () => {
  it('only the trader named sees who asked and when', async () => {
    const mod = await staff('mod');
    const { code, buyer, seller } = await disputed();
    await mod.fresh();
    await mod.b.post(url(code, '/take'), {});
    expect((await mod.b.post(url(code, '/proof-request'), { side: 'buyer' })).statusCode).toBe(204);
    const asBuyer = (await buyer.browser.get(`/v1/trades/${code}/dispute`)).json() as { proofRequest: unknown };
    const asSeller = (await seller.browser.get(`/v1/trades/${code}/dispute`)).json() as { proofRequest: unknown };
    expect(asBuyer.proofRequest).toEqual({ username: mod.name, at: START.toISOString() });
    expect(asSeller.proofRequest).toBeNull();
  });
});

describe('more on messages and the queue', () => {
  it('a moderator is never handed an appeal by next; a senior who was not involved is', async () => {
    const { code } = await disputed();
    await publishRuling(deps, code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, code, 'seller');
    const mod = await staff('mod');
    const senior = await staff('senior');
    // Drain the queue as a moderator: the appeal is never among what it takes.
    for (let i = 0; i < 100; i++) {
      const got = (await mod.b.post('/staff/v1/disputes/next', {})).json() as { code: string | null };
      expect(got.code).not.toBe(code);
      if (got.code === null) break;
    }
    expect((await loadDispute(deps.db, code))!.assignee).toBeNull();
    for (let i = 0; i < 100; i++) {
      const got = (await senior.b.post('/staff/v1/disputes/next', {})).json() as { code: string | null };
      if (got.code === code || got.code === null) break;
    }
    expect((await loadDispute(deps.db, code))!.assignee).toBe(senior.id);
  });

  it('without a moderation process a message is refused 503 (logged, nothing stored)', async () => {
    const none = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION, traderEvents: trader.events });
    try {
      const mod = await staff('mod', none);
      const { code } = await disputed();
      await mod.fresh();
      await mod.b.post(url(code, '/take'), {});
      const res = await mod.b.post(url(code, '/messages'), await msg(code, 'Hello'));
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 503, error: 'moderation-unavailable' });
      // The request is logged; nothing was sent, so no `chat.message-sent` (review 8 Nov M-2).
      expect((await logOf(code)).filter((e) => e.action === 'chat.message-requested')).toHaveLength(1);
      expect((await logOf(code)).filter((e) => e.action === 'chat.message-sent')).toEqual([]);
    } finally {
      await none.close();
    }
  });

  it('a moderation answer that is not a fresh mod envelope for this chat is not stored', async () => {
    const mod = await staff('mod');
    const { code, chat } = await disputed();
    await mod.fresh();
    await mod.b.post(url(code, '/take'), {});
    const realSend = moderation.chatSend.bind(moderation);
    try {
      // A trader's envelope passed off as the moderator's.
      moderation.chatSend = async (a) => {
        await realSend(a);
        const c = moderation.chats.get(code)!;
        const body = await encryptChat({ trade: c.channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'x' }, tk: c.tk });
        return { envelope: await signChatEnvelope(body, c.ids.buyer) };
      };
      const res = await mod.b.post(url(code, '/messages'), await msg(code, 'Hello'));
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 502, error: 'moderation-unavailable' });
    } finally {
      moderation.chatSend = realSend;
    }
    expect((await mod.b.post(url(code, '/messages'), await msg(code, 'One.'))).statusCode).toBe(201);
    // The same seq again (a replay) is refused.
    const replayBody = await msg(code, 'Two.', { seq: 0 });
    moderation.chats.get(code)!.seq = 0;
    const replay = await mod.b.post(url(code, '/messages'), replayBody);
    expect({ status: replay.statusCode, error: errorOf(replay) }).toEqual({ status: 502, error: 'moderation-unavailable' });
    const { rows } = await deps.db.query("select count(*)::int as n from chat_envelopes where chat = $1 and sender_role = 'mod'", [chat]);
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe('g62: maintenance holds the freeze clock', () => {
  it('no freeze during maintenance, and time spent in it does not count as ignoring the dispute', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await mod.fresh();
    await mod.b.post(url(code, '/take'), {});
    // As A7 leaves a dispute after 10 hours of maintenance: deadlines shifted by 10 h.
    await deps.db.query(`update disputes set ruling_due_at = ruling_due_at + interval '10 hours', reply_due_at = reply_due_at + interval '10 hours' where code = $1`, [code]);
    setNow(new Date(START.getTime() + 55 * H));
    await mod.fresh();
    let res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    // While maintenance holds it, not at all.
    setNow(new Date(START.getTime() + 59 * H));
    await mod.fresh();
    await deps.db.query('update disputes set paused_since = $2 where code = $1', [code, deps.clock()]);
    res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'freeze-not-allowed' });
    await deps.db.query('update disputes set paused_since = null where code = $1', [code]);
    res = await mod.b.post(url(code, '/freeze'), { side: 'seller', on: true, reason: 'no-reply' });
    expect(res.statusCode, res.body).toBe(200);
    setNow(START);
  });
});

describe('Task 11 tripwires (local tree only)', () => {
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

  it('NEEDS_P5_PROOF_ENVELOPE: the unblurred proof is read through the proof pipeline once its storage lands', async () => {
    // @x2f/proof (sealProofEnvelope, `proof.unblurred` sealed to the mod only, decryptProof) is on
    // main, but no API table stores a proof's ciphertext yet (Plan 5 Tasks 13-15). When one lands:
    // the moderator's unblurred view follows the key-membership design (the proof key re-wrapped to
    // the staff device key, decrypted in staff-web; NEVER bytes relayed through this API, review
    // 8 Nov I-1), and the proof-request route asks the trader who uploaded the proof instead of the
    // side the moderator names.
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = `${ROOT}apps/api/migrations/`;
    const sql = readdirSync(dir).map((f) => readFileSync(dir + f, 'utf8')).join('\n');
    // The blur check's bookkeeping (migration 367, P-012/P-013: `blur_check_proofs` holds only a
    // trade code, a proof id and whether to ask) stores no proof, so it is not the storage meant here.
    expect(/create table\s+(?!blur_check_)\w*proof/i.test(sql), 'a proof table landed: wire the ProofSource (see this test)').toBe(false);
    expect(existsSync(`${ROOT}packages/proof`)).toBe(true);
  });

});
