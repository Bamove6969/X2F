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
 *
 * Payment instructions (Task 34 review I1, restored for flex offers after J-16 dropped it): the deal
 * carries the method chosen at take (`methodId`) and the SHA-256 of that method's instructions for
 * the trade's currency, as locked in the trade record (`instructionsSha256`, lower-case hex over the
 * UTF-8 text, exactly, with no trimming or normalising). The instructions reach a device only
 * through the unsigned TradeView, so a device shows them only when `instructionsMatch` holds and the
 * view's method is the attested one; an API that serves other payment details is caught. The
 * confirmed deal carries neither (the taker never sees the instructions before the take), so
 * `verifyAttestation` checks their form, and the method only when the app passes the one it was shown.
 */
export interface AttestedTerms {
  deal: {
    poster: 'buyer' | 'seller';
    takeAmountAtomic: string;
    currency: string;
    centsPerXmr: string;
    maxFiatCents: string;
    methodId: string;
    instructionsSha256: string;
  };
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
const MAX_METHOD_ID = 64;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Lower-case hex SHA-256 of the UTF-8 payment instructions, as `AttestedTerms.deal.instructionsSha256` carries it. */
export async function instructionsSha256(text: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The payment instructions a device was shown are exactly the ones the moderator attested for this
 * trade (Task 34 review I1). A device shows instructions only when this holds, and otherwise warns;
 * it never shows unattested payment details. False for a non-string text or a malformed hash.
 */
export async function instructionsMatch(text: string, terms: Pick<AttestedTerms, 'deal'>): Promise<boolean> {
  const want = terms?.deal?.instructionsSha256;
  if (typeof text !== 'string' || typeof want !== 'string' || !SHA256_HEX.test(want)) return false;
  return (await instructionsSha256(text)) === want;
}

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
  if (!isRecord(d) || !exactKeys(d, ['poster', 'takeAmountAtomic', 'currency', 'centsPerXmr', 'maxFiatCents', 'methodId', 'instructionsSha256'])) return false;
  if (d.poster !== 'buyer' && d.poster !== 'seller') return false;
  if (typeof d.methodId !== 'string' || d.methodId.length === 0 || d.methodId.length > MAX_METHOD_ID) return false;
  if (typeof d.instructionsSha256 !== 'string' || !SHA256_HEX.test(d.instructionsSha256)) return false;
  if (typeof d.currency !== 'string' || d.currency.length === 0 || d.currency.length > MAX_CURRENCY) return false;
  return [d.takeAmountAtomic, d.centsPerXmr, d.maxFiatCents].every((x) => typeof x === 'string' && DECIMAL.test(x));
}

/** The attested deal equals the confirmed one, field by field (the method and the instructions hash are not in the confirmed deal: see `AttestedTerms`). */
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

/**
 * `wrong-terms`: the attested deal or this app's own address is not what its user confirmed (lead answer 4).
 * `bad-time`: a validly signed attestation whose `issuedAt` is in this device's future (beyond
 * ATTESTATION_CLOCK_SKEW_MS), before this device made the identity it names, or before the trade
 * was taken (review multisig-vs-RetoSwap F5, review lead-escrow-harden M1).
 */
export type AttestationErrorCode = 'bad-signature' | 'not-me' | 'wrong-trade' | 'wrong-channel' | 'wrong-terms' | 'bad-time';

/**
 * How far apart the moderation service's clock (which sets `issuedAt`) and this device's or the
 * API's may be. An attestation issued more than this in the device's future, or more than this
 * before this device made its identity or before the trade's take time, is refused (`bad-time`).
 */
export const ATTESTATION_CLOCK_SKEW_MS = 10 * 60_000;

/**
 * One moderation attestation key this app trusts, with the `issuedAt` range it signs for (ISO
 * times, inclusive; null = no bound). A key that is rotated out gets a `notAfter`, and its
 * successor a `notBefore`. The range alone does NOT stop a holder of a rotated-out key: `issuedAt`
 * is whatever the signer writes, so a thief simply backdates it into the old window (review
 * lead-escrow-harden M1). What refuses that is the lower bound this device knows itself:
 * `issuedAt` may not be older than the per-trade identity the attestation names
 * (`AttestationSelf.identityCreatedAt`), and a new trade's identity is always new. So the old key
 * can no longer attest a trade or chat whose identity was made after its `notAfter` (plus the
 * skew), while what it signed before stays valid. Not a revocation: an attestation it signed for
 * an identity made inside its window is still accepted.
 */
export interface AttestationKey {
  signPublic: string;
  notBefore: string | null;
  notAfter: string | null;
}

/**
 * The attestation keys built into this app (review F5). Today exactly one: the build's moderation
 * signing key (VITE_MOD_SIGNING_PUBLIC), valid without bounds, so nothing changes. To rotate: add
 * the new key with a `notBefore` and give this one a `notAfter`.
 */
export function attestationKeys(modSigningPublic: string): readonly AttestationKey[] {
  return [{ signPublic: modSigningPublic, notBefore: null, notAfter: null }];
}

/** An ISO time exactly as `Date.prototype.toISOString` writes it (how moderation writes issuedAt); NaN otherwise. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function isoMs(t: unknown): number {
  if (typeof t !== 'string' || !ISO_TIME.test(t)) return Number.NaN;
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString() === t ? ms : Number.NaN;
}

/** A key list entry of the right shape whose range holds `issuedMs`. */
function keyCovers(k: unknown, issuedMs: number): k is AttestationKey {
  if (typeof k !== 'object' || k === null) return false;
  const o = k as Record<string, unknown>;
  if (typeof o.signPublic !== 'string' || !HEX_KEY.test(o.signPublic)) return false;
  for (const bound of [o.notBefore, o.notAfter]) if (bound !== null && Number.isNaN(isoMs(bound))) return false;
  if (o.notBefore !== null && issuedMs < isoMs(o.notBefore)) return false;
  if (o.notAfter !== null && issuedMs > isoMs(o.notAfter)) return false;
  return true;
}

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
  if (o.v !== 1 || typeof o.trade !== 'string' || Number.isNaN(isoMs(o.issuedAt))) return false;
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
  /**
   * Trade context, optional: the payment method this app was shown for the trade (the API's trade
   * view). When given, the attested `deal.methodId` must equal it (`wrong-terms`). Not given: the
   * attested value is only checked for shape.
   */
  methodId?: string;
  /** This device's clock (ms) for the `issuedAt` check; default Date.now(). */
  now?: number;
  /**
   * Required (review lead-escrow-harden M1): when this device made the per-trade (or per-chat)
   * identity named in its slot, on its own clock (ms), as kept in its record since before the API
   * saw the identity. An `issuedAt` more than ATTESTATION_CLOCK_SKEW_MS before it is refused
   * (`bad-time`): the attestation names that identity, so it cannot be older. Left out, or not a
   * finite time of at least 0: `bad-time`. `null` only for a record written before the time was
   * kept: then there is no lower bound, which is accepted only when the key that verified has no
   * validity bounds (today's single key); with a bounded key it is `bad-time`.
   */
  identityCreatedAt: number | null;
  /**
   * Trade context, optional, an extra check only: the trade's take time this app was shown (the
   * API's unsigned trade view, an ISO time). When given, an `issuedAt` more than
   * ATTESTATION_CLOCK_SKEW_MS before it is refused (`bad-time`): an attestation cannot be older
   * than its trade. Given but unreadable: `bad-time`. A lying API can leave it out or choose it,
   * so it is never the lower bound that matters: `identityCreatedAt` is.
   */
  takenAt?: string;
}

