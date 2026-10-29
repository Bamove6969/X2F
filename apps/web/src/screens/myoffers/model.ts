// My offers (Plan 3 Task 36): the screen's words and the small rules behind them, kept apart from
// React so the unit tests can read them. Words follow Claude Design's MyOffers board
// (origin/wip/design-brief docs/design-boards/MyOffers.dc.html, 2026-10-29); anything the board does
// not give is lead wording until the owner signs it off (COPY-UNSIGNED).
import { formatAmount, formatPrice, marginText } from '../post/offerForm.js';
import type { MyOffer, OfferState, SwitchResult } from './api.js';

/** The route of the My offers screen (under Profile, where the bottom nav's Profile tab points). */
export const MY_OFFERS_PATH = '/profile/offers';

/** At most this many ids per POST /v1/account/offers/status (the API's SWITCH_MAX_IDS); more go in batches (review M5). */
export const SWITCH_BATCH = 100;

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

/** The board's title line: "Selling XMR · USD". */
export function offerTitle(o: MyOffer): string {
  return `${o.side === 'sell' ? 'Selling XMR' : 'Buying XMR'} · ${o.currency}`;
}

/** The method line: "Zelle", or "Amazon gift card (US)" for a gift card. */
export function offerMethods(o: MyOffer): string {
  return `${o.methodName}${o.country ? ` (${o.country})` : ''}`;
}

/** The price line, as the board: "+0.5% · follows the market" or "$335.00 / XMR · Fixed price". */
export function offerPrice(o: MyOffer): string {
  return o.pricing.mode === 'market' ? `${marginText(o.pricing.marginBps)} · follows the market` : `${formatPrice(o.pricing.centsPerXmr, o.currency)} · Fixed price`;
}

/** The limits line: "$50 – $2,000 per trade". */
export function offerLimits(o: MyOffer): string {
  return `${formatAmount(o.minFiatCents, o.currency)} – ${formatAmount(o.maxFiatCents, o.currency)} per trade`;
}

/**
 * The status line. The board's "On · people can see and take it" / "Off · hidden from everyone",
 * and (review M4) an On offer nobody can see right now says why.
 */
export function statusLine(o: MyOffer): string {
  if (o.status === 'paused') return 'Off · hidden from everyone';
  switch (o.hidden) {
    // COPY-UNSIGNED (the three hidden reasons)
    case 'trading-paused':
      return 'On, hidden while trading is paused';
    case 'trading-hold':
      return 'On, hidden while your account has a trading hold';
    case 'method-unavailable':
      return "On, hidden: this payment method isn't available right now";
    default:
      return 'On · people can see and take it';
  }
}

/** The header line: "3 of 5 offers on". */
export function countLine(offers: readonly MyOffer[]): string {
  const on = offers.filter((o) => o.status === 'live').length;
  return `${on} of ${offers.length} ${offers.length === 1 ? 'offer' : 'offers'} on`;
}

/** The hint under Select all. */
export function allHint(selected: number, total: number): string {
  if (selected === 0) return 'Pick offers to turn them on or off together.';
  if (selected === total) return `All ${total} offers selected.`;
  return `Some selected: ${selected} of ${total}.`;
}

/** The board's footnote, without its cap sentence: the "2 offers per side" cap comes with Task 34. */
export const FOOTNOTE = 'Turning an offer off hides it right away. Turned-off offers stay hidden until you turn them back on. Trades already started carry on as normal.';

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

/**
 * The ids to send: always the listed offers that are ticked, never 'all' (review M1: 'all' would
 * also switch an offer posted elsewhere that this screen never showed).
 */
export function idsFor(offers: readonly MyOffer[], selected: ReadonlySet<string>): string[] {
  return offers.filter((o) => selected.has(o.id)).map((o) => o.id);
}

/** `ids` in batches of at most `size`. */
export function batches(ids: readonly string[], size = SWITCH_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
