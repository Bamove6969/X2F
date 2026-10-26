// The words of the buy browse screens (BuyMain and BuyOffers boards), in SellCopy.ts's shape.
import type { BrowseCopy } from './SellCopy.js';

const people = (n: number) => `${n} ${n === 1 ? 'seller' : 'sellers'}`;

export const BUY_COPY: BrowseCopy = {
  heading: 'How do you want to pay?',
  liveTitle: (c) => `Sellers taking ${c}`,
  liveRow: (n, c, best) => `${people(n)} taking ${c}${best === null ? '' : ` · from ${best}`}`,
  emptyRow: (c) => `No ${c} sellers right now · post an offer`,
  methodSorts: ['Most sellers', 'Best rate', 'A–Z'],
  offersTitle: (m) => `Buy XMR via ${m}`,
  offersCount: (n, c) => `${people(n)} · ${c}`,
  typicalTime: (m) => `Releases in ~${m} min`,
  noOffers: (c) => `No ${c} sellers for this method right now. You can post an offer.`,
  offerSorts: ['Best price', 'Online now', 'Most trades'],
  offersFooter: 'You pay no X2F fee when you take an offer.',
  // A seller asking below market is good for the buyer.
  favourable: (bps) => bps < 0,
};
