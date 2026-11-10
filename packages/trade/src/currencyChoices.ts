/**
 * The currency picker's data (J-16; owner Q28, 6 Nov 2026, O-019: "top 5-6 most common, then A-Z, all
 * with flags"; owner Q24, O-020: a currency with no market rate now shows as unavailable, or is
 * hidden, and is back the moment its rate is). This is data only: how an unavailable currency looks
 * (a tag or hidden) is design's pick (J-32, O-021).
 */

/** The most common currencies, first in every currency list, in this order (lead's reading of Q28). */
export const TOP_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'] as const);

/** One entry of the picker: the ISO 4217 code, its flag, and whether it has a market rate now. */
export interface CurrencyChoice {
  code: string;
  flag: string;
  available: boolean;
}

/**
 * The flag of an ISO 4217 code: the regional-indicator pair of its first two letters, the ISO 3166
 * country (EUR's "EU" is the European Union flag). Every code the price feed quotes follows this.
 */
export function currencyFlag(code: string): string {
  if (!/^[A-Z]{3}$/.test(code)) throw new RangeError('not an ISO 4217 code');
  return String.fromCodePoint(...[...code.slice(0, 2)].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * `codes` as the picker lists them: TOP_CURRENCIES first (those in `codes`), then the rest A-Z by
 * code; each with its flag and `available` = `hasRate(code)` asked now, so a currency whose rate
 * comes back is available on the next call.
 */
export function currencyChoices(codes: readonly string[], hasRate: (code: string) => boolean): CurrencyChoice[] {
  const top = TOP_CURRENCIES.filter((c) => codes.includes(c));
  const rest = [...new Set(codes)].filter((c) => !(TOP_CURRENCIES as readonly string[]).includes(c)).sort();
  return [...top, ...rest].map((code) => ({ code, flag: currencyFlag(code), available: hasRate(code) }));
}
