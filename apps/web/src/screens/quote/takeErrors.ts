// What the quote says when `POST /v1/offers/:id/take` refuses (plan Task 5 refusals, 409 unless
// noted). The words name only the caller's own situation: a starter-limit refusal names the
// caller's own stage and cap and nothing about the other side (spec 2.3, Revision 2026-10-24).
import { ApiCallError } from '../../api/client.js';
import { CANT_DO_TITLE, isCantDoCode, takeCantDoText, tradeBanOf, type CantDoCode } from '../../ui/cantDoCodes.js';
import { STAGE_NAMES, fiatWhole, type QuoteOffer } from './quoteModel.js';

const GENERIC = 'The trade could not start. Try again.';

/** A moved price: the quote shows the new total and waits for a fresh tap. */
export const PRICE_MOVED = 'The price moved. Check the new total and tap Trade again.';

/**
 * Review 18 Nov M1 (lead): after the rate-first sheet, the rate or the total on the quote is no
 * longer the one the person tapped Trade at, so nothing was taken. Shown as a moved price.
 */
export class QuoteMovedError extends Error {
  constructor() {
    super('the quote moved since the Trade tap');
    this.name = 'QuoteMovedError';
  }
}

/** The caller's own stage from a starter-limit refusal: only the two stages that have a cap. */
function ownStage(extra: Record<string, unknown>): 'starter' | 'building' | null {
  return extra.stage === 'starter' || extra.stage === 'building' ? extra.stage : null;
}

/** The open-trade limit from a Starter open-count refusal (Task 5: `maxOpen`), or null. */
function maxOpen(extra: Record<string, unknown>): number | null {
  const v = extra.maxOpen;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 1000 ? v : null;
}

function capCents(extra: Record<string, unknown>): bigint | null {
  const v = extra.capUsdCents;
  return typeof v === 'string' && /^\d{1,15}$/.test(v) ? BigInt(v) : null;
}

/**
 * The refusal code when the take was refused by a rule (shown in CantDoThat, Plan 5 Task 21),
 * else null (shown inline: a moved price, a busy offer, a network failure).
 */
export function takeCantDo(e: unknown): CantDoCode | null {
  return e instanceof ApiCallError && isCantDoCode(e.code) ? e.code : null;
}

/** CantDoThat's title on the quote (COPY-UNSIGNED, in the refusal text map). */
export const TAKE_CANT_TITLE = CANT_DO_TITLE.take;

/** The words for a refused take: a rule refusal from the text map (shown in CantDoThat), else inline. */
export function takeRefusal(e: unknown, offer: QuoteOffer): string {
  if (e instanceof QuoteMovedError) return PRICE_MOVED;
  if (!(e instanceof ApiCallError)) return GENERIC;
  if (isCantDoCode(e.code)) {
    // Only a starter-limit refusal carries a stage and a cap (an account-limit one a cap, Plan 4 Task 26); for the rest both read as null.
    const stage = ownStage(e.extra);
    const cap = capCents(e.extra);
    return takeCantDoText(e.code, { stageName: stage === null ? null : STAGE_NAMES[stage], capText: cap === null ? null : fiatWhole(cap, 'USD'), maxOpen: maxOpen(e.extra), minTrades: offer.minTrades, ban: tradeBanOf(e.extra) });
  }
  switch (e.code) {
    case 'out-of-range':
      return "That amount is outside this offer's range.";
    case 'trading-paused':
      return 'Trading is paused for maintenance. Try again soon.';
    case 'price-unavailable':
      return 'Price unavailable right now';
    case 'price-changed':
      // The quote re-fetches the price when it sees this refusal (Quote.tsx), so the total is fresh.
      return PRICE_MOVED;
    case 'method-unavailable':
      // not-a-refusal: a catalog fact (the method is off the list), see NOT_REFUSAL_CODES
      return 'This payment method is not available.';
    case 'wallet-not-ready':
      return 'That wallet is still waiting before it can be used. Pick another.';
    case 'ad-busy':
      return 'Someone is already taking this offer for that amount. Try again in a few minutes.';
    default:
      return GENERIC;
  }
}
