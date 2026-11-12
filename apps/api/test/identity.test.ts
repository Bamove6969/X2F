import { createHash } from 'node:crypto';
import type { Identity } from '@x2f/protocol';
import {
  attestationBytes,
  channelFor,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  verifyAttestation,
  type Attestation,
  type AttestedTerms,
  type ConfirmedDeal,
} from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { RATE, seedTrade, type SeededTrade } from './helpers/trades.js';

const IDENTITY_DOMAIN = 'x2f/trade-identity/v1\0';

let app: FastifyInstance;
let deps: Deps;
let internal: FastifyInstance;
let modSign: { public: string; secret: Uint8Array };
let now = new Date('2026-10-23T12:00:00Z');
let n = 0;
let reqSeq = 0;

const name = (p: string) => `${p}${String(++n).padStart(4, '0')}`;

/** A trader account with a logged-in browser. */
async function trader(): Promise<{ id: string; b: Browser }> {
  const id = await seedAccount(deps, { loginName: name('idn') });
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id });
  expect(res.statusCode).toBe(200);
  return { id, b };
}

/** The terms the trade record says the attestation must sign (lead answer 4), by trade code. */
const termsByCode = new Map<string, AttestedTerms>();

function termsOf(t: SeededTrade): AttestedTerms {
  return {
    deal: {
      poster: t.trade.poster,
      takeAmountAtomic: t.trade.amountAtomic.toString(),
      currency: RATE.currency,
      centsPerXmr: RATE.centsPerXmr.toString(),
      maxFiatCents: t.trade.maxFiatCents.toString(),
      // Task 34 review I1, restored for flex offers: the method chosen at take and the SHA-256 of
      // its instructions for the trade's currency, as locked in trades.method_instructions.
      methodId: t.trade.methodId,
      instructionsSha256: createHash('sha256').update(t.sides.methodInstructions ?? '', 'utf8').digest('hex'),
    },
    payWindowMin: t.trade.payWindowMin,
    buyerPayout: t.sides.buyerPayout!,
    sellerRefund: t.sides.sellerRefund!,
  };
}

/** Closes a trade the way a setupBy cancel does (state and closed_at), straight in the table. */
async function closeTrade(code: string): Promise<void> {
  await deps.db.query(`update trades set state = 'cancelled', closed_at = now() where code = $1`, [code]);
}

/** The same deal as a trader device holds it (bigints). */
function dealOf(t: AttestedTerms): ConfirmedDeal {
  return {
    poster: t.deal.poster,
    takeAmountAtomic: BigInt(t.deal.takeAmountAtomic),
    currency: t.deal.currency,
    centsPerXmr: BigInt(t.deal.centsPerXmr),
    maxFiatCents: BigInt(t.deal.maxFiatCents),
  };
}

/** A fresh trade with a buyer and seller account, each with a browser; returns the stored code. */
async function freshTrade(
  sides: Partial<SeededTrade['sides']> = {},
  extra: { payWindowMin?: number } = {},
): Promise<{ code: string; buyer: { id: string; b: Browser }; seller: { id: string; b: Browser } }> {
  const buyer = await trader();
  const seller = await trader();
  const seeded = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', ...sides, ...extra });
  if (seeded.sides.buyerPayout !== null && seeded.sides.sellerRefund !== null) termsByCode.set(seeded.code, termsOf(seeded));
  return { code: seeded.code, buyer, seller };
}

/** Build the registration body for a role: a fresh identity and its Ed25519 proof of possession. */
function identityFor(
  code: string,
  role: 'buyer' | 'seller',
  kp: { publicKey: Uint8Array; privateKey: Uint8Array } = sodium.crypto_sign_keypair(),
): { id: Identity; body: { signPublic: string; boxPublic: string; proof: string } } {
  const signPublic = sodium.to_hex(kp.publicKey);
  const boxPublic = sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey));
  const msg = new TextEncoder().encode(`${IDENTITY_DOMAIN}${code}\0${role}\0${signPublic}${boxPublic}`);
  const proof = sodium.to_hex(sodium.crypto_sign_detached(msg, kp.privateKey));
  const id: Identity = {
    signPublic,
    boxPublic,
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
  return { id, body: { signPublic, boxPublic, proof } };
}

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** A moderation-signed request to the internal listener. `sign=false` omits the signature. */
async function signedInject(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  o: { sign?: boolean; signer?: Uint8Array; at?: number } = {},
): Promise<LightMyRequestResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  // Each request gets its own `at` (the clock is fixed here), so two identical signed GETs are not replays.
  const at = o.at ?? now.getTime() + ++reqSeq;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (o.sign !== false) {
    const bytes = internalSignedBytes({ method, path, at, bodyHash: sha256Hex(payload ?? '') });
    const sig = sodium.crypto_sign_detached(bytes, o.signer ?? modSign.secret);
    headers[INTERNAL_AT_HEADER] = String(at);
    headers[INTERNAL_SIG_HEADER] = sodium.to_base64(sig, sodium.base64_variants.ORIGINAL);
  }
  return internal.inject({ method, url: path, headers, ...(payload === undefined ? {} : { payload }) });
}

