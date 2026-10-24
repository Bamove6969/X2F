// The wallets screen's data model, kept free of React and CSS so the trade-take picker
// (Tasks 17-19) and the Playwright spec can import `takeableWallets` without pulling in a DOM.

/** The wallet apps a person can pick when adding a wallet (spec 6.4); same codes as the API's WALLET_APPS. */
export const WALLET_APPS = ['cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other'] as const;
export type WalletApp = (typeof WALLET_APPS)[number];

/** A payout wallet exactly as `GET /v1/wallets` returns it: name, the end of its address, and status, never a balance. */
export interface WalletView {
  id: string;
  app: WalletApp;
  label: string;
  /** The full address is sent but the screen only ever shows `addressEnd`, never a balance. */
  address: string;
  addressEnd: string;
  usableFrom: string;
  /** `usableFrom <= now`: false while the 24-hour wait (spec 6.3) runs. */
  usable: boolean;
}

/** The app names shown on the picker chips and wallet rows (the board's `names` list). */
export const APP_LABELS: Record<WalletApp, string> = {
  cake: 'Cake Wallet',
  edge: 'Edge',
  feather: 'Feather',
  monerujo: 'Monerujo',
  stack: 'Stack',
  'monero-gui-cli': 'Monero GUI',
  'ledger-trezor': 'Ledger or Trezor',
  other: 'Other',
};

/** The name used in "Receive address from <app>"; "Other" reads as "your wallet" (board). */
export function appPromptName(app: WalletApp): string {
  return app === 'other' ? 'your wallet' : APP_LABELS[app];
}

/**
 * The wallets a trade's payout/refund picker may offer: only those past any 24-hour wait
 * (spec 6.3, 6.4). A waiting wallet is shown on this screen with its status but is never takeable,
 * so the take picker (Tasks 17-19) filters its list through this one source of truth.
 */
export function takeableWallets(list: readonly WalletView[]): WalletView[] {
  return list.filter((w) => w.usable);
}

export type WalletTone = 'ready' | 'waiting';

/** The status word and tone for a wallet row: teal "Ready" or amber "Waiting" (board + spec 6.4). */
export function walletStatus(w: WalletView): { label: string; tone: WalletTone } {
  return w.usable ? { label: 'Ready', tone: 'ready' } : { label: 'Waiting', tone: 'waiting' };
}

// TRIPWIRE / TODO(FU-B merge): copied from the lead's FU-B (wip/lead-p2-fub, @x2f/auth-client
// `WalletDraft` and `WalletRule`); use those once FU-B is on the main line
// (apps/web/test/wallets-tripwires.test.ts fails until then).

/** One wallet of an add: what the person fills in. */
export interface WalletDraft {
  app: WalletApp;
  label: string;
  address: string;
}

/**
 * `GET /v1/wallets/rule`: what adding wallets will do for this account (owner, 2026-10-24).
 * `firstWallet`: it never had one, so the next add works at once whatever the method.
 * `strongMethods`: methods it holds that make new wallets work at once. `password`: whether a
 * password confirm is possible and would wait.
 */
export interface WalletRule {
  firstWallet: boolean;
  strongMethods: Array<'pgp' | 'passkey' | 'security-key'>;
  password: 'none' | 'immediate' | 'waits';
  waitHours: number;
}
