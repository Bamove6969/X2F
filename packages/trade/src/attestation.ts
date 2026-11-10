import { normalizeTradeCode, ROLES, type Role } from '@x2f/core';
import { canonicalJson, type Participants, type PublicKeys } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { channelFor, CHANNEL_KINDS, type ChannelKind } from './channels.js';
import { MAX_PAY_WINDOW_MIN } from './machine.js';

/**
 * The moderation service's signed statement of who the three parties to a trade are and which
 * relay channels the trade uses. Each trader app verifies it against the pinned moderation signing
 * key and checks that its own slot holds its own key, so a relay or API that swapped a participant
 * is caught before the escrow is funded (P3-C1).
 *
 * A trade gets `escrow` and `signals`; a chat gets `chat`. Every channel value must equal
 * `channelFor(trade, kind)`. A trade attestation also carries the attested `terms` (lead answer 4);
 * a chat attestation carries none.
 */
export interface Attestation {
  v: 1;
  trade: string;
  channels: Partial<Record<ChannelKind, string>>;
  participants: Participants;
  issuedAt: string;
  terms?: AttestedTerms;
}

/**
 * What the moderator attests about the deal (lead answer 4, docs/coordination.md): the deal fixed
 * at take, the buyer's time to pay fixed at take, and both sides' addresses, filled from the trade
 * record. Bigints are decimal strings without leading zeros (canonical JSON has no bigints); the
 * key sets are exact.
 */
export interface AttestedTerms {
  deal: { poster: 'buyer' | 'seller'; takeAmountAtomic: string; currency: string; centsPerXmr: string; maxFiatCents: string };
  /**
   * The buyer's time to pay in minutes, the payment method's, fixed at take (`Trade.payWindowMin`,
   * owner p9-6): an integer from 1 to MAX_PAY_WINDOW_MIN. The moderation service's shadow trade
   * runs on it, so it never co-signs a seller's refund before the buyer's own time to pay is over.
   */
  payWindowMin: number;
  /** The buyer's payout address. */
  buyerPayout: string;
  /** The seller's refund address. */
  sellerRefund: string;
}

/** The deal as the user confirmed it on the device (bigints): the amount at take, the poster, and the locked rate and offer maximum fixed at take (OD-5). */
export interface ConfirmedDeal {
  poster: 'buyer' | 'seller';
  takeAmountAtomic: bigint;
  currency: string;
  centsPerXmr: bigint;
  maxFiatCents: bigint;
}

const DECIMAL = /^[1-9]\d{0,30}$/;
const MAX_ADDRESS = 256;
const MAX_CURRENCY = 16;

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A time to pay as the trade machine allows it: whole minutes, 1 to MAX_PAY_WINDOW_MIN. */
function isPayWindowMin(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 1 && x <= MAX_PAY_WINDOW_MIN;
}

/** Exactly the `AttestedTerms` shape: exact key sets, positive decimal strings, a valid time to pay, non-empty bounded strings. */
export function isAttestedTerms(t: unknown): t is AttestedTerms {
  if (!isRecord(t) || !exactKeys(t, ['deal', 'payWindowMin', 'buyerPayout', 'sellerRefund'])) return false;
  if (!isPayWindowMin(t.payWindowMin)) return false;
  for (const a of [t.buyerPayout, t.sellerRefund]) if (typeof a !== 'string' || a.length === 0 || a.length > MAX_ADDRESS) return false;
  const d = t.deal;
  if (!isRecord(d) || !exactKeys(d, ['poster', 'takeAmountAtomic', 'currency', 'centsPerXmr', 'maxFiatCents'])) return false;
  if (d.poster !== 'buyer' && d.poster !== 'seller') return false;
  if (typeof d.currency !== 'string' || d.currency.length === 0 || d.currency.length > MAX_CURRENCY) return false;
  return [d.takeAmountAtomic, d.centsPerXmr, d.maxFiatCents].every((x) => typeof x === 'string' && DECIMAL.test(x));
}

/** The attested deal equals the confirmed one, field by field. */
function sameDeal(t: AttestedTerms['deal'], d: ConfirmedDeal): boolean {
  return (
    t.poster === d.poster &&
    t.currency === d.currency &&
    typeof d.takeAmountAtomic === 'bigint' && t.takeAmountAtomic === d.takeAmountAtomic.toString() &&
    typeof d.centsPerXmr === 'bigint' && t.centsPerXmr === d.centsPerXmr.toString() &&
    typeof d.maxFiatCents === 'bigint' && t.maxFiatCents === d.maxFiatCents.toString()
  );
}

const DOMAIN = 'x2f/attestation/v1\0';
const IDENTITY_DOMAIN = 'x2f/trade-identity/v1\0';
const HEX_KEY = /^[0-9a-f]{64}$/;

/**
 * The bytes a trader signs with its trade identity when registering it (proof of possession):
 * `x2f/trade-identity/v1\0` + code + `\0` + role + `\0` + signPublic + boxPublic (hex strings).
 * The code and role bind the proof to one slot of one trade. The API checks it on registration and
 * the moderation service checks it again before attesting.
 */
export function identityProofBytes(code: string, role: 'buyer' | 'seller', signPublic: string, boxPublic: string): Uint8Array {
  return new TextEncoder().encode(`${IDENTITY_DOMAIN}${code}\0${role}\0${signPublic}${boxPublic}`);
}

/**
 * True when `proof` (hex Ed25519 signature) verifies under `signPublic` over `identityProofBytes`
 * and `boxPublic` is the X25519 conversion of `signPublic`. Never throws.
 */
