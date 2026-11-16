import { TIMERS } from '@x2f/trade';
import { QuoteScreen, type QuoteCopy } from './Quote.js';

// BuyQuote (board BuyQuote.dc.html): a buyer taking a sell ad. Two board rows are changed by owner
// decisions: the network fee row says the buyer pays the network fee for their own payout, taken
// from it (owner 16 Nov: the payout's network fee is shared by its receiving outputs, one equal
// share per output; X2F's fee output pays its own; spec 11.1),
// and the Deposit row is gone (no buyer deposits, spec 2.5). Max is on, as on the 8 Nov board (owner
// #5, "I do really like the max button"): it fills the offer's largest trade, and the bands card
// moves its ring to the top band.

export const BUY_QUOTE_COPY: QuoteCopy = {
  adSide: 'sell',
  defaultUnit: 'fiat',
  showMax: true,
  back: (method) => `Back to ${method} sellers`,
  title: (poster) => <>Buying from {poster}</>,
  amountLabel: 'You pay',
  range: (poster, min, max) => `${poster} sells ${min} to ${max} per trade.`,
  walletLegend: 'Which wallet gets paid?',
  headline: 'You receive',
  headlineXmr: (q) => q.receiveAtomic,
  // What the buyer receives is not a figure anyone sends: the boards' 6 places (review 8 Nov item 4).
  headlineExact: false,
  // COPY-UNSIGNED (design review 8 Nov item 4)
  signedOutPickLine: 'You add your wallet when you set up your account, then pick it here.',
  walletLine: (name, end) => (
    <>
      In {name}, address ending <span className="x2f-quote__mono">{end}</span>
    </>
  ),
  noWalletLine: 'Pick the wallet that gets paid.',
  // COPY-UNSIGNED (owner 16 Nov: "they pay their fees and we pay our fees"; about half the
  // typical 0.0001 XMR two-output payout fee).
  networkFee: 'about 0.00005 XMR for your payout, taken from it',
  total: (method) => `You send via ${method}`,
  footnote: (poster) =>
    `Nothing changes after you tap Trade. ${poster} then has ${TIMERS.fundMin} minutes to lock the XMR in escrow. You only pay once it's locked.`,
};

export function BuyQuote() {
  return <QuoteScreen copy={BUY_QUOTE_COPY} />;
}