/**
 * Verify an attestation a trader received: throws nothing on success, an `AttestationError`
 * otherwise. Checks, in order: the moderation signature over `attestationBytes` with a pinned key
 * whose validity range holds `issuedAt` (`bad-signature`, also for any malformed input, an
 * `issuedAt` that is not a canonical ISO time included); `keys` is the pinned list
 * (attestationKeys), or one bare key, which is valid without bounds; that `me`'s slot holds BOTH of its keys
 * (`not-me`); that the attestation is for `me.trade` (`wrong-trade`); and that the channels are
 * EXACTLY the set for the context (trade: escrow + signals; chat: chat), each equal to
 * `channelFor(trade, kind)` (`wrong-channel`); and, for a trade, that `terms` are present and their
 * deal and this app's own address equal `me.deal` and `me.ownAddress`, both required, and their
 * `payWindowMin` equals `me.payWindowMin` when that is given (`wrong-terms`).
 * A chat attestation must carry no terms (`wrong-terms`). Last, `issuedAt` (review F5, M1): no more
 * than ATTESTATION_CLOCK_SKEW_MS in the future of `me.now`, nor before `me.identityCreatedAt` (required;
 * null: see there) or `me.takenAt` by more than that (`bad-time`). There is no maximum age: a stored attestation is verified again on every
 * start, however long its trade lasts (a dispute may run for months).
 *
 * Deviation from the plan's signature (review of Task 8): `me` also carries `trade`, `boxPublic`
 * and an optional `context`, so a validly signed attestation for another trade, a partial channel
 * set, or a slot with my signing key but someone else's box key is refused.
 */
