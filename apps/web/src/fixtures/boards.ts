// The example trade the X2F App boards show (design/x2f-app/), for fixture mode and the Playwright
// specs that stub the API, so a screen rendered from it shows the boards' copy verbatim and
// expectParity can compare it. Only fixture builds and e2e specs import this file; a production
// bundle never contains it (apps/web/test/bundle.test.ts).
//
// Every value is read off the boards named beside it. Screen tasks add what their own boards show.

/** The payment method on every trade-room board ("Trade K7M2-9QXA-4FTR-8WPN · Zelle"). */
export const BOARD_METHOD = {
  id: 'ZELLE',
  name: 'Zelle',
  // The boards have no explainer text; this is the spec's own example (spec 2.6).
  whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
} as const;

/**
 * The example trade: TradeFund, BuyerPay, SellerConfirm, SellerRefund, Review, DisputeOpen,
 * DisputeRoom, DisputeRuling and Desktop. mira.k buys ("Selling to mira.k", TradeFund) from
 * satoshi_ghost ("Buying from satoshi_ghost", BuyerPay).
 */
export const BOARD_TRADE = {
  code: 'K7M2-9QXA-4FTR-8WPN',
  method: BOARD_METHOD,
  buyer: 'mira.k',
  seller: 'satoshi_ghost',
  /** "1.250000 XMR" (TradeFund, Review, Desktop). */
  amountAtomic: 1_250_000_000_000n,
  /** "$412.50 USD" (TradeFund, BuyerPay, SellerConfirm, Desktop). */
  fiatCents: 41_250n,
  currency: 'USD',
  /** "$330.00 / XMR" (TradeFund, BuyQuote, Desktop). */
  rateCentsPerXmr: 33_000n,
} as const;
