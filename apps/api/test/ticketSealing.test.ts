// J-14 review J6, sealing half (lead 10 Nov 01:03:49): ticket text (`ticket_messages.body`: a
// support ticket's thread, staff replies, and the "My account has been compromised" report's comment,
// where the sender types any credentials) is sealed at rest under X2F_TICKET_KEYS with the key store
// every sealed secret uses (auth/keystore.ts), as main's Jabber addresses are under X2F_JABBER_KEYS.
// It is opened only per request in the reads that return it: the staff reads that write the
// `ticket.viewed` / `compromised.viewed` audit row, and the trader reading their own ticket. Never in
// a list, a log or an error.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { Keyring } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { COMPROMISED_BUCKET } from '../src/limits.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as sealModule from '../src/tickets/seal.js';
import { rewrapTicketSecrets } from '../src/tickets/seal.js';
import { afterLocksSettled } from '../src/tickets/traderRoutes.js';
import { seedAccount } from './helpers/accounts.js';
import { testRing } from './helpers/app.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, staffApps, uniqueName } from './helpers/staffApp.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { VAPID_ENV } from './helpers/vapid.js';

const T0 = new Date('2026-11-10T10:00:00Z');

let staffApp: FastifyInstance;
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let staffLogs: string[];
let traderLogs: string[];
let n = 0;

beforeAll(async () => {
  const s = await staffApps();
  ({ app: staffApp, trader: app, deps, setNow, close, logs: staffLogs, traderLogs } = s);
  addTestLogin(app, deps);
});
afterAll(async () => close());
beforeEach(() => {
  setNow(T0);
  (app as unknown as { budgets: { start: { tokens: number }; compromised: { tokens: number } } }).budgets.start.tokens = 120;
  (app as unknown as { budgets: { compromised: { tokens: number } } }).budgets.compromised.tokens = COMPROMISED_BUCKET.capacity;
});

/** Swaps the ticket ring in both apps (the staff app holds its own copy of the config). */
function setRing(ring: Keyring): void {
  deps.config.ticketKeys = ring;
  (staffApp as unknown as { deps: Deps }).deps.config.ticketKeys = ring;
}

/** A marker no other test writes, so a hit anywhere is this test's text. */
const marker = (what: string) => `${what}-${randomBytes(6).toString('hex')}`;

async function trader(): Promise<{ id: string; loginName: string; b: Browser }> {
  const loginName = `ts${String(++n).padStart(4, '0')}${Date.now().toString(36)}`;
  const id = await seedAccount(deps, { loginName });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return { id, loginName, b };
}

async function staff(role: 'owner' | 'senior' | 'helper', grants: string[] = []) {
  const s = await seedStaff(deps, { role, grants, loginName: uniqueName(role) });
  const { token } = await insertSession(deps, s.id, 'staff');
  return { ...s, b: new StaffBrowser(staffApp).withSession(token) };
}

/** Every column of every message of the ticket, as Postgres prints it (bytea as hex, text as is). */
async function rawRows(ticketId: string): Promise<string> {
  const { rows } = await deps.db.query<{ row: string }>('select m::text as row from ticket_messages m where ticket_id = $1 order by seq', [ticketId]);
  return rows.map((r) => r.row).join('\n');
}

const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

/** The whole support-ticket flow with marked text: open, staff reply, trader reply. */
async function supportFlow() {
  const a = await trader();
  const first = marker('first-words');
  const answer = marker('staff-answer');
  const again = marker('trader-again');
  const res = await a.b.post('/v1/tickets', { category: 'trades', body: first });
  expect(res.statusCode, res.body).toBe(201);
  const t = res.json().ticket as { id: string; number: number };
  const helper = await staff('helper', ['tickets.handle']);
  expect((await helper.b.post(`/staff/v1/tickets/${t.id}/messages`, { body: answer })).statusCode).toBe(201);
  expect((await a.b.post(`/v1/tickets/${t.id}/messages`, { body: again })).statusCode).toBe(201);
  return { a, t, helper, texts: [first, answer, again] };
}

