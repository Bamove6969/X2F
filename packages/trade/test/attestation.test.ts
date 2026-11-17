import { createHash } from 'node:crypto';
import { ROLES } from '@x2f/core';
import { canonicalJson, generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ATTESTATION_CLOCK_SKEW_MS,
  AttestationError,
  attestationBytes,
  attestationKeys,
  channelFor,
  escrowCheckWords,
  instructionsMatch,
  instructionsSha256,
  isAttestedTerms,
  MAX_PAY_WINDOW_MIN,
  verifyAttestation,
  WORDLIST,
  type Attestation,
  type AttestedTerms,
  type ConfirmedDeal,
} from '../src/index.js';

const TRADE = 'AB12-CD34-EF56-GH78';
const BUYER_PAYOUT = '4'.padEnd(95, 'B');
const SELLER_REFUND = '8'.padEnd(95, 'S');
/** The deal both users confirmed (bigints), and the same deal as attested (decimal strings). */
const DEAL: ConfirmedDeal = { poster: 'seller', takeAmountAtomic: 250_000_000_000n, currency: 'USD', centsPerXmr: 16_250n, maxFiatCents: 100_000n };
/** The payment instructions locked at take (J-16: the chosen method's, for the chosen currency). */
const INSTRUCTIONS = 'Zelle to pay@example.test, memo: the trade code.';
const INSTRUCTIONS_SHA256 = createHash('sha256').update(INSTRUCTIONS, 'utf8').digest('hex');
const TERMS: AttestedTerms = {
  deal: {
    poster: 'seller',
    takeAmountAtomic: '250000000000',
    currency: 'USD',
    centsPerXmr: '16250',
    maxFiatCents: '100000',
    methodId: 'ZELLE',
    instructionsSha256: INSTRUCTIONS_SHA256,
  },
  payWindowMin: 90,
  buyerPayout: BUYER_PAYOUT,
  sellerRefund: SELLER_REFUND,
};

function participantsFrom(buyer: Identity, seller: Identity, mod: Identity): Participants {
  return {
    buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic },
    seller: { signPublic: seller.signPublic, boxPublic: seller.boxPublic },
    mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
  };
}

async function buildTrade(trade = TRADE): Promise<{
  attestation: Attestation;
  sig: string;
  modSign: { public: string; secret: Uint8Array };
  buyer: Identity;
  seller: Identity;
  mod: Identity;
}> {
  await sodium.ready;
  const buyer = await generateIdentity();
  const seller = await generateIdentity();
  const mod = await generateIdentity();
  const modSignKp = sodium.crypto_sign_keypair();
  const attestation: Attestation = {
    v: 1,
    trade,
    channels: { escrow: await channelFor(trade, 'escrow'), signals: await channelFor(trade, 'signals') },
    participants: participantsFrom(buyer, seller, mod),
    issuedAt: '2026-10-23T00:00:00.000Z',
    terms: TERMS,
  };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSignKp.privateKey));
  return { attestation, sig, modSign: { public: sodium.to_hex(modSignKp.publicKey), secret: modSignKp.privateKey }, buyer, seller, mod };
}

describe('attestationBytes', () => {
  it('is the domain prefix then canonical JSON', async () => {
    const { attestation } = await buildTrade();
    expect(new TextDecoder().decode(attestationBytes(attestation))).toBe(`x2f/attestation/v1\0${canonicalJson(attestation)}`);
  });
});

type Built = Awaited<ReturnType<typeof buildTrade>>;

/** When the verifying device made its per-trade identity (device clock): a minute before buildTrade's issuedAt. */
const IDENTITY_MADE = Date.parse('2026-10-22T23:59:00.000Z');

/** What the verifying app knows about itself: its trade, its role and both of its public keys. */
function meOf(
  t: Built,
  role: 'buyer' | 'seller' = 'buyer',
  over: Partial<{
    trade: string; signPublic: string; boxPublic: string; context: 'trade' | 'chat'; deal: ConfirmedDeal; ownAddress: string; payWindowMin: number; methodId: string; now: number; takenAt: string;
    identityCreatedAt: number | null;
  }> = {},
) {
  const id = role === 'buyer' ? t.buyer : t.seller;
  const ownAddress = role === 'buyer' ? BUYER_PAYOUT : SELLER_REFUND;
  // The device made its per-trade identity a minute before buildTrade's issuedAt (review M1).
  return { trade: TRADE, role, signPublic: id.signPublic, boxPublic: id.boxPublic, deal: DEAL, ownAddress, identityCreatedAt: IDENTITY_MADE, ...over };
}

/** A chat attestation: the chat channel only and no terms. */
async function chatOf(t: Built): Promise<Attestation> {
  const { terms: _terms, ...rest } = t.attestation;
  return { ...rest, channels: { chat: await channelFor(TRADE, 'chat') } };
}

