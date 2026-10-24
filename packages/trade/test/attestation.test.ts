import { createHash } from 'node:crypto';
import { ROLES } from '@x2f/core';
import { canonicalJson, generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AttestationError,
  attestationBytes,
  channelFor,
  escrowCheckWords,
  verifyAttestation,
  WORDLIST,
  type Attestation,
} from '../src/index.js';

const TRADE = 'AB12-CD34-EF56-GH78';

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

/** What the verifying app knows about itself: its trade, its role and both of its public keys. */
function meOf(t: Built, role: 'buyer' | 'seller' = 'buyer', over: Partial<{ trade: string; signPublic: string; boxPublic: string; context: 'trade' | 'chat' }> = {}) {
  const id = role === 'buyer' ? t.buyer : t.seller;
  return { trade: TRADE, role, signPublic: id.signPublic, boxPublic: id.boxPublic, ...over };
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
    const chat: Attestation = { ...t.attestation, channels: { chat: await channelFor(TRADE, 'chat') } };
    await expect(verifyAttestation(chat, resign(t, chat), t.modSign.public, meOf(t, 'buyer', { context: 'chat' }))).resolves.toBeUndefined();
    // A trade attestation is not a chat attestation, and vice versa.
    await expect(verifyAttestation(t.attestation, t.sig, t.modSign.public, meOf(t, 'buyer', { context: 'chat' }))).rejects.toMatchObject({ code: 'wrong-channel' });
    await expect(verifyAttestation(chat, resign(t, chat), t.modSign.public, meOf(t))).rejects.toMatchObject({ code: 'wrong-channel' });
  });

  it('throws bad-signature for a malformed attestation', async () => {
    const t = await buildTrade();
    const broken = { ...t.attestation, v: 2 } as unknown as Attestation;
    await expect(verifyAttestation(broken, t.sig, t.modSign.public, meOf(t))).rejects.toBeInstanceOf(AttestationError);
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
