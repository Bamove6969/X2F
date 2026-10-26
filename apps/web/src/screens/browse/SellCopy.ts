// The words of the sell browse screens (Main and SellOffers boards). Task 17 adds BuyCopy.ts with
// the same shape for the buy side.
export interface BrowseCopy {
  /** Main board heading. */
  heading: string;
  /** "Buyers paying in USD". */
  liveTitle: (currency: string) => string;
  /** A live method row: "34 buyers paying in USD · up to $331.20". */
  liveRow: (count: number, currency: string, best: string | null) => string;
  /** A method with no live offers. */
  emptyRow: (currency: string) => string;
  /** SellOffers header title: "Sell XMR via Zelle". */
  offersTitle: (method: string) => string;
  /** The title until the method is known (a method id from the URL is never shown). */
  offersTitleBare: string;
  /** SellOffers header line: "34 buyers · USD". */
  offersCount: (count: number, currency: string) => string;
  /** The time line on an offer card: "Pays in ~6 min". */
  typicalTime: (minutes: number) => string;
  /** No offers for the method in this currency. */
  noOffers: (currency: string) => string;
  /** Sort chips on SellOffers, in order: best price, online now, most trades. */
  offerSorts: readonly [string, string, string];
  /** Whether a market margin is in the browsing person's favour (shown in the escrow tone). */
  favourable: (marginBps: number) => boolean;
}

const people = (n: number) => `${n} ${n === 1 ? 'buyer' : 'buyers'}`;

export const SELL_COPY: BrowseCopy = {
  heading: 'How do you want to get paid?',
  liveTitle: (c) => `Buyers paying in ${c}`,
  liveRow: (n, c, best) => `${people(n)} paying in ${c}${best === null ? '' : ` · up to ${best}`}`,
  emptyRow: (c) => `No ${c} buyers right now · post an offer`,
  offersTitle: (m) => `Sell XMR via ${m}`,
  offersTitleBare: 'Sell XMR',
  offersCount: (n, c) => `${people(n)} · ${c}`,
  typicalTime: (m) => `Pays in ~${m} min`,
  noOffers: (c) => `No ${c} buyers for this method right now. You can post an offer.`,
  offerSorts: ['Best price', 'Online now', 'Most trades'],
  // A buyer paying above market is good for the seller.
  favourable: (bps) => bps > 0,
};