/** Re-sign a modified attestation with the real moderation key (a validly signed but wrong statement). */
function resign(t: Built, a: Attestation): string {
  return sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), t.modSign.secret));
}

describe('verifyAttestation', () => {
  it('accepts a correctly signed attestation for each party', async () => {
    const t = await buildTrade();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer'))).resolves.toBeUndefined();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'seller'))).resolves.toBeUndefined();
  });

  it('accepts the trade code in any accepted spelling', async () => {
    const t = await buildTrade();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { trade: TRADE.toLowerCase() }))).resolves.toBeUndefined();
  });

  it('throws not-me when the buyer slot holds another key', async () => {
    const t = await buildTrade();
    const impostor = await generateIdentity();
    await expect(
      verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { signPublic: impostor.signPublic, boxPublic: impostor.boxPublic })),
    ).rejects.toMatchObject({ name: 'AttestationError', code: 'not-me' });
  });

  it('throws not-me when signPublic matches but boxPublic does not', async () => {
    const t = await buildTrade();
    const other = await generateIdentity();
    const swappedBox: Attestation = {
      ...t.attestation,
      participants: { ...t.attestation.participants, buyer: { signPublic: t.buyer.signPublic, boxPublic: other.boxPublic } },
    };
    await expect(verifyAttestation(swappedBox, resign(t, swappedBox), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'not-me' });
  });

  it('throws bad-signature for a copy re-signed by another key', async () => {
    const t = await buildTrade();
    const forger = sodium.crypto_sign_keypair();
    const forged = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(t.attestation), forger.privateKey));
    // Verified against the PINNED moderation key, so a key the forger controls does not help.
    await expect(verifyAttestation(t.attestation, forged, t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
  });

  it('throws wrong-trade for a validly signed attestation of ANOTHER trade', async () => {
    const t = await buildTrade();
    const OTHER = 'ZZ12-CD34-EF56-GH78';
    const other: Attestation = {
      ...t.attestation,
      trade: OTHER,
      channels: { escrow: await channelFor(OTHER, 'escrow'), signals: await channelFor(OTHER, 'signals') },
    };
    await expect(verifyAttestation(other, resign(t, other), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-trade' });
  });

  it('throws wrong-trade for a malformed trade code', async () => {
    const t = await buildTrade();
    const bad: Attestation = { ...t.attestation, trade: 'not a trade code', channels: {} };
    await expect(verifyAttestation(bad, resign(t, bad), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-trade' });
  });

  it('throws wrong-channel when a channel value is not channelFor(trade, kind)', async () => {
    const t = await buildTrade();
    const tampered: Attestation = { ...t.attestation, channels: { ...t.attestation.channels, escrow: await channelFor(TRADE, 'chat') } };
    await expect(verifyAttestation(tampered, resign(t, tampered), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-channel' });
  });

  it('throws wrong-channel for an empty channel set', async () => {
    const t = await buildTrade();
    const none: Attestation = { ...t.attestation, channels: {} };
    await expect(verifyAttestation(none, resign(t, none), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-channel' });
  });

  it('throws wrong-channel when signals is missing', async () => {
    const t = await buildTrade();
    const partial: Attestation = { ...t.attestation, channels: { escrow: await channelFor(TRADE, 'escrow') } };
    await expect(verifyAttestation(partial, resign(t, partial), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-channel' });
  });

  it('throws wrong-channel for an extra channel on a trade attestation', async () => {
    const t = await buildTrade();
    const extra: Attestation = { ...t.attestation, channels: { ...t.attestation.channels, chat: await channelFor(TRADE, 'chat') } };
    await expect(verifyAttestation(extra, resign(t, extra), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-channel' });
  });

  it('a chat attestation must carry exactly the chat channel', async () => {
    const t = await buildTrade();
    const chat = await chatOf(t);
    await expect(verifyAttestation(chat, resign(t, chat), t.modSign.public, meOf(t, 'buyer', { context: 'chat' }))).resolves.toBeUndefined();
    // A trade attestation is not a chat attestation, and vice versa.
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { context: 'chat' }))).rejects.toMatchObject({ code: 'wrong-channel' });
    await expect(verifyAttestation(chat, resign(t, chat), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-channel' });
  });

  it('throws wrong-terms for a trade attestation without terms', async () => {
    const t = await buildTrade();
    const { terms: _terms, ...bare } = t.attestation;
    await expect(verifyAttestation(bare, resign(t, bare), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('throws wrong-terms when any field of the attested deal differs from the confirmed deal', async () => {
    const t = await buildTrade();
    const changes: Array<Partial<AttestedTerms['deal']>> = [
      { poster: 'buyer' },
      { takeAmountAtomic: '250000000001' },
      { currency: 'EUR' },
      { centsPerXmr: '16251' },
      { maxFiatCents: '99999' },
    ];
    for (const c of changes) {
      const other: Attestation = { ...t.attestation, terms: { ...TERMS, deal: { ...TERMS.deal, ...c } } };
      await expect(verifyAttestation(other, resign(t, other), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-terms' });
      await expect(verifyAttestation(other, resign(t, other), t.modSign.public, meOf(t, 'seller'))).rejects.toMatchObject({ code: 'wrong-terms' });
    }
  });

  it("throws wrong-terms when this device's own address differs; the other side's address is not its to check", async () => {
    const t = await buildTrade();
    const payout: Attestation = { ...t.attestation, terms: { ...TERMS, buyerPayout: '4'.padEnd(95, 'X') } };
    await expect(verifyAttestation(payout, resign(t, payout), t.modSign.public, meOf(t, 'buyer'))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(payout, resign(t, payout), t.modSign.public, meOf(t, 'seller'))).resolves.toBeUndefined();
    const refund: Attestation = { ...t.attestation, terms: { ...TERMS, sellerRefund: '8'.padEnd(95, 'X') } };
    await expect(verifyAttestation(refund, resign(t, refund), t.modSign.public, meOf(t, 'seller'))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(refund, resign(t, refund), t.modSign.public, meOf(t, 'buyer'))).resolves.toBeUndefined();
  });

  it('throws wrong-terms when the attested time to pay differs from the one this app was shown; not checked when the app has none', async () => {
    const t = await buildTrade();
    // A 24-hour method (cash by mail) attested as the 90-minute default: the window the moderation
    // service would enforce is not the one the buyer sees.
    for (const role of ['buyer', 'seller'] as const) {
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, role, { payWindowMin: 1440 }))).rejects.toMatchObject({ code: 'wrong-terms' });
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, role, { payWindowMin: 90 }))).resolves.toBeUndefined();
    }
    const long: Attestation = { ...t.attestation, terms: { ...TERMS, payWindowMin: 1440 } };
    await expect(verifyAttestation(long, resign(t, long), t.modSign.public, meOf(t, 'buyer', { payWindowMin: 1440 }))).resolves.toBeUndefined();
    await expect(verifyAttestation(long, resign(t, long), t.modSign.public, meOf(t, 'buyer', { payWindowMin: 90 }))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(long, resign(t, long), t.modSign.public, meOf(t, 'buyer'))).resolves.toBeUndefined();
  });

  it('throws wrong-terms when the attested method differs from the one this app was shown; not checked when the app has none', async () => {
    const t = await buildTrade();
    for (const role of ['buyer', 'seller'] as const) {
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, role, { methodId: 'PAYPAL' }))).rejects.toMatchObject({ code: 'wrong-terms' });
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, role, { methodId: 'ZELLE' }))).resolves.toBeUndefined();
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, role))).resolves.toBeUndefined();
    }
  });

  it('throws wrong-terms when the verifying app passes no confirmed deal or no own address (fail closed)', async () => {
    const t = await buildTrade();
    const { deal: _d, ...noDeal } = meOf(t);
    const { ownAddress: _o, ...noAddress } = meOf(t);
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, noDeal)).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, noAddress)).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { ownAddress: '' }))).rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('throws wrong-terms for a chat attestation that carries terms', async () => {
    const t = await buildTrade();
    const chat: Attestation = { ...(await chatOf(t)), terms: TERMS };
    await expect(verifyAttestation(chat, resign(t, chat), t.modSign.public, meOf(t, 'buyer', { context: 'chat' }))).rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('throws bad-signature for malformed terms, even validly signed', async () => {
    const t = await buildTrade();
    const bad: unknown[] = [
      { ...TERMS, extra: 'x' },
      { ...TERMS, buyerPayout: '' },
      { ...TERMS, sellerRefund: 'x'.repeat(257) },
      { ...TERMS, deal: { ...TERMS.deal, takeAmountAtomic: '0250000000000' } },
      { ...TERMS, deal: { ...TERMS.deal, centsPerXmr: '0' } },
      { ...TERMS, deal: { ...TERMS.deal, maxFiatCents: 100000 } },
      { ...TERMS, deal: { ...TERMS.deal, poster: 'mod' } },
      { ...TERMS, deal: { ...TERMS.deal, extra: '1' } },
      { buyerPayout: BUYER_PAYOUT, sellerRefund: SELLER_REFUND },
      // No time to pay: an attestation signed before payWindowMin joined the terms.
      { deal: TERMS.deal, buyerPayout: BUYER_PAYOUT, sellerRefund: SELLER_REFUND },
      { ...TERMS, payWindowMin: 0 },
      { ...TERMS, payWindowMin: '90' },
      { ...TERMS, deal: { ...TERMS.deal, payWindowMin: 90 } },
      // The instructions hash and the method (restored after J-16): required, exact form.
      { ...TERMS, deal: (({ instructionsSha256: _h, ...d }) => d)(TERMS.deal) },
      { ...TERMS, deal: (({ methodId: _m, ...d }) => d)(TERMS.deal) },
      { ...TERMS, deal: { ...TERMS.deal, instructionsSha256: INSTRUCTIONS_SHA256.toUpperCase() } },
      { ...TERMS, deal: { ...TERMS.deal, instructionsSha256: INSTRUCTIONS_SHA256.slice(1) } },
      { ...TERMS, deal: { ...TERMS.deal, instructionsSha256: '' } },
      { ...TERMS, deal: { ...TERMS.deal, methodId: '' } },
      { ...TERMS, deal: { ...TERMS.deal, methodId: 'x'.repeat(65) } },
      { ...TERMS, deal: { ...TERMS.deal, methodId: 7 } },
    ];
    for (const terms of bad) {
      const a = { ...t.attestation, terms } as unknown as Attestation;
      await expect(verifyAttestation(a, resign(t, a), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    }
  });

  it('throws bad-signature for a malformed attestation', async () => {
    const t = await buildTrade();
    const broken = { ...t.attestation, v: 2 } as unknown as Attestation;
    await expect(verifyAttestation(broken, t.sig, t.modSign.public, meOf(t))).rejects.toBeInstanceOf(AttestationError);
  });
});

// Review multisig-vs-RetoSwap F5 (12 Nov): `issuedAt` is checked, and the pinned key is a list of keys
// with validity dates, so one can be rotated out later.
describe('verifyAttestation: issuedAt and the pinned key list', () => {
  const ISSUED = Date.parse('2026-10-23T00:00:00.000Z'); // buildTrade's issuedAt
  const MIN = 60_000;
  const at = (a: Attestation, issuedAt: string): Attestation => ({ ...a, issuedAt });

  it('today: exactly one built-in key, the same value, valid without bounds', () => {
    expect(attestationKeys('ab'.repeat(32))).toEqual([{ signPublic: 'ab'.repeat(32), notBefore: null, notAfter: null }]);
  });

  it('a one-key list behaves exactly as the bare key did', async () => {
    const t = await buildTrade();
    const keys = attestationKeys(t.modSign.public);
    await expect(verifyAttestation(t.attestation, t.sig, keys, meOf(t, 'buyer'))).resolves.toBeUndefined();
    await expect(verifyAttestation(t.attestation, t.sig, keys, meOf(t, 'seller'))).resolves.toBeUndefined();
    const other = await buildTrade();
    await expect(verifyAttestation(t.attestation, t.sig, attestationKeys(other.modSign.public), meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    await expect(verifyAttestation(t.attestation, t.sig, [], meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
  });

  it('refuses an attestation issued outside its key validity (a rotated-out key), as bad-signature', async () => {
    const t = await buildTrade();
    const pub = t.modSign.public;
    await expect(verifyAttestation(t.attestation, t.sig, [{ signPublic: pub, notBefore: null, notAfter: '2026-10-01T00:00:00.000Z' }], meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    await expect(verifyAttestation(t.attestation, t.sig, [{ signPublic: pub, notBefore: '2026-11-01T00:00:00.000Z', notAfter: null }], meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    // The bounds are inclusive.
    await expect(verifyAttestation(t.attestation, t.sig, [{ signPublic: pub, notBefore: '2026-10-23T00:00:00.000Z', notAfter: '2026-10-23T00:00:00.000Z' }], meOf(t))).resolves.toBeUndefined();
  });

  it('after a rotation, each key verifies only what it signed inside its own window', async () => {
    const t = await buildTrade();
    const next = sodium.crypto_sign_keypair();
    const keys = [
      { signPublic: t.modSign.public, notBefore: null, notAfter: '2026-11-01T00:00:00.000Z' },
      { signPublic: sodium.to_hex(next.publicKey), notBefore: '2026-11-01T00:00:00.000Z', notAfter: null },
    ];
    // The old key, inside its window.
    await expect(verifyAttestation(t.attestation, t.sig, keys, meOf(t))).resolves.toBeUndefined();
    // The new key, inside its window.
    const fresh = at(t.attestation, '2026-11-05T00:00:00.000Z');
    const freshSig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(fresh), next.privateKey));
    await expect(verifyAttestation(fresh, freshSig, keys, meOf(t))).resolves.toBeUndefined();
    // The old key signing an issuedAt after its notAfter. A thief of the old key would not do this:
    // it backdates issuedAt into the old window instead, which the key list alone cannot tell apart
    // (see the identity-time tests below, review M1).
    await expect(verifyAttestation(fresh, resign(t, fresh), keys, meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    // The new key backdated into the old key's window.
    const backdatedSig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(t.attestation), next.privateKey));
    await expect(verifyAttestation(t.attestation, backdatedSig, keys, meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
  });

  it('refuses a key list entry that is malformed', async () => {
    const t = await buildTrade();
    for (const bad of [
      { signPublic: 'xyz', notBefore: null, notAfter: null },
      { signPublic: t.modSign.public, notBefore: 'yesterday', notAfter: null },
      { signPublic: t.modSign.public, notBefore: null, notAfter: 5 },
    ]) {
      await expect(verifyAttestation(t.attestation, t.sig, [bad as never], meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    }
  });

  it('refuses an issuedAt that is not a canonical ISO time, as malformed', async () => {
    const t = await buildTrade();
    for (const issuedAt of ['', 'soon', '2026-10-23', '2026-10-23T00:00:00Z', '2026-13-40T00:00:00.000Z']) {
      const a = at(t.attestation, issuedAt);
      await expect(verifyAttestation(a, resign(t, a), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'bad-signature' });
    }
  });

  it(`accepts an issuedAt up to ${ATTESTATION_CLOCK_SKEW_MS / MIN} min in this device's future, and refuses one beyond (bad-time)`, async () => {
    const t = await buildTrade();
    const skew = ATTESTATION_CLOCK_SKEW_MS;
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { now: ISSUED - skew }))).resolves.toBeUndefined();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { now: ISSUED - skew - 1 }))).rejects.toMatchObject({ code: 'bad-time' });
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { now: ISSUED - 24 * 60 * MIN }))).rejects.toMatchObject({ code: 'bad-time' });
    // Without `now`, the device clock: an attestation from next year is refused today.
    const later = at(t.attestation, new Date(Date.now() + 365 * 24 * 60 * MIN).toISOString());
    await expect(verifyAttestation(later, resign(t, later), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'bad-time' });
  });

  it('a chat attestation from the future is refused too', async () => {
    const t = await buildTrade();
    const chat = await chatOf(t);
    await expect(verifyAttestation(chat, resign(t, chat), t.modSign.public, meOf(t, 'buyer', { context: 'chat', now: ISSUED - ATTESTATION_CLOCK_SKEW_MS - 1 }))).rejects.toMatchObject({ code: 'bad-time' });
  });

  it('an old attestation stays valid however long the trade lasts (a stored one is re-verified on every start)', async () => {
    const t = await buildTrade();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { now: ISSUED + 400 * 24 * 60 * MIN }))).resolves.toBeUndefined();
  });

  it('refuses an attestation issued before the trade was taken (older than the trade can be)', async () => {
    const t = await buildTrade();
    const skew = ATTESTATION_CLOCK_SKEW_MS;
    const iso = (ms: number) => new Date(ms).toISOString();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { takenAt: iso(ISSUED - 5 * MIN) }))).resolves.toBeUndefined();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { takenAt: iso(ISSUED + skew) }))).resolves.toBeUndefined();
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { takenAt: iso(ISSUED + skew + 1) }))).rejects.toMatchObject({ code: 'bad-time' });
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'seller', { takenAt: iso(ISSUED + 30 * 24 * 60 * MIN) }))).rejects.toMatchObject({ code: 'bad-time' });
    // A take time that is given but unreadable fails closed.
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { takenAt: 'not a time' }))).rejects.toMatchObject({ code: 'bad-time' });
  });

  // Review lead-escrow-harden M1 (16 Nov): issuedAt is chosen by whoever holds the signing key, so
  // the key window alone does not stop a thief of a rotated-out key. The lower bound is the time
  // this device made its fresh per-trade identity: the attestation names that identity, so it
  // cannot be older than it. The API's takenAt is unsigned and may be left out or chosen.
  describe('the lower bound is the time this device made its identity (review M1)', () => {
    const rotated = (t: Built) => {
      const next = sodium.crypto_sign_keypair();
      return [
        { signPublic: t.modSign.public, notBefore: null, notAfter: '2026-11-01T00:00:00.000Z' },
        { signPublic: sodium.to_hex(next.publicKey), notBefore: '2026-11-01T00:00:00.000Z', notAfter: null },
      ];
    };
    const TODAY = Date.parse('2026-11-16T12:00:00.000Z');
    const MADE_TODAY = Date.parse('2026-11-16T11:00:00.000Z');

    it('a thief of the old key who backdates issuedAt into the old window is refused, with or without the API\'s takenAt', async () => {
      const t = await buildTrade(); // issuedAt 2026-10-23, inside the old key's window
      const keys = rotated(t);
      // The device made its identity today; the API (the thief's ally) leaves takenAt out, or backdates it too.
      await expect(verifyAttestation(t.attestation, t.sig, keys, meOf(t, 'buyer', { now: TODAY, identityCreatedAt: MADE_TODAY }))).rejects.toMatchObject({ code: 'bad-time' });
      await expect(
        verifyAttestation(t.attestation, t.sig, keys, meOf(t, 'buyer', { now: TODAY, identityCreatedAt: MADE_TODAY, takenAt: '2026-10-22T23:59:00.000Z' })),
      ).rejects.toMatchObject({ code: 'bad-time' });
      // A chat attestation is bounded the same way.
      const chat = await chatOf(t);
      await expect(verifyAttestation(chat, resign(t, chat), keys, meOf(t, 'buyer', { context: 'chat', now: TODAY, identityCreatedAt: MADE_TODAY }))).rejects.toMatchObject({ code: 'bad-time' });
    });

    it(`accepts an issuedAt up to ${ATTESTATION_CLOCK_SKEW_MS / MIN} min before the identity was made, and refuses one beyond`, async () => {
      const t = await buildTrade();
      const skew = ATTESTATION_CLOCK_SKEW_MS;
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { identityCreatedAt: ISSUED + skew }))).resolves.toBeUndefined();
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { identityCreatedAt: ISSUED + skew + 1 }))).rejects.toMatchObject({ code: 'bad-time' });
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'seller', { identityCreatedAt: ISSUED - 30 * 24 * 60 * MIN }))).resolves.toBeUndefined();
    });

    it('the identity time is required: left out, or not a time, is refused (bad-time)', async () => {
      const t = await buildTrade();
      const { identityCreatedAt: _made, ...noTime } = meOf(t);
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, noTime as never)).rejects.toMatchObject({ code: 'bad-time' });
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '2026-10-22T23:59:00.000Z', -1]) {
        await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { identityCreatedAt: bad as never }))).rejects.toMatchObject({ code: 'bad-time' });
      }
    });

    it('a record from before the identity time was kept (null): no lower bound with an unbounded key only; any bounded key is refused', async () => {
      const t = await buildTrade();
      await expect(verifyAttestation(t.attestation, t.sig, attestationKeys(t.modSign.public), meOf(t, 'buyer', { identityCreatedAt: null }))).resolves.toBeUndefined();
      await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { identityCreatedAt: null }))).resolves.toBeUndefined();
      await expect(verifyAttestation(t.attestation, t.sig, rotated(t), meOf(t, 'buyer', { identityCreatedAt: null, now: TODAY }))).rejects.toMatchObject({ code: 'bad-time' });
      const fromNow = [{ signPublic: t.modSign.public, notBefore: '2026-10-01T00:00:00.000Z', notAfter: null }];
      await expect(verifyAttestation(t.attestation, t.sig, fromNow, meOf(t, 'buyer', { identityCreatedAt: null }))).rejects.toMatchObject({ code: 'bad-time' });
    });
  });

  it('identity and terms failures are reported before a time failure', async () => {
    const t = await buildTrade();
    const impostor = await generateIdentity();
    await expect(
      verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { signPublic: impostor.signPublic, boxPublic: impostor.boxPublic, now: ISSUED - 24 * 60 * MIN })),
    ).rejects.toMatchObject({ code: 'not-me' });
  });
});

