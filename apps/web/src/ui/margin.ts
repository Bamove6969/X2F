/**
 * One form for an offer's price against the market, everywhere a margin is shown (design, final
 * call 10 Nov 2026): "0.4% above market", "0.5% below market", "at market" at exactly 0. Up to two
 * decimals, trailing zeros trimmed ("0.4%", never "0.40%"; a typed hundredth stays: "0.03%",
 * "12.25%"). Every offer is the market ± % (owner Q1), so this is the whole price line: the offer
 * card (browse/OfferCard.tsx), the quote's bands card (quote/QuoteBands.tsx), Post an offer's
 * preview (PostOffer.tsx) and My offers (myoffers/model.ts) all route through here, never through
 * a formatter of their own. Whole-number maths on basis points; nothing goes through a float.
 * test/margin.test.ts.
 *
 * COPY-UNSIGNED: "above market", "below market", "at market".
 */

export interface MarginParts {
  /** "0.4%", or null at market. */
  figure: string | null;
  /** "above market", "below market" or "at market". */
  words: string;
}

/** The percentage without a sign: 40 → "0.4%", 3 → "0.03%", 1225 → "12.25%", 5000 → "50%". */
function percent(bps: number): string {
  const abs = Math.abs(Math.trunc(bps));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}%` : `${whole}.${frac}%`;
}

/** The figure and the words apart, for a screen that sets the figure in mono. */
export function marginParts(bps: number): MarginParts {
  if (bps === 0 || !Number.isFinite(bps)) return { figure: null, words: 'at market' };
  return { figure: percent(bps), words: bps > 0 ? 'above market' : 'below market' };
}

/** "0.4% above market", "0.5% below market", "at market". */
export function marginWords(bps: number): string {
  const p = marginParts(bps);
  return p.figure === null ? p.words : `${p.figure} ${p.words}`;
}
