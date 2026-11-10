import { createHash, randomBytes } from 'node:crypto';
import { newTradeCode, type Role } from '@x2f/core';
import { generateIdentity, type Identity } from '@x2f/protocol';
import {
  attestationBytes,
  channelFor,
  identityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  verifyAttestation,
  type Attestation,
  type AttestedTerms,
  type ConfirmedDeal,
  type ModPartyArgs,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  loadParty,
  modSubkey,
  open,
  relayRegisterMessage,
  startModeration,
  type Fetch,
  type ModerationHandle,
  type WorkItem,
} from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const API = 'http://api-internal.test';
const RELAY = 'http://relay-admin.test';
const NOW = new Date('2026-10-24T12:00:00Z');
/** The trade record's terms, as the API's work list hands them over (lead answer 4). */
const TERMS: AttestedTerms = {
  deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000' },
  payWindowMin: 90,
  buyerPayout: '4'.padEnd(95, 'B'),
  sellerRefund: '8'.padEnd(95, 'S'),
};
const DEAL: ConfirmedDeal = { poster: 'seller', takeAmountAtomic: 250_000_000_000n, currency: 'USD', centsPerXmr: 16_250n, maxFiatCents: 100_000n };
const ownAddress = (role: 'buyer' | 'seller'): string => (role === 'buyer' ? TERMS.buyerPayout : TERMS.sellerRefund);

let db: pg.Pool;
let dbName: string;
let keystoreKey: Uint8Array;
let modSign: { public: string; secret: Uint8Array };

beforeAll(async () => {
  await sodium.ready;
  dbName = `x2f_mod_t_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await admin.connect();
  try {
    await admin.query(`create database ${dbName} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  db = new pg.Pool({ connectionString: `${inject('modPgUrl')}/${dbName}`, max: 4 });
  keystoreKey = new Uint8Array(randomBytes(32));
  const kp = sodium.crypto_sign_keypair();
  modSign = { public: sodium.to_hex(kp.publicKey), secret: kp.privateKey };
});

afterAll(async () => {
  await db.end();
});

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** A trader's own identity and its registration proof for one slot of one trade. */
async function trader(code: string, role: 'buyer' | 'seller'): Promise<{ id: Identity; reg: WorkItem['participants']['buyer'] }> {
  const id = await generateIdentity();
  const proof = sodium.to_hex(sodium.crypto_sign_detached(identityProofBytes(code, role, id.signPublic, id.boxPublic), id.signSecret));
  return { id, reg: { signPublic: id.signPublic, boxPublic: id.boxPublic, proof } };
}

/**
 * A stand-in for the API's internal listener and the relay's admin listener, reached only through
 * the injected fetch. It CHECKS every moderation signature exactly as the real listeners do, and
 * records what was posted.
 */
