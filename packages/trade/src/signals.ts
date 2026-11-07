/**
 * The trade's signals channel schema (Plan 3 Task 10), shared by the trader apps (apps/web
 * escrow/signals.ts, Task 12) and the moderation service (apps/moderation signals.ts) so both read
 * the same payloads. Signals are sealed on `channelFor(code, 'signals')` with Plan 1's envelopes;
 * the sender is the envelope's signed `from`, never a payload field.
 *
 * - `trade.terms` (buyer or seller, at setup, resent until the moderator's ack): the seller's
 *   `{ refundAddress, deal }`, the buyer's `{ payoutAddress, deal }`; `deal` is the deal fixed at
 *   take as bigints (`ConfirmedDeal`). Lead answer 5 (docs/coordination.md, Task 12 notes).
 * - `trade.paid` (buyer): `{ amountAtomic, fiatCents }` (bigints, both > 0): the trade amount the
 *   buyer's device fixed and the fiat total the buyer confirmed (Task 12 security fix 2026-10-24).
 * - `trade.cancel` (buyer), `trade.extend` and `trade.refund-request` (seller): `{}`.
 * - `trade.ack` (mod → the sender only): `{ of: '<signal type>' }`. An ack of `trade.terms` stops
 *   the sender's terms resends. Sealed to the sender alone, so a peer never reads another's ack as
 *   its own.
 */
import type { Role } from '@x2f/core';
import type { ConfirmedDeal } from './attestation.js';

export const SIGNAL_TYPES = ['trade.terms', 'trade.paid', 'trade.cancel', 'trade.extend', 'trade.refund-request', 'trade.ack'] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** Who may send each signal. */
export const SIGNAL_SENDERS: Record<SignalType, readonly Role[]> = {
  'trade.terms': ['buyer', 'seller'],
  'trade.paid': ['buyer'],
  'trade.cancel': ['buyer'],
  'trade.extend': ['seller'],
  'trade.refund-request': ['seller'],
  'trade.ack': ['mod'],
};

/** The longest address a `trade.terms` may carry. */
export const SIGNAL_MAX_ADDRESS = 256;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/** The `trade.terms` address key for a sender: the buyer's payout, the seller's refund. */
export const signalAddressKey = (role: Role): 'payoutAddress' | 'refundAddress' => (role === 'buyer' ? 'payoutAddress' : 'refundAddress');

/** A `trade.terms` deal: exact keys, a three-letter currency, positive bigints. Null otherwise. */
export function parseSignalDeal(d: unknown): ConfirmedDeal | null {
  if (!isRecord(d) || !exactKeys(d, ['poster', 'takeAmountAtomic', 'currency', 'centsPerXmr', 'maxFiatCents'])) return null;
  if (d.poster !== 'buyer' && d.poster !== 'seller') return null;
  if (typeof d.currency !== 'string' || !/^[A-Z]{3}$/.test(d.currency)) return null;
  for (const k of ['takeAmountAtomic', 'centsPerXmr', 'maxFiatCents'] as const) if (typeof d[k] !== 'bigint' || (d[k] as bigint) <= 0n) return null;
  return d as unknown as ConfirmedDeal;
}

/** Checks a payload's exact shape for its type and sender (the signed envelope's `from`). */
export function signalPayloadOk(type: SignalType, from: Role, p: unknown): p is Record<string, unknown> {
  if (!isRecord(p) || !(SIGNAL_SENDERS[type] ?? []).includes(from)) return false;
  if (type === 'trade.terms') {
    const k = signalAddressKey(from);
    const addr = p[k];
    return exactKeys(p, [k, 'deal']) && typeof addr === 'string' && addr.length > 0 && addr.length <= SIGNAL_MAX_ADDRESS && parseSignalDeal(p.deal) !== null;
  }
  if (type === 'trade.ack') return exactKeys(p, ['of']) && typeof p.of === 'string' && (SIGNAL_TYPES as readonly string[]).includes(p.of) && p.of !== 'trade.ack';
  if (type === 'trade.paid') {
    return exactKeys(p, ['amountAtomic', 'fiatCents']) && typeof p.amountAtomic === 'bigint' && p.amountAtomic > 0n && typeof p.fiatCents === 'bigint' && p.fiatCents > 0n;
  }
  return Object.keys(p).length === 0;
}

export const isSignalType = (t: unknown): t is SignalType => typeof t === 'string' && (SIGNAL_TYPES as readonly string[]).includes(t);