/** A compromised-account report whose comment carries a typed credential. */
async function compromisedFlow() {
  const v = await trader();
  const secret = marker('typed-recovery-code');
  const res = await new Browser(app).post('/v1/tickets/compromised', { loginName: v.loginName, methodsLeft: ['password'], comment: `They have my code ${secret}` });
  await afterLocksSettled();
  expect(res.statusCode, res.body).toBe(202);
  const id = (await deps.db.query<{ id: string }>("select id from tickets where kind = 'compromised' and number = $1", [res.json().number])).rows[0]!.id;
  return { v, id, secret };
}

describe('J6 sealing: ticket text at rest', () => {
  it('a support ticket thread (trader, staff, trader) is stored sealed: no plaintext column, no plaintext bytes', async () => {
    const { t, texts } = await supportFlow();
    const { rows } = await deps.db.query<{ body_sealed: Buffer | null }>('select body_sealed from ticket_messages where ticket_id = $1 order by seq', [t.id]);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.body_sealed).toBeInstanceOf(Buffer);
      // The key store's format 1 under the ring's current key.
      expect(r.body_sealed![0]).toBe(0x01);
      expect(r.body_sealed!.readUInt16BE(1)).toBe(deps.config.ticketKeys.current);
    }
    const raw = await rawRows(t.id);
    for (const text of texts) {
      expect(raw).not.toContain(text);
      expect(raw).not.toContain(hex(text));
    }
  });

  it("the compromised report's comment (typed credentials) is stored sealed", async () => {
    const { id, secret } = await compromisedFlow();
    const raw = await rawRows(id);
    expect(raw).not.toBe('');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(hex(secret));
    const { rows } = await deps.db.query<{ sealed: boolean }>('select body_sealed is not null as sealed from ticket_messages where ticket_id = $1', [id]);
    expect(rows).toEqual([{ sealed: true }]);
  });

  // Review S2 (12 Nov): 451 folded into 450 (now 660) before landing. The table has no plaintext column at
  // all, so no code path can ever store ticket text in clear, and a row without sealed text is refused.
  it('the table has no plaintext column; a row without sealed text, or not in the sealed format, is refused', async () => {
    const { t } = await supportFlow();
    const cols = await deps.db.query<{ column_name: string; is_nullable: string }>(
      "select column_name, is_nullable from information_schema.columns where table_name = 'ticket_messages' and column_name like 'body%' order by column_name",
    );
    expect(cols.rows).toEqual([{ column_name: 'body_sealed', is_nullable: 'NO' }]);
    await expect(deps.db.query("insert into ticket_messages (ticket_id, author, at) values ($1, 'trader', now())", [t.id])).rejects.toMatchObject({ code: '23502' });
    await expect(
      deps.db.query("insert into ticket_messages (ticket_id, author, body_sealed, at) values ($1, 'trader', $2, now())", [t.id, Buffer.concat([Buffer.from([2]), randomBytes(40)])]),
    ).rejects.toThrow(/ticket_messages_sealed_size/);
  });
});

