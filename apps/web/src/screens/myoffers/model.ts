// My offers (Plan 3 Task 36): the screen's words and the small rules behind them, kept apart from
// React so the unit tests can read them. All copy here is lead wording until the owner signs it off
// (COPY-UNSIGNED); the screen has no Claude Design board yet (tripwire NEEDS_DESIGN_MYOFFERS).
import { formatAmount, formatPrice, marginText } from '../post/offerForm.js';
import type { MyOffer, OfferState, SwitchResult } from './api.js';

/** The route of the My offers screen (under Profile, where the bottom nav's Profile tab points). */
export const MY_OFFERS_PATH = '/profile/offers';

/**
 * Why one offer did not switch, shown under that offer. Inline text for now: the shared CantDoThat
 * popup (Plan 5 Task 21) is not on the main line yet (tripwire NEEDS_CANTDOTHAT_MYOFFERS).
 */
// COPY-UNSIGNED
export function refusalLine(code: string): string {
  switch (code) {
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so this offer stays off until it's resolved.";
    case 'trading-paused':
      return 'Trading is paused for maintenance, so this offer stays off for now. Try again soon.';
    case 'no-wallet':
      return 'Add a payout wallet before turning offers on.';
    case 'too-many-offers':
      return 'You have more offers in this market than the limit allows now. Remove one you no longer need, then turn this one on.';
    case 'method-unavailable':
      return "This payment method isn't available right now, so this offer stays off.";
    case 'not-found':
      return 'This offer was removed.';
    default:
      return "Something went wrong and this offer wasn't changed. Try again.";
  }
}

/** One line about the offer: "Sell · Zelle · USD". */
export function offerTitle(o: MyOffer): string {
  return `${o.side === 'sell' ? 'Sell' : 'Buy'} · ${o.methodName} · ${o.currency}${o.country ? ` (${o.country})` : ''}`;
}

/** The price and range: "+0.5% · $331.65 / XMR · $50 to $2,000". */
export function offerDetail(o: MyOffer): string {
  const price =
    o.pricing.mode === 'market'
      ? `Market ${marginText(o.pricing.marginBps)}${o.rate !== null ? ` · ${formatPrice(o.rate, o.currency)}` : ''}`
      : `Fixed ${formatPrice(o.pricing.centsPerXmr, o.currency)}`;
  return `${price} · ${formatAmount(o.minFiatCents, o.currency)} to ${formatAmount(o.maxFiatCents, o.currency)}`;
}

/** The offers with each switch result's status applied; ids reported `not-found` are dropped. */
export function applyResults(offers: readonly MyOffer[], results: readonly SwitchResult[]): MyOffer[] {
  const by = new Map(results.map((r) => [r.id, r]));
  return offers.flatMap((o) => {
    const r = by.get(o.id);
    if (!r) return [o];
    if (r.refused === 'not-found') return [];
    return [r.status !== undefined && r.status !== o.status ? { ...o, status: r.status } : o];
  });
}

/** The status line after Turn on / Turn off: how many switched, and whether some stayed as they were. */
// COPY-UNSIGNED
export function summaryLine(status: OfferState, results: readonly SwitchResult[]): string {
  const done = results.filter((r) => r.refused === undefined).length;
  const refused = results.length - done;
  const verb = status === 'live' ? 'on' : 'off';
  const offers = (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'}`;
  if (refused === 0) return `${offers(done)} turned ${verb}.`;
  if (done === 0) return `No offers turned ${verb}. Each one says why below.`;
  return `${offers(done)} turned ${verb}. ${offers(refused)} stayed as they were; each one says why below.`;
}

/** The ids to send: 'all' when every listed offer is selected (the API's "Select all"), else the selection. */
export function idsFor(offers: readonly MyOffer[], selected: ReadonlySet<string>): string[] | 'all' {
  const ids = offers.filter((o) => selected.has(o.id)).map((o) => o.id);
  return ids.length > 0 && ids.length === offers.length ? 'all' : ids;
}
