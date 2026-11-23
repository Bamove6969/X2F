import { normalizeTradeCode } from '@x2f/core';
import { canonicalJson } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';

/**
 * RetoSwap/Haveno review 2026-11-12, finding 2 (lead call): the moderation service's own signed
 * statement of a dispute payout, the only ruling a trader's device co-signs against (Haveno 1.8.0
 * and 1.9.0 had traders sign payouts built from an arbitrator's unsigned, unbound dispute result).
 *
 * The moderation process signs it with its long-term key (MOD_SIGNING_SECRET) only after its gate
 * authorised the staff-tapped ruling (apps/moderation gate/verify.ts `authorizeRuling`) and worked
 * out the payouts itself from its own attested terms and the outcome (`payoutsFor`); it names the
 * trade, the escrow address the moderator's own party derived, and the round (1; or 2 when an
 * appeal overturned round 1 before round 1's payout ran, review p4t22 m1; otherwise an overturn is
 * a lien). The API keeps it for the two traders and checks it, but
 * a trader's device verifies it itself against the pinned key and its own trade, escrow and payout
 * set before it co-signs (apps/web escrow/policy.ts), so the API's unsigned "disputed" is never
 * enough.
 *
 * Amounts are decimal strings without leading zeros (canonical JSON has no bigints); key sets are
 * exact; the bytes signed are the domain `x2f/ruling-statement/v1\0` and canonical JSON.
 */
export interface RulingStatement {
  v: 1;
  trade: string;
  escrowAddress: string;
  round: 1 | 2;
  rulingId: string;
  outcome: 'release-to-buyer' | 'refund-to-seller';
  winner: 'buyer' | 'seller';
  payouts: Array<{ address: string; amountAtomic: string }>;
  issuedAt: string;
}

/** Why a statement is not one to co-sign against. Every malformed input is `bad-signature`. */
export type RulingStatementRefusal = 'bad-signature' | 'wrong-trade' | 'wrong-escrow' | 'wrong-round' | 'not-winner' | 'wrong-payouts';
export type RulingStatementCheck = { ok: true; statement: RulingStatement } | { ok: false; reason: RulingStatementRefusal };

/** What the verifying side knows itself: never taken from the statement or the API. */
export interface RulingStatementExpect {
  trade: string;
  escrowAddress: string;
  /** The side that must be the winner (the co-signer), when given. */
  winner?: 'buyer' | 'seller';
  /** The exact payout set (order, addresses, amounts), when given. */
  payouts?: ReadonlyArray<{ address: string; amountAtomic: bigint }>;
}

const DOMAIN = 'x2f/ruling-statement/v1\0';
const KEYS = ['v', 'trade', 'escrowAddress', 'round', 'rulingId', 'outcome', 'winner', 'payouts', 'issuedAt'] as const;
const ATOMIC = /^[1-9]\d{0,30}$/;
const HEX_KEY = /^[0-9a-f]{64}$/;
const HEX_SIG = /^[0-9a-f]{128}$/;
const MAX_ADDRESS = 256;
const MAX_PAYOUTS = 16;
const MAX_ID = 128;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};
const shortString = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

/** Exactly the `RulingStatement` shape: the outcome and the winner agree, at least one payout, positive amounts. */
export function isRulingStatement(x: unknown): x is RulingStatement {
  if (!isRecord(x) || !exactKeys(x, KEYS)) return false;
  if (x.v !== 1 || (x.round !== 1 && x.round !== 2)) return false;
  if (!shortString(x.trade, 32) || !shortString(x.escrowAddress, MAX_ADDRESS) || !shortString(x.rulingId, MAX_ID) || !shortString(x.issuedAt, 64)) return false;
  if (!((x.outcome === 'release-to-buyer' && x.winner === 'buyer') || (x.outcome === 'refund-to-seller' && x.winner === 'seller'))) return false;
  if (!Array.isArray(x.payouts) || x.payouts.length < 1 || x.payouts.length > MAX_PAYOUTS) return false;
  return x.payouts.every((p) => isRecord(p) && exactKeys(p, ['address', 'amountAtomic']) && shortString(p.address, MAX_ADDRESS) && typeof p.amountAtomic === 'string' && ATOMIC.test(p.amountAtomic));
}

/** The bytes the moderation key signs: the domain, then canonical JSON of the whole statement. */
export function rulingStatementBytes(s: RulingStatement): Uint8Array {
  return new TextEncoder().encode(DOMAIN + canonicalJson(s));
}

/** The moderation service's signature (hex) over `rulingStatementBytes`. */
export async function signRulingStatement(s: RulingStatement, signingSecret: Uint8Array): Promise<string> {
  await sodium.ready;
  if (!isRulingStatement(s)) throw new TypeError('ruling statement: not a well-formed statement');
  return sodium.to_hex(sodium.crypto_sign_detached(rulingStatementBytes(s), signingSecret));
}

/**
 * Synchronous check (libsodium must be ready; before that every statement is `bad-signature`, so it
 * fails closed). In order: the shape and the signature under `modSigningPublic` (`bad-signature`);
 * the trade (`wrong-trade`) and the escrow address (`wrong-escrow`) this side knows; round 1 or 2
 * (`wrong-round`); the winner (`not-winner`) and the exact payout
 * set (`wrong-payouts`), when given. Never throws.
 */
export function rulingStatementValid(s: unknown, sig: unknown, modSigningPublic: string, want: RulingStatementExpect): RulingStatementCheck {
  try {
    if (!isRulingStatement(s) || typeof sig !== 'string' || !HEX_SIG.test(sig) || typeof modSigningPublic !== 'string' || !HEX_KEY.test(modSigningPublic)) {
      return { ok: false, reason: 'bad-signature' };
    }
    if (!sodium.crypto_sign_verify_detached(sodium.from_hex(sig), rulingStatementBytes(s), sodium.from_hex(modSigningPublic))) return { ok: false, reason: 'bad-signature' };
    const trade = normalizeTradeCode(s.trade);
    const expected = typeof want.trade === 'string' ? normalizeTradeCode(want.trade) : null;
    if (trade === null || expected === null || trade !== expected) return { ok: false, reason: 'wrong-trade' };
    if (typeof want.escrowAddress !== 'string' || want.escrowAddress === '' || s.escrowAddress !== want.escrowAddress) return { ok: false, reason: 'wrong-escrow' };
    // Review p4t22 m1 (lead default, owner question OQ2): round 2's ruling pays when an appeal
    // overturned round 1 before round 1's payout ran; the moderation process signs one per trade.
    if (s.round !== 1 && s.round !== 2) return { ok: false, reason: 'wrong-round' };
    if (want.winner !== undefined && s.winner !== want.winner) return { ok: false, reason: 'not-winner' };
    if (want.payouts !== undefined) {
      const p = want.payouts;
      const same =
        Array.isArray(p) &&
        p.length === s.payouts.length &&
        p.every((x, i) => typeof x.amountAtomic === 'bigint' && x.address === s.payouts[i]!.address && x.amountAtomic.toString() === s.payouts[i]!.amountAtomic);
      if (!same) return { ok: false, reason: 'wrong-payouts' };
    }
    return { ok: true, statement: s };
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
}

/** `rulingStatementValid` once libsodium is ready. */
export async function verifyRulingStatement(s: unknown, sig: unknown, modSigningPublic: string, want: RulingStatementExpect): Promise<RulingStatementCheck> {
  await sodium.ready;
  return rulingStatementValid(s, sig, modSigningPublic, want);
}
