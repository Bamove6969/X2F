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
} from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { seedTrade } from './helpers/trades.js';

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
  const id = await seedAccount(deps, { username: name('idn') });
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id });
  expect(res.statusCode).toBe(200);
  return { id, b };
}

/** A fresh trade with a buyer and seller account, each with a browser; returns the stored code. */
async function freshTrade(): Promise<{ code: string; buyer: { id: string; b: Browser }; seller: { id: string; b: Browser } }> {
  const buyer = await trader();
  const seller = await trader();
  const { code } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  return { code, buyer, seller };
}

/** Build the registration body for a role: a fresh identity and its Ed25519 proof of possession. */
function identityFor(code: string, role: 'buyer' | 'seller'): { id: Identity; body: { signPublic: string; boxPublic: string; proof: string } } {
  const kp = sodium.crypto_sign_keypair();
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
async function attestAndPost(code: string, buyer: Identity, seller: Identity): Promise<Attestation> {
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

    const attestation = await attestAndPost(code, buyerId.id, sellerId.id);

    const got = await buyer.b.get(`/v1/trades/${code}/attestation`);
    expect(got.statusCode).toBe(200);
    const payload = got.json() as { attestation: Attestation; sig: string };
    expect(payload.attestation).toEqual(attestation);
    // The real buyer's verification passes against the pinned moderation signing key.
    await expect(
      verifyAttestation(payload.attestation, payload.sig, modSign.public, {
        trade: code, role: 'buyer', signPublic: buyerId.id.signPublic, boxPublic: buyerId.id.boxPublic,
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
});
