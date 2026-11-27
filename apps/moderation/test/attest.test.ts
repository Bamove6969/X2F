import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newTradeCode, type Role } from '@x2f/core';
import { generateIdentity, type Identity } from '@x2f/protocol';
import {
  attestationBytes,
  channelFor,
  identityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  LIEN_BUYER_KEEPS_ATOMIC,
  LIEN_DEFAULT_RATE_BPS,
  LIEN_RECOVERY_MIN_ATOMIC,
  lienStatementValid,
  signRecoveryAddress,
  verifyAttestation,
  type Attestation,
  type LienStatement,
  type AttestedTerms,
  type ConfirmedDeal,
  type ModPartyArgs,
} from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  loadParty,
  modSubkey,
  open,
  relayRegisterMessage,
  startModeration,
  type Fetch,
  type ModerationDeps,
  type ModerationHandle,
  type WorkItem,
} from '../src/main.js';
import { freeLienRecoveries } from '../src/lienRecovery.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const API = 'http://api-internal.test';
const RELAY = 'http://relay-admin.test';
const NOW = new Date('2026-10-24T12:00:00Z');
/** The trade record's terms, as the API's work list hands them over (lead answer 4). */
const TERMS: AttestedTerms = {
  deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
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
  /** Review B1: the moderation service's signed lien statements, posted after an attestation. */
  const lienStatements: Array<{ statement: LienStatement; sig: string }> = [];
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
        const body = JSON.parse(init.body ?? '{}') as { kind: string; attestation: Attestation; sig: string; trade: string; reason: string; statement: LienStatement };
        if (body.kind === 'refused') refusals.push({ trade: body.trade, reason: body.reason });
        else if (body.kind === 'lien-statement') lienStatements.push({ statement: body.statement, sig: body.sig });
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
  return { fetch, reports, registered, refused, refusals, lienStatements };
}

/** The running service: one at a time (instance lock, security review 7 Nov finding 2), so a new start is a restart. */
const live: ModerationHandle[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((h) => h.stop()));
});

async function moderation(
  fetch: Fetch,
  runParty: (a: ModPartyArgs) => void = () => {},
  log?: (e: { reason: string }) => void,
  extra: Pick<ModerationDeps, 'lienRulings' | 'lienRates'> & { lienRecovery?: boolean | 'unset' } = {},
): Promise<ModerationHandle> {
  // Re-review N1: the lien suites run with MOD_LIEN_RECOVERY=on unless they say otherwise; 'unset' leaves the option out (the production default).
  const { lienRecovery = true, ...deps } = extra;
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
      payrollWallet: '6'.repeat(95),
      relayUrl: 'ws://relay.test',
      network: 'regtest',
      ...(lienRecovery === 'unset' ? {} : { lienRecovery }),
    },
    { fetch, runParty, now: () => NOW, intervalMs: 0, watchIntervalMs: 0, ...(log ? { log } : {}), ...deps },
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
        verifyAttestation(report.attestation, report.sig, modSign.public, { trade: code, role, signPublic: t.id.signPublic, boxPublic: t.id.boxPublic, deal: DEAL, ownAddress: ownAddress(role), identityCreatedAt: NOW.getTime() }),
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
    const me = { trade: code, role: 'buyer' as const, signPublic: buyer.id.signPublic, boxPublic: buyer.id.boxPublic, identityCreatedAt: NOW.getTime() };
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
        trade: code, role: 'buyer', signPublic: realBuyer.id.signPublic, boxPublic: realBuyer.id.boxPublic, deal: DEAL, ownAddress: TERMS.buyerPayout, identityCreatedAt: NOW.getTime(),
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
        trade: code, role: 'buyer', signPublic: realBuyer.id.signPublic, boxPublic: realBuyer.id.boxPublic, deal: DEAL, ownAddress: TERMS.buyerPayout, identityCreatedAt: NOW.getTime(),
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

