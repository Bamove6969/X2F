// What the quote says when `POST /v1/offers/:id/take` refuses (plan Task 5 refusals, 409 unless
// noted). The words name only the caller's own situation: a starter-limit refusal names the
// caller's own stage and cap and nothing about the other side (spec 2.3, Revision 2026-10-24).
import { ApiCallError } from '../../api/client.js';
import { STAGE_NAMES, fiatWhole, type QuoteOffer } from './quoteModel.js';

const GENERIC = 'The trade could not start. Try again.';

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

export function takeRefusal(e: unknown, offer: QuoteOffer): string {
  if (!(e instanceof ApiCallError)) return GENERIC;
  switch (e.code) {
    case 'starter-limit': {
      const stage = ownStage(e.extra);
      // No stage: the limit is the other side's, which is never named (Task 5 sends nothing about it).
      if (stage === null) return 'This trade is above a trading limit right now. Try a smaller amount or another offer.';
      const open = maxOpen(e.extra);
      if (open !== null) return `Your account is on ${STAGE_NAMES[stage]} limits: at most ${open} open ${open === 1 ? 'trade' : 'trades'} at once. Finish one first.`;
      const cap = capCents(e.extra);
      const limit = cap === null ? '' : ` up to ${fiatWhole(cap, 'USD')} per trade`;
      return `Your account is on ${STAGE_NAMES[stage]} limits${limit}. Try a smaller amount.`;
    }
    case 'own-offer':
      return 'This is your own offer.';
    case 'out-of-range':
      return "That amount is outside this offer's range.";
    case 'not-enough-trades':
      return `This offer needs at least ${offer.minTrades} completed ${offer.minTrades === 1 ? 'trade' : 'trades'}.`;
    case 'trading-hold':
      return 'Your account is on a trading hold while a dispute is open, so it cannot start trades.';
    case 'trading-paused':
      return 'Trading is paused for maintenance. Try again soon.';
    case 'price-unavailable':
      return 'Price unavailable right now';
    case 'price-changed':
      // The quote re-fetches the price when it sees this refusal (Quote.tsx), so the total is fresh.
      return 'The price moved. Check the new total and tap Trade again.';
    case 'method-unavailable':
      return 'This payment method is not available.';
    case 'wallet-not-ready':
      return 'That wallet is still waiting before it can be used. Pick another.';
    case 'already-waiting':
      return 'You already have a trade on this offer waiting to be funded.';
    case 'offer-busy':
      // The poster's own open-trade limit; nothing says whose limit or how many (Task 5 review M6).
      return "This offer can't take more trades right now. Try again later or pick another offer.";
    case 'ad-busy':
      return 'Someone is already taking this offer for that amount. Try again in a few minutes.';
    default:
      return GENERIC;
  }
}
