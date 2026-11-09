// Owner rule p5-7, boards JabberSetup and Alerts: the Jabber set-up routes, the outbox worker and
// the fixed message texts, against real Postgres with a fake sender.
import { createHmac, hkdfSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { startHold, withTx } from '../src/auth/hold.js';
import { startDispute } from '../src/disputes/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { codeHash, maskJid, normalizeJid } from '../src/jabber/address.js';
import { PENDING_RETENTION_MS, purgeJabberPending } from '../src/jabber/retention.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { OUTBOX_ATTEMPTS, sendDueNotices } from '../src/jabber/outbox.js';
import { CODE_TRIES, CODE_TTL_MS, RESEND_WAIT_S, TESTS_PER_DAY } from '../src/jabber/routes.js';
import { ACCOUNT_CHANGE_TEXT, NOTICE_KINDS, SENDER_NAME, TRADE_ATTENTION_TEXT, messageText, type JabberMessage, type JabberSender } from '../src/jabber/sender.js';
import { seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';

const sent: Array<{ to: string; message: JabberMessage }> = [];
let failing = false;
const fake: JabberSender = {
  async send(to, message) {
    // A real failure may quote the address: the code must never log it.
    if (failing) throw new Error(`server refused ${to}`);
    sent.push({ to, message });
  },
};

let app: FastifyInstance;
let deps: Deps;
let logs: string[];
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let now = new Date('2026-10-17T12:00:00Z');
let n = 0;

beforeAll(async () => {
  ({ app, deps, logs, setNow, trader } = await tradeApp({}, { jabberSender: fake }));
});
afterAll(async () => {
  // Nothing anywhere in this file's log lines ever carried an address.
  expect(logs.join('\n')).not.toMatch(/@xmpp\.example|jabber-user/);
  await app.close();
});
beforeEach(() => {
  sent.length = 0;
  failing = false;
});

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
  setNow(now);
};
const address = () => `jabber-user${++n}@xmpp.example.org`;
const err = (r: { statusCode: number; json(): unknown }) => ({ status: r.statusCode, ...(r.json() as object) });
const lastCode = () => (sent.at(-1)!.message as { code: string }).code;
const notices = async (accountId: string) =>
  (await deps.db.query<{ n: number }>('select count(*)::int as n from jabber_outbox where account_id = $1', [accountId])).rows[0]!.n;
const sendAll = () => sendDueNotices({ db: deps.db, clock: deps.clock, config: deps.config, sender: fake });

/** A trader with Jabber alerts on at `jid`. */
async function withJabber(jid = address()) {
  const t = await trader();
  advance(RESEND_WAIT_S * 1000 + 1);
  expect((await t.browser.post('/v1/account/jabber/test', { address: jid })).statusCode).toBe(202);
  expect((await t.browser.post('/v1/account/jabber/verify', { code: lastCode() })).statusCode).toBe(200);
  sent.length = 0;
  return { ...t, jid };
}

describe('the fixed texts', () => {
  it('an account change is the owner\'s sentence and nothing else; a test message carries only the code', () => {
    expect(ACCOUNT_CHANGE_TEXT).toBe('An account change was made on your X2F account.');
    expect(SENDER_NAME).toBe('X2F alerts');
    expect(messageText({ kind: 'account-change' })).toBe(ACCOUNT_CHANGE_TEXT);
    expect(messageText({ kind: 'test-code', code: '012345' })).toBe('Your X2F test code is 012345.');
    expect(() => messageText({ kind: 'test-code', code: 'wallet changed' })).toThrow();
    // Lead default 2026-11-08: the dispute notice to the payer, the second and last notice kind.
    expect(NOTICE_KINDS).toEqual(['account-change', 'trade-attention']);
    expect(messageText({ kind: 'trade-attention' })).toBe(TRADE_ATTENTION_TEXT);
    expect(TRADE_ATTENTION_TEXT).toBe('A trade on your X2F account needs your attention.');
    expect(() => messageText({ kind: 'wallet-added' } as never)).toThrow();
  });

  it('addresses: bare, lower-cased, no resource or markup; masked as on the board', () => {
    expect(normalizeJid('  Mira.Lee@XMPP.Example.org ')).toBe('mira.lee@xmpp.example.org');
    for (const bad of ['mira', 'mira@', '@xmpp.example.org', 'mira@xmpp.example.org/phone', 'mi ra@x.org', 'm<a>@x.org', "m'@x.org", 'm@localhost', 'm@x..org', 42, null]) {
      expect(normalizeJid(bad), String(bad)).toBeNull();
    }
    expect(maskJid('mira.lee@xmpp.example.org')).toBe('mira…@xmpp.example.org');
    expect(maskJid('miral@x.org')).toBe('mira…@x.org');
  });

  it('review L3: a local part of four characters or fewer shows only its first character', () => {
    expect(maskJid('mira@xmpp.example.org')).toBe('m…@xmpp.example.org');
    expect(maskJid('bob@x.org')).toBe('b…@x.org');
    expect(maskJid('al@x.org')).toBe('a…@x.org');
    expect(maskJid('z@x.org')).toBe('z…@x.org');
  });

  it('review L7: the test-code hash is keyed by a subkey (HKDF "x2f/jabber-code"), never the raw ring key', () => {
    const ring = deps.config.jabberKeys!;
    const raw = ring.keys.get(ring.current)!;
    const h = codeHash(deps.config, 'acct-1', '123456');
    expect(h.equals(createHmac('sha256', raw).update('x2f/jabber-code\x00acct-1\x00123456').digest())).toBe(false);
    const sub = Buffer.from(hkdfSync('sha256', raw, new Uint8Array(0), 'x2f/jabber-code', 32));
    expect(h.equals(createHmac('sha256', sub).update('acct-1\x00123456').digest())).toBe(true);
  });
});

describe('set-up: address, test code, done', () => {
  it('the three steps; the address is stored only sealed and answered only masked', async () => {
    const t = await trader();
    expect((await t.browser.get('/v1/account/jabber')).json()).toEqual({ available: true, state: 'off', address: null, pendingAddress: null, lastSentAt: null });
    const r = await t.browser.post('/v1/account/jabber/test', { address: ' Jabber-User-Mira@XMPP.example.org ' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ pendingAddress: 'jabb…@xmpp.example.org', resendAfterSeconds: RESEND_WAIT_S });
    await new Promise((res) => setImmediate(res));
    expect(sent).toEqual([{ to: 'jabber-user-mira@xmpp.example.org', message: { kind: 'test-code', code: expect.stringMatching(/^[0-9]{6}$/) } }]);
    const { rows } = await deps.db.query<{ j: string }>('select to_jsonb(c)::text as j from jabber_contacts c where account_id = $1', [t.id]);
    expect(rows[0]!.j).not.toContain('mira');
    expect(rows[0]!.j).not.toContain(lastCode());
    expect((await t.browser.get('/v1/account/jabber')).json()).toMatchObject({ state: 'off', pendingAddress: 'jabb…@xmpp.example.org' });

    const wrong = lastCode() === '000000' ? '000001' : '000000';
    expect(err(await t.browser.post('/v1/account/jabber/verify', { code: wrong }))).toEqual({ status: 400, error: 'code-invalid' });
    const ok = await t.browser.post('/v1/account/jabber/verify', { code: lastCode() });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ available: true, state: 'on', address: 'jabb…@xmpp.example.org', pendingAddress: null, lastSentAt: null });
    // Turning it on is not itself a notice.
    expect(await notices(t.id)).toBe(0);
    expect(JSON.stringify((await t.browser.get('/v1/account/jabber')).json())).not.toContain('mira');
  });

  it('a change through a real route queues one notice; the worker sends the fixed sentence to the address', async () => {
    const t = await withJabber();
    expect((await t.browser.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(200);
    expect(await notices(t.id)).toBe(1);
    expect(await sendAll()).toEqual({ sent: 1, retried: 0, dropped: 0 });
    expect(sent).toEqual([{ to: t.jid, message: { kind: 'account-change' } }]);
    expect(await notices(t.id)).toBe(0);
    expect((await t.browser.get('/v1/account/jabber')).json()).toMatchObject({ lastSentAt: now.toISOString() });
  });

  it('refuses a malformed address or code, unknown keys, and answers 503 when the deployment has no sender', async () => {
    const t = await trader();
    expect(err(await t.browser.post('/v1/account/jabber/test', { address: 'name@xmpp.example.org/phone' }))).toEqual({ status: 400, error: 'jabber-address-invalid' });
    expect(err(await t.browser.post('/v1/account/jabber/test', { address: address(), extra: 1 }))).toEqual({ status: 400, error: 'bad-request' });
    expect(err(await t.browser.post('/v1/account/jabber/verify', { code: '12345' }))).toEqual({ status: 400, error: 'code-invalid' });
    expect(err(await t.browser.post('/v1/account/jabber/verify', { code: '123456' }))).toEqual({ status: 409, error: 'challenge-expired' });
    const saved = deps.jabberSender;
    delete deps.jabberSender;
    try {
      expect(err(await t.browser.post('/v1/account/jabber/test', { address: address() }))).toEqual({ status: 503, error: 'jabber-unavailable' });
      expect((await t.browser.get('/v1/account/jabber')).json()).toMatchObject({ available: false });
    } finally {
      deps.jabberSender = saved!;
    }
  });
});

describe('limits', () => {
  it('one test message a minute, then at most TESTS_PER_DAY a day per account', async () => {
    const t = await trader();
    const jid = address();
    expect((await t.browser.post('/v1/account/jabber/test', { address: jid })).statusCode).toBe(202);
    const again = await t.browser.post('/v1/account/jabber/test', { address: jid });
    expect(err(again)).toEqual({ status: 429, error: 'slow-down', retryAfterSeconds: RESEND_WAIT_S });
    for (let i = 1; i < TESTS_PER_DAY; i++) {
      advance(RESEND_WAIT_S * 1000);
      expect((await t.browser.post('/v1/account/jabber/test', { address: jid })).statusCode, `send ${i + 1}`).toBe(202);
    }
    advance(RESEND_WAIT_S * 1000);
    expect(err(await t.browser.post('/v1/account/jabber/test', { address: jid }))).toMatchObject({ status: 429, error: 'slow-down' });
    expect(sent).toHaveLength(TESTS_PER_DAY);
  });

  it('CODE_TRIES wrong codes end the code (even the right one is then refused); a code lasts CODE_TTL_MS', async () => {
    const t = await trader();
    advance(RESEND_WAIT_S * 1000);
    await t.browser.post('/v1/account/jabber/test', { address: address() });
    const right = lastCode();
    const wrong = right === '999999' ? '999998' : '999999';
    for (let i = 1; i < CODE_TRIES; i++) expect(err(await t.browser.post('/v1/account/jabber/verify', { code: wrong }))).toEqual({ status: 400, error: 'code-invalid' });
    expect(err(await t.browser.post('/v1/account/jabber/verify', { code: wrong }))).toEqual({ status: 409, error: 'challenge-expired' });
    expect(err(await t.browser.post('/v1/account/jabber/verify', { code: right }))).toEqual({ status: 409, error: 'challenge-expired' });

    advance(RESEND_WAIT_S * 1000);
    await t.browser.post('/v1/account/jabber/test', { address: address() });
    advance(CODE_TTL_MS);
    expect(err(await t.browser.post('/v1/account/jabber/verify', { code: lastCode() }))).toEqual({ status: 409, error: 'challenge-expired' });
  });
});

describe('switching off, turning off and changing the address tell the address that was on', () => {
  it('the Alerts switch off: one notice to the address; switching it on again sends none', async () => {
    const t = await withJabber();
    const off = await t.browser.put('/v1/account/jabber/enabled', { on: false });
    expect(off.json()).toMatchObject({ state: 'paused' });
    expect((await t.browser.put('/v1/account/security/logout-timer', { idleHours: 4 })).statusCode).toBe(200);
    expect((await t.browser.put('/v1/account/jabber/enabled', { on: true })).json()).toMatchObject({ state: 'on' });
    await sendAll();
    expect(sent).toEqual([{ to: t.jid, message: { kind: 'account-change' } }]);
  });

  it('Turn off deletes the address and tells it; the switch then has nothing to switch', async () => {
    const t = await withJabber();
    expect((await t.browser.delete('/v1/account/jabber')).statusCode).toBe(204);
    expect((await t.browser.get('/v1/account/jabber')).json()).toMatchObject({ state: 'off', address: null });
    expect(err(await t.browser.put('/v1/account/jabber/enabled', { on: true }))).toEqual({ status: 404, error: 'not-found' });
    await sendAll();
    expect(sent).toEqual([{ to: t.jid, message: { kind: 'account-change' } }]);
  });

  it('a new address gets notices only once proven; the old one is told when it is replaced', async () => {
    const t = await withJabber();
    const next = address();
    advance(RESEND_WAIT_S * 1000);
    expect((await t.browser.post('/v1/account/jabber/test', { address: next })).statusCode).toBe(202);
    const code = lastCode();
    sent.length = 0;
    // Still pending: the old address keeps getting notices.
    expect((await t.browser.put('/v1/account/security/logout-timer', { idleHours: 6 })).statusCode).toBe(200);
    expect((await t.browser.post('/v1/account/jabber/verify', { code })).json()).toMatchObject({ state: 'on', address: maskJid(next) });
    await sendAll();
    expect(sent).toEqual([{ to: t.jid, message: { kind: 'account-change' } }, { to: t.jid, message: { kind: 'account-change' } }]);
  });
});

describe('fire and forget', () => {
  it('a failing Jabber server never fails or delays the change; the notice is retried, then dropped, and nothing is logged with the address', async () => {
    const t = await withJabber();
    failing = true;
    expect((await t.browser.put('/v1/account/security/logout-timer', { idleHours: 8 })).statusCode).toBe(200);
    expect(await sendAll()).toEqual({ sent: 0, retried: 1, dropped: 0 });
    // Not due again until its retry time.
    expect(await sendAll()).toEqual({ sent: 0, retried: 0, dropped: 0 });
    for (let i = 2; i < OUTBOX_ATTEMPTS; i++) {
      advance(3_600_000);
      expect(await sendAll()).toEqual({ sent: 0, retried: 1, dropped: 0 });
    }
    advance(3_600_000);
    expect(await sendAll()).toEqual({ sent: 0, retried: 0, dropped: 1 });
    expect(await notices(t.id)).toBe(0);
  });

  it('a failing test-code send still answers 202 and logs no address', async () => {
    const t = await trader();
    failing = true;
    advance(RESEND_WAIT_S * 1000);
    expect((await t.browser.post('/v1/account/jabber/test', { address: address() })).statusCode).toBe(202);
    await new Promise((res) => setImmediate(res));
    expect(logs.some((l) => l.includes('test-not-sent'))).toBe(true);
  });
});

describe('who may change it', () => {
  it('a session whose login waits gets weak-session; during a hold every write gets recovery-hold', async () => {
    const t = await withJabber();
    await deps.db.query("update sessions set strength = 'weak-single', onboarding_until = null where account_id = $1", [t.id]);
    for (const r of [
      await t.browser.put('/v1/account/jabber/enabled', { on: false }),
      await t.browser.delete('/v1/account/jabber'),
      await t.browser.post('/v1/account/jabber/test', { address: address() }),
    ]) expect(err(r)).toEqual({ status: 403, error: 'weak-session' });

    const h = await withJabber();
    await startHold(deps.db, h.id, deps.clock(), { reason: 'weak-change', startedBy: null });
    expect(err(await h.browser.delete('/v1/account/jabber'))).toMatchObject({ status: 403, error: 'recovery-hold' });
    expect((await h.browser.get('/v1/account/jabber')).json()).toMatchObject({ state: 'on' });
  });

  it("a team member gets owner-only; a member's login change notifies the team account", async () => {
    const owner = await withJabber();
    const loginId = await seedAccount(deps, { loginName: `jmember${n}x`, displayName: `jm-${n}-placeholder`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Jmate', 'jmate', '{offers}', $2, $3, $2, $2)`,
      [owner.id, deps.clock(), loginId],
    );
    // Adding the member was a team change.
    expect(await notices(owner.id)).toBe(1);
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    expect(err(await mb.get('/v1/account/jabber'))).toEqual({ status: 403, error: 'owner-only' });
    expect(err(await mb.post('/v1/account/jabber/test', { address: address() }))).toEqual({ status: 403, error: 'owner-only' });
    await deps.db.query("update accounts set display_name = 'jm-renamed', display_key = 'jm-renamed' where id = $1", [loginId]);
    expect(await notices(owner.id)).toBe(2);
  });
});

describe('a dispute tells the payer (lead default 2026-11-08, same opt-in)', () => {
  for (const openedBy of ['buyer', 'seller', 'system'] as const) {
    it(`opened by the ${openedBy}: the buyer gets the trade-attention sentence; the seller gets nothing`, async () => {
      const buyer = await withJabber();
      const seller = await withJabber();
      const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      const trade = await driveTo(deps, t.trade, 'paid');
      await deps.db.query('delete from jabber_outbox');
      await withTx(deps.db, (c) => startDispute(c, trade, { openedBy, reason: openedBy === 'system' ? 'escalated' : 'other', note: '', afterRefund: false, now: deps.clock(), prices: null }));
      const { rows } = await deps.db.query<{ account_id: string; kind: string }>('select account_id, kind from jabber_outbox');
      expect(rows).toEqual([{ account_id: buyer.id, kind: 'trade-attention' }]);
      await sendAll();
      expect(sent).toEqual([{ to: buyer.jid, message: { kind: 'trade-attention' } }]);
    });
  }
});

describe('review L4: an unproven typed address is purged 24 hours after its test message', () => {
  it('clears the pending address (deleting a row that holds nothing else); a proven address stays, and the purge is not a notice', async () => {
    const typed = await trader();
    advance(RESEND_WAIT_S * 1000 + 1);
    expect((await typed.browser.post('/v1/account/jabber/test', { address: address() })).statusCode).toBe(202);
    const changing = await withJabber();
    advance(RESEND_WAIT_S * 1000 + 1);
    expect((await changing.browser.post('/v1/account/jabber/test', { address: address() })).statusCode).toBe(202);
    await deps.db.query('delete from jabber_outbox');
    const row = async (id: string) =>
      (await deps.db.query<{ jid: boolean; pending: boolean; enabled: boolean }>(
        'select jid_sealed is not null as jid, pending_sealed is not null as pending, enabled from jabber_contacts where account_id = $1', [id],
      )).rows[0] ?? null;

    advance(PENDING_RETENTION_MS - 600_000);
    await purgeJabberPending.run(deps.db, deps.clock());
    expect(await row(typed.id)).toEqual({ jid: false, pending: true, enabled: false });
    expect(await row(changing.id)).toEqual({ jid: true, pending: true, enabled: true });

    advance(600_000);
    expect(await purgeJabberPending.run(deps.db, deps.clock())).toBeGreaterThanOrEqual(2);
    expect(await row(typed.id)).toBeNull();
    expect(await row(changing.id)).toEqual({ jid: true, pending: false, enabled: true });
    expect(await notices(changing.id)).toBe(0);
    expect(PENDING_RETENTION_MS).toBe(24 * 3_600_000);
    expect(RETENTION_JOBS).toContain(purgeJabberPending);
  });
});