describe('J6 sealing: opened only where the read is audited (or the owner reads their own)', () => {
  it('the staff read opens the thread and writes ticket.viewed; the trader reads their own thread opened', async () => {
    const { a, t, helper, texts } = await supportFlow();
    const before = (await logEntries(deps, 'ticket.viewed')).length;
    const view = await helper.b.get(`/staff/v1/tickets/${t.id}`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json().messages.map((m: { body: string }) => m.body)).toEqual(texts);
    const viewed = await logEntries(deps, 'ticket.viewed');
    expect(viewed.length).toBe(before + 1);
    expect(JSON.parse(viewed.at(-1)!.detail)).toEqual({ ticketId: t.id });
    const own = await a.b.get(`/v1/tickets/${t.id}`);
    expect(own.json().messages.map((m: { body: string }) => m.body)).toEqual(texts);
  });

  it('the senior read of a compromised report opens the comment and writes compromised.viewed', async () => {
    const { id, secret } = await compromisedFlow();
    const senior = await staff('senior');
    const before = (await logEntries(deps, 'compromised.viewed')).length;
    const view = await senior.b.get(`/staff/v1/compromised/${id}`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json().comment).toBe(`They have my code ${secret}`);
    expect((await logEntries(deps, 'compromised.viewed')).length).toBe(before + 1);
  });

  it('lists carry ids and metadata only; logs and the activity log never carry the text, refusals included', async () => {
    const { a, t, helper, texts } = await supportFlow();
    const { secret, id } = await compromisedFlow();
    const senior = await staff('senior');
    // Reads that open the text, so the logs below cover them too.
    await helper.b.get(`/staff/v1/tickets/${t.id}`);
    await a.b.get(`/v1/tickets/${t.id}`);
    await senior.b.get(`/staff/v1/compromised/${id}`);
    // Refusals: a closed ticket, a body too long, another trader's ticket.
    const tooLong = marker('too-long') + 'x'.repeat(4001);
    expect((await a.b.post(`/v1/tickets/${t.id}/messages`, { body: tooLong })).statusCode).toBe(400);
    expect((await helper.b.post(`/staff/v1/tickets/${t.id}/close`)).statusCode).toBe(200);
    const late = marker('after-close');
    expect(errorOf(await a.b.post(`/v1/tickets/${t.id}/messages`, { body: late }))).toBe('ticket-closed');
    const lists = JSON.stringify([
      (await a.b.get('/v1/tickets')).json(),
      (await helper.b.get('/staff/v1/tickets?status=closed')).json(),
      (await helper.b.get('/staff/v1/tickets?status=open')).json(),
      (await senior.b.get('/staff/v1/compromised')).json(),
    ]);
    const logs = [...staffLogs, ...traderLogs].join('\n');
    const audit = JSON.stringify((await deps.db.query("select * from activity_log where action like 'ticket.%' or action like 'compromised.%' or action like 'account.%'")).rows);
    for (const text of [...texts, secret, tooLong.slice(0, 30), late]) {
      expect(lists).not.toContain(text);
      expect(logs).not.toContain(text);
      expect(audit).not.toContain(text);
    }
    expect(lists).not.toContain('"body"');
    expect(lists).not.toContain('"comment"');
  });
});

