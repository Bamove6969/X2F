// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md): a payout wallet is saved for future
// trades or is for one trade only (the API's `oneTime`; the trade that uses it takes it off the list).
// COPY-UNSIGNED: every string in this file.

/** The add form's choice in Settings → Your wallets. COPY-UNSIGNED */
export const KEEP_FOR = {
  legend: 'Use it for',
  saved: 'Future trades',
  savedNote: 'It stays here until you remove it.',
  oneTime: 'One trade only',
  // Review 17 Nov M3: the restore runs only for a cancel in setup (owner Q10; extending it is OQ2). COPY-UNSIGNED
  oneTimeNote: 'Pick it when you start a trade. Once that trade uses it, it leaves this list. It comes back only if that trade is cancelled while it is still being set up.',
} as const;

/** The tag on a one-time wallet in the lists. COPY-UNSIGNED */
export const ONE_TIME_TAG = 'One trade only';

/** Owner, 17 Nov 2026: the default payout wallet, picked first when a trade starts. COPY-UNSIGNED */
export const DEFAULT_TAG = 'Default';
export const MAKE_DEFAULT = 'Make default';
export const MAKE_DEFAULT_FAILED = 'That wallet could not be made the default. Try again.';

/** Review 17 Nov M4: the add's answer named another address than the one typed on this device. COPY-UNSIGNED */
export const ADD_SWAPPED = 'X2F answered with a different address from the one you typed, so it is not shown as saved. Check Your wallets before you trade.';

/** Review 17 Nov M4: a listed wallet whose address differs from the one typed on this device for it. COPY-UNSIGNED */
export const NOT_MATCHING = 'This address does not match the one you typed on this device.';


/**
 * Review 17 Nov (b) M1: a one-time wallet a trade still being set up is using. It comes back if that
 * trade ends before it is funded; removing it now means it never comes back. COPY-UNSIGNED
 */
export const IN_USE_WORD = 'In use';
export const IN_USE_NOTE = (code: string) => `By trade ${code}. It comes back if that trade is cancelled before it is funded, unless you remove it.`;

/**
 * Owner demo note #226 (25 Nov 2026): "an option to change it rename the wallet in settings later.
 * Traders want to know where each wallet is going". The Rename action on a wallet row and its sheet.
 * COPY-UNSIGNED (note #226)
 */
export const RENAME = {
  action: 'Rename',
  actionLabel: (name: string) => `Rename ${name}`,
  title: 'Rename wallet',
  field: 'Wallet name',
  help: 'Only the name changes. The address, the default and any wait stay as they are.',
  invalid: 'Use 1 to 40 characters, with no hidden or control characters.',
  save: 'Save name',
  cancel: 'Cancel',
  failed: 'That wallet could not be renamed. Try again.',
  // A 404: the wallet was removed meanwhile.
  gone: 'That wallet was removed from your list meanwhile.',
} as const;
