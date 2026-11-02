/**
 * What to check when a past-reputation key or signature is refused (owner item 75, 2 Nov 2026: the
 * check stays strict, with no allowance for a signature dated ahead of the server clock; the
 * refusal lists these). Returned as `help` on start's key refusals and on finish's
 * `bad-signature`, `wrong-text` and `wrong-key`, like a refused key's `detail` sentence, which the
 * web shows as the server wrote it. How the list is shown is Claude Design's.
 */

// COPY-UNSIGNED: the owner's four points, in his order; wording not yet signed off.
export const PAST_REP_SIGNING_HELP: readonly string[] = Object.freeze([
  "Check the public key's format: the right number of dashes and the spacing. The top and bottom lines should look alike.",
  "Check that your computer's date and time are correct.",
  'Sign the message. Do not encrypt it to anyone.',
  'Use up-to-date PGP software.',
]);