export async function identityProofValid(
  code: string,
  role: 'buyer' | 'seller',
  keys: { signPublic: string; boxPublic: string; proof: string },
): Promise<boolean> {
  await sodium.ready;
  try {
    if (!HEX_KEY.test(keys.signPublic) || !HEX_KEY.test(keys.boxPublic) || !/^[0-9a-f]{128}$/.test(keys.proof)) return false;
    const pk = sodium.from_hex(keys.signPublic);
    if (sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(pk)) !== keys.boxPublic) return false;
    return sodium.crypto_sign_verify_detached(sodium.from_hex(keys.proof), identityProofBytes(code, role, keys.signPublic, keys.boxPublic), pk);
  } catch {
    return false;
  }
}

/** The bytes the moderation key signs: the domain, then canonical JSON of the whole attestation. */
export function attestationBytes(a: Attestation): Uint8Array {
  return new TextEncoder().encode(DOMAIN + canonicalJson(a));
}

/** `wrong-terms`: the attested deal or this app's own address is not what its user confirmed (lead answer 4). */
export type AttestationErrorCode = 'bad-signature' | 'not-me' | 'wrong-trade' | 'wrong-channel' | 'wrong-terms';

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
  if (!exactKeys(o, ['v', 'trade', 'channels', 'participants', 'issuedAt']) && !exactKeys(o, ['v', 'trade', 'channels', 'participants', 'issuedAt', 'terms'])) return false;
  if ('terms' in o && !isAttestedTerms(o.terms)) return false;
  return true;
}

/** The exact channel set an attestation must carry: a trade gets escrow + signals, a chat gets chat. */
const CHANNELS_FOR: Record<'trade' | 'chat', readonly ChannelKind[]> = { trade: ['escrow', 'signals'], chat: ['chat'] };

/** What the verifying app knows about itself, from its own state (never from the attestation). */
export interface AttestationSelf {
  /** The trade this app is in; the attestation must be for exactly this trade. */
  trade: string;
  role: 'buyer' | 'seller';
  signPublic: string;
  boxPublic: string;
  /** Which kind of attestation is expected (default 'trade'). */
  context?: 'trade' | 'chat';
  /** Trade context: the deal the user confirmed on this device. Required there (fail closed). */
  deal?: ConfirmedDeal;
  /** Trade context: this app's own address (the buyer's payout, the seller's refund). Required there. */
  ownAddress?: string;
  /**
   * Trade context, optional: the time to pay this app was shown for the trade (the API's trade
   * view). When given, the attested `payWindowMin` must equal it (`wrong-terms`), so the window the
   * moderation service enforces is the one the buyer sees. Not given: the attested value is only
   * checked for shape.
   */
  payWindowMin?: number;
}

/**
 * Verify an attestation a trader received: throws nothing on success, an `AttestationError`
 * otherwise. Checks, in order: the moderation signature over `attestationBytes` with the pinned
 * key (`bad-signature`, also for any malformed input); that `me`'s slot holds BOTH of its keys
 * (`not-me`); that the attestation is for `me.trade` (`wrong-trade`); and that the channels are
 * EXACTLY the set for the context (trade: escrow + signals; chat: chat), each equal to
 * `channelFor(trade, kind)` (`wrong-channel`); and, for a trade, that `terms` are present and their
 * deal and this app's own address equal `me.deal` and `me.ownAddress`, both required, and their
 * `payWindowMin` equals `me.payWindowMin` when that is given (`wrong-terms`).
 * A chat attestation must carry no terms (`wrong-terms`).
 *
 * Deviation from the plan's signature (review of Task 8): `me` also carries `trade`, `boxPublic`
 * and an optional `context`, so a validly signed attestation for another trade, a partial channel
 * set, or a slot with my signing key but someone else's box key is refused.
 */
export async function verifyAttestation(
  a: Attestation,
  sig: string,
  modSigningPublic: string,
  me: AttestationSelf,
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
  if (
    slot === undefined ||
    typeof me.signPublic !== 'string' || typeof me.boxPublic !== 'string' ||
    slot.signPublic !== me.signPublic.toLowerCase() ||
    slot.boxPublic !== me.boxPublic.toLowerCase()
  ) {
    throw new AttestationError('not-me');
  }

  const trade = normalizeTradeCode(a.trade);
  const expected = typeof me.trade === 'string' ? normalizeTradeCode(me.trade) : null;
  if (trade === null || expected === null || trade !== expected) throw new AttestationError('wrong-trade');

  const want = CHANNELS_FOR[me.context ?? 'trade'];
  if (want === undefined) throw new AttestationError('wrong-channel');
  const have = Object.keys(a.channels);
  if (have.length !== want.length || !want.every((k) => have.includes(k))) throw new AttestationError('wrong-channel');
  for (const kind of want) {
    if (a.channels[kind] !== (await channelFor(trade, kind))) throw new AttestationError('wrong-channel');
  }

  if ((me.context ?? 'trade') === 'chat') {
    if (a.terms !== undefined) throw new AttestationError('wrong-terms');
    return;
  }
  const t = a.terms;
  if (t === undefined || !isRecord(me.deal) || typeof me.ownAddress !== 'string' || me.ownAddress === '') throw new AttestationError('wrong-terms');
  if (!sameDeal(t.deal, me.deal)) throw new AttestationError('wrong-terms');
  if ((me.role === 'buyer' ? t.buyerPayout : t.sellerRefund) !== me.ownAddress) throw new AttestationError('wrong-terms');
  if (me.payWindowMin !== undefined && t.payWindowMin !== me.payWindowMin) throw new AttestationError('wrong-terms');
}