describe('J6 sealing: keys', () => {
  it('rewrapTicketSecrets reseals every message under the current key; a re-run finds nothing; the old key can then go', async () => {
    const { t, helper, texts } = await supportFlow();
    const { id, secret } = await compromisedFlow();
    const old = deps.config.ticketKeys;
    const next = testRing(old.current + 1);
    const both: Keyring = { current: next.current, keys: new Map([...next.keys, ...old.keys]) };
    try {
      setRing(both);
      const first = await rewrapTicketSecrets({ db: deps.db, config: deps.config });
      expect(first.failed).toBe(0);
      expect(first.rewrapped).toBeGreaterThanOrEqual(4);
      expect(await rewrapTicketSecrets({ db: deps.db, config: deps.config })).toEqual({ rewrapped: 0, failed: 0 });
      const { rows } = await deps.db.query<{ body_sealed: Buffer }>('select body_sealed from ticket_messages where ticket_id = any($1::uuid[])', [[t.id, id]]);
      for (const r of rows) expect(r.body_sealed.readUInt16BE(1)).toBe(next.current);
      // The old key leaves the ring: everything still opens with the new key alone.
      setRing(next);
      expect((await helper.b.get(`/staff/v1/tickets/${t.id}`)).json().messages.map((m: { body: string }) => m.body)).toEqual(texts);
      const senior = await staff('senior');
      expect((await senior.b.get(`/staff/v1/compromised/${id}`)).json().comment).toBe(`They have my code ${secret}`);
      // Rewrapping writes no audit row and returns counts only.
      expect(JSON.stringify(first)).not.toContain(secret);
    } finally {
      // Back to a ring that opens every other test's rows (the old key, plus the new one for these).
      setRing({ current: old.current, keys: new Map([...old.keys, ...next.keys]) });
    }
  });

  it('a message whose key left the ring fails closed: no text, no plaintext in the error or the logs, and the rewrap counts it as failed', async () => {
    const { a, t, helper, texts } = await supportFlow();
    const kept = deps.config.ticketKeys;
    const other = testRing(kept.current + 50);
    try {
      setRing(other);
      const staffRead = await helper.b.get(`/staff/v1/tickets/${t.id}`);
      expect(staffRead.statusCode).toBe(500);
      const own = await a.b.get(`/v1/tickets/${t.id}`);
      expect(own.statusCode).toBe(500);
      for (const r of [staffRead, own]) for (const text of texts) expect(r.body).not.toContain(text);
      const logs = [...staffLogs, ...traderLogs].join('\n');
      for (const text of texts) expect(logs).not.toContain(text);
      const result = await rewrapTicketSecrets({ db: deps.db, config: deps.config });
      expect(result.failed).toBeGreaterThanOrEqual(3);
      // Nothing was rewritten: the old key opens them again once it is back.
    } finally {
      setRing(kept);
    }
    expect((await helper.b.get(`/staff/v1/tickets/${t.id}`)).json().messages.map((m: { body: string }) => m.body)).toEqual(texts);
  });

  it('a sealed message moved to another message or ticket does not open', async () => {
    const one = await supportFlow();
    const two = await supportFlow();
    const blob = (await deps.db.query<{ body_sealed: Buffer }>('select body_sealed from ticket_messages where ticket_id = $1 order by seq limit 1', [one.t.id])).rows[0]!.body_sealed;
    await deps.db.query('update ticket_messages set body_sealed = $2 where id = (select id from ticket_messages where ticket_id = $1 order by seq limit 1)', [two.t.id, blob]);
    const read = await two.helper.b.get(`/staff/v1/tickets/${two.t.id}`);
    expect(read.statusCode).toBe(500);
    expect(read.body).not.toContain(one.texts[0]);
  });

  it('X2F_TICKET_KEYS is required (env or file), and must be separate from every other secret', () => {
    const k = (fill: number) => `1:${Buffer.alloc(32, fill).toString('base64')}`;
    const env = {
      X2F_ORIGINS: 'https://x2f.test', X2F_RP_ID: 'x2f.test', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x2f',
      X2F_LEAKED_LIST_PATH: '/srv/x2f/leaked.bin', X2F_SERVER_KEY: Buffer.alloc(32, 7).toString('base64'), X2F_MONERO_NETWORK: 'stagenet',
      X2F_TERMS_VERSION: '2026-10-17', X2F_PGP_SIGNING_KEY_PATH: '/srv/x2f/signing.asc', X2F_PGP_SIGNING_FINGERPRINT: 'a'.repeat(40),
      X2F_PASSWORD_PEPPERS: k(1), X2F_RECOVERY_CODE_KEYS: k(2), X2F_TOTP_KEYS: k(3), X2F_LOGIN_NAME_KEYS: k(4), ...VAPID_ENV,
    };
    expect(() => loadConfig(env)).toThrow(/X2F_TICKET_KEYS is missing/);
    expect(loadConfig({ ...env, X2F_TICKET_KEYS: k(5) }).ticketKeys.current).toBe(1);
    expect(() => loadConfig({ ...env, X2F_TICKET_KEYS: k(3) })).toThrow(/X2F_TICKET_KEYS .*separate/);
    // The error names the variable only, never the key.
    try {
      loadConfig({ ...env, X2F_TICKET_KEYS: `1:${Buffer.alloc(31, 9).toString('base64')}` });
    } catch (e) {
      expect(String(e)).not.toContain(Buffer.alloc(31, 9).toString('base64'));
    }
  });
});

describe('J6 sealing: no plaintext step (review S2)', () => {
  // Migration 450 was renumbered 660 on landing (18 Nov): still no second, plaintext-sealing step.
  it('there is no migration 451, no ticket-sealing migration, no seal-tickets tool and no plaintext seal or startup check', () => {
    const root = new URL('../', import.meta.url);
    const migrations = readdirSync(new URL('migrations/', root));
    expect(migrations.filter((f) => f.startsWith('451_') || /ticket_sealing/.test(f))).toEqual([]);
    expect(migrations.filter((f) => /ticket/.test(f))).toEqual(['660_support_tickets.sql']);
    expect(existsSync(new URL('src/tools/seal-tickets.ts', root))).toBe(false);
    expect(JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts['seal-tickets']).toBeUndefined();
    expect(Object.keys(sealModule).filter((k) => /plaintext|TicketsSealed/i.test(k))).toEqual([]);
  });
});

