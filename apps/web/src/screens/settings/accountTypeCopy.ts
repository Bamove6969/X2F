// Owner 2 Nov 2026: Settings > Account type (Trader and Vendor accounts), in the words of the
// BecomeVendor board (origin/wip/design-brief docs/design-boards/BecomeVendor.dc.html, "Draft
// copy"). COPY-UNSIGNED: the owner signs it off with the board. Refusals (vendor-needs-key,
// not-vendor, a password confirm) are CantDoThat's, worded in ui/cantDoCodes.ts.
//
// Left out on purpose: the board's "Session length" row (per-type session lengths are not built
// yet) and its "Switching back" sheet (OPEN, owner: what happens to live offers and the team).

export const ACCOUNT_TYPE_PATH = '/settings/account-type';

export const ACCOUNT_TYPE_COPY = {
  title: 'Account type',
  intro: "Traders take offers. Vendors post them. Switch when you're ready to post your own.",
  yourAccount: 'Your account',
  current: 'Current',
  typeName: { trader: 'Trader', vendor: 'Vendor' } as const,
  typeText: {
    trader: 'You take offers that vendors post. You pay no fee.',
    vendor: 'You post offers and can add team members. You pay the 1% fee on completed trades.',
  } as const,
  compareTitle: 'Trader vs vendor',
  compareCaption: 'What changes between a trader and a vendor account',
  rows: [
    { what: 'Post offers', trader: 'No', vendor: 'Yes' },
    { what: 'Team members (up to 3)', trader: 'No', vendor: 'Yes' },
    { what: 'Fee on completed trades', trader: 'None', vendor: '1%' },
  ] as const,
  becomeTitle: 'To become a vendor',
  keyReq: 'Two-factor method set up (passkey, security key or PGP key)',
  keyMet: 'The account holder (team lead) has a passkey, security key or PGP key.',
  keyNotMet: "The account holder (team lead) needs a passkey, security key or PGP key. A username and password alone isn't enough.",
  met: 'Met',
  notMet: 'Not met',
  addKey: 'Add a passkey, security key or PGP key',
  switchButton: 'Switch to a vendor account',
  sheetTitle: 'Switch to a vendor account?',
  sheetLines: ['You can post offers and add team members.', 'You pay the 1% fee on completed trades.', 'You confirm with your passkey, security key or PGP key.'] as const,
  sheetConfirm: 'Switch to vendor',
  cancel: 'Cancel',
  switched: 'Your account is now a vendor account.',
  postOffer: 'Post an offer',
  switchBack: 'Switching back to a trader account comes later.',
  loadFailed: 'Your account type could not be loaded. Try again.',
  saveFailed: 'Something went wrong and your account was not switched. Try again.',
  signedOut: 'Log in to see your account type.',
} as const;
