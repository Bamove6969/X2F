// The BuyQuote board's example (design/x2f-app/BuyQuote.dc.html) in the API shapes the quote reads
// (src/screens/quote/api.ts), for e2e/quote.spec.ts. Only fixture builds and e2e specs import this
// file; a production bundle never contains it (apps/web/test/bundle.test.ts). Bigints travel as
// decimal strings.

/** "Buying from satoshi_ghost", "Zelle · USD · $330.00 / XMR", "satoshi_ghost sells $50 to $1,500 per trade." */
export const BOARD_BUY_QUOTE = {
  method: { id: 'ZELLE', name: 'Zelle' },
  currency: 'USD',
  /** "$330.00 / XMR": a market offer at the market price (margin 0). */
  marketCentsPerXmr: '33000',
  /** The board's default amount: "$412.50" buys "1.250000 XMR". */
  amount: '412.50',
  offer: {
    id: 'offer-ghost',
    poster: {
      displayName: 'satoshi_ghost',
      completedTrades: 212,
      online: true,
      lastSeenAt: '2026-10-24T00:00:00.000Z',
      typicalMinutes: 6,
      positivePct: 99,
      badges: [],
      stage: 'graduated',
    },
    rate: '33000',
    pricing: { mode: 'market', marginBps: 0 },
    minFiatCents: '5000',
    maxFiatCents: '150000',
    minTrades: 0,
  },
  /** The board's three wallets ("Cake Wallet …k3Fz", "Ledger (via Feather) …9QbP", "Edge …7HcW"). */
  wallets: [
    { id: 'w-cake', app: 'cake', label: 'Cake Wallet', address: '4BoardCakeAddressa9k3Fz', addressEnd: 'a9k3Fz', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
    { id: 'w-ledger', app: 'ledger-trezor', label: 'Ledger (via Feather)', address: '4BoardLedgerAddressb29QbP', addressEnd: 'b29QbP', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
    { id: 'w-edge', app: 'edge', label: 'Edge', address: '4BoardEdgeAddressc37HcW', addressEnd: 'c37HcW', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
  ],
  code: 'K7M2-9QXA-4FTR-8WPN',
} as const;
