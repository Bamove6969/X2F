/**
 * The ending shown for a payout address: the last 6 characters of the trimmed FULL address, the
 * same rule as @x2f/accounts `addressEnd`. Screens that also hold the full address (the quote's
 * wallet picker, the accepted-offer sheet) cut it here rather than trusting the API's separate
 * `addressEnd`, so the ending the person checks is the ending of the address the escrow pays to
 * (Task 19 re-review, gap 2).
 */
export function addressEnd(address: string): string {
  return address.trim().slice(-6);
}

/** The longest payout address a screen accepts into a confirmed record (as `readConfirmed`). */
export const MAX_ADDRESS_LENGTH = 256;

/** Whether `address` can be confirmed for a trade: non-empty and at most 256 characters. */
export function confirmableAddress(address: unknown): address is string {
  return typeof address === 'string' && address.trim() !== '' && address.length <= MAX_ADDRESS_LENGTH;
}