function fakeNetwork(work: () => WorkItem[]) {
  const reports: Array<{ attestation: Attestation; sig: string }> = [];
  const registered: Array<{ channel: string; signPublics: Record<Role, string> }> = [];
  const refused: string[] = [];
  /** Terminal `refused` reports posted to the API (signed like every internal request). */
  const refusals: Array<{ trade: string; reason: string }> = [];
  const modKey = sodium.from_hex(modSign.public);
  const fetch: Fetch = async (url, init) => {
    const reply = (status: number, body: unknown = {}) => ({ status, json: async () => body });
    const u = new URL(url);
    if (u.origin === API) {
      const at = Number(init.headers[INTERNAL_AT_HEADER]);
      const sig = init.headers[INTERNAL_SIG_HEADER];
      const msg = internalSignedBytes({ method: init.method, path: u.pathname, at, bodyHash: sha256Hex(init.body ?? '') });
      if (!sig || !sodium.crypto_sign_verify_detached(sodium.from_base64(sig, sodium.base64_variants.ORIGINAL), msg, modKey)) {
        refused.push(u.pathname);
        return reply(401);
      }
      if (init.method === 'GET' && u.pathname === '/internal/v1/work') return reply(200, { work: work() });
      if (init.method === 'POST' && u.pathname === '/internal/v1/reports') {
        const body = JSON.parse(init.body ?? '{}') as { kind: string; attestation: Attestation; sig: string; trade: string; reason: string };
        if (body.kind === 'refused') refusals.push({ trade: body.trade, reason: body.reason });
        else reports.push({ attestation: body.attestation, sig: body.sig });
        return reply(201, { ok: true });
      }
      return reply(404);
    }
    if (u.origin === RELAY && u.pathname === '/v1/admin/trades') {
      const body = JSON.parse(init.body ?? '{}') as { channel: string; signPublics: Record<Role, string>; at: number; sig: string };
      const msg = relayRegisterMessage({ channel: body.channel, signPublics: body.signPublics, at: body.at });
      if (!sodium.crypto_sign_verify_detached(sodium.from_base64(body.sig, sodium.base64_variants.ORIGINAL), msg, modKey)) {
        refused.push('relay');
        return reply(401);
      }
      if (registered.some((r) => r.channel === body.channel)) return reply(409, { error: 'exists' });
      registered.push({ channel: body.channel, signPublics: body.signPublics });
      return reply(201, { ok: true });
    }
    return reply(404);
  };
  return { fetch, reports, registered, refused, refusals };
}

/** The running service: one at a time (instance lock, security review 7 Nov finding 2), so a new start is a restart. */
const live: ModerationHandle[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((h) => h.stop()));
});

async function moderation(fetch: Fetch, runParty: (a: ModPartyArgs) => void = () => {}, log?: (e: { reason: string }) => void): Promise<ModerationHandle> {
  await Promise.all(live.splice(0).map((h) => h.stop()));
  const h = await startModeration(
    {
      apiInternalUrl: API,
      relayAdminUrl: RELAY,
      daemonUri: 'http://127.0.0.1:1',
      db,
      keystoreKey,
      signingSecret: modSign.secret,
      feeWallet: '5'.repeat(95),
      relayUrl: 'ws://relay.test',
      network: 'regtest',
    },
    { fetch, runParty, now: () => NOW, intervalMs: 0, watchIntervalMs: 0, ...(log ? { log } : {}) },
  );
  live.push(h);
  return h;
}

