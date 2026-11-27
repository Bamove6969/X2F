import type { Dispute } from './dispute.js';
import { ESCROW_OUTCOMES, type RulingOutcome } from './intent.js';

/**
 * Owner decision, 26 Nov 2026 (Jess, 5:43 PM Pacific; docs/lien-recovery.md "Grace: 7 days to pay
 * the agreed way"): when a moderator's ruling places a lien, the moderator chooses how it is paid.
 *
 * - `collect`: "Start collecting now". Recovery from the debtor's later trades starts at once
 *   (the behaviour before this decision, and the default when no choice was sent).
 * - `grace`: "Give them 7 days to pay the agreed way". The moderator writes how the two traders
 *   agreed the debt is paid (`method`, e.g. "new PayPal payment of $120"). For `LIEN_GRACE_DAYS`
 *   nothing is recovered from the debtor's trades; the person owed signs off "I've been paid", which
 *   ends the lien as repaid off the platform. If the days pass without that, the lien is marked
 *   lapsed (once) and the moderator who ruled is told; they switch it to collecting (a key tap) or
 *   send it to a senior moderator. Recovery does not start by itself on the lapse
 *   (`LIEN_LAPSE_STARTS_COLLECTING`, the one switch).
 *
 * Pure: the API stores and enforces it (apps/api/src/disputes/lienGrace.ts); the staff and trader
 * sites read the same constants.
 */

/** The owner's 7 days ("one week to pay"), counted from the ruling that placed the lien. */
export const LIEN_GRACE_DAYS = 7;
/** The longest "How they agreed to pay" text. */
export const LIEN_GRACE_METHOD_MAX = 500;
/**
 * Lead reading of "re-trigger a new notification to the moderator to come back and have to elevate
 * the situation": a lapse only tells the moderator; recovery starts when they switch the lien to
 * collecting. Set true to make the lapse itself start collecting (the timer then sets
 * `collect_started_at` with the lapse; apps/api/src/disputes/lienGrace.ts reads this one constant).
 */
export const LIEN_LAPSE_STARTS_COLLECTING = false;

/**
 * Owner addition, 26 Nov 2026 5:51 PM: with "Start collecting now" the moderator enters the share of
 * each later trade collected (1..100%, default 100%), from what the debtor says they can afford.
 * `rateBps` is that share in basis points; under 100% it carries `rateReason` (1..500, pre-filled by
 * the staff site). The moderation service signs a rate under 100% only with a senior moderator's
 * (or the owner's) `lien-rate` tap bound to the lien (apps/moderation lienRecovery.ts
 * `lienRateTaps`), which a moderator's ruling tap cannot be and which cannot exist before the lien
 * does. So a rate under 100% becomes the lien's pending rate request, proposed by the moderator who
 * ruled with this reason, for a senior to approve; until then the current rate (100%) applies.
 */
export type LienPlan = { mode: 'collect'; rateBps: number; rateReason: string | null } | { mode: 'grace'; method: string };

/** The full rate (100%), the default of "Start collecting now" (as DEFAULT_RECOVERY_RATE_BPS). */
export const LIEN_FULL_RATE_BPS = 10_000;
/** The reason the staff site pre-fills for a rate under 100% chosen with the ruling. COPY-UNSIGNED */
export const LIEN_RATE_REASON_PREFILL = 'Set with the ruling, from what the person at fault said they can afford';

/** What collecting depends on, as the API stores it on the lien. */
export interface LienGraceFacts {
  /** Set only for a lien placed in grace; null for "collect now". */
  graceUntil: Date | string | null;
  /** When collecting started after a grace (the moderator's switch, or a lapse when the switch above is on). */
  collectStartedAt: Date | string | null;
  /** The person owed signed off that they were paid off the platform. */
  repaidOffPlatformAt: Date | string | null;
}

/**
 * Whether the lien's recovery collects from the debtor's trades now (ignoring its status and the
 * liens switch, which the callers check): not paid off the platform, and either never in grace or
 * switched to collecting. A grace lien whose days passed does not collect until the switch
 * (`LIEN_LAPSE_STARTS_COLLECTING` false). The API's SQL twin is `LIEN_COLLECTING_SQL`.
 */
export function lienCollecting(l: LienGraceFacts): boolean {
  if (l.repaidOffPlatformAt !== null) return false;
  return l.graceUntil === null || l.collectStartedAt !== null;
}

/** The grace's end for a lien placed at `placedAt`. */
export function graceUntilOf(placedAt: Date): Date {
  return new Date(placedAt.getTime() + LIEN_GRACE_DAYS * 86_400_000);
}

/** The control characters a stored text may not hold (tab and newline excepted). */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * The plan as a request sends it (`{ mode: 'collect' }` or `{ mode: 'grace', method }`), trimmed,
 * or null when it is not one. The method is 1..LIEN_GRACE_METHOD_MAX characters after trimming.
 */
export function parseLienPlan(v: unknown): LienPlan | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (o.mode === 'collect') {
    if (!Object.keys(o).every((k) => k === 'mode' || k === 'rateBps' || k === 'rateReason')) return null;
    return parseCollectRate(o);
  }
  if (o.mode !== 'grace' || keys !== 'method,mode' || typeof o.method !== 'string') return null;
  const method = o.method.trim();
  if (method.length < 1 || method.length > LIEN_GRACE_METHOD_MAX || CONTROL.test(method)) return null;
  return { mode: 'grace', method };
}

/**
 * The collecting share as sent with "Start collecting now" (at ruling, or with the switch):
 * `rateBps` 1..10000 (absent: 100%), and under 100% a `rateReason` of 1..500 characters (trimmed).
 * Null when it is not one.
 */
export function parseCollectRate(o: { rateBps?: unknown; rateReason?: unknown }): { mode: 'collect'; rateBps: number; rateReason: string | null } | null {
  const rate = o.rateBps === undefined ? LIEN_FULL_RATE_BPS : o.rateBps;
  if (typeof rate !== 'number' || !Number.isSafeInteger(rate) || rate < 1 || rate > LIEN_FULL_RATE_BPS) return null;
  if (rate === LIEN_FULL_RATE_BPS) return o.rateReason === undefined || o.rateReason === null ? { mode: 'collect', rateBps: rate, rateReason: null } : null;
  if (typeof o.rateReason !== 'string') return null;
  const reason = o.rateReason.trim();
  if (reason.length < 1 || reason.length > 500 || CONTROL.test(reason)) return null;
  return { mode: 'collect', rateBps: rate, rateReason: reason };
}

const isEscrow = (o: RulingOutcome) => (ESCROW_OUTCOMES as readonly string[]).includes(o);

/**
 * Whether publishing `outcome` as the dispute's current round may place a lien (`lienSteps`), so the
 * ruling screen asks how it is paid: round 1 after a refund ordering the seller to send the XMR, or a
 * round-2 ruling that changes round 1 (an overturn liens whoever got the coins or the payment) or
 * orders the seller to send the XMR. It may say yes for a ruling that in the end places none (round
 * 1's payout not run yet, liens switched off): the choice is then unused.
 */
export function rulingMayPlaceLien(d: Pick<Dispute, 'round' | 'afterRefund'> & { round1: { outcome: RulingOutcome } | null }, outcome: RulingOutcome): boolean {
  if (d.round === 1) return d.afterRefund && outcome === 'seller-sends-xmr';
  const first = d.round1?.outcome;
  if (first === undefined || first === outcome) return false;
  return isEscrow(first) || first === 'seller-sends-xmr' || outcome === 'seller-sends-xmr';
}
