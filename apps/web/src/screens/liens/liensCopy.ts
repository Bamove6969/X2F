/**
 * Lien recovery copy (owner 16 Nov 2026, docs/lien-recovery.md). COPY-UNSIGNED: the owner's
 * meaning ("advised that their proceeds will be deducted ... until they have paid back the lien in
 * full"; the rate: 26 Nov 2026, "100% of their earnings are pulled until they pay back in full"),
 * not his words. At 100% the buyer's payout still keeps the network fee it pays (@x2f/trade
 * LIEN_BUYER_KEEPS_ATOMIC), so the copy says "all" with that exception. DESIGN: not drawn.
 */
export const LIENS_COPY = {
  title: 'What you owe after a dispute',
  none: 'You do not owe anything from a dispute.',
  owesIntro: (pct: string) =>
    pct === '100%'
      ? 'A moderator decided you owe this amount to the other trader. You can keep trading. Each time you buy XMR, all of it goes to them until it is paid in full, except a small amount kept to pay the network fee.'
      : `A moderator decided you owe this amount to the other trader. You can keep trading. Each time you buy XMR, ${pct} of what you receive goes to them until it is paid in full.`,
  owed: 'Owed',
  recovered: 'Paid back so far',
  remaining: 'Still to pay',
  rate: 'Taken from each purchase',
  suspended: 'On hold while your appeal is decided.',
  // Owner 27 Nov 2026 (docs/lien-recovery.md "Debtor is the seller"): selling pays it back too,
  // with extra the seller sends on top of the sale. COPY-UNSIGNED.
  sellNote: (pct: string) =>
    pct === '100%'
      ? 'Each time you sell XMR, you also send extra into the escrow, as much again as you sell, until it is paid in full. The extra goes to them when the trade completes. You get it back if the trade is refunded.'
      : `Each time you sell XMR, you also send extra into the escrow, ${pct} of what you sell, until it is paid in full. The extra goes to them when the trade completes. You get it back if the trade is refunded.`,
  fromTrade: (code: string) => `From trade ${code}`,
  owedToTitle: 'Owed to you after a dispute',
  owedToIntro: 'What this trader receives when they buy XMR, and extra they send when they sell XMR, is paid to you until the amount is paid in full.',
  received: 'Received',
  repaid: 'Paid in full.',
  addressNeeded: 'Choose the wallet these payments go to. Nothing is paid to you until you do.',
  addressSet: 'Payments go to the wallet you chose.',
  addressPick: 'Your wallets',
  addressUse: 'Send these payments to this wallet',
  addressChange: 'Change wallet',
  addressNoRecord: (code: string) => `Open this on the device you used for trade ${code}. That device confirms the wallet.`,
  // not-a-refusal: a wallet choice to redo on the same screen (another account holds that address)
  addressTaken: 'That wallet cannot be used for this. Pick another one.',
  addressFailed: 'That did not work. Try again.',
  loadFailed: 'Could not load this. Try again later.',
} as const;

/** Basis points as a percentage: 10000 → "100%", 2550 → "25.5%". */
export function pctOf(bps: number): string {
  return `${bps / 100}%`;
}

/**
 * Review B1 (lien recovery): the buyer's quote shows what this purchase pays to the person they owe,
 * before the take. COPY-UNSIGNED. DESIGN: not drawn (NEEDS_DESIGN_LIEN_NOTICE: placed as a quote row
 * and a note until design draws it).
 */
export const LIEN_QUOTE_COPY = {
  row: 'Paid to the person you owe',
  note: (paid: string, kept: string) =>
    `You owe another trader after a dispute. This purchase pays ${paid} of it, from the XMR you buy. You receive ${kept}. Tapping Trade agrees to this.`,
  failed: 'We could not check what this purchase pays to the person you owe. Try again in a moment.',
  sheet: (paid: string) => `You owe another trader after a dispute. This purchase pays ${paid} of it, from the XMR you buy. Using a wallet agrees to this.`,
} as const;

/**
 * Seller lien recovery (owner 27 Nov 2026, docs/lien-recovery.md "Debtor is the seller"): a seller
 * who owes a lien sends extra on top of the sale, and sees and accepts the figure before the trade
 * starts (the quote for a buy ad, the accept sheet for their own sell ad) and again on the funding
 * screen. Only the seller ever sees it. COPY-UNSIGNED. DESIGN: not drawn (NEEDS_DESIGN_SELLER_LIEN:
 * placed as a quote row and a note until design draws it).
 */
export const SELLER_LIEN_COPY = {
  row: 'Extra for what you owe',
  fundRow: 'Includes extra for what you owe',
  explain: 'It goes to the person you owe when the trade completes; you get it back if the trade is refunded.',
  note: (extra: string) =>
    `Extra for what you owe: ${extra}. It goes to the person you owe when the trade completes; you get it back if the trade is refunded. Tapping Trade agrees to this.`,
  sheet: (extra: string) =>
    `Extra for what you owe: ${extra}. It goes to the person you owe when the trade completes; you get it back if the trade is refunded. Using a wallet agrees to this.`,
  failed: 'We could not check the extra you send for what you owe. Try again in a moment.',
} as const;
