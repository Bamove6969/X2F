import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, identityProofValid, type Attestation } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import type { WorkItem } from './link.js';

/**
 * Attesting one trade: the moderation service checks both traders' proofs of possession itself
 * (it does not take the API's word), generates the moderator's own trade identity, and signs the
 * participant list with the long-term moderation signing key. The API never chooses the mod key:
 * a participant list the API made up can only ever be signed with a moderator identity minted
 * here, and a trader whose own key is not in its slot rejects it (`not-me`).
 */
export interface Attested {
  attestation: Attestation;
  /** Hex Ed25519 signature by the moderation signing key over `attestationBytes`. */
  sig: string;
  mod: Identity;
  participants: Participants;
}

export class AttestRefused extends Error {
  constructor(readonly reason: 'bad-proof' | 'bad-work') {
    super(reason);
    this.name = 'AttestRefused';
  }
}

/** Both proofs must verify for their own role and this trade, and the two keys must differ. */
export async function checkWork(w: WorkItem): Promise<void> {
  if (typeof w?.trade !== 'string' || typeof w.participants !== 'object' || w.participants === null) throw new AttestRefused('bad-work');
  const { buyer, seller } = w.participants;
  if (!buyer || !seller || buyer.signPublic === seller.signPublic) throw new AttestRefused('bad-work');
  if (!(await identityProofValid(w.trade, 'buyer', buyer)) || !(await identityProofValid(w.trade, 'seller', seller))) {
    throw new AttestRefused('bad-proof');
  }
}

/** Sign an attestation for `participants` (which already include this service's mod identity). */
export async function signAttestation(trade: string, participants: Participants, signingSecret: Uint8Array, issuedAt: Date): Promise<{ attestation: Attestation; sig: string }> {
  await sodium.ready;
  const attestation: Attestation = {
    v: 1,
    trade,
    channels: { escrow: await channelFor(trade, 'escrow'), signals: await channelFor(trade, 'signals') },
    participants,
    issuedAt: issuedAt.toISOString(),
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
  const { attestation, sig } = await signAttestation(w.trade, participants, signingSecret, issuedAt);
  return { attestation, sig, mod, participants };
}
