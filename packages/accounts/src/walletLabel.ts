/**
 * A payout wallet's name (its `label`), one rule for the API's add and rename routes
 * (apps/api/src/wallets/routes.ts), the sign-up wallet step and the web forms that name a wallet
 * (owner demo note #226, 25 Nov 2026: "an option to name the wallet when they enter it in and an
 * option to ... rename the wallet in settings later").
 *
 * A name is shown next to the wallet's real details (its app, its address's last 6 characters, its
 * Default / Ready tags) wherever wallets are listed or picked, so it must never be able to pass for
 * those details (security review of wip/lead-note-226, Medium 1). Refused (`walletLabelProblem`):
 * - `length`: empty once trimmed, or over WALLET_LABEL_MAX characters (code points);
 * - `characters`: control or format characters (C0, C1, DEL, bidi overrides such as U+202E,
 *   zero-width characters), and the Trade Tag's script checks (`unsafeScripts`: invisible
 *   characters, right-to-left letters, stray combining marks, mixed or confusable scripts such as a
 *   Cyrillic `а` among Latin letters);
 * - `separator`: the separators the lists draw between a name and its details ("…", "·", "•" and
 *   their look-alikes, two dots or more in a row, a vertical bar);
 * - `status`: a word the lists use for a wallet's state ("Default", "Ready", "Usable", "Waiting",
 *   "Verified", "In use", "One trade only"), as a word of its own, any case, look-alikes and digits
 *   drawn like letters folded (`D3fault`);
 * - `address`: 5 or more characters of the end of one of the account's own wallet addresses, under
 *   `addressFold` (NFKC, any case, 0/o and 1/i/l as one, spaces, hyphens and dots dropped:
 *   `labelSpoofsAddress`); or, for any address, after NFKC, a run of 6 or more letters and digits
 *   (base58 and its excluded look-alikes 0, O, I, l; joined across hyphens, dots and underscores)
 *   holding a digit or a capital letter after its first character (address ends such as `Rk3Fz1`),
 *   other than a word with a number after it ("Wallet-2"). Plain words are runs of base58 letters too ("Savings",
 *   "Spending"), so a run of lower-case letters after one capital is allowed.
 * Names need not be unique on an account (the add never asked). Stored names keep the rule they
 * were saved under.
 */
import { lookAlikeKey, unsafeScripts } from './username.js';

export const WALLET_LABEL_MAX = 40;

export type WalletLabelProblem = 'length' | 'characters' | 'separator' | 'status' | 'address';

const CONTROL = /[\p{Cc}\p{Cf}]/u;
/** The lists' separators and their look-alikes: ellipses, middle dots, bullets, bars, two dots or more. */
const SEPARATOR = /[⋯․‥✓✔☑…··•‣‧∙⋅・･◦⁃⸱⸳᛫ᐧꞏ|¦❘]|\.{2,}/u;
/** The words the lists show for a wallet's state (Wallets.tsx, WalletPicker, AcceptedSheet), as look-alike keys. */
const STATUS_WORDS = ['default', 'ready', 'usable', 'waiting', 'verified'].map(lookAlikeKey);
const STATUS_PHRASES = [['in', 'use'], ['one', 'trade', 'only']].map((p) => p.map(lookAlikeKey));
/**
 * Verification review of wip/lead-note-226 (Medium): the fold an address end and a name are compared
 * under, so a look-alike of the end cannot slip through: NFKC (full-width ｒ, mathematical 𝐑 and
 * 𝟑 become plain r and 3), lower case, the base58-excluded look-alikes as one letter each (0 and o
 * as o; 1, i and l as l), and every character but a letter or digit dropped (spaces, hyphens, dots).
 */
export function addressFold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/[1i]/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The folded 5-character windows of an address's last 6 characters (what the lists show of it). */
function endWindows(address: string): string[] {
  const end = addressFold(address.trim().slice(-6));
  const out = new Set<string>();
  for (let i = 0; i + 5 <= end.length; i++) out.add(end.slice(i, i + 5));
  return [...out];
}

/**
 * Whether the name holds, under `addressFold`, 5 or more characters of the end of one of these
 * addresses (the account's wallets, removed ones included, and the one being added): "Savings
 * kfzxqm", "Rk3-Fz1" or "ＲＫ３ＦＺ１" against a wallet ending Rk3Fz1.
 */
export function labelSpoofsAddress(name: string, addresses: readonly string[]): boolean {
  const folded = addressFold(name);
  if (folded.length < 5) return false;
  return addresses.some((a) => endWindows(a).some((w) => folded.includes(w)));
}

/**
 * The backstop for any address end, the account's or not: after NFKC, a run of 6 or more characters
 * drawn from base58 and its excluded look-alikes (0, O, I, l), joined across hyphens, dots and
 * underscores (`Rk3-Fz1`), that holds a digit or a capital after its first character.
 */
function looksLikeAddressEnd(name: string): boolean {
  const joined = name.normalize('NFKC').replace(/(?<=[A-Za-z0-9])[-._]+(?=[A-Za-z0-9])/g, '');
  for (const m of joined.matchAll(/[A-Za-z0-9]{6,}/g)) {
    const run = m[0];
    // A word and a number after it ("Wallet-2", "Monero2025") reads as a name; the account's own
    // address ends of that shape are still caught by `labelSpoofsAddress`.
    if (/^[A-Za-z][a-z]{2,}\d{1,4}$/.test(run)) continue;
    if (/\d/.test(run) || /[A-Z]/.test(run.slice(1))) return true;
  }
  return false;
}

/** Digits drawn like letters (as the new trade-tag rule folds them): `D3fault`, `R3ady`. */
const DIGIT_LETTERS: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '8': 'b', '9': 'g' };

function hasStatusWord(name: string): boolean {
  const words = lookAlikeKey(name.replace(/[0-9]/g, (d) => DIGIT_LETTERS[d] ?? d)).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
  if (words.some((w) => STATUS_WORDS.includes(w))) return true;
  return STATUS_PHRASES.some((p) => words.some((_, i) => p.every((w, j) => words[i + j] === w)));
}

/**
 * Why `raw` may not be a wallet's name, or null when it may (then `cleanWalletLabel` gives the name
 * stored). `addresses`: the account's wallet addresses the name must not spoof (`labelSpoofsAddress`;
 * the API passes all of them, removed ones and the one being added included; a client passes those it has).
 */
export function walletLabelProblem(raw: unknown, addresses: readonly string[] = []): WalletLabelProblem | null {
  if (typeof raw !== 'string') return 'characters';
  if (raw.length > WALLET_LABEL_MAX * 4) return 'length';
  const clean = raw.normalize('NFC').trim();
  const length = [...clean].length;
  if (length < 1 || length > WALLET_LABEL_MAX) return 'length';
  if (CONTROL.test(clean) || unsafeScripts(clean)) return 'characters';
  if (SEPARATOR.test(clean) || SEPARATOR.test(clean.normalize('NFKC')) || SEPARATOR.test(lookAlikeKey(clean))) return 'separator';
  if (hasStatusWord(clean)) return 'status';
  if (looksLikeAddressEnd(clean) || labelSpoofsAddress(clean, addresses)) return 'address';
  return null;
}

/** The name stored (NFC, trimmed) when `raw` is an allowed wallet name, else null. */
export function cleanWalletLabel(raw: unknown, addresses: readonly string[] = []): string | null {
  return walletLabelProblem(raw, addresses) === null ? (raw as string).normalize('NFC').trim() : null;
}
