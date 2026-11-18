/**
 * Which staff API error codes are "can't do that" refusals (X2F's own rule stopping this person,
 * shown with the kit's one CantDoThat dialog) and their words (Plan 4 Task 16). Everything else
 * (a typo, a wrong code, an expired step, a network fault) is a fault, shown in a danger Notice by
 * the screen that made the call.
 *
 * Every sentence here is draft copy. COPY-UNSIGNED
 */
import { codeOf } from './api.js';

export const STAFF_REFUSALS = {
  // Task 4: a switched-off staff member, or a login outside the member's login hours (the API
  // checks both only after the keys verified).
  'account-disabled': 'This staff account is switched off. Ask the owner to switch it back on.',
  'outside-login-hours': 'You can log in only during your login hours. Ask the owner if they need to change.',
  // Task 4 and 6: a key the staff site does not take (an owner key that X2F cannot check, a pair
  // that is not allowed).
  'method-not-allowed': 'The staff site does not take that key. Use a hardware security key that X2F can check, such as a YubiKey, or your PGP key.',
  // Task 7: what an invite needs before it can finish.
  'security-key-required': 'Moderators need a hardware security key. Add one to finish.',
  'two-factors-required': 'Staff log in with two keys. Add a second key to finish.',
  // Owner G3 (owner-page3, review 8 Nov I-4): a moderator holds all three methods; a staff passkey
  // is another device than the security key; a change to the owner's keys takes both owner keys.
  'all-three-methods-required': 'Moderators keep three keys: a hardware security key, a passkey and a PGP key. Add the missing one to finish.',
  // D-070 (owner p11-19): the security key became optional for a moderator; a PGP key and a passkey are not.
  'moderator-methods-required': 'Moderators need a passkey and a PGP key. A hardware security key is optional. Add the missing one to finish.',
  'passkey-is-security-key': 'That passkey is on your security key. Register the passkey on another device, such as your phone or computer.',
  'both-owner-keys-required': 'This change needs a tap from both owner security keys. Tap the second key to finish.',
  // Task 6: setup cannot finish without both keys and the PGP key (the button stays disabled until
  // they are in; these are the server's word if it is pressed anyway).
  'owner-needs-two-keys': 'The owner account needs two security keys. Register the spare key to finish.',
  'owner-needs-pgp': 'The owner account needs a PGP key. Add it to finish.',
  forbidden: 'Your role does not include this page.',
  // J-14 (D-059): a compromised-account ticket closes only once its lock is lifted.
  'account-locked': 'This account is still locked. Unlock it first, once you are sure the person is its real owner.',
} as const satisfies Record<string, string>;

export type StaffRefusal = keyof typeof STAFF_REFUSALS;

/** The refusal in `e`, or null when `e` is a fault (or no API answer at all). */
export function refusalOf(e: unknown): { code: StaffRefusal; text: string } | null {
  const code = codeOf(e);
  if (code === null || !Object.hasOwn(STAFF_REFUSALS, code)) return null;
  return { code: code as StaffRefusal, text: STAFF_REFUSALS[code as StaffRefusal] };
}

/** A fault's sentence: the network, a slow-down, an expired step, or `fallback`. COPY-UNSIGNED */
export function faultText(e: unknown, fallback: string): string {
  const code = codeOf(e);
  if (code === null) return 'X2F could not be reached just now. Try again.';
  if (code === 'slow-down') return 'Too many tries. Wait a few minutes, then try again.';
  if (code === 'challenge-expired') return 'That step has expired. Start again.';
  return fallback;
}
