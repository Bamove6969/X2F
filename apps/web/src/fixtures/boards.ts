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

// ---- Sell browse (Task 16): the Main and SellOffers boards. ----
// API shapes are the Task 3/4 ones the browse screens consume (src/screens/browse/api.ts); bigints
// travel as decimal strings.

/**
 * The live rows of the Main board in USD ("<n> buyers paying in USD · up to $<rate>"), in its
 * default "Most buyers" order. Ids are the catalog's (data/payment-methods.json).
 */
export const BOARD_SELL_LIVE_USD = [
  { id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 34, bestRate: '33120' },
  { id: 'CASH_APP', name: 'Cash App', group: 'Payment apps', giftCard: false, offers: 27, bestRate: '33210' },
  { id: 'PAY_BY_MAIL', name: 'Cash by mail', group: 'Cash & money orders', giftCard: false, offers: 21, bestRate: '33800' },
  { id: 'VENMO', name: 'Venmo', group: 'Payment apps', giftCard: false, offers: 12, bestRate: '33300' },
  { id: 'PAYPAL', name: 'PayPal', group: 'Payment apps', giftCard: false, offers: 9, bestRate: '33650' },
  { id: 'TRANSFERWISE', name: 'Wise', group: 'Payment apps', giftCard: false, offers: 8, bestRate: '33010' },
  { id: 'F2F', name: 'Cash in person (face to face)', group: 'Cash & money orders', giftCard: false, offers: 7, bestRate: '33500' },
  { id: 'REVOLUT', name: 'Revolut', group: 'Payment apps', giftCard: false, offers: 6, bestRate: '33040' },
  { id: 'CASH_DEPOSIT', name: 'Cash deposit at bank', group: 'Cash & money orders', giftCard: false, offers: 3, bestRate: '33340' },
  { id: 'SWIFT', name: 'International wire (SWIFT)', group: 'Bank transfers', giftCard: false, offers: 3, bestRate: '32940' },
  { id: 'WESTERN_UNION', name: 'Western Union', group: 'Cash & money orders', giftCard: false, offers: 2, bestRate: '33400' },
  { id: 'STRIKE', name: 'Strike', group: 'Payment apps', giftCard: false, offers: 2, bestRate: '33000' },
  { id: 'MONEY_GRAM', name: 'MoneyGram', group: 'Cash & money orders', giftCard: false, offers: 1, bestRate: '33400' },
] as const;

/** SellOffers: "Sell XMR via Zelle", "34 buyers · USD", "Market price $329.90 / XMR". */
export const BOARD_SELL_OFFERS = {
  method: BOARD_METHOD,
  currency: 'USD',
  buyers: 34,
  marketCentsPerXmr: '32990',
} as const;

const HOUR_MS = 3_600_000;

/**
 * The three offer cards of the SellOffers board, as `GET /v1/offers` sends them. `now` places
 * nightowl_44's last visit ("Seen 2 h ago"). The board's "Deposit required" line is out of date
 * (no buyer deposits, plan Revision 2026-10-18).
 */
export function boardSellOffers(now: Date = new Date()) {
  return [
    {
      id: 'offer-mira',
      poster: {
        tradeTag: 'mira.k',
        completedTrades: 212,
        online: true,
        lastSeenAt: now.toISOString(),
        typicalMinutes: 6,
        positivePct: 99,
        badges: ['trusted', 'fast', 'veteran', 'pgp', 'security-key'],
        stage: 'graduated',
      },
      rate: '33120',
      pricing: { mode: 'market', marginBps: 40 },
      minFiatCents: '5000',
      maxFiatCents: '200000',
      minTrades: 0,
    },
    {
      id: 'offer-nightowl',
      poster: {
        tradeTag: 'nightowl_44',
        completedTrades: 58,
        online: false,
        lastSeenAt: new Date(now.getTime() - 2 * HOUR_MS - 5 * 60_000).toISOString(),
        typicalMinutes: 15,
        positivePct: 97,
        badges: ['security-key', 'veteran'],
        stage: 'graduated',
      },
      rate: '33090',
      pricing: { mode: 'market', marginBps: 30 },
      minFiatCents: '10000',
      maxFiatCents: '500000',
      minTrades: 0,
    },
    {
      id: 'offer-first',
      poster: {
        tradeTag: 'first_trade_ty',
        completedTrades: 0,
        online: true,
        lastSeenAt: now.toISOString(),
        typicalMinutes: null,
        positivePct: null,
        badges: [],
        stage: 'starter',
      },
      rate: '32990',
      pricing: { mode: 'market', marginBps: 0 },
      minFiatCents: '2000',
      maxFiatCents: '20000',
      minTrades: 0,
    },
  ];
}

// ---- Buy browse (Task 17): the BuyMain and BuyOffers boards. ----

/**
 * The live rows of the BuyMain board in USD ("<n> sellers taking USD · from $<rate>"), in its
 * default "Most sellers" order. Names are the catalog's (data/payment-methods.json), which spells four
 * of them differently from the board's older list ("ACH bank transfer (US)" for "Bank transfer (ACH)").
 */