export async function verifyAttestation(
  a: Attestation,
  sig: string,
  keys: string | readonly AttestationKey[],
  me: AttestationSelf,
): Promise<void> {
  await sodium.ready;
  const pinned: readonly unknown[] = typeof keys === 'string' ? [{ signPublic: keys, notBefore: null, notAfter: null }] : Array.isArray(keys) ? keys : [];
  if (!wellFormed(a) || typeof sig !== 'string') throw new AttestationError('bad-signature');
  const issuedMs = isoMs(a.issuedAt);
  let ok = false;
  /** The key list entry that verified the signature (its bounds decide what a missing identity time allows). */
  let signedBy: AttestationKey | null = null;
  try {
    const sigBytes = sodium.from_hex(sig);
    if (sigBytes.length === sodium.crypto_sign_BYTES) {
      const bytes = attestationBytes(a);
      for (const k of pinned) {
        if (keyCovers(k, issuedMs) && sodium.crypto_sign_verify_detached(sigBytes, bytes, sodium.from_hex(k.signPublic))) {
          ok = true;
          signedBy = k;
          break;
        }
      }
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
  } else {
    const t = a.terms;
    if (t === undefined || !isRecord(me.deal) || typeof me.ownAddress !== 'string' || me.ownAddress === '') throw new AttestationError('wrong-terms');
    if (!sameDeal(t.deal, me.deal)) throw new AttestationError('wrong-terms');
    if ((me.role === 'buyer' ? t.buyerPayout : t.sellerRefund) !== me.ownAddress) throw new AttestationError('wrong-terms');
    if (me.payWindowMin !== undefined && t.payWindowMin !== me.payWindowMin) throw new AttestationError('wrong-terms');
    if (me.methodId !== undefined && t.deal.methodId !== me.methodId) throw new AttestationError('wrong-terms');
  }

  const now = me.now ?? Date.now();
  if (!Number.isFinite(now) || issuedMs > now + ATTESTATION_CLOCK_SKEW_MS) throw new AttestationError('bad-time');
  // Review M1: the lower bound this device knows itself. Required; null only for an old record,
  // and then only with a key that has no bounds (where a lower bound would change nothing).
  const made: unknown = me.identityCreatedAt;
  if (made === null) {
    if (signedBy === null || signedBy.notBefore !== null || signedBy.notAfter !== null) throw new AttestationError('bad-time');
  } else if (typeof made !== 'number' || !Number.isFinite(made) || made < 0 || issuedMs < made - ATTESTATION_CLOCK_SKEW_MS) {
    throw new AttestationError('bad-time');
  }
  if (me.takenAt !== undefined) {
    const taken = isoMs(me.takenAt);
    if (Number.isNaN(taken) || issuedMs < taken - ATTESTATION_CLOCK_SKEW_MS) throw new AttestationError('bad-time');
  }
}
