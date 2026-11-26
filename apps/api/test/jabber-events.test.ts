// W-021 (owner p11-27): the Jabber notifications settings page. Each user picks which events send
// them a secure Jabber notice. The events are the notice kinds main's outbox carries
// (`NOTICE_KINDS`: account changes, and a dispute on a trade the user pays). Against real Postgres
// with a fake sender.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { withTx } from '../src/auth/liveSession.js';
import { startDispute } from '../src/disputes/store.js';
import { sendDueNotices } from '../src/jabber/outbox.js';
import { RESEND_WAIT_S } from '../src/jabber/routes.js';
import { ALWAYS_ON_KINDS, NOTICE_KINDS, type JabberMessage, type JabberSender } from '../src/jabber/sender.js';
import { seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

const sent: Array<{ to: string; message: JabberMessage }> = [];
const fake: JabberSender = {
  async send(to, message) {
    sent.push({ to, message });
  },
};

let app: FastifyInstance;
let deps: Deps;
let logs: string[];
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let now = new Date('2026-11-12T12:00:00Z');
let n = 0;

beforeAll(async () => {
  ({ app, deps, logs, setNow, trader } = await tradeApp({}, { jabberSender: fake }));
  // Start the clock here, so no session is created before a jump of the clock.
  setNow(now);
});
afterAll(async () => {
  expect(logs.join('\n')).not.toMatch(/@xmpp\.example|events-user/);
  await app.close();
});
beforeEach(() => {
  sent.length = 0;
});

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
  setNow(now);
};
const address = () => `events-user${++n}@xmpp.example.org`;
const err = (r: { statusCode: number; json(): unknown }) => ({ status: r.statusCode, ...(r.json() as object) });
const lastCode = () => (sent.at(-1)!.message as { code: string }).code;
const queued = async (accountId: string) =>
  (await deps.db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1 order by id', [accountId])).rows.map((r) => r.kind);
const clearOutbox = (accountId: string) => deps.db.query('delete from jabber_outbox where account_id = $1', [accountId]);
const sendAll = () => sendDueNotices({ db: deps.db, clock: deps.clock, config: deps.config, sender: fake });
// J-20 (batch 9): the lead's notice of a member's first login is a security notice too, always on.
const ALL_ON = {
  events: [
    { kind: 'account-change', on: true, canTurnOff: false },
    { kind: 'trade-attention', on: true, canTurnOff: true },
    { kind: 'team-member-first-login', on: true, canTurnOff: false },
  ],
};
const nudgeChange = (b: Browser) => b.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null });

async function withJabber(jid = address()) {
  const t = await trader();
  advance(RESEND_WAIT_S * 1000 + 1);
  expect((await t.browser.post('/v1/account/jabber/test', { address: jid })).statusCode).toBe(202);
  await new Promise((r) => setImmediate(r));
  expect((await t.browser.post('/v1/account/jabber/verify', { code: lastCode() })).statusCode).toBe(200);
  sent.length = 0;
  return { ...t, jid };
}

async function dispute(buyerId: string, sellerId: string) {
  const t = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  const trade = await driveTo(deps, t.trade, 'paid');
  await withTx(deps.db, (c) => startDispute(c, trade, { openedBy: 'seller', reason: 'other', note: '', afterRefund: false, now: deps.clock(), prices: null }));
}

describe('the event list', () => {
  it("lists main's notice kinds in order, every one on until the user turns it off", async () => {
    expect(NOTICE_KINDS).toEqual(['account-change', 'trade-attention', 'team-member-first-login']);
    const t = await trader();
    expect((await t.browser.get('/v1/account/jabber/events')).json()).toEqual(ALL_ON);
    // Nothing to pick before an address is proven.
    expect(err(await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false }))).toEqual({ status: 404, error: 'not-found' });
    const j = await withJabber();
    expect((await j.browser.get('/v1/account/jabber/events')).json()).toEqual(ALL_ON);
  });

  it('refuses an unknown kind, a value that is not true or false, and extra keys', async () => {
    const t = await withJabber();
    for (const b of [
      { kind: 'wallet-added', on: false },
      { kind: 'test-code', on: false },
      { kind: 'account-change', on: 'no' },
      { kind: 'account-change' },
      { kind: 'account-change', on: false, extra: 1 },
      [],
      null,
    ]) expect(err(await t.browser.put('/v1/account/jabber/events', b)), JSON.stringify(b)).toEqual({ status: 400, error: 'bad-request' });
    expect((await t.browser.get('/v1/account/jabber/events')).json()).toEqual(ALL_ON);
  });

  it("review F1 (safe default until the owner rules): security notices can't be turned off, by the API or in the database", async () => {
    // One named constant holds the rule; J-20's first login is in it ahead of its landing.
    expect(ALWAYS_ON_KINDS).toEqual(['account-change', 'team-member-first-login']);
    const t = await withJabber();
    await clearOutbox(t.id);
    for (const kind of ['account-change', 'team-member-first-login']) {
      expect(err(await t.browser.put('/v1/account/jabber/events', { kind, on: false })), kind).toEqual({ status: 409, error: 'jabber-event-always-on' });
      await expect(deps.db.query('update jabber_contacts set muted_kinds = array[$2::text] where account_id = $1', [t.id, kind]), kind).rejects.toThrow(/check/);
    }
    // Asking for it on is not a change and is accepted.
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'account-change', on: true })).json()).toEqual(ALL_ON);
    expect(await queued(t.id)).toEqual([]);
    await deps.db.query("update jabber_contacts set muted_kinds = '{trade-attention}' where account_id = $1", [t.id]);
  });

  it('a muted kind is skipped by jabber_queue itself, so a notice queued from code (as J-20 queues the first login) is muted too', async () => {
    const t = await withJabber();
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    await clearOutbox(t.id);
    const q = (k: string) =>
      deps.db.query('select jabber_queue(c.account_id, c.jid_sealed, $2) from jabber_contacts c where c.account_id = $1', [t.id, k]);
    await q('trade-attention');
    expect(await queued(t.id)).toEqual([]);
    await q('account-change');
    expect(await queued(t.id)).toEqual(['account-change']);
  });

  it('the database refuses a kind the outbox does not carry', async () => {
    const t = await withJabber();
    await expect(deps.db.query("update jabber_contacts set muted_kinds = '{wallet-added}' where account_id = $1", [t.id])).rejects.toThrow(/check/);
  });
});