export const BOARD_BUY_LIVE_USD = [
  { id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 29, bestRate: '33000' },
  { id: 'CASH_APP', name: 'Cash App', group: 'Payment apps', giftCard: false, offers: 23, bestRate: '33330' },
  { id: 'PAY_BY_MAIL', name: 'Cash by mail', group: 'Cash & money orders', giftCard: false, offers: 18, bestRate: '33920' },
  { id: 'ACH_TRANSFER', name: 'ACH bank transfer (US)', group: 'Bank transfers', giftCard: false, offers: 13, bestRate: '33200' },
  { id: 'VENMO', name: 'Venmo', group: 'Payment apps', giftCard: false, offers: 10, bestRate: '33420' },
  { id: 'PAYPAL', name: 'PayPal', group: 'Payment apps', giftCard: false, offers: 8, bestRate: '33770' },
  { id: 'TRANSFERWISE', name: 'Wise', group: 'Payment apps', giftCard: false, offers: 7, bestRate: '33130' },
  { id: 'F2F', name: 'Cash in person (face to face)', group: 'Cash & money orders', giftCard: false, offers: 6, bestRate: '33620' },
  { id: 'AMAZON_GIFT_CARD', name: 'Amazon gift card', group: 'Gift cards & vouchers', giftCard: true, offers: 5, bestRate: '35320' },
  { id: 'REVOLUT', name: 'Revolut', group: 'Payment apps', giftCard: false, offers: 5, bestRate: '33160' },
  { id: 'CASH_DEPOSIT', name: 'Cash deposit at bank', group: 'Cash & money orders', giftCard: false, offers: 3, bestRate: '33460' },
  { id: 'DOMESTIC_WIRE_TRANSFER', name: 'Domestic wire transfer (US)', group: 'Bank transfers', giftCard: false, offers: 3, bestRate: '33080' },
  { id: 'SWIFT', name: 'International wire (SWIFT)', group: 'Bank transfers', giftCard: false, offers: 3, bestRate: '33060' },
  { id: 'STRIKE', name: 'Strike', group: 'Payment apps', giftCard: false, offers: 2, bestRate: '33120' },
  { id: 'US_POSTAL_MONEY_ORDER', name: 'USPS money order', group: 'Cash & money orders', giftCard: false, offers: 2, bestRate: '33570' },
  { id: 'WESTERN_UNION', name: 'Western Union', group: 'Cash & money orders', giftCard: false, offers: 2, bestRate: '33520' },
  { id: 'MONEY_GRAM', name: 'MoneyGram', group: 'Cash & money orders', giftCard: false, offers: 1, bestRate: '33520' },
] as const;

/** BuyOffers: "Buy XMR via Zelle", "29 sellers · USD", "Market price $329.90 / XMR". */
export const BOARD_BUY_OFFERS = {
  method: BOARD_METHOD,
  currency: 'USD',
  sellers: 29,
  marketCentsPerXmr: '32990',
} as const;

/**
 * The three offer cards of the BuyOffers board, as `GET /v1/offers?side=sell` sends them, in the
 * board's "Best price" order (lowest first). The board draws satoshi_ghost's offer as a fixed price
 * ($330.00, "$0.10 above market" against $329.90); there are no fixed-price offers (owner Q1, 6 Nov),
 * so it is +0.03%, which comes to the same $330.00. lowtide_rx has 12 trades, so the API would say stage 'building'
 * and the card shows New (spec 2.3, owner 2026-10-24); the board predates starter limits and shows
 * no badge there.
 */
export function boardBuyOffers(now: Date = new Date()) {
  return [
    {
      id: 'offer-satoshi',
      poster: {
        tradeTag: 'satoshi_ghost',
        completedTrades: 340,
        online: true,
        lastSeenAt: now.toISOString(),
        typicalMinutes: 8,
        positivePct: 99,
        badges: ['trusted', 'veteran', 'fast', 'pgp'],
        stage: 'graduated',
      },
      rate: '33000',
      pricing: { mode: 'market', marginBps: 3 },
      minFiatCents: '5000',
      maxFiatCents: '150000',
      minTrades: 0,
    },
    {
      id: 'offer-kettle',
      poster: {
        tradeTag: 'kettle.moss',
        completedTrades: 96,
        online: false,
        lastSeenAt: new Date(now.getTime() - 40 * 60_000 - 20_000).toISOString(),
        typicalMinutes: 20,
        positivePct: 98,
        badges: ['pgp'],
        stage: 'graduated',
      },
      rate: '33150',
      pricing: { mode: 'market', marginBps: 50 },
      minFiatCents: '10000',
      maxFiatCents: '300000',
      minTrades: 0,
    },
    {
      id: 'offer-lowtide',
      poster: {
        tradeTag: 'lowtide_rx',
        completedTrades: 12,
        online: true,
        lastSeenAt: now.toISOString(),
        typicalMinutes: 30,
        positivePct: 100,
        badges: [],
        stage: 'building',
      },
      rate: '33300',
      pricing: { mode: 'market', marginBps: 90 },
      minFiatCents: '2000',
      maxFiatCents: '40000',
      minTrades: 0,
    },
  ];
}
