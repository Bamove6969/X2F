// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md): a payout wallet is saved for future
// trades or is for one trade only (the API's `oneTime`; the trade that uses it takes it off the list).
// COPY-UNSIGNED: every string in this file.

/** The add form's choice in Settings → Your wallets. COPY-UNSIGNED */
export const KEEP_FOR = {
  legend: 'Use it for',
  saved: 'Future trades',
  savedNote: 'It stays here until you remove it.',
  oneTime: 'One trade only',
  oneTimeNote: 'Pick it when you start a trade. Once that trade uses it, it leaves this list. If that trade is cancelled before any XMR is sent, it comes back.',
} as const;

/** The tag on a one-time wallet in the lists. COPY-UNSIGNED */
export const ONE_TIME_TAG = 'One trade only';

/** Owner, 17 Nov 2026: the default payout wallet, picked first when a trade starts. COPY-UNSIGNED */
export const DEFAULT_TAG = 'Default';
export const MAKE_DEFAULT = 'Make default';
export const MAKE_DEFAULT_FAILED = 'That wallet could not be made the default. Try again.';