describe('a muted event sends nothing; the others still do', () => {
  it('trade attention off: a dispute queues nothing, an account change still does', async () => {
    const buyer = await withJabber();
    const seller = await trader();
    expect((await buyer.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    await clearOutbox(buyer.id);
    await dispute(buyer.id, seller.id);
    expect(await queued(buyer.id)).toEqual([]);
    expect((await nudgeChange(buyer.browser)).statusCode).toBe(200);
    expect(await queued(buyer.id)).toEqual(['account-change']);
  });

  it("a member's change still notifies the team account (account changes are always on)", async () => {
    const owner = await withJabber();
    expect((await owner.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    await clearOutbox(owner.id);
    const loginId = await seedAccount(deps, { loginName: `evmember${n}x`, displayName: `em-${n}-placeholder`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Evmate', 'evmate', '{offers-see}', $2, $3, $2, $2)`,
      [owner.id, deps.clock(), loginId],
    );
    expect(await queued(owner.id)).toEqual(['account-change']);
  });
});

describe('changing the picks is itself an account change, told to the address (so a thief cannot quietly silence it)', () => {
  it('turning an event off or on queues one account-change notice, even while that event is the one off', async () => {
    const t = await withJabber();
    await clearOutbox(t.id);
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    expect(await queued(t.id)).toEqual(['account-change']);
    await sendAll();
    // The outbox is shared with earlier tests' accounts: look at this address only.
    expect(sent.filter((x) => x.to === t.jid)).toEqual([{ to: t.jid, message: { kind: 'account-change' } }]);
    sent.length = 0;
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: true })).statusCode).toBe(200);
    expect(await queued(t.id)).toEqual(['account-change']);
    // Each change of the picks is its own notice.
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    expect(await queued(t.id)).toEqual(['account-change', 'account-change']);
  });

  it('setting a pick to what it already is changes nothing and tells nobody', async () => {
    const t = await withJabber();
    await clearOutbox(t.id);
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: true })).json()).toEqual(ALL_ON);
    expect(await queued(t.id)).toEqual([]);
  });

  it('while the Alerts switch is off, picking events queues nothing (nothing is being sent)', async () => {
    const t = await withJabber();
    expect((await t.browser.put('/v1/account/jabber/enabled', { on: false })).statusCode).toBe(200);
    await clearOutbox(t.id);
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    expect(await queued(t.id)).toEqual([]);
  });

  it('Turn off forgets the picks with the address: a new set-up starts with every event on', async () => {
    const t = await withJabber();
    expect((await t.browser.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false })).statusCode).toBe(200);
    expect((await t.browser.delete('/v1/account/jabber')).statusCode).toBe(204);
    expect((await t.browser.get('/v1/account/jabber/events')).json()).toEqual(ALL_ON);
  });
});

describe('who may change the picks', () => {
  it('a team member gets owner-only, for the list and the change', async () => {
    const owner = await withJabber();
    const loginId = await seedAccount(deps, { loginName: `evmember2${n}x`, displayName: `em2-${n}-placeholder`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Evmate2', 'evmate2', '{offers-see}', $2, $3, $2, $2)`,
      [owner.id, deps.clock(), loginId],
    );
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    expect(err(await mb.get('/v1/account/jabber/events'))).toEqual({ status: 403, error: 'owner-only' });
    expect(err(await mb.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false }))).toEqual({ status: 403, error: 'owner-only' });
  });

  it('signed out: 401', async () => {
    const b = new Browser(app);
    expect((await b.get('/v1/account/jabber/events')).statusCode).toBe(401);
  });
});
