// Plan 4 Task 11: the moderator's queue and case view, messages to the parties, the
// unblurred-proof request, and the freeze. The moderator's chat READ is not built: the chat key
// design (design-chat-membership-keys-2026-11-08, build task 9) replaces the plan's plaintext read
// through the API, so no staff route returns chat text (NEEDS_P4_CHAT_MEMBERSHIP below). Owner 2026-11-02 (binding): a dispute
// alone never blocks trading; a moderator freezes an account only as a separate later action, when
// a party ignores the dispute (~48 h with no reply) or ignores a ruling, and the freeze has no end
// time: a moderator lifts it once the person has done what the dispute asks.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { channelFor } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { isIncidentId } from '@x2f/staff';
import { ModerationError, NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { disputeSettings } from '../../src/disputes/settings.js';
import { loadDispute } from '../../src/disputes/store.js';
import { buildStaffApi, type ModerationClient } from '../../src/staff/app.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { insertOffer } from '../helpers/offers.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { driveTo, seedTrade } from '../helpers/trades.js';

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
}

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

  async chatSend(a: { code: string; logEntryId: string; text: string }) {
    // Review 8 Nov M-2: the API asks under `chat.message-requested`; `chat.message-sent` comes after.
    await this.logged(a.logEntryId, 'chat.message-requested', a.code);
    this.calls.push({ op: 'send', code: a.code, logEntryId: a.logEntryId });
    const c = this.chats.get(a.code);
    if (!c) throw new ModerationError(404, 'no-chat');
    const envelope = await seal({
      trade: c.channel, from: 'mod', seq: c.seq++, type: 'chat.msg',
      payload: { text: a.text },
      to: ['buyer', 'seller', 'mod'], me: c.ids.mod, participants: c.participants,
    });
    return { envelope };
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

/** The seller's confirm window seedTrade gives every trade (its `confirmWindowMin`). */
const CONFIRM_WINDOW_MIN = 120;

/**
 * A trade the buyer disputed at `at`, with its chat (both traders' identities and the mod's). The
 * buyer marked it paid one confirm window before `at`: trade-rules P1 (owner p9-4, proto review P1)
 * lets the buyer open a dispute only after "I've paid" and the method's full wait, so `at` is the
 * first moment the dispute may open.
 */
async function disputed(at = START) {
  setNow(new Date(at.getTime() - CONFIRM_WINDOW_MIN * MIN));
  const seller = await newTrader();
  const buyer = await newTrader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
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
  moderation.chats.set(t.code, { chat, channel: await channelFor(chat, 'chat'), ids, participants, seq: 0 });
  return { seller, buyer, code: t.code, chat };
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
    const owner = await staff('owner');
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
    await mod.b.post(url(code, '/messages'), { text: 'Hello' });
    expect(await activeFreezes(seller.id)).toEqual([]);
    expect(await activeFreezes(buyer.id)).toEqual([]);
  });
});

describe('the case view', () => {
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
});