describe('attesting a trade', () => {
  it('signs, registers both channels and posts an attestation both real traders accept', async () => {
    const code = newTradeCode();
    const buyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    const net = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS }]);
    const mod = await moderation(net.fetch);
    expect(await mod.tick()).toEqual([code]);
    expect(net.refused).toEqual([]);

    const report = net.reports.find((r) => r.attestation.trade === code)!;
    expect(report).toBeDefined();
    for (const [role, t] of [['buyer', buyer], ['seller', seller]] as const) {
      await expect(
        verifyAttestation(report.attestation, report.sig, modSign.public, { trade: code, role, signPublic: t.id.signPublic, boxPublic: t.id.boxPublic, deal: DEAL, ownAddress: ownAddress(role) }),
      ).resolves.toBeUndefined();
    }
    const channels = net.registered.map((r) => r.channel);
    expect(channels).toContain(await channelFor(code, 'escrow'));
    expect(channels).toContain(await channelFor(code, 'signals'));
    // Posting again after a restart re-sends the SAME attestation, never a new mod identity.
    const again = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS }]);
    await (await moderation(again.fetch)).tick();
    expect(again.reports[0]).toEqual(report);
    await mod.stop();
  });

  it('attests nothing when a proof does not verify', async () => {
    const code = newTradeCode();
    const buyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    const forged = { ...seller.reg, proof: sodium.to_hex(sodium.randombytes_buf(64)) };
    const net = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: forged }, terms: TERMS }]);
    expect(await (await moderation(net.fetch)).tick()).toEqual([]);
    expect(net.reports).toHaveLength(0);
    expect(net.registered).toHaveLength(0);
    // The refusal is final and reported, so the API drops the trade from work.
    expect(net.refusals).toEqual([{ trade: code, reason: 'bad-proof' }]);
    expect(net.refused).toEqual([]);
    const { rows } = await db.query('select 1 from signed_terms where trade = $1', [code]);
    expect(rows).toHaveLength(0);
  });

  it('signs the terms from the work item, and both traders refuse an attestation whose deal or own address differs', async () => {
    const code = newTradeCode();
    const buyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    const net = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS }]);
    expect(await (await moderation(net.fetch)).tick()).toEqual([code]);
    const report = net.reports.find((r) => r.attestation.trade === code)!;
    expect(report.attestation.terms).toEqual(TERMS);
    const me = { trade: code, role: 'buyer' as const, signPublic: buyer.id.signPublic, boxPublic: buyer.id.boxPublic };
    // The time to pay is signed as the work item gave it; a device shown another one refuses it.
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...me, deal: DEAL, ownAddress: TERMS.buyerPayout, payWindowMin: TERMS.payWindowMin }))
      .resolves.toBeUndefined();
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...me, deal: DEAL, ownAddress: TERMS.buyerPayout, payWindowMin: 1440 }))
      .rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...me, deal: { ...DEAL, centsPerXmr: 1n }, ownAddress: TERMS.buyerPayout }))
      .rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...me, deal: DEAL, ownAddress: TERMS.sellerRefund }))
      .rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('skips work with missing or malformed terms (logged bad-terms, never a final refusal) and signs nothing (review M3)', async () => {
    const { payWindowMin: _p, ...noPayWindow } = TERMS; // a work item from an API before the time to pay joined the terms
    const bad: unknown[] = [
      undefined, null, { ...TERMS, buyerPayout: '' }, { ...TERMS, deal: { ...TERMS.deal, takeAmountAtomic: '01' } }, { ...TERMS, extra: 1 },
      noPayWindow, { ...TERMS, payWindowMin: 0 }, { ...TERMS, payWindowMin: 1441 }, { ...TERMS, payWindowMin: '90' },
    ];
    for (const terms of bad) {
      const code = newTradeCode();
      const buyer = await trader(code, 'buyer');
      const seller = await trader(code, 'seller');
      const reasons: string[] = [];
      const net = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms } as unknown as WorkItem]);
      const mod = await moderation(net.fetch, () => {}, (e) => void reasons.push(e.reason));
      expect(await mod.tick()).toEqual([]);
      expect(net.reports).toHaveLength(0);
      expect(net.refusals).toEqual([]);
      expect(reasons).toContain('bad-terms');
      const { rows } = await db.query('select 1 from signed_terms where trade = $1', [code]);
      expect(rows).toHaveLength(0);
      // Once the API serves the terms (e.g. after a deploy skew), the same trade is attested.
      const fixed = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS }]);
      expect(await (await moderation(fixed.fetch)).tick()).toEqual([code]);
    }
  });

  it('hands runParty the attested terms from its own signed record, never a later work item (review M5)', async () => {
    const code = newTradeCode();
    const buyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    const passed: ModPartyArgs[] = [];
    const net = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS }]);
    await (await moderation(net.fetch, (a) => void passed.push(a))).tick();
    expect(passed.map((p) => p.terms)).toEqual([TERMS]);
    // A restart whose work item now says other terms: the stored signed attestation's terms win.
    const other = { ...TERMS, buyerPayout: '4'.padEnd(95, 'X') };
    const again = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: other }]);
    await (await moderation(again.fetch, (a) => void passed.push(a))).tick();
    expect(passed.map((p) => p.terms)).toEqual([TERMS, TERMS]);
    expect(again.reports[0]!.attestation.terms).toEqual(TERMS);
  });

  it('101 refused trades at the front of the work list do not stall a fresh trade (I1)', async () => {
    // One person with two accounts and the same key in both slots: moderation refuses each one.
    // The fake API serves the OLDEST 100 open items, like the real listener, and drops refused ones.
    type Item = WorkItem & { done: boolean };
    const items: Item[] = [];
    for (let i = 0; i < 101; i++) {
      const code = newTradeCode();
      const t = await trader(code, 'buyer');
      const seller = { ...t.reg, proof: sodium.to_hex(sodium.crypto_sign_detached(identityProofBytes(code, 'seller', t.id.signPublic, t.id.boxPublic), t.id.signSecret)) };
      items.push({ trade: code, participants: { buyer: t.reg, seller }, terms: TERMS, done: false });
    }
    const fresh = newTradeCode();
    const buyer = await trader(fresh, 'buyer');
    const seller = await trader(fresh, 'seller');
    items.push({ trade: fresh, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS, done: false });

    const net = fakeNetwork(() => items.filter((w) => !w.done).slice(0, 100).map(({ trade, participants, terms }) => ({ trade, participants, terms })));
    const markDone = () => {
      for (const r of net.refusals) items.find((w) => w.trade === r.trade)!.done = true;
      for (const r of net.reports) items.find((w) => w.trade === r.attestation.trade)!.done = true;
    };
    const mod = await moderation(net.fetch);
    expect(await mod.tick()).toEqual([]);
    markDone();
    expect(net.refusals).toHaveLength(100);
    expect(new Set(net.refusals.map((r) => r.reason))).toEqual(new Set(['bad-work']));
    expect(await mod.tick()).toEqual([fresh]);
    markDone();
    expect(net.refusals).toHaveLength(101);
    expect(net.reports.map((r) => r.attestation.trade)).toEqual([fresh]);
    await mod.stop();
  });

  it('swapped list: an API-generated buyer identity makes the real buyer abort, and no attestation pairs the real seller with an API-chosen mod', async () => {
    const code = newTradeCode();
    const realBuyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    // The API generates a buyer identity itself (it can sign a valid proof for a key it holds) and
    // stores it in place of the real buyer's.
    const apiBuyer = await trader(code, 'buyer');
    const apiKeys = new Set([apiBuyer.id.signPublic]);
    const net = fakeNetwork(() => [{ trade: code, participants: { buyer: apiBuyer.reg, seller: seller.reg }, terms: TERMS }]);
    await (await moderation(net.fetch)).tick();

    const report = net.reports.find((r) => r.attestation.trade === code)!;
    // The real buyer checks its own slot: setup aborts.
    await expect(
      verifyAttestation(report.attestation, report.sig, modSign.public, {
        trade: code, role: 'buyer', signPublic: realBuyer.id.signPublic, boxPublic: realBuyer.id.boxPublic, deal: DEAL, ownAddress: TERMS.buyerPayout,
      }),
    ).rejects.toMatchObject({ code: 'not-me' });

    // The mod key in every moderation-signed attestation is the one this service minted and sealed,
    // never a key the API chose.
    const sealed = await loadParty<{ me: { signPublic: string } }>(db, keystoreKey, code);
    expect(report.attestation.participants.mod.signPublic).toBe(sealed!.me.signPublic);
    expect(apiKeys.has(report.attestation.participants.mod.signPublic)).toBe(false);

    // The API cannot make its own attestation listing the real buyer, the real seller and a mod it
    // chose: it does not hold the moderation signing key, so the real buyer refuses it.
    const apiMod = await generateIdentity();
    const forged: Attestation = {
      v: 1,
      trade: code,
      channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
      participants: {
        buyer: { signPublic: realBuyer.id.signPublic, boxPublic: realBuyer.id.boxPublic },
        seller: { signPublic: seller.id.signPublic, boxPublic: seller.id.boxPublic },
        mod: { signPublic: apiMod.signPublic, boxPublic: apiMod.boxPublic },
      },
      issuedAt: NOW.toISOString(),
      terms: TERMS,
    };
    const apiKey = sodium.crypto_sign_keypair();
    const forgedSig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(forged), apiKey.privateKey));
    await expect(
      verifyAttestation(forged, forgedSig, modSign.public, {
        trade: code, role: 'buyer', signPublic: realBuyer.id.signPublic, boxPublic: realBuyer.id.boxPublic, deal: DEAL, ownAddress: TERMS.buyerPayout,
      }),
    ).rejects.toMatchObject({ code: 'bad-signature' });

    // And none of the attestations this service ever signed lists the real seller with that mod.
    const { rows } = await db.query<{ attestation: Attestation }>('select attestation from signed_terms');
    expect(rows.some((r) => r.attestation.participants.seller.signPublic === seller.id.signPublic && r.attestation.participants.mod.signPublic === apiMod.signPublic)).toBe(false);
  });
});

