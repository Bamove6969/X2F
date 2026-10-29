// My offers (Plan 3 Task 36): the screen's words and the small rules behind them, kept apart from
// React so the unit tests can read them. Words follow Claude Design's MyOffers board
// (origin/wip/design-brief docs/design-boards/MyOffers.dc.html, 2026-10-29); anything the board does
// not give is lead wording until the owner signs it off (COPY-UNSIGNED).
import { CANT_DO_CODES, MY_OFFERS_HIDDEN, isCantDoCode, myOffersRowText, type CantDoCode, type MyOffersHidden } from '../../ui/cantDoCodes.js';
import { formatAmount, formatPrice, marginText } from '../post/offerForm.js';
import type { MyOffer, OfferState, SwitchResult } from './api.js';

/** The route of the My offers screen (under Profile, where the bottom nav's Profile tab points). */
export const MY_OFFERS_PATH = '/profile/offers';

/** At most this many ids per POST /v1/account/offers/status (the API's SWITCH_MAX_IDS); more go in batches (review M5). */
export const SWITCH_BATCH = 100;

/** Why a live offer is hidden (review M4), as GET /v1/account/offers sends it. */
export const HIDDEN_REASONS = Object.keys(MY_OFFERS_HIDDEN) as MyOffersHidden[];

/**
 * The line under one offer that did not switch. A "can't do that" refusal (cantDoCodes.ts:
 * trading-hold, too-many-offers) gets a short line here and its full reason in CantDoThat
 * (`cantDoFor`); the rest are not refusals and are said in the row only. The words are in
 * cantDoCodes.ts (`myOffersRowText`).
 */
export function refusalLine(code: string): string {
  return myOffersRowText(code);
}

/**
 * The CantDoThat popup for a Turn on: the refusal that kept the most offers off (a hold before the
 * cap on a tie, as a hold covers every offer, by CANT_DO_CODES order), and how many it kept off; null when none did.
 */
export function cantDoFor(results: readonly SwitchResult[]): { code: CantDoCode; count: number } | null {
  const counts = new Map<CantDoCode, number>();
  for (const r of results) if (isCantDoCode(r.refused)) counts.set(r.refused, (counts.get(r.refused) ?? 0) + 1);
  let best: { code: CantDoCode; count: number } | null = null;
  // CANT_DO_CODES order breaks a tie (a trading hold comes before the offer cap).
  for (const code of CANT_DO_CODES) {
    const count = counts.get(code) ?? 0;
    if (count > 0 && (best === null || count > best.count)) best = { code, count };
  }
  return best;
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
  return o.hidden !== undefined ? MY_OFFERS_HIDDEN[o.hidden] : 'On · people can see and take it';
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
