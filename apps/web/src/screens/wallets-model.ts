// The wallets screen's data model, kept free of React and CSS so the trade-take picker
// (Tasks 17-19) and the Playwright spec can import `takeableWallets` without pulling in a DOM.

import type { Wallet, WalletApp, WalletDraft, WalletRule } from '@x2f/auth-client';

export type { WalletApp, WalletDraft, WalletRule };

/** The most wallets one add may carry: the API's own limit, re-exported by @x2f/auth-client. */
export { MAX_WALLET_BATCH } from '@x2f/auth-client';

/** The wallet apps a person can pick when adding a wallet (spec 6.4); same codes and order as the API. */
export const WALLET_APPS = ['cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other'] as const satisfies readonly WalletApp[];

/** A payout wallet exactly as `GET /v1/wallets` returns it: name, the end of its address, and status, never a balance. */
export type WalletView = Wallet;

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

/**
 * The Edge privacy tip (Wallets, TradeFund). Edge has no "Full Sync" setting (owner demo note 16 Nov
 * #96: "inside the edge wallet i dont see anything"): a Monero wallet's menu in Edge has Wallet
 * Settings, with LWS (Edge's light-wallet server, which sees incoming payments) or Full Node
 * (edge-react-gui WalletListMenuModal/WalletSettingsModal, strings wallet_setting_backend_option_*).
 * COPY-UNSIGNED
 */
export const EDGE_TIP =
  "For best privacy, open your Monero wallet's menu in Edge, choose Wallet Settings and pick Full Node. With LWS, Edge's servers can see payments coming in.";

/** The name used in "Receive address from <app>"; "Other" reads as "your wallet" (board). */
export function appPromptName(app: WalletApp): string {
  return app === 'other' ? 'your wallet' : APP_LABELS[app];
}

/**
 * The wallets a trade's payout/refund picker may offer: only those past any 24-hour wait
 * (spec 6.3, 6.4). A waiting wallet is shown on this screen with its status but is never takeable,
 * so the take picker (Tasks 17-19) filters its list through this one source of truth.
 */
export function takeableWallets<W extends Pick<WalletView, 'usable'>>(list: readonly W[]): W[] {
  return list.filter((w) => w.usable);
}

export type WalletTone = 'ready' | 'waiting';

/** The status word and tone for a wallet row: teal "Ready" or amber "Waiting" (board + spec 6.4). */
export function walletStatus(w: WalletView): { label: string; tone: WalletTone } {
  return w.usable ? { label: 'Ready', tone: 'ready' } : { label: 'Waiting', tone: 'waiting' };
}

const METHOD_NAMES: Record<WalletRule['strongMethods'][number], string> = {
  pgp: 'a PGP key',
  passkey: 'a passkey',
  'security-key': 'a security key',
};

/** "a passkey", "a passkey and a PGP key", "a passkey, a PGP key and a security key". */
function methodList(methods: WalletRule['strongMethods']): string {
  const names = methods.map((m) => METHOD_NAMES[m]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the Add a wallet popup says for this account, before anything is entered (spec 6.3,
 * "Wallet rules refined", 2026-10-24). One sentence per line.
 */
export function ruleLines(rule: WalletRule): string[] {
  if (rule.firstWallet) {
    return [
      'This is your first wallet, so it works at once, however you confirm.',
      'You can add several at once, and they all work at once.',
    ];
  }
  const lines: string[] = [];
  const strong = rule.strongMethods;
  if (strong.length > 0) {
    lines.push(`You use ${methodList(strong)}: confirm with ${strong.length === 1 ? 'it' : 'one of them'} and your new wallets work at once.`);
  } else {
    lines.push("Saving asks you to confirm it's you.");
  }
  lines.push('One confirm covers several wallets.');
  return lines;
}

/** The short reminder under the form, from the same rule. */
export function ruleNote(rule: WalletRule | null): string {
  if (rule === null) return "Saving asks you to confirm it's you. New wallets work at once.";
  if (rule.firstWallet) return 'Your first wallet works at once.';
  if (rule.strongMethods.length > 0) return `Confirm with ${methodList(rule.strongMethods)} and they work at once.`;
  return "Saving asks you to confirm it's you.";
}

/** The next neutral name, "Wallet N", counting the wallets already listed and those in this batch. */
export function nextWalletName(count: number): string {
  return `Wallet ${count + 1}`;
}

/** Neutral name suggestions (spec: labels are stored by X2F, so never where the money came from). */
export function nameSuggestions(count: number): string[] {
  return [...new Set([nextWalletName(count), 'Savings', 'Spending'])];
}
