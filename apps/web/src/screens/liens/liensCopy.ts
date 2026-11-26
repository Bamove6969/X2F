/**
 * Lien recovery copy (owner 16 Nov 2026, docs/lien-recovery.md). COPY-UNSIGNED: the owner's
 * meaning ("advised that their proceeds will be deducted at a rate of 50% until they have paid back
 * the lien in full"), not his words. DESIGN: not drawn.
 */
export const LIENS_COPY = {
  title: 'What you owe after a dispute',
  none: 'You do not owe anything from a dispute.',
  owesIntro: (pct: string) =>
    `A moderator decided you owe this amount to the other trader. You can keep trading. Each time you buy XMR, ${pct} of what you receive goes to them until it is paid in full.`,
  owed: 'Owed',
  recovered: 'Paid back so far',
  remaining: 'Still to pay',
  rate: 'Taken from each purchase',
  suspended: 'On hold while your appeal is decided.',
  sellNote: 'Selling XMR does not pay it back.',
  fromTrade: (code: string) => `From trade ${code}`,
  owedToTitle: 'Owed to you after a dispute',
  owedToIntro: 'Part of what this trader receives from their trades is paid to you until the amount is paid in full.',
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

/** Basis points as a percentage: 5000 → "50%", 2550 → "25.5%". */
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
