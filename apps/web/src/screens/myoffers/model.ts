// My offers (Plan 3 Task 36): the screen's words and the small rules behind them, kept apart from
// React so the unit tests can read them. Words follow Claude Design's MyOffers board
// (origin/wip/design-brief docs/design-boards/MyOffers.dc.html, 2026-10-29); anything the board does
// not give is lead wording until the owner signs it off (COPY-UNSIGNED).
import { CANT_DO_CODES, MY_OFFERS_HIDDEN, OFFER_CAP_LINE, TRADING_HOLD_CODE, isCantDoCode, myOffersRowText, type CantDoCode, type MyOffersHidden } from '../../ui/cantDoCodes.js';
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

/**
 * The CantDoThat popup for a Turn on (design session 2 Nov 2026): `hold` when a trading hold kept
 * every offer off and none was turned on; otherwise, when a "can't do that" refusal kept some off,
 * `some` with the refusal that kept the most off (`cantDoFor`) and the ids of every offer kept off,
 * so the popup can list which and why; null when nothing was refused that way.
 */
export function turnOnPopup(results: readonly SwitchResult[], before: readonly MyOffer[]): { kind: 'hold' } | { kind: 'some'; code: CantDoCode; count: number; ids: string[] } | null {
  const top = cantDoFor(results);
  if (top === null) return null;
  const was = new Map(before.map((o) => [o.id, o.status]));
  const changed = results.some((r) => r.refused === undefined && was.get(r.id) !== 'live');
  const refused = results.filter((r) => r.refused !== undefined && r.refused !== 'not-found');
  if (!changed && refused.every((r) => r.refused === TRADING_HOLD_CODE)) return { kind: 'hold' };
  return { kind: 'some', ...top, ids: refused.map((r) => r.id) };
}

/** The board's title line: "Selling XMR · USD". */
export function offerTitle(o: MyOffer): string {
  return `${o.side === 'sell' ? 'Selling XMR' : 'Buying XMR'} · ${o.currency}`;
}

/** The method line: "Zelle", or "Amazon gift card (US)" for a gift card. */
export function offerMethods(o: MyOffer): string {
  return `${o.methodName}${o.country ? ` (${o.country})` : ''}`;
}

/** The price line in two parts, as the board: ["+0.5%", "follows the market"] or ["$335.00 / XMR", "Fixed price"]. */
export function offerPriceParts(o: MyOffer): [string, string] {
  return o.pricing.mode === 'market' ? [marginText(o.pricing.marginBps), 'follows the market'] : [formatPrice(o.pricing.centsPerXmr, o.currency), 'Fixed price'];
}

/** The price line: "+0.5% · follows the market" or "$335.00 / XMR · Fixed price". */
export function offerPrice(o: MyOffer): string {
  return offerPriceParts(o).join(' · ');
}

/** The limits in mono: "$50 – $2,000" (the line adds " per trade"). */
export function offerLimitsRange(o: MyOffer): string {
  return `${formatAmount(o.minFiatCents, o.currency)} – ${formatAmount(o.maxFiatCents, o.currency)}`;
}

/** The limits line: "$50 – $2,000 per trade". */
export function offerLimits(o: MyOffer): string {
  return `${offerLimitsRange(o)} per trade`;
}

/**
 * Whether the account has a trading hold, as far as this screen can tell: GET /v1/account/offers
 * marks every live offer `hidden: 'trading-hold'` during one, and a Turn on refused with
 * `trading-hold` says so too (`refusedHold`). With only Off offers and no Turn on yet, the screen
 * cannot know (the API sends no account flag; reported to the lead as an API follow-up).
 */
export function isHeld(offers: readonly MyOffer[], refusedHold: boolean): boolean {
  return refusedHold || offers.some((o) => o.status === 'live' && o.hidden === TRADING_HOLD_CODE);
}

/** The status line's tone: ink for On, ink-muted for Off, caution while held or hidden. */
export type StatusTone = 'on' | 'off' | 'caution';

