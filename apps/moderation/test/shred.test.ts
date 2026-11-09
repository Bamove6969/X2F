import { createHash, randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { generateIdentity, open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { CHAT_AFTER_DISPUTE_DAYS, CHAT_PRETRADE_IDLE_DAYS, channelFor, chatIdentityProofBytes, INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, type Attestation } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadChatIdentity, startModeration, type ChatWorkItem, type Fetch, type ModerationHandle } from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

/**
 * The moderation shred pass (design-chat-membership-keys-2026-11-08 section 5, task 1): when the API
 * purges a chat, this service destroys the chat's moderator identity and signed attestation, on its
 * own clock and never while its own records show the chat's trade in a dispute.
 */
const API = 'http://api-internal.test';
const DAY = 86_400_000;
const T0 = new Date('2026-10-28T12:00:00Z');

let db: pg.Pool;
let keystoreKey: Uint8Array;
let modSign: { public: string; secret: Uint8Array };
let now = T0;

beforeAll(async () => {
  await sodium.ready;
  const name = `x2f_mod_s_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await admin.connect();
  try {
    await admin.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  db = new pg.Pool({ connectionString: `${inject('modPgUrl')}/${name}`, max: 4 });
  keystoreKey = new Uint8Array(randomBytes(32));
  const kp = sodium.crypto_sign_keypair();
  modSign = { public: sodium.to_hex(kp.publicKey), secret: kp.privateKey };
});

afterAll(async () => {
  await db.end();
});

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

interface Order {
  chat: string;
  trade: string | null;
  purgedAt: string;
}

/** The API's internal listener as the moderation service sees it, checking every signature. */
function fakeApi(s: { chatWork?: () => ChatWorkItem[]; orders?: () => Order[]; watch?: () => Array<{ trade: string; state: string }> | null; shredStatus?: number }) {
  const reports: Array<Record<string, unknown>> = [];
  const modKey = sodium.from_hex(modSign.public);
  const fetch: Fetch = async (url, init) => {
    const reply = (status: number, body: unknown = {}) => ({ status, json: async () => body });
    const u = new URL(url);
    if (u.origin !== API) return reply(404);
    const msg = internalSignedBytes({ method: init.method, path: u.pathname, at: Number(init.headers[INTERNAL_AT_HEADER]), bodyHash: sha256Hex(init.body ?? '') });
    const sig = init.headers[INTERNAL_SIG_HEADER];
    if (!sig || !sodium.crypto_sign_verify_detached(sodium.from_base64(sig, sodium.base64_variants.ORIGINAL), msg, modKey)) return reply(401);
    if (init.method === 'GET' && u.pathname === '/internal/v1/work') return reply(200, { work: [] });
    if (init.method === 'GET' && u.pathname === '/internal/v1/chat-work') return reply(200, { work: s.chatWork?.() ?? [] });
    if (init.method === 'GET' && u.pathname === '/internal/v1/chat-shred') return reply(200, { orders: s.orders?.() ?? [] });
    if (init.method === 'GET' && u.pathname === '/internal/v1/watch') {
      const w = s.watch ? s.watch() : [];
      if (w === null) return reply(503);
      return reply(200, { trades: w.map((t) => ({ ...t, settleKind: null, paused: false, finalAlertSeenAt: null, finalAlertAt: null })) });
    }
    if (init.method === 'POST' && u.pathname === '/internal/v1/reports') {
      const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      reports.push(body);
      return reply(body.kind === 'chat-shredded' ? (s.shredStatus ?? 201) : 201, { ok: true });
    }
    return reply(404);
  };
  return { fetch, reports };
}

const live: ModerationHandle[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((h) => h.stop()));
});

async function moderation(fetch: Fetch, log: (e: { reason: string }) => void = () => {}): Promise<ModerationHandle> {
  await Promise.all(live.splice(0).map((h) => h.stop()));
  const h = await startModeration(
    { apiInternalUrl: API, relayAdminUrl: 'http://relay.test', daemonUri: 'http://127.0.0.1:1', db, keystoreKey, signingSecret: modSign.secret, feeWallet: '5'.repeat(95), relayUrl: 'ws://relay.test', network: 'regtest' },
    { fetch, now: () => now, intervalMs: 0, watchIntervalMs: 0, runParty: () => {}, log },
  );
  live.push(h);
  return h;
}

async function chatter(chat: string, role: 'buyer' | 'seller'): Promise<{ id: Identity; reg: ChatWorkItem['participants']['buyer'] }> {
  const id = await generateIdentity();
  const proof = sodium.to_hex(sodium.crypto_sign_detached(chatIdentityProofBytes(chat, role, id.signPublic, id.boxPublic), id.signSecret));
  return { id, reg: { signPublic: id.signPublic, boxPublic: id.boxPublic, proof } };
}

/** A chat this service attested at T0, and one buyer line sealed to buyer, seller and the mod identity. */
async function attestedChat(): Promise<{ chat: string; participants: Participants; envelope: Envelope; channel: string }> {
  now = T0;
  const chat = newTradeCode();
  const buyer = await chatter(chat, 'buyer');
  const seller = await chatter(chat, 'seller');
  const net = fakeApi({ chatWork: () => [{ chat, participants: { buyer: buyer.reg, seller: seller.reg } }] });
  const mod = await moderation(net.fetch);
  expect(await mod.chatTick()).toEqual([chat]);
  const report = net.reports.find((r) => r.kind === 'chat-attestation') as { attestation: Attestation } | undefined;
  const participants = report!.attestation.participants;
  // The row was made by the database clock; this service's own clock is `now`.
  await db.query('update signed_chats set created_at = $2 where chat = $1', [chat, T0]);
  await db.query('update mod_chat_identities set created_at = $2 where chat = $1', [chat, T0]);
  const channel = await channelFor(chat, 'chat');
  const envelope = await seal({ trade: channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'the account is 1234' }, to: ['buyer', 'seller', 'mod'], me: buyer.id, participants });
  return { chat, participants, envelope, channel };
}

/** Every row of every table in the moderation database, as text. */
async function dumpAll(): Promise<string> {
  const { rows: tables } = await db.query<{ t: string }>(`select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`);
  const parts: string[] = [];
  for (const { t } of tables) {
    const { rows } = await db.query<{ j: string }>(`select row_to_json(x)::text as j from ${t} x`);
    parts.push(...rows.map((r) => r.j));
  }
  return parts.join('\n');
}

const order = (chat: string, trade: string | null = null): Order => ({ chat, trade, purgedAt: new Date(now.getTime() - 1000).toISOString() });

describe('the shred pass', () => {
  it('destroys the purged chat\'s mod identity and attestation, so nothing left opens the envelope, and reports it shredded', async () => {
    const c = await attestedChat();
    // Before: the sealed mod identity opens the moderator's copy of the line.
    const kept = await loadChatIdentity(db, keystoreKey, c.chat);
    const opened = await open(c.envelope, { me: { ...kept! }, myRole: 'mod', participants: c.participants, trade: c.channel, guard: new ReplayGuard(c.channel) });
    expect(opened.payload).toEqual({ text: 'the account is 1234' });

    now = new Date(T0.getTime() + 31 * DAY);
    const net = fakeApi({ orders: () => [order(c.chat)] });
    const mod = await moderation(net.fetch);
    expect(await mod.shredTick()).toEqual([c.chat]);
    expect(net.reports).toEqual([{ kind: 'chat-shredded', chat: c.chat }]);

    // After: no identity, no attestation, and no row anywhere in this database names the chat or
    // its mod keys, so neither the database nor MOD_KEYSTORE_KEY can open the envelope again.
    expect(await loadChatIdentity(db, keystoreKey, c.chat)).toBeNull();
    expect((await db.query('select 1 from signed_chats where chat = $1', [c.chat])).rows).toHaveLength(0);
    expect((await db.query('select 1 from mod_chat_identities where chat = $1', [c.chat])).rows).toHaveLength(0);
    const dump = await dumpAll();
    expect(dump).not.toContain(c.chat);
    expect(dump).not.toContain(c.participants.mod.signPublic);
    expect(dump).not.toContain(Buffer.from(kept!.boxSecret).toString('hex'));
  });

  it('is idempotent: an order seen again (or for a chat it never attested) is reported done with nothing to delete', async () => {
    const c = await attestedChat();
    now = new Date(T0.getTime() + 31 * DAY);
    const never = newTradeCode();
    const net = fakeApi({ orders: () => [order(c.chat), order(never)] });
    const mod = await moderation(net.fetch);
    expect(await mod.shredTick()).toEqual([c.chat, never]);
    expect(await mod.shredTick()).toEqual([c.chat, never]);
    expect(net.reports.filter((r) => r.kind === 'chat-shredded')).toHaveLength(4);
  });

  it('a report the API does not take is retried on the next pass (the keys are already gone)', async () => {
    const c = await attestedChat();
    now = new Date(T0.getTime() + 31 * DAY);
    const reasons: string[] = [];
    const down = fakeApi({ orders: () => [order(c.chat)], shredStatus: 503 });
    expect(await (await moderation(down.fetch, (e) => reasons.push(e.reason))).shredTick()).toEqual([]);
    expect(reasons).toContain('chat-shred-report-refused-503');
    expect(await loadChatIdentity(db, keystoreKey, c.chat)).toBeNull();
    const up = fakeApi({ orders: () => [order(c.chat)] });
    expect(await (await moderation(up.fetch)).shredTick()).toEqual([c.chat]);
  });

  it(`its own clock: a chat it attested less than ${CHAT_PRETRADE_IDLE_DAYS} days ago is never shredded, whatever the API says`, async () => {
    const c = await attestedChat();
    now = new Date(T0.getTime() + CHAT_PRETRADE_IDLE_DAYS * DAY - 1);
    const reasons: string[] = [];
    const net = fakeApi({ orders: () => [order(c.chat)] });
    const mod = await moderation(net.fetch, (e) => reasons.push(e.reason));
    expect(await mod.shredTick()).toEqual([]);
    expect(reasons).toContain('chat-shred-held-young');
    expect(net.reports).toEqual([]);
    expect(await loadChatIdentity(db, keystoreKey, c.chat)).not.toBeNull();
    now = new Date(T0.getTime() + CHAT_PRETRADE_IDLE_DAYS * DAY);
    expect(await mod.shredTick()).toEqual([c.chat]);
  });

  it(`never shreds the chat of a trade it saw disputed in the last ${CHAT_AFTER_DISPUTE_DAYS} days (its own record from the watch list)`, async () => {
    const c = await attestedChat();
    const trade = newTradeCode();
    let state = 'disputed';
    const reasons: string[] = [];
    const net = fakeApi({ orders: () => [order(c.chat, trade)], watch: () => [{ trade, state }] });
    const mod = await moderation(net.fetch, (e) => reasons.push(e.reason));
    // The watcher pass on day 10 sees the dispute; then the API closes it (and lists the trade closed).
    now = new Date(T0.getTime() + 10 * DAY);
    await mod.watch();
    state = 'closed';
    // A (compromised or buggy) API orders the shred on day 40: held.
    now = new Date(T0.getTime() + 40 * DAY);
    expect(await mod.shredTick()).toEqual([]);
    expect(reasons).toContain('chat-shred-held-dispute');
    expect(await loadChatIdentity(db, keystoreKey, c.chat)).not.toBeNull();
    now = new Date(T0.getTime() + (10 + CHAT_AFTER_DISPUTE_DAYS) * DAY);
    expect(await mod.shredTick()).toEqual([]);
    now = new Date(T0.getTime() + (10 + CHAT_AFTER_DISPUTE_DAYS) * DAY + 1);
    expect(await mod.shredTick()).toEqual([c.chat]);
  });

  it('the shred pass records a dispute it sees on the watch list itself, and holds while it is open', async () => {
    const c = await attestedChat();
    const trade = newTradeCode();
    now = new Date(T0.getTime() + 31 * DAY);
    const reasons: string[] = [];
    const net = fakeApi({ orders: () => [order(c.chat, trade)], watch: () => [{ trade, state: 'disputed' }] });
    const mod = await moderation(net.fetch, (e) => reasons.push(e.reason));
    expect(await mod.shredTick()).toEqual([]);
    expect(reasons).toContain('chat-shred-held-dispute');
    expect((await db.query('select 1 from mod_dispute_seen where trade = $1', [trade])).rows).toHaveLength(1);
  });

  it('holds a trade chat while the watch list shows its trade not closed, and every trade chat when the list cannot be read', async () => {
    const c = await attestedChat();
    const trade = newTradeCode();
    now = new Date(T0.getTime() + 31 * DAY);
    const reasons: string[] = [];
    let watch: Array<{ trade: string; state: string }> | null = [{ trade, state: 'published' }];
    const pre = await attestedChat();
    now = new Date(T0.getTime() + 31 * DAY);
    const net = fakeApi({ orders: () => [order(c.chat, trade), order(pre.chat)], watch: () => watch });
    const mod = await moderation(net.fetch, (e) => reasons.push(e.reason));
    // The pre-trade chat (no trade) is not held by the trade's state.
    expect(await mod.shredTick()).toEqual([pre.chat]);
    expect(reasons).toContain('chat-shred-held-open');
    watch = null;
    expect(await mod.shredTick()).toEqual([pre.chat]);
    expect(reasons).toContain('chat-shred-held-unknown');
    watch = [{ trade, state: 'closed' }];
    expect(await mod.shredTick()).toEqual([c.chat, pre.chat]);
    // A trade the list no longer shows (closed more than 31 days ago) is not held either.
    expect(await loadChatIdentity(db, keystoreKey, c.chat)).toBeNull();
  });

  it('a bad order is logged and skipped; the shred list unavailable is logged', async () => {
    const reasons: string[] = [];
    const net = fakeApi({ orders: () => [{ chat: 'nope', trade: null, purgedAt: '' }] });
    expect(await (await moderation(net.fetch, (e) => reasons.push(e.reason))).shredTick()).toEqual([]);
    expect(reasons).toContain('bad-chat-shred');
    const failing: Fetch = async () => {
      throw new Error('api down');
    };
    expect(await (await moderation(failing, (e) => reasons.push(e.reason))).shredTick()).toEqual([]);
    expect(reasons).toContain('chat-shred-unavailable');
  });
});
