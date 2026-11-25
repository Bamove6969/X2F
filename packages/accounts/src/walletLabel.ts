/**
 * A payout wallet's name (its `label`), one rule for the API's add and rename routes
 * (apps/api/src/wallets/routes.ts) and for the web forms that name a wallet (owner demo note #226,
 * 25 Nov 2026: "an option to name the wallet when they enter it in and an option to ... rename the
 * wallet in settings later").
 *
 * A name is 1 to WALLET_LABEL_MAX characters (code points) once trimmed, with no control (C0, C1,
 * DEL) or format characters (bidi overrides such as U+202E, zero-width characters): it is shown
 * back in lists, pickers and alerts. Names need not be unique on an account (the add never asked).
 */
export const WALLET_LABEL_MAX = 40;

const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** The trimmed name when `raw` is an allowed wallet name, else null. */
export function cleanWalletLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  const length = [...clean].length;
  if (length < 1 || length > WALLET_LABEL_MAX || CONTROL.test(clean)) return null;
  return clean;
}