/**
 * The status line. The board's "On · people can see and take it" / "Off · hidden from everyone";
 * (review M4) an On offer nobody can see right now says why; and during a trading hold every offer
 * reads "Hidden · trading hold" (design review 1 Nov 2026, shot 34), so no row contradicts the hold.
 */
export function statusLine(o: MyOffer, held = false): { text: string; tone: StatusTone } {
  // COPY-UNSIGNED (design session 2 Nov 2026: one caution chip on every offer, on or off)
  if (held) return { text: 'Paused · trading hold', tone: 'caution' };
  if (o.status === 'paused') return { text: 'Off · hidden from everyone', tone: 'off' };
  return o.hidden !== undefined ? { text: MY_OFFERS_HIDDEN[o.hidden], tone: 'caution' } : { text: 'On · people can see and take it', tone: 'on' };
}

/** The header line: "3 of 5 offers on", or during a hold "Trading hold · all offers hidden". */
export function countLine(offers: readonly MyOffer[], held = false): string {
  // COPY-UNSIGNED (design session 2 Nov 2026)
  if (held) return 'Trading hold · all offers paused';
  const on = offers.filter((o) => o.status === 'live').length;
  return `${on} of ${offers.length} ${offers.length === 1 ? 'offer' : 'offers'} on`;
}

/** The hint under Select all. */
export function allHint(selected: number, total: number): string {
  if (selected === 0) return 'Pick offers to turn them on or off together.';
  if (selected === total) return `All ${total} offers selected.`;
  return `Some selected: ${selected} of ${total}.`;
}

/**
 * The board's footnote with its cap line from the batch 3 MyOffers board (owner, 2 Nov 2026: 3
 * buying and 3 selling offers per vendor; one offer covers all the currencies it lists).
 * COPY-UNSIGNED. The cap line is `OFFER_CAP_LINE`, the cap the API enforces (C2-A1: routes.ts
 * OFFER_CAP_DEFAULTS, 3 per side).
 */
export const FOOTNOTE = `Turning an offer off hides it right away. Turned-off offers stay hidden until you turn them back on. Trades already started carry on as normal. ${OFFER_CAP_LINE} Each offer can cover several currencies.`;

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

/**
 * The line after Turn on / Turn off, and its tone. It counts against the statuses `before` the
 * switch, so an offer that was already on is never counted as "turned on" (design review 1 Nov
 * 2026, shot 33: the old line said "2 offers turned on" while the popup said they stay off). A Turn
 * on that a trading hold refused says so in the hold's words. Caution when some stayed as they were.
 */
// COPY-UNSIGNED
export function summaryLine(status: OfferState, results: readonly SwitchResult[], before: readonly MyOffer[] = []): { text: string; tone: 'plain' | 'caution'; hold?: true } {
  const was = new Map(before.map((o) => [o.id, o.status]));
  const ok = results.filter((r) => r.refused === undefined);
  const changed = ok.filter((r) => was.get(r.id) !== status).length;
  const already = ok.length - changed;
  const refused = results.length - ok.length;
  const verb = status === 'live' ? 'on' : 'off';
  const offers = (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'}`;
  if (status === 'live' && changed === 0 && results.some((r) => r.refused === TRADING_HOLD_CODE)) {
    // COPY-UNSIGNED. The screen shows the hold's own notice instead (`hold`), so this is a fallback.
    return { text: 'Trading hold: no offers were turned on. They stay paused until the hold ends.', tone: 'caution', hold: true };
  }
  const parts = [changed > 0 ? `${offers(changed)} turned ${verb}.` : `No offers turned ${verb}.`];
  if (already > 0) parts.push(`${offers(already)} ${already === 1 ? 'was' : 'were'} already ${verb}.`);
  if (refused > 0) parts.push(`${offers(refused)} stayed as ${refused === 1 ? 'it was' : 'they were'}; each one says why below.`);
  return { text: parts.join(' '), tone: refused > 0 ? 'caution' : 'plain' };
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
