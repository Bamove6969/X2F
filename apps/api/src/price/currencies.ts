/**
 * The fiat currencies the price feed quotes, with each one's ISO 4217 exponent: the number of
 * decimal places of its minor unit, which is what "cents" means everywhere (Revision 2026-10-20).
 * 0 for JPY, KRW, CLP and VND; 3 for KWD and BHD; 2 for the rest. The list is the fiat set the
 * proposed sources quote (CoinGecko's, minus non-ISO codes); a currency outside it has no price.
 */
export const CURRENCY_EXPONENTS: Readonly<Record<string, 0 | 2 | 3>> = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2, HUF: 2,
  UAH: 2, TRY: 2, RUB: 2, GEL: 2, ILS: 2, AED: 2, SAR: 2, BHD: 3, KWD: 3, ZAR: 2, NGN: 2, BRL: 2, ARS: 2,
  CLP: 0, MXN: 2, BMD: 2, CNY: 2, HKD: 2, TWD: 2, JPY: 0, KRW: 0, SGD: 2, MYR: 2, THB: 2, IDR: 2, PHP: 2,
  VND: 0, INR: 2, PKR: 2, BDT: 2, LKR: 2, MMK: 2,
});

/** The currency's ISO 4217 exponent, or null when the feed does not quote it (codes are upper case). */
export function currencyExponent(currency: string): 0 | 2 | 3 | null {
  return Object.hasOwn(CURRENCY_EXPONENTS, currency) ? CURRENCY_EXPONENTS[currency]! : null;
}

// Plain decimals only: no sign, exponent, spaces or hex; at most 15 integer digits.
const DECIMAL = /^(\d{1,15})(?:\.(\d{1,30}))?$/;

/**
 * A decimal price string ("581.675") in minor units with `exponent` places, rounded half up
 * (58168n for exponent 2). Exact: no floating point. Null for anything that is not a plain decimal.
 */
export function decimalToMinor(text: string, exponent: number): bigint | null {
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? '';
  const kept = (frac + '0'.repeat(exponent)).slice(0, exponent);
  let value = BigInt(whole + kept);
  const next = frac.charCodeAt(exponent);
  if (!Number.isNaN(next) && next >= 0x35 /* '5' */) value += 1n;
  return value;
}