/**
 * Public keys for a stand-in moderator identity. The separation check forbids apps/api from naming
 * the protocol's identity generator (tests included), so this test makes a key pair with libsodium.
 */
function stubModKeys(): { signPublic: string; boxPublic: string } {
  const kp = sodium.crypto_sign_keypair();
  return { signPublic: sodium.to_hex(kp.publicKey), boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)) };
}

/** The moderation service's job, done here with the shared trade package only (no moderation code in the API). */
async function attestAndPost(code: string, buyer: Identity, seller: Identity, terms: AttestedTerms = termsByCode.get(code)!): Promise<Attestation> {
  const mod = stubModKeys();
  const attestation: Attestation = {
    v: 1,
    trade: code,
    channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
    participants: {
      buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic },
      seller: { signPublic: seller.signPublic, boxPublic: seller.boxPublic },
      mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
    },
    issuedAt: now.toISOString(),
    terms,
  };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
  const res = await signedInject('POST', '/internal/v1/reports', { kind: 'attestation', attestation, sig });
  expect(res.statusCode).toBe(201);
  return attestation;
}

beforeAll(async () => {
  await sodium.ready;
  ({ app, deps } = await testApp());
  addTestLogin(app, deps);
  const kp = sodium.crypto_sign_keypair();
  modSign = { public: sodium.to_hex(kp.publicKey), secret: kp.privateKey };
  internal = await buildInternalListener({ db: deps.db, modSigningPublic: modSign.public, now: () => now.getTime() });
});

afterAll(async () => {
  await internal.close();
  await app.close();
});

describe('POST /v1/trades/:code/identity', () => {
  it('rejects a body carrying a secret key (additionalProperties: false)', async () => {
    const { code, buyer } = await freshTrade();
    const { body } = identityFor(code, 'buyer');
    const res = await buyer.b.post(`/v1/trades/${code}/identity`, { ...body, signSecret: 'ff'.repeat(32) });
    expect(res.statusCode).toBe(400);
    const { rows } = await deps.db.query('select 1 from trade_identities where code = $1', [code]);
    expect(rows).toHaveLength(0);
  });

  it('rejects a bad proof with bad-proof', async () => {
    const { code, buyer } = await freshTrade();
    const { body } = identityFor(code, 'buyer');
    const res = await buyer.b.post(`/v1/trades/${code}/identity`, { ...body, proof: sodium.to_hex(sodium.randombytes_buf(64)) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-proof' });
  });

  it('registers the role from the session and refuses a second registration (identity-exists)', async () => {
    const { code, buyer } = await freshTrade();
    const first = await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ role: 'buyer' });
    const again = await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'identity-exists' });
  });

  it('refuses the key the other slot already holds with identity-conflict (no same-key trade becomes work)', async () => {
    const { code, buyer, seller } = await freshTrade();
    // One person holding both accounts signs a valid proof for each role with the same key.
    const kp = sodium.crypto_sign_keypair();
    const first = await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer', kp).body);
    expect(first.statusCode).toBe(201);
    const same = await seller.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'seller', kp).body);
    expect(same.statusCode).toBe(409);
    expect(same.json()).toMatchObject({ error: 'identity-conflict' });
    const { rows } = await deps.db.query<{ role: string }>('select role from trade_identities where code = $1', [code]);
    expect(rows.map((r) => r.role)).toEqual(['buyer']);
    // A different key still registers the seller.
    expect((await seller.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'seller').body)).statusCode).toBe(201);
  });

  it('a buyer cannot register the seller slot: its session is always the buyer', async () => {
    const { code, buyer } = await freshTrade();
    // Even a proof built for role 'seller' registers nothing in the seller slot: the role is the
    // session's, and the seller proof fails the buyer-role proof check.
    const sellerShaped = identityFor(code, 'seller');
    const res = await buyer.b.post(`/v1/trades/${code}/identity`, sellerShaped.body);
    expect(res.statusCode).toBe(400); // proof is over role 'seller', so it is bad for this buyer
    const { rows } = await deps.db.query<{ role: string }>('select role from trade_identities where code = $1', [code]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a non-participant and a non-existent trade with 404', async () => {
    const { code } = await freshTrade();
    const stranger = await trader();
    const res = await stranger.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
    expect(res.statusCode).toBe(404);
    const missing = await stranger.b.get('/v1/trades/ZZZZ-ZZZZ-ZZZZ-ZZZZ/attestation');
    expect(missing.statusCode).toBe(404);
  });
});

