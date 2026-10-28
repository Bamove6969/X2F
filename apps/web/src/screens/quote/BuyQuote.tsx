import { TIMERS } from '@x2f/trade';
import { QuoteScreen, type QuoteCopy } from './Quote.js';

// BuyQuote (board BuyQuote.dc.html): a buyer taking a sell ad. Two board rows are changed by owner
// decisions: the network fee row uses the OD-4 copy (it comes off the buyer's payout, spec 11.1),
// and the Deposit row is gone (no buyer deposits, spec 2.5).

export const BUY_QUOTE_COPY: QuoteCopy = {
  adSide: 'sell',
  defaultUnit: 'fiat',
  showMax: false,
  back: (method) => `Back to ${method} sellers`,
  title: (poster) => <>Buying from {poster}</>,
  amountLabel: 'You pay',
  range: (poster, min, max) => `${poster} sells ${min} to ${max} per trade.`,
  walletLegend: 'Which wallet gets paid?',
  headline: 'You receive',
  headlineXmr: (q) => q.receiveAtomic,
  walletLine: (name, end) => (
    <>
      In {name}, address ending <span className="x2f-quote__mono">{end}</span>
    </>
  ),
  noWalletLine: 'Pick the wallet that gets paid.',
  signedOutWalletLine: 'In the wallet you add when you set up your account.',
  networkFee: 'about 0.0001 XMR, taken from the payout',
  total: (method) => `You send via ${method}`,
  footnote: (poster) =>
    `Nothing changes after you tap Trade. ${poster} then has ${TIMERS.fundMin} minutes to lock the XMR in escrow. You only pay once it's locked.`,
};

export function BuyQuote() {
  return <QuoteScreen copy={BUY_QUOTE_COPY} />;
}
