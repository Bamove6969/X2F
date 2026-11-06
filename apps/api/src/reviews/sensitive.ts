/**
 * The personal-details check on review notes (P5-A6): "Remove personal details from the note."
 *
 * NEEDS_TASK_7_SENSITIVE_TEXT: Plan 5 Task 3 is meant to pass `s => detectSensitiveText(s).length > 0`
 * from `@x2f/proof` (Task 7), which is being built in parallel and is not on this tree yet. Until it
 * lands, this small local check stands in: it flags emails, phone/card/account-like digit runs,
 * IBAN-shaped strings and Monero addresses, and errs on the side of refusing. When `@x2f/proof`
 * exports `detectSensitiveText`, replace the body with that call (add `@x2f/proof` to
 * apps/api/package.json) and delete this stand-in; the tripwire in apps/api/test/reviews-tripwire.test.ts
 * fails until then.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/u;
/** Seven or more digits, allowing spaces, dots, dashes, slashes and brackets between them (phones, cards, accounts). */
const DIGIT_RUN = /\d(?:[\s().\/-]*\d){6,}/u;
/** IBAN-shaped: two letters, two digits, then 10-30 letters or digits (spaces allowed). */
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/iu;
/** A Monero standard, subaddress or integrated address (base58, 95 or 106 characters, starting 4 or 8). */
const XMR_ADDRESS = /\b[48][1-9A-HJ-NP-Za-km-z]{94}(?:[1-9A-HJ-NP-Za-km-z]{11})?\b/u;

export function hasPersonalDetails(note: string): boolean {
  return EMAIL.test(note) || DIGIT_RUN.test(note) || IBAN.test(note) || XMR_ADDRESS.test(note);
}