describe('GET /v1/trades/:code/attestation and the internal listener', () => {
  it('is 202 until both traders register and the moderation service posts it', async () => {
    const { code, buyer, seller } = await freshTrade();
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');

    // Nothing registered: no work, attestation pending.
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(202);

    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    // Only the buyer registered: the trade is not ready, so work does not list it.
    const workBuyerOnly = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
    expect(workBuyerOnly.work.some((w) => w.trade === code)).toBe(false);
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(202);

    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);
    const work = (await signedInject('GET', '/internal/v1/work')).json() as {
      work: Array<{ trade: string; participants: { buyer: { signPublic: string }; seller: { signPublic: string } } }>;
    };
    const item = work.work.find((w) => w.trade === code);
    expect(item).toBeDefined();
    expect(item!.participants.buyer.signPublic).toBe(buyerId.id.signPublic);
    // The work item hands moderation the trade record's terms to sign (lead answer 4).
    expect((item as unknown as { terms: AttestedTerms }).terms).toEqual(termsByCode.get(code));

    const attestation = await attestAndPost(code, buyerId.id, sellerId.id);

    const got = await buyer.b.get(`/v1/trades/${code}/attestation`);
    expect(got.statusCode).toBe(200);
    const payload = got.json() as { attestation: Attestation; sig: string };
    expect(payload.attestation).toEqual(attestation);
    // The real buyer's verification passes against the pinned moderation signing key.
    await expect(
      verifyAttestation(payload.attestation, payload.sig, modSign.public, {
        trade: code, role: 'buyer', signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic,
        deal: dealOf(termsByCode.get(code)!), ownAddress: termsByCode.get(code)!.buyerPayout,
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses an unsigned or wrongly signed report to /internal/v1/reports with 401', async () => {
    const { code, buyer, seller } = await freshTrade();
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');
    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);

    const mod = stubModKeys();
    const attestation: Attestation = {
      v: 1,
      trade: code,
      channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
      participants: {
        buyer: { signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic },
        seller: { signPublic: sellerId.id.signPublic, boxPublic: sellerId.id.boxPublic },
        mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
      },
      issuedAt: now.toISOString(),
      terms: termsByCode.get(code)!,
    };
    const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
    const report = { kind: 'attestation', attestation, sig };

    const unsigned = await signedInject('POST', '/internal/v1/reports', report, { sign: false });
    expect(unsigned.statusCode).toBe(401);

    const other = sodium.crypto_sign_keypair();
    const wrong = await signedInject('POST', '/internal/v1/reports', report, { signer: other.privateKey });
    expect(wrong.statusCode).toBe(401);

    // Still nothing stored.
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(202);
  });

  it('a refused report is terminal: the trade leaves work for good and its traders stop waiting', async () => {
    const { code, buyer, seller } = await freshTrade();
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');

    // Not work yet (only one identity): nothing to refuse.
    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    const early = await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: code, reason: 'bad-proof' });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'not-refusable' });
    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);

    // Exact body only, and a fixed reason set.
    for (const bad of [
      { kind: 'refused', trade: code, reason: 'because' },
      { kind: 'refused', trade: code, reason: 'bad-proof', extra: 1 },
      { kind: 'refused', trade: 'not a code', reason: 'bad-proof' },
    ]) {
      expect((await signedInject('POST', '/internal/v1/reports', bad)).statusCode).toBe(400);
    }
    // Unsigned refusals are refused like any internal request.
    const unsigned = await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: code, reason: 'bad-proof' }, { sign: false });
    expect(unsigned.statusCode).toBe(401);
    const listed = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
    expect(listed.work.some((w) => w.trade === code)).toBe(true);

    const res = await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: code, reason: 'bad-proof' });
    expect(res.statusCode).toBe(201);
    // A repeat is idempotent.
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: code, reason: 'bad-proof' })).statusCode).toBe(201);

    const after = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
    expect(after.work.some((w) => w.trade === code)).toBe(false);
    for (const t of [buyer, seller]) {
      const got = await t.b.get(`/v1/trades/${code}/attestation`);
      expect(got.statusCode).toBe(409);
      expect(got.json()).toMatchObject({ error: 'attestation-refused' });
    }

    // A refused trade is never attested afterwards.
    const mod = stubModKeys();
    const attestation: Attestation = {
      v: 1,
      trade: code,
      channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
      participants: {
        buyer: { signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic },
        seller: { signPublic: sellerId.id.signPublic, boxPublic: sellerId.id.boxPublic },
        mod,
      },
      issuedAt: now.toISOString(),
      terms: termsByCode.get(code)!,
    };
    const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
    const late = await signedInject('POST', '/internal/v1/reports', { kind: 'attestation', attestation, sig });
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ error: 'refused' });
  });

  it('work rotates: a trade that keeps failing cannot hold the window shut for newer trades', async () => {
    // A listener serving 2 per pull. Older open trades (from other tests too) keep "failing": nothing
    // ever attests or refuses them. Each new trade must still be served within a bounded number of pulls.
    let clock = now.getTime();
    const small = await buildInternalListener({ db: deps.db, modSigningPublic: modSign.public, now: () => clock, workLimit: 2 });
    try {
      const fresh: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { code, buyer, seller } = await freshTrade();
        await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
        await seller.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'seller').body);
        fresh.push(code);
      }
      const { rows } = await deps.db.query<{ n: string }>(
        `select count(*) as n from trades t
           join trade_identities bi on bi.code = t.code and bi.role = 'buyer'
           join trade_identities si on si.code = t.code and si.role = 'seller'
          where not exists (select 1 from trade_attestations a where a.code = t.code)
            and not exists (select 1 from trade_refusals r where r.code = t.code)
            and t.state = 'setup' and t.closed_at is null
            and t.buyer_payout is not null and t.seller_refund is not null`,
      );
      const open = Number(rows[0]!.n);
      const seen = new Set<string>();
      for (let pull = 0; pull < Math.ceil(open / 2) + 1; pull++) {
        clock += 1_000;
        const at = clock;
        const bytes = internalSignedBytes({ method: 'GET', path: '/internal/v1/work', at, bodyHash: sha256Hex('') });
        const sig = sodium.to_base64(sodium.crypto_sign_detached(bytes, modSign.secret), sodium.base64_variants.ORIGINAL);
        const res = await small.inject({ method: 'GET', url: '/internal/v1/work', headers: { [INTERNAL_AT_HEADER]: String(at), [INTERNAL_SIG_HEADER]: sig } });
        expect(res.statusCode).toBe(200);
        const { work } = res.json() as { work: Array<{ trade: string }> };
        expect(work.length).toBeLessThanOrEqual(2);
        for (const w of work) seen.add(w.trade);
      }
      for (const code of fresh) expect(seen.has(code)).toBe(true);
    } finally {
      await small.close();
    }
  });

  it('stores no attestation whose terms differ from the trade record (409 terms-mismatch) or that has no terms (400)', async () => {
    const { code, buyer, seller } = await freshTrade();
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');
    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);
    const real = termsByCode.get(code)!;
    const post = async (terms: unknown) => {
      const mod = stubModKeys();
      const attestation = {
        v: 1,
        trade: code,
        channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
        participants: {
          buyer: { signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic },
          seller: { signPublic: sellerId.id.signPublic, boxPublic: sellerId.id.boxPublic },
          mod,
        },
        issuedAt: now.toISOString(),
        ...(terms === undefined ? {} : { terms }),
      } as Attestation;
      const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
      return signedInject('POST', '/internal/v1/reports', { kind: 'attestation', attestation, sig });
    };
    for (const terms of [
      { ...real, buyerPayout: `${real.buyerPayout.slice(0, -1)}X` },
      { ...real, sellerRefund: `${real.sellerRefund.slice(0, -1)}X` },
      { ...real, deal: { ...real.deal, poster: 'buyer' } },
      { ...real, deal: { ...real.deal, takeAmountAtomic: '1' } },
      { ...real, deal: { ...real.deal, currency: 'EUR' } },
      { ...real, deal: { ...real.deal, centsPerXmr: '1' } },
      { ...real, deal: { ...real.deal, maxFiatCents: '1' } },
      { ...real, payWindowMin: real.payWindowMin === 90 ? 1440 : 90 },
      { ...real, deal: { ...real.deal, methodId: 'PAYPAL' } },
      { ...real, deal: { ...real.deal, instructionsSha256: sha256Hex('Zelle to thief@example.test') } },
    ]) {
      const res = await post(terms);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'terms-mismatch' });
    }
    const { payWindowMin: _p, ...noPayWindow } = real;
    const { instructionsSha256: _h, ...noHash } = real.deal;
    for (const terms of [
      undefined, { ...real, extra: 1 }, { ...real, deal: { ...real.deal, centsPerXmr: '01' } }, noPayWindow, { ...real, payWindowMin: 0 },
      { ...real, deal: noHash }, { ...real, deal: { ...real.deal, instructionsSha256: real.deal.instructionsSha256.toUpperCase() } },
    ]) {
      const res = await post(terms);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-attestation' });
    }
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(202);
    expect((await post(real)).statusCode).toBe(201);
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(200);
  });

  it("serves the trade's own time to pay in the work item's terms and stores only an attestation that signs it (owner p9-6)", async () => {
    const { code, buyer, seller } = await freshTrade({}, { payWindowMin: 1440 }); // a 24-hour method (cash by mail)
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');
    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);
    const work = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string; terms: AttestedTerms }> };
    const item = work.work.find((w) => w.trade === code)!;
    expect(item.terms.payWindowMin).toBe(1440);
    expect(item.terms).toEqual(termsByCode.get(code));
    // Signed with the machine default instead: refused, nothing stored.
    const mod = stubModKeys();
    const attestation: Attestation = {
      v: 1,
      trade: code,
      channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
      participants: {
        buyer: { signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic },
        seller: { signPublic: sellerId.id.signPublic, boxPublic: sellerId.id.boxPublic },
        mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
      },
      issuedAt: now.toISOString(),
      terms: { ...item.terms, payWindowMin: 90 },
    };
    const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
    const res = await signedInject('POST', '/internal/v1/reports', { kind: 'attestation', attestation, sig });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'terms-mismatch' });
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(202);
    await attestAndPost(code, buyerId.id, sellerId.id, item.terms);
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(200);
  });

  it("serves the SHA-256 of the trade's locked payment instructions and its method in the work item's terms, and stores only an attestation that signs them", async () => {
    const instructions = 'Zelle to seller@example.test\nMemo: the trade code only.';
    const { code, buyer, seller } = await freshTrade({ methodInstructions: instructions });
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');
    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);
    const work = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string; terms: AttestedTerms }> };
    const item = work.work.find((w) => w.trade === code)!;
    expect(item.terms.deal.instructionsSha256).toBe(sha256Hex(instructions));
    expect(item.terms.deal.methodId).toBe('zelle');
    expect(item.terms).toEqual(termsByCode.get(code));
    // The instructions are never in the work item itself, only their hash.
    expect(JSON.stringify(item)).not.toContain('seller@example.test');
    // An attestation of the hash of other instructions (a swapped payee) is refused.
    const swapped = { ...item.terms, deal: { ...item.terms.deal, instructionsSha256: sha256Hex('Zelle to thief@example.test\nMemo: the trade code only.') } };
    const mod = stubModKeys();
    const attestation: Attestation = {
      v: 1,
      trade: code,
      channels: { escrow: await channelFor(code, 'escrow'), signals: await channelFor(code, 'signals') },
      participants: {
        buyer: { signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic },
        seller: { signPublic: sellerId.id.signPublic, boxPublic: sellerId.id.boxPublic },
        mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
      },
      issuedAt: now.toISOString(),
      terms: swapped,
    };
    const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
    const res = await signedInject('POST', '/internal/v1/reports', { kind: 'attestation', attestation, sig });
    expect([res.statusCode, (res.json() as { error: string }).error]).toEqual([409, 'terms-mismatch']);
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(202);
    await attestAndPost(code, buyerId.id, sellerId.id, item.terms);
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(200);
  });

  it('does not serve as work a trade whose payout or refund address is missing', async () => {
    for (const sides of [{ buyerPayout: null }, { sellerRefund: null }]) {
      const { code, buyer, seller } = await freshTrade(sides);
      await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
      await seller.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'seller').body);
      const listed = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
      expect(listed.work.some((w) => w.trade === code)).toBe(false);
    }
  });

  it('a closed trade is neither work nor refusable, and its never-attested attestation is a final 409 trade-closed (review M1, M2)', async () => {
    const { code, buyer, seller } = await freshTrade();
    await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
    await seller.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'seller').body);
    const listed = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
    expect(listed.work.some((w) => w.trade === code)).toBe(true);

    await closeTrade(code);
    const after = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
    expect(after.work.some((w) => w.trade === code)).toBe(false);
    const refuse = await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: code, reason: 'bad-proof' });
    expect(refuse.statusCode).toBe(409);
    expect(refuse.json()).toMatchObject({ error: 'not-refusable' });
    for (const t of [buyer, seller]) {
      const got = await t.b.get(`/v1/trades/${code}/attestation`);
      expect(got.statusCode).toBe(409);
      expect(got.json()).toMatchObject({ error: 'trade-closed' });
    }
  });

  it('a trade past setup (still open) is not served as work (review M1)', async () => {
    const { code, buyer, seller } = await freshTrade();
    await buyer.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'buyer').body);
    await seller.b.post(`/v1/trades/${code}/identity`, identityFor(code, 'seller').body);
    await deps.db.query(`update trades set state = 'funding' where code = $1`, [code]);
    const listed = (await signedInject('GET', '/internal/v1/work')).json() as { work: Array<{ trade: string }> };
    expect(listed.work.some((w) => w.trade === code)).toBe(false);
  });

  it('an attested or refused trade keeps its answer after it closes (200, attestation-refused)', async () => {
    const a = await freshTrade();
    const aBuyer = identityFor(a.code, 'buyer');
    const aSeller = identityFor(a.code, 'seller');
    await a.buyer.b.post(`/v1/trades/${a.code}/identity`, aBuyer.body);
    await a.seller.b.post(`/v1/trades/${a.code}/identity`, aSeller.body);
    await attestAndPost(a.code, aBuyer.id, aSeller.id);
    await closeTrade(a.code);
    expect((await a.buyer.b.get(`/v1/trades/${a.code}/attestation`)).statusCode).toBe(200);

    const r = await freshTrade();
    await r.buyer.b.post(`/v1/trades/${r.code}/identity`, identityFor(r.code, 'buyer').body);
    await r.seller.b.post(`/v1/trades/${r.code}/identity`, identityFor(r.code, 'seller').body);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: r.code, reason: 'bad-proof' })).statusCode).toBe(201);
    await closeTrade(r.code);
    const got = await r.buyer.b.get(`/v1/trades/${r.code}/attestation`);
    expect(got.statusCode).toBe(409);
    expect(got.json()).toMatchObject({ error: 'attestation-refused' });
  });

  it('the work-served stamp goes once the attestation or the refusal is recorded (review M7)', async () => {
    const served = async (code: string) => (await deps.db.query('select 1 from trade_work_served where code = $1', [code])).rows.length;
    const a = await freshTrade();
    const aBuyer = identityFor(a.code, 'buyer');
    const aSeller = identityFor(a.code, 'seller');
    await a.buyer.b.post(`/v1/trades/${a.code}/identity`, aBuyer.body);
    await a.seller.b.post(`/v1/trades/${a.code}/identity`, aSeller.body);
    const r = await freshTrade();
    await r.buyer.b.post(`/v1/trades/${r.code}/identity`, identityFor(r.code, 'buyer').body);
    await r.seller.b.post(`/v1/trades/${r.code}/identity`, identityFor(r.code, 'seller').body);
    // Pull until both have been served (older open trades from other tests share the window).
    for (let i = 0; i < 50 && ((await served(a.code)) === 0 || (await served(r.code)) === 0); i++) await signedInject('GET', '/internal/v1/work');
    expect(await served(a.code)).toBe(1);
    expect(await served(r.code)).toBe(1);
    await attestAndPost(a.code, aBuyer.id, aSeller.id);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: r.code, reason: 'bad-work' })).statusCode).toBe(201);
    expect(await served(a.code)).toBe(0);
    expect(await served(r.code)).toBe(0);
  });

  it('an attested trade cannot be refused afterwards', async () => {
    const { code, buyer, seller } = await freshTrade();
    const buyerId = identityFor(code, 'buyer');
    const sellerId = identityFor(code, 'seller');
    await buyer.b.post(`/v1/trades/${code}/identity`, buyerId.body);
    await seller.b.post(`/v1/trades/${code}/identity`, sellerId.body);
    await attestAndPost(code, buyerId.id, sellerId.id);
    const res = await signedInject('POST', '/internal/v1/reports', { kind: 'refused', trade: code, reason: 'bad-work' });
    expect(res.statusCode).toBe(409);
    expect((await buyer.b.get(`/v1/trades/${code}/attestation`)).statusCode).toBe(200);
  });
});