describe('R27: the escrow wallet password', () => {
  it('is 32 random bytes per trade, different per trade, and never in mod_party_state', async () => {
    const codes = [newTradeCode(), newTradeCode()];
    const items: WorkItem[] = [];
    for (const code of codes) {
      items.push({ trade: code, participants: { buyer: (await trader(code, 'buyer')).reg, seller: (await trader(code, 'seller')).reg }, terms: TERMS });
    }
    const passed: ModPartyArgs[] = [];
    const net = fakeNetwork(() => items);
    await (await moderation(net.fetch, (a) => void passed.push(a))).tick();

    expect(passed.map((p) => p.trade).sort()).toEqual([...codes].sort());
    const passwords = passed.map((p) => p.password);
    for (const pw of passwords) {
      expect(pw).toMatch(/^[0-9a-f]{64}$/);
      expect(Buffer.from(pw, 'hex')).toHaveLength(32);
    }
    expect(passwords[0]).not.toBe(passwords[1]);

    for (const p of passed) {
      // Stored only in mod_wallet_secrets, sealed under the separate wallet subkey.
      const w = await db.query<{ sealed: Buffer }>('select sealed from mod_wallet_secrets where trade = $1', [p.trade]);
      expect(Buffer.from(open(modSubkey(keystoreKey, 'wallet'), `x2f/mod/wallet/${p.trade}`, w.rows[0]!.sealed)).toString('hex')).toBe(p.password);
      // The wallet subkey is not the party-state key: the party key cannot open it.
      expect(() => open(keystoreKey, `x2f/mod/wallet/${p.trade}`, w.rows[0]!.sealed)).toThrow();
    }
    // No mod_party_state row contains any password, sealed or opened.
    const { rows } = await db.query<{ trade: string; sealed: Buffer }>('select trade, sealed from mod_party_state');
    for (const row of rows) {
      const plain = Buffer.from(open(keystoreKey, `x2f/mod/party/${row.trade}`, row.sealed));
      for (const pw of passwords) {
        const raw = Buffer.from(pw, 'hex');
        expect(plain.includes(pw)).toBe(false);
        expect(plain.includes(raw)).toBe(false);
        expect(plain.includes(raw.toString('base64'))).toBe(false);
        expect(row.sealed.includes(raw)).toBe(false);
      }
    }
  });
});

describe('database separation', () => {
  it("the API's database role cannot SELECT mod_party_state or mod_wallet_secrets", async () => {
    const host = new URL(inject('modPgUrl')).host;
    const api = new pg.Client({ connectionString: `postgres://x2f_api:${inject('apiRolePassword')}@${host}/${dbName}` });
    await api.connect();
    try {
      for (const table of ['mod_party_state', 'mod_wallet_secrets', 'signed_terms']) {
        await expect(api.query(`select * from ${table}`)).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
      }
    } finally {
      await api.end();
    }
  });
});
