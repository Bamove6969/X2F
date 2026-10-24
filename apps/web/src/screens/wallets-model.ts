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

/** The most wallets one add may carry (FU-B `MAX_WALLET_BATCH`; owner, 2026-10-24). */
export const MAX_WALLET_BATCH = 10;

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
  const h = rule.waitHours;
  if (rule.firstWallet) {
    return [
      'This is your first wallet, so it works at once, however you confirm.',
      'You can add several at once, and they all work at once.',
    ];
  }
  const lines: string[] = [];
  const strong = rule.strongMethods;
  if (strong.length > 0) {
    lines.push(
      `You use ${methodList(strong)}: confirm with ${strong.length === 1 ? 'it' : 'one of them'} and your new wallets work at once.`,
    );
    if (rule.password === 'waits') {
      lines.push(`If you confirm with your password instead, they work ${h} hours after you add them.`);
    }
  } else if (rule.password === 'waits') {
    lines.push(`You only have a password: new wallets will work ${h} hours after you add them.`);
    lines.push('Add a passkey, security key or PGP key first to skip the wait.');
  } else {
    lines.push("Saving asks you to confirm it's you.");
  }
  lines.push(
    rule.password === 'waits'
      ? `One confirm covers several wallets, and they share one ${h}-hour wait, not one each.`
      : 'One confirm covers several wallets.',
  );
  return lines;
}

/** The short reminder under the form, from the same rule. */
export function ruleNote(rule: WalletRule | null): string {
  if (rule === null) return "Saving asks you to confirm it's you. New wallets may wait 24 hours, depending on how you confirm.";
  if (rule.firstWallet) return 'Your first wallet works at once.';
  if (rule.strongMethods.length > 0) {
    const wait = rule.password === 'waits' ? ` With your password they wait ${rule.waitHours} hours.` : '';
    return `Confirm with ${methodList(rule.strongMethods)} and they work at once.${wait}`;
  }
  if (rule.password === 'waits') return `They will work ${rule.waitHours} hours after you add them.`;
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
