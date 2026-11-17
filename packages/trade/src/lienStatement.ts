import { normalizeTradeCode } from '@x2f/core';
import { canonicalJson } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { LIEN_RECOVERY_MAX_BPS } from './payouts.js';

/**
 * Lien recovery, review B1 (security, 2026-11-16) with the provisional owner answers of 17 Nov 2026
 * (docs/lien-recovery.md). Two signed statements, both canonical JSON under a domain of their own:
 *
 * - `LienStatement`, signed by the moderation service (MOD_SIGNING_SECRET) once it has checked a lien
 *   against its own records: the lien's source trade (one it attested), that a ruling its gate
 *   verified makes `creditorSide` a creditor there, the amount (that trade's XMR) and the rate (the
 *   50% default, or a rate a senior moderator's key tap approved, verified by its gate). The
 *   account ids are the API's word, pinned on first sight: the service never signs a later statement
 *   for the same lien with other parties. It keeps the statement, and the sum it has signed into
 *   trades' terms for the lien, in its own database (apps/moderation migration 009).
 * - `RecoveryAddressStatement` (Q2), signed by the CREDITOR's own device with its trade identity
 *   from the disputed trade: "pay my recoveries from this dispute to `address`". The moderation
 *   service checks it against that identity as it attested it (never the API's word), so recoveries
 *   go only to an address the creditor chose for this purpose.
 */
export interface LienStatement {
  v: 1;
  lienId: string;
  /** The disputed trade the lien comes from. */
  fromCode: string;
  /** The creditor's side in that trade. */
  creditorSide: 'buyer' | 'seller';
  /** Account ids, as the API named them when the service first checked the lien. */
  debtor: string;
  creditor: string;
  /** What the creditor is owed in total (the source trade's XMR), a decimal string. */
  amountAtomic: string;
  /** 1..LIEN_RECOVERY_MAX_BPS. */
  rateBps: number;
  issuedAt: string;
}

export interface RecoveryAddressStatement {
  v: 1;
  fromCode: string;
  creditorSide: 'buyer' | 'seller';
  address: string;
  issuedAt: string;
}

const LIEN_DOMAIN = 'x2f/lien-statement/v1\0';
const ADDRESS_DOMAIN = 'x2f/lien-recovery-address/v1\0';
const LIEN_KEYS = ['v', 'lienId', 'fromCode', 'creditorSide', 'debtor', 'creditor', 'amountAtomic', 'rateBps', 'issuedAt'] as const;
const ADDRESS_KEYS = ['v', 'fromCode', 'creditorSide', 'address', 'issuedAt'] as const;
const ATOMIC = /^[1-9]\d{0,30}$/;
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_SIG = /^[0-9a-f]{128}$/;
const MAX_ADDRESS = 256;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};
const shortString = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const isCode = (x: unknown): x is string => typeof x === 'string' && normalizeTradeCode(x) === x;
const isTime = (x: unknown): x is string => shortString(x, 64) && !Number.isNaN(Date.parse(x));

export function isLienStatement(x: unknown): x is LienStatement {
  if (!isRecord(x) || !exactKeys(x, LIEN_KEYS) || x.v !== 1) return false;
  if (!shortString(x.lienId, 64) || !shortString(x.debtor, 64) || !shortString(x.creditor, 64) || x.debtor === x.creditor) return false;
  if (!isCode(x.fromCode) || (x.creditorSide !== 'buyer' && x.creditorSide !== 'seller') || !isTime(x.issuedAt)) return false;
  if (typeof x.amountAtomic !== 'string' || !ATOMIC.test(x.amountAtomic)) return false;
  return typeof x.rateBps === 'number' && Number.isSafeInteger(x.rateBps) && x.rateBps >= 1 && x.rateBps <= LIEN_RECOVERY_MAX_BPS;
}

export function isRecoveryAddressStatement(x: unknown): x is RecoveryAddressStatement {
  if (!isRecord(x) || !exactKeys(x, ADDRESS_KEYS) || x.v !== 1) return false;
  return isCode(x.fromCode) && (x.creditorSide === 'buyer' || x.creditorSide === 'seller') && shortString(x.address, MAX_ADDRESS) && isTime(x.issuedAt);
}

export const lienStatementBytes = (s: LienStatement): Uint8Array => new TextEncoder().encode(LIEN_DOMAIN + canonicalJson(s));
export const recoveryAddressBytes = (s: RecoveryAddressStatement): Uint8Array => new TextEncoder().encode(ADDRESS_DOMAIN + canonicalJson(s));

/** The moderation service's signature (hex) over a well-formed lien statement. */
export async function signLienStatement(s: LienStatement, signingSecret: Uint8Array): Promise<string> {
  await sodium.ready;
  if (!isLienStatement(s)) throw new TypeError('lien statement: not a well-formed statement');
  return sodium.to_hex(sodium.crypto_sign_detached(lienStatementBytes(s), signingSecret));
}

/** The creditor device's signature (hex), with its trade identity's secret key from the disputed trade. */
export async function signRecoveryAddress(s: RecoveryAddressStatement, identitySecret: Uint8Array): Promise<string> {
  await sodium.ready;
  if (!isRecoveryAddressStatement(s)) throw new TypeError('recovery address: not a well-formed statement');
  return sodium.to_hex(sodium.crypto_sign_detached(recoveryAddressBytes(s), identitySecret));
}

const verify = (bytes: () => Uint8Array, sig: unknown, publicHex: unknown): boolean => {
  try {
    if (typeof sig !== 'string' || !HEX_SIG.test(sig) || typeof publicHex !== 'string' || !HEX_KEY.test(publicHex)) return false;
    return sodium.crypto_sign_verify_detached(sodium.from_hex(sig), bytes(), sodium.from_hex(publicHex));
  } catch {
    return false;
  }
};

/** Synchronous (libsodium must be ready; before that it fails closed). Never throws. */
export function lienStatementValid(s: unknown, sig: unknown, modSigningPublic: unknown): s is LienStatement {
  return isLienStatement(s) && verify(() => lienStatementBytes(s), sig, modSigningPublic);
}

/** Synchronous (libsodium must be ready; before that it fails closed). `signPublic`: the creditor's trade identity in `fromCode`. */
export function recoveryAddressValid(s: unknown, sig: unknown, signPublic: unknown): s is RecoveryAddressStatement {
  return isRecoveryAddressStatement(s) && verify(() => recoveryAddressBytes(s), sig, signPublic);
}