describe('isAttestedTerms', () => {
  it('accepts exactly the attested terms shape', () => {
    expect(isAttestedTerms(TERMS)).toBe(true);
    expect(isAttestedTerms({ ...TERMS, deal: { ...TERMS.deal, poster: 'buyer' } })).toBe(true);
    expect(isAttestedTerms(null)).toBe(false);
    expect(isAttestedTerms({ ...TERMS, deal: { ...TERMS.deal, currency: '' } })).toBe(false);
    expect(isAttestedTerms({ ...TERMS, deal: { ...TERMS.deal, takeAmountAtomic: '-1' } })).toBe(false);
    expect(isAttestedTerms({ ...TERMS, deal: { ...TERMS.deal, takeAmountAtomic: '1'.repeat(32) } })).toBe(false);
  });

  it('requires the time to pay: whole minutes from 1 to MAX_PAY_WINDOW_MIN (24 hours)', () => {
    for (const m of [1, 90, 180, MAX_PAY_WINDOW_MIN]) expect(isAttestedTerms({ ...TERMS, payWindowMin: m })).toBe(true);
    const { payWindowMin: _p, ...missing } = TERMS;
    expect(isAttestedTerms(missing)).toBe(false);
    for (const m of [0, -90, MAX_PAY_WINDOW_MIN + 1, 90.5, Number.NaN, Number.POSITIVE_INFINITY, '90', null, 90n]) {
      expect(isAttestedTerms({ ...TERMS, payWindowMin: m })).toBe(false);
    }
  });
});

