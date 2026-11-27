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
  sellNote: 'Selling XMR does not pay it back.',
  fromTrade: (code: string) => `From trade ${code}`,
  owedToTitle: 'Owed to you after a dispute',
  owedToIntro: 'What this trader receives when they buy XMR is paid to you until the amount is paid in full.',
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
  // Owner decision 26 Nov 2026 (5:43 PM): 7 days to pay the agreed way. COPY-UNSIGNED
  graceOwes: (method: string, until: string) =>
    `A moderator gave you until ${until} to pay this the way you both agreed: ${method}. Nothing is taken from your trades until then. The person you owe must confirm they have been paid.`,
  graceOwesLapsed: (method: string) =>
    `The time to pay the agreed way (${method}) has passed and the person you owe has not confirmed payment. A moderator will decide what happens next; from then on what you receive in later trades may go to them.`,
  graceOwedTo: (method: string, until: string) =>
    `A moderator gave them until ${until} to pay you the way you both agreed: ${method}. Nothing is taken from their trades until then. Confirm here once you have received it.`,
  graceOwedToLapsed: (method: string) =>
    `The time to pay the agreed way (${method}) has passed. A moderator has been told. If you have been paid, confirm it here.`,
  graceConfirm: "I've been paid",
  graceConfirmCheck: 'Only confirm once the money is in your account. This ends what they owe you for good.',
  graceConfirmYes: 'Yes, I have been paid in full',
  graceConfirmNo: 'Not yet',
  // Ended as paid outside X2F: the person owed confirmed it, or a moderator did once the two settled it.
  gracePaid: 'This was paid outside X2F. Nothing more is owed to you.',
  gracePaidDebtor: 'This was paid outside X2F. You owe nothing more.',
} as const;

/** A deadline for the lien screen, in the reader's own time zone. */
export function deadlineText(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

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
