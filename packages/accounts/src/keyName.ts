/**
 * The name a person gives their security key or passkey (owner 25 Nov security-key report: "it
 * should let me name it as well"). Checked the same way by the web (before sending) and the API
 * (`PUT /v1/account/webauthn/label`, which stores it as the credential's `label`).
 *
 * A name is NFC-normalised, trimmed, its runs of spaces folded to one, then must be 1 to
 * KEY_NAME_MAX code points of letters, combining marks, digits, spaces and the punctuation in
 * KEY_NAME_PUNCTUATION. Control, format (bidi overrides, zero-width) and every other character are
 * refused, so a name always shows as what it says.
 */

export const KEY_NAME_MAX = 32;
/** The punctuation a key name may hold besides letters, digits and spaces. */
export const KEY_NAME_PUNCTUATION = "-_.'’()#&+,/:";

export type KeyNameProblem = 'empty' | 'too-long' | 'characters';
export type KeyNameCheck = { ok: true; name: string } | { ok: false; problem: KeyNameProblem };

const ALLOWED = /^[\p{L}\p{M}\p{N} \-_.'’()#&+,/:]+$/u;

/** `raw` as it is stored (`ok`), or why it cannot be a key name. */
export function checkKeyName(raw: string): KeyNameCheck {
  const name = raw.normalize('NFC').replace(/ {2,}/g, ' ').trim();
  if (name === '') return { ok: false, problem: 'empty' };
  if (!ALLOWED.test(name)) return { ok: false, problem: 'characters' };
  if (Array.from(name).length > KEY_NAME_MAX) return { ok: false, problem: 'too-long' };
  return { ok: true, name };
}

/** The suggested name of the `n`th key of a kind (1-based): "Security key 1", "Passkey 2". */
export function defaultKeyName(kind: 'security-key' | 'passkey', n: number): string {
  const i = Number.isInteger(n) && n > 0 ? n : 1;
  return `${kind === 'passkey' ? 'Passkey' : 'Security key'} ${i}`;
}
