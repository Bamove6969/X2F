import { detectSensitiveText } from '@x2f/proof';

/**
 * The personal-details check on review notes (P5-A6): "Remove personal details from the note."
 *
 * Plan 5 Task 3 uses Task 7's `detectSensitiveText` from `@x2f/proof`, so notes follow the owner's
 * rules as built there: emails, phones, cards, IBANs, account numbers, Monero addresses and UPI IDs
 * are refused (owner 2026-11-02: notes refuse all personal details, UPI included); amounts written
 * with thousands separators, decimals, dates, year ranges and trade codes are not details (item 29,
 * Q13-Q15); handles, street addresses and names are left to the person reviewed to report (Q16).
 */
export function hasPersonalDetails(note: string): boolean {
  return detectSensitiveText(note).length > 0;
}