describe('who works a case', () => {
  it('an unassigned mod gets forbidden-case; the assignee and a senior may write', async () => {
    const mod = await staff('mod');
    const stranger = await staff('mod');
    const senior = await staff('senior');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    for (const route of ['/messages', '/proof-request', '/freeze']) {
      const res = await stranger.b.post(url(code, route), route === '/messages' ? { text: 'Hello' } : route === '/proof-request' ? { side: 'buyer' } : route === '/freeze' ? { side: 'seller', on: true, reason: 'no-reply' } : {});
      expect({ route, status: res.statusCode, error: errorOf(res) }).toEqual({ route, status: 403, error: 'forbidden-case' });
    }
    expect((await mod.b.post(url(code, '/messages'), { text: 'One.' })).statusCode).toBe(201);
    expect((await senior.b.post(url(code, '/messages'), { text: 'Two.' })).statusCode).toBe(201);
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
      const res = await mod.b.post(url(code, '/messages'), { text: 'Hello' });
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
      await mod.b.post(url(code, '/messages'), { text: 'One.' });
      await mod.b.post(url(code, '/messages'), { text: 'Two.' });
      for (const s of [sb, ss]) expect(eventsOf(s.frames, 'moderator-joined')).toEqual([{ type: 'moderator-joined', code, username: mod.name }]);
      await senior.b.post(url(code, '/messages'), { text: 'Three.' });
      await senior.b.post(url(code, '/messages'), { text: 'Four.' });
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
    const res = await senior.b.post(url(code, '/messages'), { text: 'Hello' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden-case' });
    const fresh = await staff('senior');
    expect((await fresh.b.post(url(code, '/messages'), { text: 'Hello' })).statusCode).toBe(201);
  });

  it('NEEDS_P4_CHAT_MEMBERSHIP: no staff route reads the chat (design build task 9)', async () => {
    // The plan's `POST /staff/v1/disputes/:code/chat` (one logged chat.read per read, plaintext from
    // the moderation process through the API) is NOT registered: a compromised API could read every
    // disputed chat. Build task 9 of design-chat-membership-keys-2026-11-08 replaces it with a grant
    // to certified staff device keys; build that, then replace this test and the it.todo below.
    const mod = await staff('mod');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const res = await mod.b.post(url(code, '/chat'), {});
    expect(res.statusCode).toBe(404);
    expect((await logOf(code)).filter((e) => e.action === 'chat.read')).toEqual([]);
    const routes = staffApp.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/chat\b/);
  });

  it.todo('NEEDS_P4_CHAT_MEMBERSHIP: reads are logged, one chat.read per read before any key is granted; with logging failing nothing is granted');
});

describe('messages to the parties', () => {
  it('a mod message is logged, stored as a mod envelope that opens for buyer and seller, and counts as the first reply', async () => {
    const mod = await staff('mod');
    const { code, chat, buyer, seller } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    const sb = stream(buyer.id);
    try {
      const res = await mod.b.post(url(code, '/messages'), { text: 'Please upload your bank statement.' });
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
    for (const [who, role] of [[buyer, 'buyer'], [seller, 'seller']] as const) {
      const got = await who.browser.get(`/v1/chats/${chat}/envelopes?after=0`);
      expect(got.statusCode, got.body).toBe(200);
      const list = (got.json() as { envelopes: { senderRole: string; envelope: Envelope }[] }).envelopes.filter((e) => e.senderRole === 'mod');
      expect(list).toHaveLength(1);
      const opened = await open(list[0]!.envelope, { me: c.ids[role], myRole: role, participants: c.participants, trade: c.channel, guard: new ReplayGuard(c.channel) });
      // The trader app's chat contract (chatCrypto: payload exactly { text }); the badge comes from
      // the verified sender `mod` and the server's moderator name, never from the payload.
      expect(opened).toEqual({ from: 'mod', type: 'chat.msg', payload: { text: 'Please upload your bank statement.' } });
    }
  });

  it('refuses an empty or too long text, and a closed dispute', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await mod.b.post(url(code, '/take'), {});
    for (const text of ['', '   ', 'x'.repeat(2001), 5, 'bell\u0007']) {
      expect((await mod.b.post(url(code, '/messages'), { text })).statusCode).toBe(400);
    }
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, START]);
    const res = await mod.b.post(url(code, '/messages'), { text: 'Hello' });
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

  it('NEEDS_P4_CHAT_MEMBERSHIP: no staff route reads the unblurred proof through the API (review 8 Nov I-1)', async () => {
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
    const envelope = await seal({ trade: c.channel, from: 'seller', seq: 0, type: 'chat.msg', payload: { text: 'Here is more context.' }, to: ['buyer', 'seller', 'mod'], me: c.ids.seller, participants: c.participants });
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
      const res = await mod.b.post(url(code, '/messages'), { text: 'Hello' });
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
        return { envelope: await seal({ trade: c.channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'x' }, to: ['buyer', 'seller', 'mod'], me: c.ids.buyer, participants: c.participants }) };
      };
      const res = await mod.b.post(url(code, '/messages'), { text: 'Hello' });
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 502, error: 'moderation-unavailable' });
    } finally {
      moderation.chatSend = realSend;
    }
    expect((await mod.b.post(url(code, '/messages'), { text: 'One.' })).statusCode).toBe(201);
    // The same seq again (a replay) is refused.
    moderation.chats.get(code)!.seq = 0;
    const replay = await mod.b.post(url(code, '/messages'), { text: 'Two.' });
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
    expect(/create table\s+\w*proof/i.test(sql), 'a proof table landed: wire the ProofSource (see this test)').toBe(false);
    expect(existsSync(`${ROOT}packages/proof`)).toBe(true);
  });

});