describe('escrowCheckWords', () => {
  const addr = 'A'.repeat(95);

  it('returns four words from the bundled list', async () => {
    const t = await buildTrade();
    const words = await escrowCheckWords(t.attestation.participants, addr);
    expect(words).toHaveLength(4);
    for (const w of words) expect(WORDLIST).toContain(w);
  });

  it('is equal for equal inputs', async () => {
    const t = await buildTrade();
    const a = await escrowCheckWords(t.attestation.participants, addr);
    const b = await escrowCheckWords(t.attestation.participants, addr);
    expect(a).toEqual(b);
  });

  it('differs when one participant key changes', async () => {
    const t = await buildTrade();
    const impostor = await generateIdentity();
    const changed: Participants = {
      ...t.attestation.participants,
      buyer: { signPublic: impostor.signPublic, boxPublic: impostor.boxPublic },
    };
    const a = await escrowCheckWords(t.attestation.participants, addr);
    const b = await escrowCheckWords(changed, addr);
    expect(a).not.toEqual(b);
  });

  it('differs when the escrow address changes', async () => {
    const t = await buildTrade();
    const a = await escrowCheckWords(t.attestation.participants, addr);
    const b = await escrowCheckWords(t.attestation.participants, `${addr}B`);
    expect(a).not.toEqual(b);
  });
});