// Review B1 (lien recovery, 2026-11-16): the moderation service no longer signs whatever recovery
// the API hands it. A recovery is signed only when this service's own records back it: the source
// trade it attested, a lien creditor of that trade's rulings as its gate verified them (staff key
// taps), the creditor's own address from that trade's signed terms, at most the lien's rate of the
// buyer's proceeds (100% by default, owner 26 Nov 2026; never leaving the buyer under the network fee), and never more in total than that
// trade's XMR across the trades it signed and has not seen end without paying.
describe('lien recovery at attestation (review B1, owner answers of 17 and 26 Nov)', () => {
  /** A new trade by the debtor, as buyer, on other addresses than the source trade's. */
  const N_TERMS: AttestedTerms = { ...TERMS, buyerPayout: '4'.padEnd(95, 'N'), sellerRefund: '8'.padEnd(95, 'M') };
  // N_TERMS: a seller's ad of 0.25 XMR, so the buyer's proceeds are 0.25 XMR.
  // The exact figure at the 100% default (owner 26 Nov 2026) on a lien of 0.25 XMR: all of the
  // proceeds but what the buyer's output keeps (MAX_NETWORK_FEE + 1 atomic unit).
  const FULL = 250_000_000_000n - LIEN_BUYER_KEEPS_ATOMIC;
  const HALF = 125_000_000_000n; // the exact figure at a 50% rate a senior approved
  const CREDITOR_ADDRESS = '4'.padEnd(95, 'R');
  const DEBTOR = '11111111-1111-4111-8111-111111111111';
  const CREDITOR = '22222222-2222-4222-8222-222222222222';
  const reasonsOf = () => {
    const reasons: string[] = [];
    return { reasons, log: (e: { reason: string }) => void reasons.push(e.reason) };
  };

  /** Attests the source trade (the disputed one) exactly as any trade; the buyer there is the creditor. */
  async function sourceTrade(): Promise<{ code: string; creditor: Identity; seller: Identity }> {
    const code = newTradeCode();
    const buyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    const net = fakeNetwork(() => [{ trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms: TERMS }]);
    expect(await (await moderation(net.fetch)).tick()).toEqual([code]);
    return { code, creditor: buyer.id, seller: seller.id };
  }

  /** Q2: the creditor's device's signed "pay my recoveries to `address`" (its identity in the source trade). */
  async function signedAddress(src: { code: string }, key: Identity, address = CREDITOR_ADDRESS, side: 'buyer' | 'seller' = 'buyer') {
    const statement = { v: 1 as const, fromCode: src.code, creditorSide: side, address, issuedAt: NOW.toISOString() };
    return { statement, sig: await signRecoveryAddress(statement, key.signSecret) };
  }

  /** The work item's lien source as the API names it. */
  async function sourceOf(src: { code: string; creditor: Identity }, over: Record<string, unknown> = {}) {
    return {
      fromCode: src.code, creditor: 'buyer', lienId: LIEN, debtorAccount: DEBTOR, creditorAccount: CREDITOR, buyerAccount: DEBTOR, rateBps: LIEN_DEFAULT_RATE_BPS,
      address: await signedAddress(src, src.creditor), ...over,
    };
  }
  let LIEN = '';

  async function debtorTrade(
    rec: { address: string; amountAtomic: bigint } | null,
    lienSource: unknown,
    rulings: NonNullable<ModerationDeps['lienRulings']> | null,
    extra: Pick<ModerationDeps, 'lienRates'> & { lienRecovery?: boolean | 'unset' } = {},
  ) {
    const code = newTradeCode();
    const buyer = await trader(code, 'buyer');
    const seller = await trader(code, 'seller');
    const terms: AttestedTerms = rec === null ? N_TERMS : { ...N_TERMS, lienRecovery: { address: rec.address, amountAtomic: rec.amountAtomic.toString() } };
    const item = { trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms, ...(lienSource !== undefined ? { lienSource } : {}) } as WorkItem;
    const net = fakeNetwork(() => [item]);
    const r = reasonsOf();
    const done = await (await moderation(net.fetch, () => {}, r.log, { ...(rulings === null ? {} : { lienRulings: rulings }), ...extra })).tick();
    const signed = (await db.query('select 1 from signed_terms where trade = $1', [code])).rows.length === 1;
    return { code, done, signed, reasons: r.reasons, net, item };
  }

  const creditorBuyer: NonNullable<ModerationDeps['lienRulings']> = { creditors: async () => ['buyer'] };
  const rec = (amountAtomic: bigint, address = CREDITOR_ADDRESS) => ({ address, amountAtomic });

  beforeEach(() => {
    LIEN = randomUUID();
  });

  it('signs exactly the expected recovery to the creditor\'s signed address, records it against the lien, and signs and posts a lien statement', async () => {
    const src = await sourceTrade();
    const n = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer);
    expect(n.done).toEqual([n.code]);
    const report = n.net.reports.find((x) => x.attestation.trade === n.code)!;
    expect(report.attestation.terms?.lienRecovery).toEqual({ address: CREDITOR_ADDRESS, amountAtomic: FULL.toString() });
    const { rows } = await db.query('select lien_id, source_code, creditor, amount_atomic::text as amount, freed_at from mod_lien_recoveries where trade = $1', [n.code]);
    expect(rows).toEqual([{ lien_id: LIEN, source_code: src.code, creditor: 'buyer', amount: FULL.toString(), freed_at: null }]);
    expect(n.net.lienStatements).toHaveLength(1);
    const ls = n.net.lienStatements[0]!;
    expect(lienStatementValid(ls.statement, ls.sig, modSign.public)).toBe(true);
    expect(ls.statement).toMatchObject({ lienId: LIEN, fromCode: src.code, creditorSide: 'buyer', debtor: DEBTOR, creditor: CREDITOR, amountAtomic: '250000000000', rateBps: LIEN_DEFAULT_RATE_BPS });
  });

  it('re-review N1: with MOD_LIEN_RECOVERY off (the default, or off) every recovery is refused and no lien statement is signed; on, the same item is signed', async () => {
    const src = await sourceTrade();
    for (const lienRecovery of ['unset', false] as const) {
      const n = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer, { lienRecovery });
      expect(n.done, String(lienRecovery)).toEqual([]);
      expect(n.signed).toBe(false);
      expect(n.reasons).toContain('lien-refused-off');
      expect(n.net.reports.filter((x) => x.attestation.trade === n.code)).toEqual([]);
      expect(n.net.lienStatements).toEqual([]);
      expect((await db.query('select 1 from mod_lien_recoveries where lien_id = $1', [LIEN])).rows).toEqual([]);
      expect((await db.query('select 1 from mod_liens where lien_id = $1', [LIEN])).rows).toEqual([]);
    }
    // A trade with no recovery is attested as ever while it is off.
    const plain = await debtorTrade(null, undefined, creditorBuyer, { lienRecovery: false });
    expect(plain.done).toEqual([plain.code]);
    // On: the same lien and source are signed.
    const on = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer, { lienRecovery: true });
    expect(on.done).toEqual([on.code]);
    expect(on.net.lienStatements).toHaveLength(1);
  });

  it('re-review N1: MOD_LIEN_RECOVERY is on only when it says on; unset, empty or off is off, anything else refuses the start', async () => {
    const { lienRecoveryFromEnv } = await import('../src/main.js');
    expect(lienRecoveryFromEnv({})).toBe(false);
    expect(lienRecoveryFromEnv({ MOD_LIEN_RECOVERY: '' })).toBe(false);
    expect(lienRecoveryFromEnv({ MOD_LIEN_RECOVERY: 'off' })).toBe(false);
    expect(lienRecoveryFromEnv({ MOD_LIEN_RECOVERY: 'on' })).toBe(true);
    for (const v of ['1', 'true', 'ON', 'yes', ' on']) expect(() => lienRecoveryFromEnv({ MOD_LIEN_RECOVERY: v }), v).toThrow('MOD_LIEN_RECOVERY');
    // The process entry passes it to startModeration.
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main.slice(main.indexOf('// `tsx apps/moderation/src/main.ts`'))).toContain('lienRecovery: lienRecoveryFromEnv(env)');
  });

  it('compromised API (review B1): an injected or inflated recovery, or one to any address the creditor did not sign, is refused and nothing is signed', async () => {
    const src = await sourceTrade();
    const ok = await sourceOf(src);
    const cases: Array<[string, Awaited<ReturnType<typeof debtorTrade>>]> = [
      // Injected: no source, no gate, a source for no lien.
      ['lien-refused-no-authority', await debtorTrade(rec(FULL), ok, null)],
      ['lien-refused-no-source', await debtorTrade(rec(FULL), undefined, creditorBuyer)],
      ['lien-refused-bad-source', await debtorTrade(null, ok, creditorBuyer)],
      ['lien-refused-bad-source', await debtorTrade(rec(FULL), { fromCode: src.code, creditor: 'buyer' }, creditorBuyer)],
      ['lien-refused-source-unknown', await debtorTrade(rec(FULL), await sourceOf({ code: newTradeCode(), creditor: src.creditor }), creditorBuyer)],
      // Inflated: one atomic unit under the exact figure; one over it, which at the 100% default is
      // also over the cap (lienRecoveryCap); all of the proceeds; under 0.01 XMR.
      ['lien-refused-not-expected', await debtorTrade(rec(FULL - 1n), ok, creditorBuyer)],
      ['lien-refused-over-rate', await debtorTrade(rec(FULL + 1n), ok, creditorBuyer)],
      ['lien-refused-over-rate', await debtorTrade(rec(250_000_000_000n), ok, creditorBuyer)],
      ['lien-refused-over-rate', await debtorTrade(rec(9_999_999_999n), ok, creditorBuyer)],
      // Redirected: the API's own address; the address signed by the API instead of the creditor; the
      // creditor's statement for another trade or side; this trade's own payout (B2).
      ['lien-refused-wrong-address', await debtorTrade(rec(FULL, '4'.padEnd(95, 'Z')), ok, creditorBuyer)],
      ['lien-refused-wrong-address', await debtorTrade(rec(FULL, '4'.padEnd(95, 'Z')), await sourceOf(src, { address: await signedAddress(src, await generateIdentity(), '4'.padEnd(95, 'Z')) }), creditorBuyer)],
      ['lien-refused-wrong-address', await debtorTrade(rec(FULL), await sourceOf(src, { address: await signedAddress(src, src.seller, CREDITOR_ADDRESS, 'seller') }), creditorBuyer)],
      ['lien-refused-wrong-address', await debtorTrade(rec(FULL, N_TERMS.buyerPayout), await sourceOf(src, { address: await signedAddress(src, src.creditor, N_TERMS.buyerPayout) }), creditorBuyer)],
      ['lien-refused-wrong-address', await debtorTrade(rec(FULL, '5'.repeat(95)), await sourceOf(src, { address: await signedAddress(src, src.creditor, '5'.repeat(95)) }), creditorBuyer)],
      // The rulings make the buyer the creditor; the API names the seller. No verified ruling at all.
      ['lien-refused-not-creditor', await debtorTrade(rec(FULL), ok, { creditors: async () => [] })],
      ['lien-refused-no-authority', await debtorTrade(rec(FULL), ok, { creditors: async () => null })],
      // A lien whose debtor is not this trade's buyer.
      ['lien-refused-not-debtor', await debtorTrade(rec(FULL), await sourceOf(src, { buyerAccount: '33333333-3333-4333-8333-333333333333' }), creditorBuyer)],
      // Another rate with no senior's key tap the gate verified (Q1), or above 100%.
      ['lien-refused-rate-unverified', await debtorTrade(rec(HALF), await sourceOf(src, { rateBps: 5000 }), creditorBuyer)],
      ['lien-refused-rate-unverified', await debtorTrade(rec(HALF), await sourceOf(src, { rateBps: 5000 }), creditorBuyer, { lienRates: { approvals: async () => [{ rateBps: 7000, nonce: 'aa'.repeat(32) }] } })],
      ['lien-refused-over-rate', await debtorTrade(rec(FULL), await sourceOf(src, { rateBps: 10_001 }), creditorBuyer, { lienRates: { approvals: async () => [{ rateBps: 10_001, nonce: 'ab'.repeat(32) }] } })],
    ];
    for (const [reason, c] of cases) {
      expect(c.done, reason).toEqual([]);
      expect(c.signed, reason).toBe(false);
      expect(c.reasons, reason).toContain(reason);
      expect(c.net.refusals, reason).toEqual([]);
      expect(c.net.reports, reason).toEqual([]);
    }
  });

  it('Q1: a rate other than the 100% default is signed once the gate verified a senior\'s tap for it, and the statement carries it', async () => {
    const src = await sourceTrade();
    const asked: string[] = [];
    const rates = { approvals: async (lienId: string) => (asked.push(lienId), [{ rateBps: 5000, nonce: 'a1'.repeat(32) }]) };
    const n = await debtorTrade(rec(HALF), await sourceOf(src, { rateBps: 5000 }), creditorBuyer, { lienRates: rates });
    expect(n.done).toEqual([n.code]);
    expect(asked).toEqual([LIEN]);
    expect(n.net.lienStatements[0]!.statement.rateBps).toBe(5000);
    const { rows } = await db.query('select nonce, lien_id, rate_bps, from_rate_bps, trade from mod_lien_rate_taps where lien_id = $1', [LIEN]);
    expect(rows).toEqual([{ nonce: 'a1'.repeat(32), lien_id: LIEN, rate_bps: 5000, from_rate_bps: LIEN_DEFAULT_RATE_BPS, trade: n.code }]);
  });

  it('Q1, compromised API: an applied tap is spent (no replay of an old approval, no return to the default without a new tap); the replaced rate is good only for the grace period', async () => {
    const src = await sourceTrade(); // 0.25 XMR owed; each trade's proceeds 0.25 XMR
    const SIXTY = 150_000_000_000n; // 60% of 0.25 XMR
    const QUARTER = 62_500_000_000n; // 25%
    const t60 = { rateBps: 6000, nonce: 'b1'.repeat(32) };
    const t25 = { rateBps: 2500, nonce: 'b2'.repeat(32) };
    const taps: Array<{ rateBps: number; nonce: string }> = [t60];
    const lienRates = { approvals: async () => [...taps] };
    // The senior approves 60%: applied, and the tap spent.
    const a = await debtorTrade(rec(SIXTY), await sourceOf(src, { rateBps: 6000 }), creditorBuyer, { lienRates });
    expect(a.signed).toBe(true);
    await freeLienRecoveries(db, a.code);
    // A senior then lowers it to 25% and it is applied.
    taps.push(t25);
    const b = await debtorTrade(rec(QUARTER), await sourceOf(src, { rateBps: 2500 }), creditorBuyer, { lienRates });
    expect(b.signed).toBe(true);
    expect(b.net.lienStatements[0]!.statement.rateBps).toBe(2500);
    await freeLienRecoveries(db, b.code);
    // A day later the API replays the old 60% approval: refused (its tap is spent).
    await db.query(`update mod_lien_rate_taps set applied_at = now() - interval '25 hours' where lien_id = $1`, [LIEN]);
    const replay = await debtorTrade(rec(SIXTY), await sourceOf(src, { rateBps: 6000 }), creditorBuyer, { lienRates });
    expect(replay.signed).toBe(false);
    expect(replay.reasons).toContain('lien-refused-rate-unverified');
    // Nor may it go back to the 100% default without a new tap.
    const back = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer, { lienRates });
    expect(back.signed).toBe(false);
    expect(back.reasons).toContain('lien-refused-rate-unverified');
    // Within the grace period the rate 25% replaced (60%) is still good for a trade reserved before
    // the change, and the lien keeps 25%.
    await db.query('update mod_lien_rate_taps set applied_at = now() where lien_id = $1 and rate_bps = 2500', [LIEN]);
    const late = await debtorTrade(rec(SIXTY), await sourceOf(src, { rateBps: 6000 }), creditorBuyer, { lienRates });
    expect(late.signed).toBe(true);
    expect(late.net.lienStatements).toEqual([]);
    expect((await db.query('select rate_bps from mod_liens where lien_id = $1', [LIEN])).rows).toEqual([{ rate_bps: 2500 }]);
  });

  it('pins the lien\'s parties on first sight: a later item naming another debtor or creditor for the same lien is refused', async () => {
    const src = await sourceTrade();
    const first = await debtorTrade(rec(FULL), await sourceOf(src, { lienId: LIEN }), creditorBuyer);
    expect(first.signed).toBe(true);
    const other = '44444444-4444-4444-8444-444444444444';
    const c = await debtorTrade(rec(FULL), await sourceOf(src, { lienId: LIEN, debtorAccount: other, buyerAccount: other }), creditorBuyer);
    expect(c.signed).toBe(false);
    expect(c.reasons).toContain('lien-refused-lien-changed');
  });

  it('partial: never more in total than the lien (the source trade\'s XMR); the last trade gets exactly what is left; freed recoveries count no more', async () => {
    const src = await sourceTrade(); // 0.25 XMR owed: a full recovery and the 0.010000000001 XMR left use it up
    const ok = await sourceOf(src);
    const a = await debtorTrade(rec(FULL), ok, creditorBuyer);
    const b = await debtorTrade(rec(250_000_000_000n - FULL), ok, creditorBuyer);
    expect([a.signed, b.signed]).toEqual([true, true]);
    const c = await debtorTrade(rec(LIEN_RECOVERY_MIN_ATOMIC), ok, creditorBuyer);
    expect(c.signed).toBe(false);
    expect(c.reasons).toContain('lien-refused-over-owed');
    // Trade a ends without paying it (the watcher saw it refunded): its share is free again.
    await freeLienRecoveries(db, a.code);
    const d = await debtorTrade(rec(FULL), ok, creditorBuyer);
    expect(d.signed).toBe(true);
  });

  it('a restart re-posts a trade it already signed without counting its recovery twice', async () => {
    const src = await sourceTrade();
    const a = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer);
    expect(a.signed).toBe(true);
    const again = fakeNetwork(() => [a.item]);
    await (await moderation(again.fetch, () => {}, undefined, { lienRulings: creditorBuyer })).tick();
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from mod_lien_recoveries where trade = $1', [a.code]);
    expect(rows[0]!.n).toBe(1);
  });

  // Owner 27 Nov 2026 (docs/lien-recovery.md "Debtor is the seller"): a selling debtor's extra, in its
  // own `sellerLienRecovery` with its own `sellerLienSource` (this trade's seller), checked by the same
  // rules; the figure is expectedSellerRecovery of the amount at take.
  describe('a seller who owes the lien (owner 27 Nov 2026)', () => {
    const TAKE = 250_000_000_000n; // N_TERMS: 0.25 XMR at take; the lien (the source trade's XMR) is 0.25 XMR too
    async function sellerSourceOf(src: { code: string; creditor: Identity }, over: Record<string, unknown> = {}) {
      const { buyerAccount: _b, ...rest } = await sourceOf(src);
      return { ...rest, sellerAccount: DEBTOR, ...over };
    }
    async function sellerTrade(
      srec: { address: string; amountAtomic: bigint } | null,
      sellerLienSource: unknown,
      over: { lienRecovery?: { address: string; amountAtomic: bigint }; lienSource?: unknown; lienRecoveryOn?: boolean } = {},
    ) {
      const code = newTradeCode();
      const buyer = await trader(code, 'buyer');
      const seller = await trader(code, 'seller');
      const terms: AttestedTerms = {
        ...N_TERMS,
        ...(over.lienRecovery !== undefined ? { lienRecovery: { address: over.lienRecovery.address, amountAtomic: over.lienRecovery.amountAtomic.toString() } } : {}),
        ...(srec !== null ? { sellerLienRecovery: { address: srec.address, amountAtomic: srec.amountAtomic.toString() } } : {}),
      };
      const item = {
        trade: code, participants: { buyer: buyer.reg, seller: seller.reg }, terms,
        ...(over.lienSource !== undefined ? { lienSource: over.lienSource } : {}),
        ...(sellerLienSource !== undefined ? { sellerLienSource } : {}),
      } as WorkItem;
      const net = fakeNetwork(() => [item]);
      const r = reasonsOf();
      const done = await (await moderation(net.fetch, () => {}, r.log, { lienRulings: creditorBuyer, ...(over.lienRecoveryOn === false ? { lienRecovery: false } : {}) })).tick();
      const signed = (await db.query('select 1 from signed_terms where trade = $1', [code])).rows.length === 1;
      return { code, done, signed, reasons: r.reasons, net, item, seller };
    }

    it('signs exactly the expected extra to the creditor\'s signed address and records it as the seller\'s', async () => {
      const src = await sourceTrade();
      const n = await sellerTrade(rec(TAKE), await sellerSourceOf(src));
      expect(n.done).toEqual([n.code]);
      const report = n.net.reports.find((x) => x.attestation.trade === n.code)!;
      expect(report.attestation.terms?.sellerLienRecovery).toEqual({ address: CREDITOR_ADDRESS, amountAtomic: TAKE.toString() });
      expect(report.attestation.terms).not.toHaveProperty('lienRecovery');
      const { rows } = await db.query('select debtor_side, lien_id, creditor, amount_atomic::text as amount from mod_lien_recoveries where trade = $1', [n.code]);
      expect(rows).toEqual([{ debtor_side: 'seller', lien_id: LIEN, creditor: 'buyer', amount: TAKE.toString() }]);
      expect(n.net.lienStatements[0]!.statement).toMatchObject({ lienId: LIEN, debtor: DEBTOR, rateBps: LIEN_DEFAULT_RATE_BPS });
      // The seller's device accepts exactly the extra it confirmed, and none other.
      const seller = n.item.participants.seller;
      const base = { trade: n.code, role: 'seller' as const, signPublic: seller.signPublic, boxPublic: seller.boxPublic, ownAddress: N_TERMS.sellerRefund, identityCreatedAt: NOW.getTime() };
      await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...base, deal: { ...DEAL, sellerLienRecoveryAtomic: TAKE } })).resolves.toBeUndefined();
      await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...base, deal: DEAL })).rejects.toMatchObject({ code: 'wrong-terms' });
    });

    it('compromised API: a seller extra that is injected, inflated, mis-sourced or redirected is refused and nothing is signed', async () => {
      const src = await sourceTrade();
      const ok = await sellerSourceOf(src);
      const cases: Array<[string, Awaited<ReturnType<typeof sellerTrade>>]> = [
        ['lien-refused-off', await sellerTrade(rec(TAKE), ok, { lienRecoveryOn: false })],
        ['lien-refused-no-source', await sellerTrade(rec(TAKE), undefined)],
        ['lien-refused-bad-source', await sellerTrade(null, ok)],
        // The buyer's source shape (buyerAccount) is not a seller source.
        ['lien-refused-bad-source', await sellerTrade(rec(TAKE), await sourceOf(src))],
        ['lien-refused-not-debtor', await sellerTrade(rec(TAKE), await sellerSourceOf(src, { sellerAccount: '33333333-3333-4333-8333-333333333333' }))],
        ['lien-refused-not-expected', await sellerTrade(rec(TAKE - 1n), ok)],
        ['lien-refused-over-rate', await sellerTrade(rec(TAKE + 1n), ok)],
        ['lien-refused-over-rate', await sellerTrade(rec(LIEN_RECOVERY_MIN_ATOMIC - 1n), ok)],
        ['lien-refused-wrong-address', await sellerTrade(rec(TAKE, '4'.padEnd(95, 'Z')), ok)],
        ['lien-refused-wrong-address', await sellerTrade(rec(TAKE, N_TERMS.sellerRefund), await sellerSourceOf(src, { address: await signedAddress(src, src.creditor, N_TERMS.sellerRefund) }))],
      ];
      for (const [reason, c] of cases) {
        expect(c.done, reason).toEqual([]);
        expect(c.signed, reason).toBe(false);
        expect(c.reasons, reason).toContain(reason);
        expect(c.net.reports, reason).toEqual([]);
      }
    });

    it('one remainder for buys and sales: after a buyer recovery the next sale\'s extra is exactly what is left; more is over-owed', async () => {
      const src = await sourceTrade();
      const a = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer);
      expect(a.signed).toBe(true);
      const over = await sellerTrade(rec(TAKE), await sellerSourceOf(src));
      expect(over.signed).toBe(false);
      expect(over.reasons).toContain('lien-refused-over-owed');
      const left = TAKE - FULL; // 0.010000000001 XMR: at least the 0.01 XMR floor
      const b = await sellerTrade(rec(left), await sellerSourceOf(src));
      expect(b.signed).toBe(true);
    });

    it('both parties owe: one trade carries both recoveries, each checked against its own lien and recorded by side', async () => {
      const srcB = await sourceTrade();
      const srcS = await sourceTrade();
      const buyerLien = LIEN;
      const sellerLien = randomUUID();
      const BUYER_DEBTOR = '55555555-5555-4555-8555-555555555555';
      const n = await sellerTrade(
        rec(TAKE, '4'.padEnd(95, 'Q')),
        await sellerSourceOf(srcS, { lienId: sellerLien, address: await signedAddress(srcS, srcS.creditor, '4'.padEnd(95, 'Q')) }),
        { lienRecovery: rec(FULL), lienSource: await sourceOf(srcB, { lienId: buyerLien, debtorAccount: BUYER_DEBTOR, buyerAccount: BUYER_DEBTOR }) },
      );
      expect(n.done).toEqual([n.code]);
      const terms = n.net.reports.find((x) => x.attestation.trade === n.code)!.attestation.terms!;
      expect(terms.lienRecovery).toEqual({ address: CREDITOR_ADDRESS, amountAtomic: FULL.toString() });
      expect(terms.sellerLienRecovery).toEqual({ address: '4'.padEnd(95, 'Q'), amountAtomic: TAKE.toString() });
      const { rows } = await db.query('select debtor_side, lien_id from mod_lien_recoveries where trade = $1 order by debtor_side', [n.code]);
      expect(rows).toEqual([{ debtor_side: 'buyer', lien_id: buyerLien }, { debtor_side: 'seller', lien_id: sellerLien }]);
      // Never both to one address.
      const same = await sellerTrade(
        rec(TAKE),
        await sellerSourceOf(srcS, { lienId: randomUUID() }),
        { lienRecovery: rec(FULL), lienSource: await sourceOf(srcB, { lienId: randomUUID(), debtorAccount: BUYER_DEBTOR, buyerAccount: BUYER_DEBTOR }) },
      );
      expect(same.signed).toBe(false);
      expect(same.reasons).toContain('lien-refused-wrong-address');
    });
  });

  it('the co-signing devices refuse what an API could get past nothing else: the buyer accepts only its own figure (review B1)', async () => {
    const src = await sourceTrade();
    const n = await debtorTrade(rec(FULL), await sourceOf(src), creditorBuyer);
    const report = n.net.reports.find((x) => x.attestation.trade === n.code)!;
    const buyer = n.item.participants.buyer;
    const base = { trade: n.code, role: 'buyer' as const, signPublic: buyer.signPublic, boxPublic: buyer.boxPublic, ownAddress: N_TERMS.buyerPayout, identityCreatedAt: NOW.getTime() };
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...base, deal: { ...DEAL, lienRecoveryAtomic: FULL } })).resolves.toBeUndefined();
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...base, deal: DEAL })).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(report.attestation, report.sig, modSign.public, { ...base, deal: { ...DEAL, lienRecoveryAtomic: FULL - 1n } })).rejects.toMatchObject({ code: 'wrong-terms' });
  });
});
