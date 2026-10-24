import { normalizeTradeCode, ROLES, type Role } from '@x2f/core';
import { canonicalJson, type Participants, type PublicKeys } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { channelFor, CHANNEL_KINDS, type ChannelKind } from './channels.js';

/**
 * The moderation service's signed statement of who the three parties to a trade are and which
 * relay channels the trade uses. Each trader app verifies it against the pinned moderation signing
 * key and checks that its own slot holds its own key, so a relay or API that swapped a participant
 * is caught before the escrow is funded (P3-C1).
 *
 * A trade gets `escrow` and `signals`; a chat gets `chat`. Every channel value must equal
 * `channelFor(trade, kind)`.
 */
export interface Attestation {
  v: 1;
  trade: string;
  channels: Partial<Record<ChannelKind, string>>;
  participants: Participants;
  issuedAt: string;
}

const DOMAIN = 'x2f/attestation/v1\0';
const HEX_KEY = /^[0-9a-f]{64}$/;

/** The bytes the moderation key signs: the domain, then canonical JSON of the whole attestation. */
export function attestationBytes(a: Attestation): Uint8Array {
  return new TextEncoder().encode(DOMAIN + canonicalJson(a));
}

export type AttestationErrorCode = 'bad-signature' | 'not-me' | 'wrong-trade' | 'wrong-channel';

export class AttestationError extends Error {
  constructor(readonly code: AttestationErrorCode) {
    super(code);
    this.name = 'AttestationError';
  }
}

function isPublicKeys(x: unknown): x is PublicKeys {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.signPublic === 'string' && HEX_KEY.test(o.signPublic) && typeof o.boxPublic === 'string' && HEX_KEY.test(o.boxPublic);
}

/** Shape, key encodings and that no two roles share a signing key; anything off → untrusted. */
function wellFormed(a: unknown): a is Attestation {
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return false;
  const o = a as Record<string, unknown>;
  if (o.v !== 1 || typeof o.trade !== 'string' || typeof o.issuedAt !== 'string') return false;
  if (typeof o.participants !== 'object' || o.participants === null) return false;
  const parts = o.participants as Record<string, unknown>;
  if (Object.keys(parts).length !== ROLES.length) return false;
  const seen = new Set<string>();
  for (const r of ROLES) {
    const p = parts[r];
    if (!isPublicKeys(p)) return false;
    if (seen.has(p.signPublic)) return false;
    seen.add(p.signPublic);
  }
  if (typeof o.channels !== 'object' || o.channels === null || Array.isArray(o.channels)) return false;
  const channels = o.channels as Record<string, unknown>;
  for (const [kind, value] of Object.entries(channels)) {
    if (!(CHANNEL_KINDS as readonly string[]).includes(kind) || typeof value !== 'string') return false;
  }
  return true;
}

/**
 * Verify an attestation a trader received: throws nothing on success, an `AttestationError`
 * otherwise. Checks, in order: the moderation signature over `attestationBytes` with the pinned
 * key (`bad-signature`, also for any malformed input); that `me` occupies its own slot
 * (`not-me`); that the trade code is valid (`wrong-trade`); and that every channel value equals
 * `channelFor(trade, kind)` (`wrong-channel`).
 */
export async function verifyAttestation(
  a: Attestation,
  sig: string,
  modSigningPublic: string,
  me: { role: 'buyer' | 'seller'; signPublic: string },
): Promise<void> {
  await sodium.ready;
  if (!wellFormed(a) || typeof sig !== 'string' || typeof modSigningPublic !== 'string' || !HEX_KEY.test(modSigningPublic)) {
    throw new AttestationError('bad-signature');
  }
  let ok = false;
  try {
    const sigBytes = sodium.from_hex(sig);
    if (sigBytes.length === sodium.crypto_sign_BYTES) {
      ok = sodium.crypto_sign_verify_detached(sigBytes, attestationBytes(a), sodium.from_hex(modSigningPublic));
    }
  } catch {
    ok = false;
  }
  if (!ok) throw new AttestationError('bad-signature');

  const slot = a.participants[me.role as Role];
  if (slot === undefined || slot.signPublic.toLowerCase() !== me.signPublic.toLowerCase()) {
    throw new AttestationError('not-me');
  }
  if (normalizeTradeCode(a.trade) === null) throw new AttestationError('wrong-trade');
  for (const kind of Object.keys(a.channels) as ChannelKind[]) {
    if (a.channels[kind] !== (await channelFor(a.trade, kind))) throw new AttestationError('wrong-channel');
  }
}