describe('bundled wordlist', () => {
  it('is the standard BIP-39 English 2048-word list', () => {
    expect(WORDLIST).toHaveLength(2048);
    const digest = createHash('sha256').update(`${WORDLIST.join('\n')}\n`).digest('hex');
    expect(digest).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });
});

beforeAll(async () => {
  await sodium.ready;
  expect(ROLES).toContain('mod');
});

// Task 34 review I1, restored for flex offers (J-16 dropped it): the attested terms carry the SHA-256
// of the payment instructions locked at take, and a device shows instructions only when they match.
describe('instructionsSha256 and instructionsMatch', () => {
  it('is the lower-case hex SHA-256 of the UTF-8 text, exactly (no trimming or normalising)', async () => {
    expect(await instructionsSha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await instructionsSha256(INSTRUCTIONS)).toBe(INSTRUCTIONS_SHA256);
    const nfc = 'Pago a Jos\u00e9';
    expect(await instructionsSha256(nfc)).toBe(createHash('sha256').update(nfc, 'utf8').digest('hex'));
    expect(await instructionsSha256(nfc.normalize('NFD'))).not.toBe(await instructionsSha256(nfc));
    expect(await instructionsSha256(`${INSTRUCTIONS} `)).not.toBe(INSTRUCTIONS_SHA256);
  });

  it('holds only for the attested text', async () => {
    expect(await instructionsMatch(INSTRUCTIONS, TERMS)).toBe(true);
    expect(await instructionsMatch('Zelle to thief@example.test, memo: the trade code.', TERMS)).toBe(false);
    expect(await instructionsMatch(`${INSTRUCTIONS}\n`, TERMS)).toBe(false);
    expect(await instructionsMatch('', TERMS)).toBe(false);
    // An offer that gave no instructions: the empty text is attested and matches.
    const none = { ...TERMS, deal: { ...TERMS.deal, instructionsSha256: await instructionsSha256('') } };
    expect(await instructionsMatch('', none)).toBe(true);
    expect(await instructionsMatch(INSTRUCTIONS, none)).toBe(false);
  });

  it('fails closed on a malformed hash or a non-string text', async () => {
    for (const h of [INSTRUCTIONS_SHA256.toUpperCase(), '', 'x'.repeat(64), INSTRUCTIONS_SHA256.slice(2)]) {
      expect(await instructionsMatch(INSTRUCTIONS, { ...TERMS, deal: { ...TERMS.deal, instructionsSha256: h } })).toBe(false);
    }
    expect(await instructionsMatch(null as unknown as string, TERMS)).toBe(false);
    expect(await instructionsMatch(undefined as unknown as string, TERMS)).toBe(false);
  });
});

// Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): an optional `lienRecovery` in the terms.
describe('attested lien recovery', () => {
  const CREDITOR = '4'.padEnd(95, 'C');
  const REC = { address: CREDITOR, amountAtomic: '100000000000' }; // 0.1 XMR

  it('isAttestedTerms accepts terms with or without a well-formed lienRecovery, nothing else', () => {
    expect(isAttestedTerms(TERMS)).toBe(true);
    expect(isAttestedTerms({ ...TERMS, lienRecovery: REC })).toBe(true);
    for (const bad of [{}, { address: CREDITOR }, { ...REC, amountAtomic: '0' }, { ...REC, amountAtomic: '01' }, { ...REC, address: '' }, { ...REC, extra: 1 }, null]) {
      expect(isAttestedTerms({ ...TERMS, lienRecovery: bad })).toBe(false);
    }
  });

  it('the buyer (the debtor) accepts only the recovery it confirmed; none confirmed means none attested', async () => {
    const t = await buildTrade();
    const a: Attestation = { ...t.attestation, terms: { ...TERMS, lienRecovery: REC } };
    const sig = resign(t, a);
    await expect(verifyAttestation(a, sig, t.modSign.public, meOf(t, 'buyer'))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(a, sig, t.modSign.public, meOf(t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: 99_999_999_999n } }))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(a, sig, t.modSign.public, meOf(t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: 100_000_000_000n } }))).resolves.toBeUndefined();
    // A confirmed recovery the terms do not carry is also refused.
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: 100_000_000_000n } }))).rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('the seller is not asked to confirm the buyer’s recovery (it costs the seller nothing)', async () => {
    const t = await buildTrade();
    const a: Attestation = { ...t.attestation, terms: { ...TERMS, lienRecovery: REC } };
    await expect(verifyAttestation(a, resign(t, a), t.modSign.public, meOf(t, 'seller'))).resolves.toBeUndefined();
  });
});

