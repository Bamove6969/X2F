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
 *   zero-width characters), and the display name's script checks (`unsafeScripts`: invisible
 *   characters, right-to-left letters, stray combining marks, mixed or confusable scripts such as a
 *   Cyrillic `а` among Latin letters);
 * - `separator`: the separators the lists draw between a name and its details ("…", "·", "•" and
 *   their look-alikes, two dots or more in a row, a vertical bar);
 * - `status`: a word the lists use for a wallet's state ("Default", "Ready", "Usable", "Waiting",
 *   "Verified", "In use", "One trade only"), as a word of its own, any case, look-alikes and digits
 *   drawn like letters folded (`D3fault`);
 * - `address`: something that reads like the end of a Monero address: a run of 6 or more base58
 *   characters ([1-9A-HJ-NP-Za-km-z]) holding a digit or a capital letter after its first character
 *   (address ends such as `Rk3Fz1`). Plain words are runs of base58 letters too ("Savings",
 *   "Spending"), so a run of lower-case letters after one capital is allowed.
 * Names need not be unique on an account (the add never asked). Stored names keep the rule they
 * were saved under.
 */
import { lookAlikeKey, unsafeScripts } from './username.js';

export const WALLET_LABEL_MAX = 40;

export type WalletLabelProblem = 'length' | 'characters' | 'separator' | 'status' | 'address';

const CONTROL = /[\p{Cc}\p{Cf}]/u;
/** The lists' separators and their look-alikes: ellipses, middle dots, bullets, bars, two dots or more. */
const SEPARATOR = /[…··•‣‧∙⋅・･◦⁃⸱⸳᛫ᐧꞏ|¦❘]|\.{2,}/u;
/** The words the lists show for a wallet's state (Wallets.tsx, WalletPicker, AcceptedSheet), as look-alike keys. */
const STATUS_WORDS = ['default', 'ready', 'usable', 'waiting', 'verified'].map(lookAlikeKey);
const STATUS_PHRASES = [['in', 'use'], ['one', 'trade', 'only']].map((p) => p.map(lookAlikeKey));
/** A run of base58 characters, 6 or more. */
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{6,}/g;

function looksLikeAddressEnd(name: string): boolean {
  for (const m of name.matchAll(BASE58_RUN)) {
    const run = m[0];
    if (/\d/.test(run) || /[A-Z]/.test(run.slice(1))) return true;
  }
  return false;
}

/** Digits drawn like letters (as the new display-name rule folds them): `D3fault`, `R3ady`. */
const DIGIT_LETTERS: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '8': 'b', '9': 'g' };

function hasStatusWord(name: string): boolean {
  const words = lookAlikeKey(name.replace(/[0-9]/g, (d) => DIGIT_LETTERS[d] ?? d)).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
  if (words.some((w) => STATUS_WORDS.includes(w))) return true;
  return STATUS_PHRASES.some((p) => words.some((_, i) => p.every((w, j) => words[i + j] === w)));
}

/** Why `raw` may not be a wallet's name, or null when it may (then `cleanWalletLabel` gives the name stored). */
export function walletLabelProblem(raw: unknown): WalletLabelProblem | null {
  if (typeof raw !== 'string') return 'characters';
  if (raw.length > WALLET_LABEL_MAX * 4) return 'length';
  const clean = raw.normalize('NFC').trim();
  const length = [...clean].length;
  if (length < 1 || length > WALLET_LABEL_MAX) return 'length';
  if (CONTROL.test(clean) || unsafeScripts(clean)) return 'characters';
  if (SEPARATOR.test(clean) || SEPARATOR.test(lookAlikeKey(clean))) return 'separator';
  if (hasStatusWord(clean)) return 'status';
  if (looksLikeAddressEnd(clean)) return 'address';
  return null;
}

/** The name stored (NFC, trimmed) when `raw` is an allowed wallet name, else null. */
export function cleanWalletLabel(raw: unknown): string | null {
  return walletLabelProblem(raw) === null ? (raw as string).normalize('NFC').trim() : null;
}
