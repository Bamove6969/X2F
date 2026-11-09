import { TIMERS } from '@x2f/trade';
import { QuoteScreen, type QuoteCopy } from './Quote.js';

// The seller's quote: a seller taking a buy ad. It has no board and mirrors BuyQuote's parts (plan
// Task 18): the amount or Max, the wallet the seller funds from (refunds go back to it, spec 6.4),
// the same rows, and no fee line (on a buy ad the poster's 1% comes out of the poster's own payout,
// so the seller locks exactly the amount). The seller pays the funding network fee in their own
// wallet (spec 11.1).

export const SELL_QUOTE_COPY: QuoteCopy = {
  adSide: 'buy',
  defaultUnit: 'xmr',
  showMax: true,
  back: (method) => `Back to ${method} buyers`,
  title: (poster) => <>Selling to {poster}</>,
  amountLabel: 'You sell',
  range: (poster, min, max) => `${poster} buys ${min} to ${max} per trade.`,
  walletLegend: 'Which wallet sends the XMR?',
  headline: 'You lock in escrow',
  headlineXmr: (q) => q.sellerFundsAtomic,
  // What the seller locks is what they will send: exact (Task 18 review item 5, the exact-send rule).
  headlineExact: true,
  signedOutPickLine: 'You add your wallet when you set up your account, then pick it here. Refunds go back to it.',
  walletLine: (name, end) => (
    <>
      From {name}, address ending <span className="x2f-quote__mono">{end}</span>. Refunds go back to it.
    </>
  ),
  noWalletLine: 'Pick the wallet you send from. Refunds go back to it.',
  signedOutWalletLine: 'From the wallet you add when you set up your account.',
  networkFee: 'paid by your wallet when you send',
  total: (method) => `You get via ${method}`,
  footnote: (poster) =>
    `Nothing changes after you tap Trade. You then have ${TIMERS.fundMin} minutes to lock the XMR in escrow from your wallet. ${poster} pays once it's locked.`,
};

export function SellQuote() {
  return <QuoteScreen copy={SELL_QUOTE_COPY} />;
}
