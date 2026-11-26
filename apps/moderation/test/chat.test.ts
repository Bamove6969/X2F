import { createHash, randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { generateIdentity, type Identity } from '@x2f/protocol';
import {
  chatIdentityProofBytes,
  identityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  verifyAttestation,
  type Attestation,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadChatIdentity, startModeration, type ChatWorkItem, type Fetch, type ModerationHandle } from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const API = 'http://api-internal.test';
const NOW = new Date('2026-10-28T12:00:00Z');

let db: pg.Pool;
let keystoreKey: Uint8Array;
let modSign: { public: string; secret: Uint8Array };

beforeAll(async () => {
  await sodium.ready;
  const name = `x2f_mod_c_${randomBytes(8).toString('hex')}`;
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

async function chatter(chat: string, role: 'buyer' | 'seller', bytes = chatIdentityProofBytes): Promise<{ id: Identity; reg: ChatWorkItem['participants']['buyer'] }> {
  const id = await generateIdentity();
  const proof = sodium.to_hex(sodium.crypto_sign_detached(bytes(chat, role, id.signPublic, id.boxPublic), id.signSecret));
  return { id, reg: { signPublic: id.signPublic, boxPublic: id.boxPublic, proof } };
}

/** The API's internal listener as the moderation service sees it, checking every signature. */
function fakeApi(chatWork: () => ChatWorkItem[]) {
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
    if (init.method === 'GET' && u.pathname === '/internal/v1/chat-work') return reply(200, { work: chatWork() });
    if (init.method === 'POST' && u.pathname === '/internal/v1/reports') {
      reports.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
      return reply(201, { ok: true });
    }
    return reply(404);
  };
  return { fetch, reports };
}

/** The running service: one at a time (instance lock, security review 7 Nov finding 2), so a new start is a restart. */
const live: ModerationHandle[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((h) => h.stop()));
});

async function moderation(fetch: Fetch): Promise<ModerationHandle> {
  await Promise.all(live.splice(0).map((h) => h.stop()));
  const h = await startModeration(
    { apiInternalUrl: API, relayAdminUrl: 'http://relay.test', daemonUri: 'http://127.0.0.1:1', db, keystoreKey, signingSecret: modSign.secret, feeWallet: '5'.repeat(95), payrollWallet: '6'.repeat(95), relayUrl: 'ws://relay.test', network: 'regtest' },
    { fetch, now: () => NOW, intervalMs: 0, watchIntervalMs: 0, runParty: () => {} },
  );
  live.push(h);
  return h;
}

describe('the chat mod identity', () => {
  it('attests a chat both traders accept (chat context), seals the mod identity and re-posts the same attestation', async () => {
    const chat = newTradeCode();
    const buyer = await chatter(chat, 'buyer');
    const seller = await chatter(chat, 'seller');
    const net = fakeApi(() => [{ chat, participants: { buyer: buyer.reg, seller: seller.reg } }]);
    const mod = await moderation(net.fetch);
    expect(await mod.chatTick()).toEqual([chat]);
    const report = net.reports.find((r) => r.kind === 'chat-attestation') as { attestation: Attestation; sig: string } | undefined;
    expect(report).toBeDefined();
    expect(report!.attestation.terms).toBeUndefined();
    for (const [role, t] of [['buyer', buyer], ['seller', seller]] as const) {
      await expect(
        verifyAttestation(report!.attestation, report!.sig, modSign.public, { trade: chat, role, signPublic: t.id.signPublic, boxPublic: t.id.boxPublic, context: 'chat', identityCreatedAt: NOW.getTime() }),
      ).resolves.toBeUndefined();
    }
    // The mod identity is kept sealed, so a moderator can read the chat once a dispute opens.
    const kept = await loadChatIdentity(db, keystoreKey, chat);
    expect(kept?.signPublic).toBe(report!.attestation.participants.mod.signPublic);
    const raw = await db.query<{ sealed: Buffer }>('select sealed from mod_chat_identities where chat = $1', [chat]);
    expect(raw.rows[0]!.sealed.toString('hex')).not.toContain(Buffer.from(kept!.signSecret).toString('hex').slice(0, 32));

    const again = fakeApi(() => [{ chat, participants: { buyer: buyer.reg, seller: seller.reg } }]);
    await (await moderation(again.fetch)).chatTick();
    expect(again.reports[0]).toEqual(report);
    await mod.stop();
  });

  it('refuses a chat whose proof is a trade-identity proof (never the trade domain, review M4)', async () => {
    const chat = newTradeCode();
    const buyer = await chatter(chat, 'buyer', identityProofBytes);
    const seller = await chatter(chat, 'seller');
    const net = fakeApi(() => [{ chat, participants: { buyer: buyer.reg, seller: seller.reg } }]);
    const mod = await moderation(net.fetch);
    expect(await mod.chatTick()).toEqual([]);
    expect(net.reports).toEqual([{ kind: 'chat-refused', chat, reason: 'bad-proof' }]);
    expect((await db.query('select 1 from signed_chats where chat = $1', [chat])).rows).toHaveLength(0);
    await mod.stop();
  });
});

describe('the work loop (review M3)', () => {
  it('logs a pass that throws and keeps running, so the process and the chain watcher live on', async () => {
    const reasons: string[] = [];
    const failing: Fetch = async () => {
      throw new Error('api down');
    };
    let unhandled = 0;
    const onUnhandled = () => void unhandled++;
    process.on('unhandledRejection', onUnhandled);
    const mod = await startModeration(
      { apiInternalUrl: API, relayAdminUrl: 'http://relay.test', daemonUri: 'http://127.0.0.1:1', db, keystoreKey, signingSecret: modSign.secret, feeWallet: '5'.repeat(95), payrollWallet: '6'.repeat(95), relayUrl: 'ws://relay.test', network: 'regtest' },
      {
        fetch: failing,
        now: () => NOW,
        intervalMs: 5,
        watchIntervalMs: 0,
        runParty: () => {},
        // a throw that escapes tick(): the log itself fails on the pass's own reason
        log: (e) => {
          reasons.push(e.reason);
          if (e.reason === 'work-unavailable') throw new Error('log sink down');
        },
      },
    );
    const failed = () => reasons.filter((r) => r === 'work-pass-failed').length;
    try {
      const deadline = Date.now() + 5_000;
      while (failed() < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
      expect(failed()).toBeGreaterThanOrEqual(2);
      expect(unhandled).toBe(0);
    } finally {
      await mod.stop();
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
