// Owner rule p5-7, boards JabberSetup and Alerts: the Jabber set-up routes, the outbox worker and
// the fixed message texts, against real Postgres with a fake sender.
import { createHmac, createPrivateKey, createPublicKey, hkdfSync, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { startHold, withTx } from '../src/auth/hold.js';
import { startDispute } from '../src/disputes/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { codeHash, maskJid, normalizeJid, openJid, sealJid } from '../src/jabber/address.js';
import { OmemoDevice, PreKeyLedger, generateBundleSecrets, identityFromSeed, newIdentitySeed, parseBundleSecrets, parseEncryptedElement, parsePreKeyMessage } from '@x2f/omemo';
import { loadOmemoBundle, loadOmemoIdentity, omemoEncryptor, omemoEncryptorFrom, parseBundle, xeddsaVerify } from '../src/jabber/omemo.js';
import { PREKEY_RECORD_RETENTION_MS, dbPreKeyStore, purgeJabberPreKeys } from '../src/jabber/prekeys.js';
import { rewrapJabberSecrets } from '../src/jabber/rewrap.js';
import { PENDING_RETENTION_MS, purgeJabberPending } from '../src/jabber/retention.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import type { Keyring } from '../src/config.js';
import { OUTBOX_ATTEMPTS, sendDueNotices } from '../src/jabber/outbox.js';
import { CODE_TRIES, CODE_TTL_MS, RESEND_WAIT_S, TESTS_PER_DAY } from '../src/jabber/routes.js';
import { ACCOUNT_CHANGE_TEXT, NOTICE_KINDS, NoticeDeferred, SENDER_NAME, TEAM_FIRST_LOGIN_TEXT, TRADE_ATTENTION_TEXT, messageText, type JabberMessage, type JabberSender } from '../src/jabber/sender.js';
import { seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';

const sent: Array<{ to: string; message: JabberMessage }> = [];
/** The prekey ledger each send was given (review M2: one per outbox pass). */
const passes: unknown[] = [];
let failing = false;
const fake: JabberSender = {
  async send(to, message, o) {
    // A real failure may quote the address: the code must never log it.
    if (failing) throw new Error(`server refused ${to}`);
    sent.push({ to, message });
    passes.push(o?.preKeys);
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
  passes.length = 0;
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
    // Lead default 2026-11-08: the dispute notice to the payer.
    expect(messageText({ kind: 'trade-attention' })).toBe(TRADE_ATTENTION_TEXT);
    expect(TRADE_ATTENTION_TEXT).toBe('A trade on your X2F account needs your attention.');
    // J-20 (owner p11-27, S-107): a team member's first login, to the team account. No name.
    expect(NOTICE_KINDS).toEqual([
      'account-change', 'team-member-first-login',
      'trade-started', 'trade-funded', 'trade-paid', 'trade-cancel-asked', 'trade-completed', 'trade-cancelled', 'trade-attention', 'trade-ruled',
    ]);
    expect(messageText({ kind: 'team-member-first-login' })).toBe(TEAM_FIRST_LOGIN_TEXT);
    expect(TEAM_FIRST_LOGIN_TEXT).toBe('A team member logged in to your X2F account for the first time.');
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
    expect((await t.browser.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect(await notices(t.id)).toBe(1);
    expect(await sendAll()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 0 });
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
    expect((await t.browser.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
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
    expect((await t.browser.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect((await t.browser.post('/v1/account/jabber/verify', { code })).json()).toMatchObject({ state: 'on', address: maskJid(next) });
    await sendAll();
    expect(sent).toEqual([{ to: t.jid, message: { kind: 'account-change' } }, { to: t.jid, message: { kind: 'account-change' } }]);
    // Review M2: both notices of one pass share one prekey ledger, so an offline device never gets two on the same prekey
    // (the test-code send before them, outside any pass, had none).
    const [first, second] = passes.slice(-2);
    expect(first).toBeInstanceOf(PreKeyLedger);
    expect(second).toBe(first);
    expect(passes.at(0)).toBeUndefined();
  });
});

describe('fire and forget', () => {
  it('a failing Jabber server never fails or delays the change; the notice is retried, then dropped, and nothing is logged with the address', async () => {
    const t = await withJabber();
    failing = true;
    expect((await t.browser.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect(await sendAll()).toEqual({ sent: 0, retried: 1, dropped: 0, deferred: 0 });
    // Not due again until its retry time.
    expect(await sendAll()).toEqual({ sent: 0, retried: 0, dropped: 0, deferred: 0 });
    for (let i = 2; i < OUTBOX_ATTEMPTS; i++) {
      advance(3_600_000);
      expect(await sendAll()).toEqual({ sent: 0, retried: 1, dropped: 0, deferred: 0 });
    }
    advance(3_600_000);
    expect(await sendAll()).toEqual({ sent: 0, retried: 0, dropped: 1, deferred: 0 });
    expect(await notices(t.id)).toBe(0);
  });

  it("lead decision after interop 4b: a notice to a device whose prekeys the pass used up stays in the outbox, untried, and goes on the next pass against the refreshed bundle", async () => {
    const t = await withJabber();
    await sendAll(); // whatever earlier tests left due goes to the fake sender, not to this one
    // The user's client: two prekeys published, offline during the first pass (its bundle does not change).
    const phone = new OmemoDevice(11, 2);
    const id = identityFromSeed(newIdentitySeed());
    const omemo = omemoEncryptorFrom({ deviceId: 777, ...id }, generateBundleSecrets(id, 20));
    const delivered: string[] = [];
    // The real encryptor and the pass's ledger, as the XMPP sender uses them; the device list is the phone alone.
    const sender: JabberSender = {
      async send(to, message, o) {
        const bundle = parseBundle(phone.deviceId, phone.bundleXml())!;
        delivered.push(await omemo.encrypt({ to, plaintext: messageText(message), bundles: [bundle], ...(o?.preKeys ? { preKeys: o.preKeys } : {}) }));
      },
    };
    // Three real changes (an unchanged write is no change: 331's trigger): the nudge setting on, off, on.
    for (const enabled of [true, false, true]) expect((await t.browser.put('/v1/account/nudges', { enabled, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect(await notices(t.id)).toBe(3);
    const pass = () => sendDueNotices({ db: deps.db, clock: deps.clock, config: deps.config, sender });
    expect(await pass()).toEqual({ sent: 2, retried: 0, dropped: 0, deferred: 1 });
    // Left for the next pass with its tries untouched; nothing was sent without a prekey.
    const left = await deps.db.query<{ attempts: number; next_at: Date | null }>('select attempts, next_at from jabber_outbox where account_id = $1', [t.id]);
    expect(left.rows).toHaveLength(1);
    expect(left.rows[0]!.attempts).toBe(0);
    expect(left.rows[0]!.next_at === null || left.rows[0]!.next_at <= now).toBe(true);
    const preKeyIdOf = (xml: string) => parsePreKeyMessage(parseEncryptedElement(xml).keys[0]!.data).preKeyId;
    expect(delivered.map(preKeyIdOf).sort()).toEqual([1, 2]);
    // The client comes online, reads both and republishes fresh prekeys; the next pass sends the third on one of them.
    for (const xml of delivered) expect(phone.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    phone.replenish();
    expect(await pass()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 0 });
    expect(delivered).toHaveLength(3);
    expect([3, 4]).toContain(preKeyIdOf(delivered[2]!));
    expect(phone.decrypt(delivered[2]!)).toBe(ACCOUNT_CHANGE_TEXT);
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

describe('lead follow-up to interop 4b: the prekeys X2F used are remembered across passes (migration 335)', () => {
  const preKeyIdOf = (xml: string) => parsePreKeyMessage(parseEncryptedElement(xml).keys[0]!.data).preKeyId!;
  /** The real encryptor with the database record, as production has it; the recipient's device list is `devices()`. */
  function omemoSender(devices: () => OmemoDevice[], ring: Keyring = deps.config.jabberKeys!, log?: (e: unknown) => void) {
    const id = identityFromSeed(newIdentitySeed());
    const omemo = omemoEncryptorFrom({ deviceId: 777, ...id }, generateBundleSecrets(id, 20), log, dbPreKeyStore(deps.db, ring, deps.clock));
    const delivered: string[] = [];
    const calls = { n: 0 };
    const sender: JabberSender = {
      async send(to, message, o) {
        calls.n++;
        const bundles = devices().map((d) => parseBundle(d.deviceId, d.bundleXml())!);
        delivered.push(await omemo.encrypt({ to, plaintext: messageText(message), bundles, ...(o?.preKeys ? { preKeys: o.preKeys } : {}) }));
      },
    };
    return { sender, delivered, calls, pass: () => sendDueNotices({ db: deps.db, clock: deps.clock, config: { jabberKeys: ring }, sender }) };
  }
  // Real account changes through a change path (the nudge setting; the logout timer went with 307).
  // Each write flips the setting, since an unchanged write is no change (331's trigger).
  let enabled = true;
  const changes = async (t: { browser: Browser }, count: number) => {
    for (let i = 0; i < count; i++) {
      enabled = !enabled;
      expect((await t.browser.put('/v1/account/nudges', { enabled, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    }
  };
  const records = async () =>
    (await deps.db.query<Record<string, unknown> & { prekey_ids: number[] }>('select * from jabber_omemo_prekeys')).rows;

  it('two passes against an unchanged bundle never reuse a prekey; a refreshed bundle or a new identity key clears the record; the record holds ids only', async () => {
    const t = await withJabber();
    await sendAll();
    await deps.db.query('delete from jabber_omemo_prekeys');
    let phone = new OmemoDevice(21, 3); // offline: the same three prekeys in every fetch
    const s = omemoSender(() => [phone]);
    await changes(t, 2);
    expect(await s.pass()).toEqual({ sent: 2, retried: 0, dropped: 0, deferred: 0 });
    // The next pass starts a new ledger, but the record already holds the two used ids: one left, so one sent and one deferred.
    await changes(t, 2);
    expect(await s.pass()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 1 });
    expect(s.delivered.map(preKeyIdOf).sort()).toEqual([1, 2, 3]);
    for (const xml of s.delivered) expect(phone.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    let rows = await records();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(['device_sealed', 'id', 'listed_ids', 'prekey_ids', 'recipient_tag', 'updated_at']);
    expect([...rows[0]!.prekey_ids].sort()).toEqual([1, 2, 3]);
    // Nothing in it names the address, the device id or the device's key.
    const raw = Buffer.concat([rows[0]!.recipient_tag as Buffer, rows[0]!.device_sealed as Buffer]);
    expect(raw.includes(Buffer.from(t.jid))).toBe(false);
    expect(raw.includes(phone.identity.publicKey)).toBe(false);
    const id21 = Buffer.alloc(4);
    id21.writeUInt32BE(21);
    expect(raw.includes(id21)).toBe(false);

    // The client comes back, reads them and republishes: the deferred notice goes on a fresh prekey and the old ids are forgotten.
    phone.replenish();
    expect(await s.pass()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 0 });
    const fresh = preKeyIdOf(s.delivered[3]!);
    expect([4, 5, 6]).toContain(fresh);
    expect(phone.decrypt(s.delivered[3]!)).toBe(ACCOUNT_CHANGE_TEXT);
    rows = await records();
    expect(rows.map((r) => r.prekey_ids)).toEqual([[fresh]]);

    // A reinstalled client: the same device id with a new identity key (and prekey ids 1-3 again) starts a new record.
    const before = rows[0]!.device_sealed as Buffer;
    phone = new OmemoDevice(21, 3);
    await changes(t, 1);
    expect(await s.pass()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 0 });
    rows = await records();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prekey_ids).toEqual([preKeyIdOf(s.delivered[4]!)]);
    expect((rows[0]!.device_sealed as Buffer).equals(before)).toBe(false);
    expect(phone.decrypt(s.delivered[4]!)).toBe(ACCOUNT_CHANGE_TEXT);
    // A send outside any pass (a test code) also reads and writes the record.
    await s.sender.send(t.jid, { kind: 'test-code', code: '123456' });
    expect([...(await records())[0]!.prekey_ids].sort()).toEqual([preKeyIdOf(s.delivered[4]!), preKeyIdOf(s.delivered[5]!)].sort());
    expect(await notices(t.id)).toBe(0);
  });

  it('within a pass, once a recipient is known used up, its remaining notices are deferred without connecting', async () => {
    const t = await withJabber();
    await sendAll();
    await deps.db.query('delete from jabber_omemo_prekeys');
    const phone = new OmemoDevice(22, 2);
    const s = omemoSender(() => [phone]);
    await changes(t, 4);
    expect(await s.pass()).toEqual({ sent: 2, retried: 0, dropped: 0, deferred: 2 });
    // Two sent, the third found the device used up; the fourth never reached the sender.
    expect(s.calls.n).toBe(3);
    expect(await notices(t.id)).toBe(2);
    for (const xml of s.delivered) expect(phone.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    phone.replenish();
    expect(await s.pass()).toEqual({ sent: 2, retried: 0, dropped: 0, deferred: 0 });
    expect(s.calls.n).toBe(5);
    for (const xml of s.delivered.slice(2)) expect(phone.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    await deps.db.query('delete from jabber_omemo_prekeys');
  });

  it('rewrap-jabber re-tags the record under the current key: after the old key is removed, an unchanged bundle still gets no reused prekey', async () => {
    const t = await withJabber();
    await sendAll();
    await deps.db.query('delete from jabber_omemo_prekeys');
    const phone = new OmemoDevice(24, 3); // offline throughout
    const old = deps.config.jabberKeys!;
    const before = omemoSender(() => [phone], old);
    await changes(t, 2);
    expect(await before.pass()).toEqual({ sent: 2, retried: 0, dropped: 0, deferred: 0 });
    // A new key first, the rewrap, then the old key removed.
    const fresh = new Uint8Array(randomBytes(32));
    const both: Keyring = { current: old.current + 1, keys: new Map([[old.current + 1, fresh], ...old.keys]) };
    const onlyNew: Keyring = { current: old.current + 1, keys: new Map([[old.current + 1, fresh]]) };
    const first = await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } });
    expect(first.failed).toBe(0);
    expect(await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } })).toEqual({ rewrapped: 0, failed: 0, prekeysRewrapped: 0, prekeysNotCurrent: 0 });
    const after = omemoSender(() => [phone], onlyNew);
    await changes(t, 2);
    expect(await after.pass()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 1 });
    const all = [...before.delivered, ...after.delivered];
    expect(all.map(preKeyIdOf).sort()).toEqual([1, 2, 3]);
    for (const xml of all) expect(phone.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    // This account's address is now sealed under a key the rest of the file does not hold.
    await deps.db.query('delete from jabber_contacts where account_id = $1', [t.id]);
    await deps.db.query('delete from jabber_outbox');
    await deps.db.query('delete from jabber_omemo_prekeys');
  });

  it('review R3: two processes during a rotation (the same two keys, either one current) take one lock per address, so concurrent sends never share a prekey', async () => {
    await deps.db.query('delete from jabber_omemo_prekeys');
    const old = deps.config.jabberKeys!;
    const fresh = new Uint8Array(randomBytes(32));
    const oldFirst: Keyring = { current: old.current, keys: new Map([...old.keys, [old.current + 1, fresh]]) };
    const newFirst: Keyring = { current: old.current + 1, keys: new Map([[old.current + 1, fresh], ...old.keys]) };
    const id = identityFromSeed(newIdentitySeed());
    const secrets = generateBundleSecrets(id, 20);
    const encryptors = [oldFirst, newFirst].map((ring) => omemoEncryptorFrom({ deviceId: 777, ...id }, secrets, undefined, dbPreKeyStore(deps.db, ring, deps.clock)));
    for (let round = 0; round < 12; round++) {
      const phone = new OmemoDevice(30 + round, 2);
      const to = `race${round}@xmpp.example.org`;
      const bundles = [parseBundle(phone.deviceId, phone.bundleXml())!];
      const out = await Promise.all(encryptors.map((e) => e.encrypt({ to, plaintext: ACCOUNT_CHANGE_TEXT, bundles })));
      expect(new Set(out.map(preKeyIdOf)).size, `round ${round}`).toBe(2);
    }
    await deps.db.query('delete from jabber_omemo_prekeys');
  });

  /** The production encryptor with the database record, called directly (no outbox). */
  const directEncryptor = (ring: Keyring = deps.config.jabberKeys!) => {
    const id = identityFromSeed(newIdentitySeed());
    return omemoEncryptorFrom({ deviceId: 777, ...id }, generateBundleSecrets(id, 20), undefined, dbPreKeyStore(deps.db, ring, deps.clock));
  };

  it('review R4: a partial bundle answer (fewer prekeys than last seen, none new) keeps the record, so a later full answer reuses no id', async () => {
    await deps.db.query('delete from jabber_omemo_prekeys');
    const phone = new OmemoDevice(40, 3);
    const enc = directEncryptor();
    const to = 'partial@xmpp.example.org';
    const full = () => parseBundle(phone.deviceId, phone.bundleXml())!;
    const send = (b: ReturnType<typeof full>) => enc.encrypt({ to, plaintext: ACCOUNT_CHANGE_TEXT, bundles: [b] });
    const first = [await send(full()), await send(full())];
    const [x, y] = first.map(preKeyIdOf) as [number, number];
    // The server's answer drops one recorded id (a key that did not parse, a cut answer): the third id is used, and y stays recorded.
    const partial = { ...full(), preKeys: full().preKeys.filter((p) => p.id !== y) };
    const third = await send(partial);
    expect([x, y]).not.toContain(preKeyIdOf(third));
    // The full answer again: every id is used, so nothing is sent on y (or any other).
    await expect(send(full())).rejects.toThrow();
    for (const xml of [...first, third]) expect(phone.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    // A real republish (new ids) still clears it.
    phone.replenish();
    expect([4, 5, 6]).toContain(preKeyIdOf(await send(full())));
    await deps.db.query('delete from jabber_omemo_prekeys');
  });

  it('review R2: the rewrap also moves the records of addresses only queued notices hold, and counts prekey records apart (moved, and left under an old key)', async () => {
    await deps.db.query('delete from jabber_omemo_prekeys');
    const old = deps.config.jabberKeys!;
    const fresh = new Uint8Array(randomBytes(32));
    const both: Keyring = { current: old.current + 1, keys: new Map([[old.current + 1, fresh], ...old.keys]) };
    const onlyNew: Keyring = { current: old.current + 1, keys: new Map([[old.current + 1, fresh]]) };
    // An address that is only in a queued notice (the old address after a change), and one that is nowhere.
    const t = await trader();
    const queuedJid = address();
    await deps.db.query('insert into jabber_outbox (account_id, jid_sealed, txid, kind, next_at) values ($1, $2, 1, $3, $4)', [
      t.id, sealJid(old, t.id, queuedJid), 'account-change', new Date(now.getTime() + 86_400_000),
    ]);
    const phone = new OmemoDevice(41, 3);
    const bundles = () => [parseBundle(phone.deviceId, phone.bundleXml())!];
    const before = directEncryptor(old);
    const used = [await before.encrypt({ to: queuedJid, plaintext: ACCOUNT_CHANGE_TEXT, bundles: bundles() }), await before.encrypt({ to: queuedJid, plaintext: ACCOUNT_CHANGE_TEXT, bundles: bundles() })].map(preKeyIdOf);
    await before.encrypt({ to: 'nobody@xmpp.example.org', plaintext: ACCOUNT_CHANGE_TEXT, bundles: bundles() });
    const r = await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } });
    expect(r.failed).toBe(0);
    expect(r.prekeysRewrapped).toBe(1);
    expect(r.prekeysNotCurrent).toBe(1);
    const again = await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } });
    expect(again).toEqual({ rewrapped: 0, failed: 0, prekeysRewrapped: 0, prekeysNotCurrent: 1 });
    // With the old key gone, the queued address's record is still found: one id left, then none.
    const after = directEncryptor(onlyNew);
    const third = preKeyIdOf(await after.encrypt({ to: queuedJid, plaintext: ACCOUNT_CHANGE_TEXT, bundles: bundles() }));
    expect([...used, third].sort()).toEqual([1, 2, 3]);
    await expect(after.encrypt({ to: queuedJid, plaintext: ACCOUNT_CHANGE_TEXT, bundles: bundles() })).rejects.toThrow();
    await deps.db.query('delete from jabber_outbox where account_id = $1', [t.id]);
    await deps.db.query('delete from jabber_omemo_prekeys');
  });

  it("review R1 (lead decision): a device whose recorded ids cover its whole published list at the start of a send is skipped (logged as a count) and the notice goes to the user's other devices", async () => {
    const t = await withJabber();
    await sendAll();
    await deps.db.query('delete from jabber_omemo_prekeys');
    const abandoned = new OmemoDevice(42, 2); // listed, never reads
    const laptop = new OmemoDevice(43, 20); // reads (and its bundle is refreshed on every fetch)
    const logged: unknown[] = [];
    const s = omemoSender(() => [abandoned, laptop], deps.config.jabberKeys!, (e) => logged.push(e));
    await changes(t, 2);
    expect(await s.pass()).toEqual({ sent: 2, retried: 0, dropped: 0, deferred: 0 });
    for (const xml of s.delivered) expect(laptop.decrypt(xml)).toBe(ACCOUNT_CHANGE_TEXT);
    laptop.replenish();
    expect(logged).toEqual([]);
    // The next pass: the dead phone has had every listed prekey for a pass already; the laptop still gets the notice.
    await changes(t, 1);
    expect(await s.pass()).toEqual({ sent: 1, retried: 0, dropped: 0, deferred: 0 });
    const last = s.delivered.at(-1)!;
    expect(parseEncryptedElement(last).keys.map((k) => k.rid)).toEqual([43]);
    expect(laptop.decrypt(last)).toBe(ACCOUNT_CHANGE_TEXT);
    expect(logged).toEqual([{ jabber: 'omemo', skippedUsedUp: 1 }]);
    // With only the dead device listed there is nobody to send to: a failed try (retried, later dropped), not a deferral for ever.
    const alone = omemoSender(() => [abandoned], deps.config.jabberKeys!, (e) => logged.push(e));
    await changes(t, 1);
    expect(await alone.pass()).toEqual({ sent: 0, retried: 1, dropped: 0, deferred: 0 });
    await deps.db.query('delete from jabber_outbox where account_id = $1', [t.id]);
    await deps.db.query('delete from jabber_omemo_prekeys');
  });

  it('review R1 (lead decision): a notice deferred for more than 24 hours counts as a failed try', async () => {
    const t = await withJabber();
    await sendAll();
    const deferring: JabberSender = { send: async () => { throw new NoticeDeferred(); } };
    const pass = () => sendDueNotices({ db: deps.db, clock: deps.clock, config: deps.config, sender: deferring });
    const row = async () =>
      (await deps.db.query<{ attempts: number; deferred_since: Date | null }>('select attempts, deferred_since from jabber_outbox where account_id = $1', [t.id])).rows;
    await changes(t, 1);
    expect(await pass()).toEqual({ sent: 0, retried: 0, dropped: 0, deferred: 1 });
    expect(await row()).toEqual([{ attempts: 0, deferred_since: now }]);
    advance(23 * 3_600_000);
    expect(await pass()).toEqual({ sent: 0, retried: 0, dropped: 0, deferred: 1 });
    expect((await row())[0]!.deferred_since).toEqual(new Date(now.getTime() - 23 * 3_600_000));
    advance(2 * 3_600_000);
    expect(await pass()).toEqual({ sent: 0, retried: 1, dropped: 0, deferred: 0 });
    expect((await row())[0]!.attempts).toBe(1);
    await deps.db.query('delete from jabber_outbox where account_id = $1', [t.id]);
  });

  it('purgeJabberPreKeys drops records not touched for 30 days and keeps the rest', async () => {
    await deps.db.query('delete from jabber_omemo_prekeys');
    const at = (ms: number) => new Date(now.getTime() - ms);
    for (const [tag, when] of [[1, at(PREKEY_RECORD_RETENTION_MS + 1)], [2, at(PREKEY_RECORD_RETENTION_MS - 60_000)]] as const) {
      await deps.db.query('insert into jabber_omemo_prekeys (recipient_tag, device_sealed, prekey_ids, listed_ids, updated_at) values ($1, $2, $3, $4, $5)', [
        Buffer.alloc(32, tag), Buffer.alloc(40, tag), [1], [1], when,
      ]);
    }
    expect(await purgeJabberPreKeys.run(deps.db, now)).toBe(1);
    expect((await records()).map((r) => (r.recipient_tag as Buffer)[0])).toEqual([2]);
    expect(RETENTION_JOBS).toContain(purgeJabberPreKeys);
    await deps.db.query('delete from jabber_omemo_prekeys');
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
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at, first_login_at)
       values ($1, 'Jmate', 'jmate', '{offers-see}', $2, $3, $2, $2, $2)`,
      [owner.id, deps.clock(), loginId],
    );
    // Adding the member was a team change (a member who has logged in before: J-20's first-login notice is the next test's).
    expect(await notices(owner.id)).toBe(1);
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    expect(err(await mb.get('/v1/account/jabber'))).toEqual({ status: 403, error: 'owner-only' });
    expect(err(await mb.post('/v1/account/jabber/test', { address: address() }))).toEqual({ status: 403, error: 'owner-only' });
    await deps.db.query("update accounts set display_name = 'jm-renamed', display_key = 'jm-renamed' where id = $1", [loginId]);
    expect(await notices(owner.id)).toBe(2);
  });
});

describe("a team member's first login tells the team account (J-20, owner p11-27, S-107; review F4)", () => {
  it('queues one team-member-first-login notice in the login, sends its sentence; later logins queue nothing more', async () => {
    const owner = await withJabber();
    const loginId = await seedAccount(deps, { loginName: `jfirst${n}x`, displayName: `jf-${n}-placeholder`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Jfirst', 'jfirst', '{offers-see}', $2, $3, $2, $2)`,
      [owner.id, deps.clock(), loginId],
    );
    await deps.db.query('delete from jabber_outbox');
    expect((await new Browser(app).post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    const kinds = async () => (await deps.db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1 order by id', [owner.id])).rows.map((r) => r.kind);
    expect(await kinds()).toEqual(['team-member-first-login']);
    await sendAll();
    expect(sent).toEqual([{ to: owner.jid, message: { kind: 'team-member-first-login' } }]);
    sent.length = 0;
    expect((await new Browser(app).post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    expect(await kinds()).toEqual([]);
  });
});

describe('a dispute tells both sides (migration 920; was the payer only, lead default 2026-11-08), same opt-in', () => {
  for (const openedBy of ['buyer', 'seller', 'system'] as const) {
    it(`opened by the ${openedBy}: buyer and seller each get the trade-attention sentence`, async () => {
      const buyer = await withJabber();
      const seller = await withJabber();
      const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      const trade = await driveTo(deps, t.trade, 'paid');
      await deps.db.query('delete from jabber_outbox');
      await withTx(deps.db, (c) => startDispute(c, trade, { openedBy, reason: openedBy === 'system' ? 'escalated' : 'other', note: '', afterRefund: false, now: deps.clock(), prices: null }));
      const { rows } = await deps.db.query<{ account_id: string; kind: string }>('select account_id, kind from jabber_outbox order by account_id');
      expect(rows).toEqual([{ account_id: buyer.id, kind: 'trade-attention' }, { account_id: seller.id, kind: 'trade-attention' }].sort((a, b) => a.account_id.localeCompare(b.account_id)));
      await sendAll();
      expect(sent.map((x) => x.to).sort()).toEqual([buyer.jid, seller.jid].sort());
      expect(sent.every((x) => x.message.kind === 'trade-attention')).toBe(true);
    });
  }
});

describe('trade milestones (owner 27 Nov 2026, migration 920): each tells only the side it is for, with a fixed sentence', () => {
  const kindsOf = async (id: string) =>
    (await deps.db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1 order by id', [id])).rows.map((r) => r.kind);

  it('the happy path: the poster hears of the new trade, the buyer of the escrow, the seller of the payment, both of the end', async () => {
    const buyer = await withJabber();
    const seller = await withJabber();
    await deps.db.query('delete from jabber_outbox');
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    expect(await kindsOf(seller.id)).toEqual(['trade-started']);
    expect(await kindsOf(buyer.id)).toEqual([]);
    await driveTo(deps, t.trade, 'secured');
    expect(await kindsOf(buyer.id)).toEqual(['trade-funded']);
    await deps.db.query('delete from jabber_outbox');
    const t2 = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer' });
    expect(await kindsOf(buyer.id)).toEqual(['trade-started']);
    expect(await kindsOf(seller.id)).toEqual([]);
    await driveTo(deps, t2.trade, 'released');
    expect(await kindsOf(buyer.id)).toEqual(['trade-started', 'trade-funded', 'trade-completed']);
    expect(await kindsOf(seller.id)).toEqual(['trade-paid', 'trade-completed']);
    await sendAll();
    const texts = sent.map((x) => messageText(x.message));
    expect(texts).toContain('Someone started a new trade with you on X2F.');
    expect(texts).toContain('A buyer marked a payment as sent on one of your X2F trades.');
    expect(texts).toContain('One of your X2F trades is complete.');
    // Never a trade code, amount or address in any sentence.
    for (const text of texts) expect(text).not.toMatch(new RegExp(`${t2.code}|[0-9]{3,}`));
  });

  it('a cancel request tells the other side; a cancel or refund tells both', async () => {
    const buyer = await withJabber();
    const seller = await withJabber();
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, t.trade, 'secured');
    await deps.db.query('delete from jabber_outbox');
    await deps.db.query("update trades set cancel_proposed_by = 'buyer' where code = $1", [t.code]);
    expect(await kindsOf(seller.id)).toEqual(['trade-cancel-asked']);
    expect(await kindsOf(buyer.id)).toEqual([]);
    await deps.db.query("update trades set state = 'refunded' where code = $1", [t.code]);
    expect(await kindsOf(seller.id)).toEqual(['trade-cancel-asked', 'trade-cancelled']);
    expect(await kindsOf(buyer.id)).toEqual(['trade-cancelled']);
  });

  it('a published ruling tells both sides', async () => {
    const buyer = await withJabber();
    const seller = await withJabber();
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const trade = await driveTo(deps, t.trade, 'paid');
    await withTx(deps.db, (c) => startDispute(c, trade, { openedBy: 'buyer', reason: 'other', note: '', afterRefund: false, now: deps.clock(), prices: null }));
    await deps.db.query('delete from jabber_outbox');
    await deps.db.query(
      `insert into dispute_rulings (code, seq, round, outcome, reason, moderator_name, ruled_at, appeal_until)
       select code, seq, 1, 'release-to-buyer', 'x', 'Mod', now(), now() + interval '1 day' from disputes where code = $1`,
      [t.code],
    );
    expect(await kindsOf(buyer.id)).toEqual(['trade-ruled']);
    expect(await kindsOf(seller.id)).toEqual(['trade-ruled']);
  });

  it('nothing for a side without Jabber on', async () => {
    const buyer = await withJabber();
    const seller = await trader();
    await deps.db.query("update jabber_contacts set enabled = false where account_id = $1", [buyer.id]);
    await deps.db.query('delete from jabber_outbox');
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer' });
    await driveTo(deps, t.trade, 'released');
    expect(await kindsOf(buyer.id)).toEqual([]);
    expect(await kindsOf(seller.id)).toEqual([]);
  });
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

describe('review M4: a key removed from X2F_JABBER_KEYS', () => {
  const ringOf = (entries: Array<[number, Uint8Array]>, current: number): Keyring => ({ current, keys: new Map(entries) });

  it('an address sealed under a key the ring no longer holds shows as broken (needs setting up again), not on', async () => {
    const t = await withJabber();
    const gone = ringOf([[77, new Uint8Array(randomBytes(32))]], 77);
    await deps.db.query('update jabber_contacts set jid_sealed = $2 where account_id = $1', [t.id, sealJid(gone, t.id, t.jid)]);
    await deps.db.query('delete from jabber_outbox');
    expect((await t.browser.get('/v1/account/jabber')).json()).toMatchObject({ state: 'broken', address: null });
    await deps.db.query('delete from jabber_contacts where account_id = $1', [t.id]);
    await deps.db.query('delete from jabber_outbox');
  });

  it('rewrapJabberSecrets reseals addresses, pending addresses and queued notices under the current key, queueing no notice; a re-run finds nothing', async () => {
    const t = await withJabber();
    advance(RESEND_WAIT_S * 1000 + 1);
    expect((await t.browser.post('/v1/account/jabber/test', { address: address() })).statusCode).toBe(202);
    expect((await t.browser.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect(await notices(t.id)).toBe(1);
    const old = deps.config.jabberKeys!;
    const fresh = new Uint8Array(randomBytes(32));
    const both = ringOf([[old.current + 1, fresh], ...old.keys], old.current + 1);
    const onlyNew = ringOf([[old.current + 1, fresh]], old.current + 1);

    const first = await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } });
    expect(first.failed).toBe(0);
    expect(first.rewrapped).toBeGreaterThanOrEqual(3);
    expect(await notices(t.id)).toBe(1); // the rewrap itself is not an account change
    const { rows } = await deps.db.query<{ jid_sealed: Buffer; pending_sealed: Buffer }>('select jid_sealed, pending_sealed from jabber_contacts where account_id = $1', [t.id]);
    expect(openJid(onlyNew, t.id, rows[0]!.jid_sealed)).toBe(t.jid);
    expect(openJid(onlyNew, t.id, rows[0]!.pending_sealed)).toMatch(/@xmpp\.example\.org$/);
    const queued = await deps.db.query<{ jid_sealed: Buffer }>('select jid_sealed from jabber_outbox where account_id = $1', [t.id]);
    expect(openJid(onlyNew, t.id, queued.rows[0]!.jid_sealed)).toBe(t.jid);
    expect(await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } })).toEqual({ rewrapped: 0, failed: 0, prekeysRewrapped: 0, prekeysNotCurrent: 0 });

    // A blob under a key neither ring holds is counted, left as it is, and never opens.
    const stray = ringOf([[90, new Uint8Array(randomBytes(32))]], 90);
    await deps.db.query('update jabber_contacts set jid_sealed = $2 where account_id = $1', [t.id, sealJid(stray, t.id, t.jid)]);
    await deps.db.query('delete from jabber_outbox');
    expect(await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: both } })).toEqual({ rewrapped: 0, failed: 1, prekeysRewrapped: 0, prekeysNotCurrent: 0 });
    await deps.db.query('delete from jabber_contacts where account_id = $1', [t.id]);
    await deps.db.query('delete from jabber_outbox');
  });
});

describe("review H1 (owner ruling p11-31, OMEMO mandatory): X2F's own OMEMO identity and bundle", () => {
  it('are created once with the private keys stored only sealed; the production encryptor announces and encrypts with them; the rewrap moves both', async () => {
    const ring = deps.config.jabberKeys!;
    const a = await loadOmemoIdentity(deps.db, ring, deps.clock());
    const b = await loadOmemoIdentity(deps.db, ring, deps.clock());
    expect(b.deviceId).toBe(a.deviceId);
    expect(b.publicKey.equals(a.publicKey)).toBe(true);
    expect(b.privateKey.equals(a.privateKey)).toBe(true);
    expect(a.deviceId).toBeGreaterThanOrEqual(1);
    expect(a.deviceId).toBeLessThan(2 ** 31);
    // The pair is a real X25519 pair: the public key is the private key's own.
    const derived = createPublicKey(createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', d: a.privateKey.toString('base64url'), x: a.publicKey.toString('base64url') }, format: 'jwk' }));
    expect(derived.export({ format: 'jwk' }).x).toBe(a.publicKey.toString('base64url'));
    // Lead decision after review L1: the identity is an Ed25519 seed; it signs (OpenSSL) what the libsignal-style verifier accepts under the Montgomery key.
    const probe = randomBytes(33);
    expect(xeddsaVerify(a.publicKey, probe, a.sign(probe))).toBe(true);
    expect(xeddsaVerify(a.publicKey, probe, b.sign(probe))).toBe(true);
    const bundle1 = await loadOmemoBundle(deps.db, ring, a);
    const bundle2 = await loadOmemoBundle(deps.db, ring, a);
    expect(bundle2).toEqual(bundle1);
    expect(bundle1.preKeys).toHaveLength(100);
    const { rows } = await deps.db.query<{ n: number; sealed: Buffer; bundle: Buffer }>('select count(*) over ()::int as n, identity_sealed as sealed, bundle_sealed as bundle from jabber_omemo_identity');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sealed.includes(a.privateKey)).toBe(false);
    expect(rows[0]!.bundle.includes(bundle1.signedPreKey.privateKey)).toBe(false);
    expect(rows[0]!.bundle.includes(bundle1.signedPreKey.privateKey.toString('hex'))).toBe(false);

    // The production encryptor: announces our device list and a bundle the sender's own parser accepts, and encrypts to a device that can read it.
    const encryptor = omemoEncryptor(deps.db, ring, deps.clock);
    const announced = await encryptor.announce();
    expect(announced.deviceId).toBe(a.deviceId);
    expect(announced.deviceList).toBe(`<list xmlns='eu.siacs.conversations.axolotl'><device id='${a.deviceId}'/></list>`);
    expect(parseBundle(a.deviceId, announced.bundle)?.preKeys).toHaveLength(100);
    const device = new OmemoDevice(4242, 20);
    const element = await encryptor.encrypt({ to: 'x@y.org', plaintext: 'An account change was made on your X2F account.', bundles: [parseBundle(4242, device.bundleXml())!] });
    expect(device.decrypt(element)).toBe('An account change was made on your X2F account.');

    const fresh = new Uint8Array(randomBytes(32));
    const next: Keyring = { current: 60, keys: new Map([[60, fresh], ...ring.keys]) };
    // (Earlier tests in this file left contacts sealed under rings `next` does not hold; those count as failed, not ours.)
    expect((await rewrapJabberSecrets({ db: deps.db, config: { jabberKeys: next } })).rewrapped).toBeGreaterThanOrEqual(2);
    const onlyNew: Keyring = { current: 60, keys: new Map([[60, fresh]]) };
    const moved = await loadOmemoIdentity(deps.db, onlyNew, deps.clock());
    expect(moved.privateKey.equals(a.privateKey)).toBe(true);
    expect(await loadOmemoBundle(deps.db, onlyNew, moved)).toEqual(bundle1);
    await expect(loadOmemoIdentity(deps.db, ring, deps.clock())).rejects.toThrow();
    const sealedBundle = (await deps.db.query<{ bundle_sealed: Buffer }>('select bundle_sealed from jabber_omemo_identity')).rows[0]!.bundle_sealed;
    expect(() => parseBundleSecrets(sealedBundle, a.privateKey)).toThrow(); // still sealed, not readable as is
  });
});

describe('owner demo note #226: renaming a wallet queues the account-change notice (security review)', () => {
  it('one notice per real rename, the fixed sentence only; the same name again queues nothing', async () => {
    const t = await withJabber();
    const addr = `5${'A'.repeat(94)}`;
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $3) returning id`,
      [t.id, addr, deps.clock()],
    );
    const id = rows[0]!.id;
    await deps.db.query('delete from jabber_outbox');
    const res = await t.browser.put(`/v1/wallets/${id}/label`, { label: 'Savings' });
    expect(res.statusCode, res.body).toBe(204);
    expect((await deps.db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1', [t.id])).rows.map((r) => r.kind)).toEqual(['account-change']);
    await sendAll();
    expect(sent).toEqual([{ to: t.jid, message: { kind: 'account-change' } }]);
    // Never the name or the address in the notice.
    expect(JSON.stringify(sent)).not.toMatch(/Savings|Main|AAAAAA/);
    sent.length = 0;
    await deps.db.query('delete from jabber_outbox');
    expect((await t.browser.put(`/v1/wallets/${id}/label`, { label: 'Savings' })).statusCode).toBe(204);
    expect(await notices(t.id)).toBe(0);
  });
});