// Review B1 and B3 (2026-11-16), provisional owner answers Q1/Q5 (17 Nov): neither device accepts
// signed terms whose recovery could not be paid by an honest release: above 90% of the buyer's
// proceeds, leaving the buyer less than the largest network fee + 0.01 XMR, under 0.01 XMR, or to
// one of the trade's own addresses.
describe('attested lien recovery limits (review B1, B3)', () => {
  const CREDITOR = '4'.padEnd(95, 'C');
  // TERMS: a seller's ad of 0.25 XMR, so the buyer's proceeds are 0.25 XMR and the cap 90%: 0.225 XMR.
  const CAP = 225_000_000_000n;
  const signed = async (amountAtomic: bigint, address = CREDITOR) => {
    const t = await buildTrade();
    const a: Attestation = { ...t.attestation, terms: { ...TERMS, lienRecovery: { address, amountAtomic: amountAtomic.toString() } } };
    return { t, a, sig: resign(t, a) };
  };

  it('both devices accept the cap and refuse one atomic unit more', async () => {
    const ok = await signed(CAP);
    await expect(verifyAttestation(ok.a, ok.sig, ok.t.modSign.public, meOf(ok.t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: CAP } }))).resolves.toBeUndefined();
    await expect(verifyAttestation(ok.a, ok.sig, ok.t.modSign.public, meOf(ok.t, 'seller'))).resolves.toBeUndefined();
    const over = await signed(CAP + 1n);
    await expect(verifyAttestation(over.a, over.sig, over.t.modSign.public, meOf(over.t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: CAP + 1n } }))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(over.a, over.sig, over.t.modSign.public, meOf(over.t, 'seller'))).rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('both devices refuse a recovery to the buyer\'s payout or the seller\'s refund address', async () => {
    for (const address of [BUYER_PAYOUT, SELLER_REFUND]) {
      const s = await signed(100_000_000_000n, address);
      await expect(verifyAttestation(s.a, s.sig, s.t.modSign.public, meOf(s.t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: 100_000_000_000n } }))).rejects.toMatchObject({ code: 'wrong-terms' });
      await expect(verifyAttestation(s.a, s.sig, s.t.modSign.public, meOf(s.t, 'seller'))).rejects.toMatchObject({ code: 'wrong-terms' });
    }
  });
});

