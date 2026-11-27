import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, identityProofValid, isAttestedTerms, type Attestation, type AttestedTerms } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import type { ChatWorkItem, WorkItem } from './link.js';

/**
 * Attesting one trade: the moderation service checks both traders' proofs of possession itself
 * (it does not take the API's word), generates the moderator's own trade identity, and signs the
 * participant list with the long-term moderation signing key. The API never chooses the mod key:
 * a participant list the API made up can only ever be signed with a moderator identity minted
 * here, and a trader whose own key is not in its slot rejects it (`not-me`). The attestation also
 * signs the trade record's terms (deal, time to pay and both addresses, lead answer 4), which each trader checks
 * against what its user confirmed (`wrong-terms`).
 */
export interface Attested {
  attestation: Attestation;
  /** Hex Ed25519 signature by the moderation signing key over `attestationBytes`. */
  sig: string;
  mod: Identity;
  participants: Participants;
}

/**
 * Work whose terms are missing or malformed (review M3): an API bug or a deploy skew (moderation
 * rolled out before the API serves `terms`), never the traders' doing. Logged and skipped, never a
 * final refusal; the work list's rotation keeps it from holding other trades back.
 */
export class BadTerms extends Error {
  constructor() {
    super('bad-terms');
    this.name = 'BadTerms';
  }
}

export class AttestRefused extends Error {
  constructor(readonly reason: 'bad-proof' | 'bad-work') {
    super(reason);
    this.name = 'AttestRefused';
  }
}

/**
 * Both proofs must verify for their own role and this trade and the two keys must differ (else a
 * final AttestRefused); then the terms must be well formed (else BadTerms, a skip).
 */
export async function checkWork(w: WorkItem): Promise<void> {
  if (typeof w?.trade !== 'string' || typeof w.participants !== 'object' || w.participants === null) throw new AttestRefused('bad-work');
  const { buyer, seller } = w.participants;
  if (!buyer || !seller || buyer.signPublic === seller.signPublic) throw new AttestRefused('bad-work');
  if (!(await identityProofValid(w.trade, 'buyer', buyer)) || !(await identityProofValid(w.trade, 'seller', seller))) {
    throw new AttestRefused('bad-proof');
  }
  if (!isAttestedTerms(w.terms)) throw new BadTerms();
}

/** Sign an attestation for `participants` (which already include this service's mod identity) and the trade's terms. */
export async function signAttestation(
  trade: string,
  participants: Participants,
  terms: AttestedTerms,
  signingSecret: Uint8Array,
  issuedAt: Date,
): Promise<{ attestation: Attestation; sig: string }> {
  await sodium.ready;
  const attestation: Attestation = {
    v: 1,
    trade,
    channels: { escrow: await channelFor(trade, 'escrow'), signals: await channelFor(trade, 'signals') },
    participants,
    issuedAt: issuedAt.toISOString(),
    terms: {
      deal: { ...terms.deal },
      payWindowMin: terms.payWindowMin,
      buyerPayout: terms.buyerPayout,
      sellerRefund: terms.sellerRefund,
      // Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): signed only when present.
      ...(terms.lienRecovery !== undefined ? { lienRecovery: { address: terms.lienRecovery.address, amountAtomic: terms.lienRecovery.amountAtomic } } : {}),
      // Owner 27 Nov 2026: a selling debtor's extra, signed only when present (checked first: lienRecovery.ts).
      ...(terms.sellerLienRecovery !== undefined ? { sellerLienRecovery: { address: terms.sellerLienRecovery.address, amountAtomic: terms.sellerLienRecovery.amountAtomic } } : {}),
    },
  };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), signingSecret));
  return { attestation, sig };
}

/** Verify the work item, mint the moderator identity and sign the attestation. */
export async function attestTrade(
  w: WorkItem,
  signingSecret: Uint8Array,
  issuedAt: Date,
  newIdentity: () => Promise<Identity> = generateIdentity,
): Promise<Attested> {
  await checkWork(w);
  const mod = await newIdentity();
  const participants: Participants = {
    buyer: { signPublic: w.participants.buyer.signPublic, boxPublic: w.participants.buyer.boxPublic },
    seller: { signPublic: w.participants.seller.signPublic, boxPublic: w.participants.seller.boxPublic },
    mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
  };
  const { attestation, sig } = await signAttestation(w.trade, participants, w.terms, signingSecret, issuedAt);
  return { attestation, sig, mod, participants };
}

/** A chat's work item: both chat-identity proofs (the x2f/chat-identity/v1 domain, never the trade one) and two different keys. */
export async function checkChatWork(w: ChatWorkItem): Promise<void> {
  if (typeof w?.chat !== 'string' || typeof w.participants !== 'object' || w.participants === null) throw new AttestRefused('bad-work');
  const { buyer, seller } = w.participants;
  if (!buyer || !seller || buyer.signPublic === seller.signPublic || buyer.boxPublic === seller.boxPublic) throw new AttestRefused('bad-work');
  if (!(await chatIdentityProofValid(w.chat, 'buyer', buyer)) || !(await chatIdentityProofValid(w.chat, 'seller', seller))) {
    throw new AttestRefused('bad-proof');
  }
}

/**
 * Attesting one chat (Task 20): the same rule as a trade, with the chat channel only and no terms.
 * The moderator's chat identity is minted here, so the API can never choose who reads the chat.
 */
export async function attestChat(
  w: ChatWorkItem,
  signingSecret: Uint8Array,
  issuedAt: Date,
  newIdentity: () => Promise<Identity> = generateIdentity,
): Promise<Attested> {
  await checkChatWork(w);
  await sodium.ready;
  const mod = await newIdentity();
  const participants: Participants = {
    buyer: { signPublic: w.participants.buyer.signPublic, boxPublic: w.participants.buyer.boxPublic },
    seller: { signPublic: w.participants.seller.signPublic, boxPublic: w.participants.seller.boxPublic },
    mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
  };
  const attestation: Attestation = {
    v: 1,
    trade: w.chat,
    channels: { chat: await channelFor(w.chat, 'chat') },
    participants,
    issuedAt: issuedAt.toISOString(),
  };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), signingSecret));
  return { attestation, sig, mod, participants };
}