// Q5 (provisional, 17 Nov) and review B1's compromised API: a recovery under 0.01 XMR is never paid,
// and a buyer who accepted none (or another figure) refuses a recovery the API had signed in.
describe('attested lien recovery: Q5 floor and an API that injects or inflates a recovery (review B1)', () => {
  const CREDITOR = '4'.padEnd(95, 'C');
  const signed = async (amountAtomic: bigint) => {
    const t = await buildTrade();
    const a: Attestation = { ...t.attestation, terms: { ...TERMS, lienRecovery: { address: CREDITOR, amountAtomic: amountAtomic.toString() } } };
    return { t, a, sig: resign(t, a) };
  };

  it('both devices refuse a recovery under 0.01 XMR', async () => {
    const s = await signed(9_999_999_999n);
    await expect(verifyAttestation(s.a, s.sig, s.t.modSign.public, meOf(s.t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: 9_999_999_999n } }))).rejects.toMatchObject({ code: 'wrong-terms' });
    await expect(verifyAttestation(s.a, s.sig, s.t.modSign.public, meOf(s.t, 'seller'))).rejects.toMatchObject({ code: 'wrong-terms' });
  });

  it('injected: a buyer who accepted no recovery refuses one; inflated: a buyer who accepted 0.05 XMR refuses 0.06', async () => {
    const injected = await signed(100_000_000_000n);
    await expect(verifyAttestation(injected.a, injected.sig, injected.t.modSign.public, meOf(injected.t, 'buyer'))).rejects.toMatchObject({ code: 'wrong-terms' });
    const inflated = await signed(60_000_000_000n);
    await expect(
      verifyAttestation(inflated.a, inflated.sig, inflated.t.modSign.public, meOf(inflated.t, 'buyer', { deal: { ...DEAL, lienRecoveryAtomic: 50_000_000_000n } })),
    ).rejects.toMatchObject({ code: 'wrong-terms' });
  });
});
