import { BUY_COPY } from '../browse/BuyCopy.js';
import { SELL_COPY } from '../browse/SellCopy.js';
import { bandAt, bandClip, marginText, offerBands, rangeText, type BandAt } from '../browse/bands.js';
import type { AdSide, Quote, QuoteOffer } from './quoteModel.js';

// The offer's size bands under "What you get" (owner 2026-11-08: "carry at least that information
// ... over to this screen to help me make my decision"): each band's range and price in the offers
// card's own words (browse/bands.ts), the band the amount falls in marked, and where its price
// clips. No board draws this yet; it keeps the quote card's look. COPY-UNSIGNED, DESIGNER-REVIEW:
// "Price bands", "Your amount", "N+ completed trades" and bandClip's lines.

/** Where the quote's amount falls: by the fiat total of a good quote, or the edge a refused one is past. */
function quoteBandAt(q: Quote | null, bands: ReturnType<typeof offerBands>): BandAt | null {
  if (q?.kind === 'ok') return bandAt(bands, q.fiatCents);
  if (q?.kind === 'too-low') return { kind: 'below' };
  if (q?.kind === 'too-high') return { kind: 'above' };
  return null;
}

export function QuoteBands({ offer, adSide, quote, market }: { offer: QuoteOffer; adSide: AdSide; quote: Quote | null; market: bigint | null }) {
  const bands = offerBands(offer);
  const at = quoteBandAt(quote, bands);
  // Whether a price above or below market is good for the person looking, as on the offers card:
  // the taker of a sell ad is buying (the Buy screens' words), of a buy ad selling.
  const favourable = (adSide === 'sell' ? BUY_COPY : SELL_COPY).favourable;
  return (
    <section aria-label="Price bands" className="x2f-quote__card x2f-quote__bands">
      <span className="x2f-section-title">Price bands</span>
      <ol className="x2f-quote__band-list">
        {bands.map((b, i) => {
          const here = at?.kind === 'in' && at.index === i;
          const price = marginText(b.pricing, offer.currency, market, favourable);
          return (
            <li key={i} data-part="band" className="x2f-quote__band" aria-current={here ? 'true' : undefined}>
              <span className="x2f-quote__band-line">
                <span data-part="band-range" className="x2f-quote__mono">
                  {rangeText(b.fromFiatCents, b.toFiatCents, offer.currency)}
                </span>
                <span data-part="band-price" className="x2f-quote__band-price" data-tone={price.favourable ? 'escrow' : undefined}>
                  {price.text}
                </span>
              </span>
              {b.minTrades > 0 || here ? (
                <span className="x2f-quote__band-line">
                  <span className="x2f-quote__muted-sm">{b.minTrades > 0 ? `${b.minTrades}+ completed trades` : ''}</span>
                  {here ? <span className="x2f-quote__band-here">Your amount</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <span data-part="band-clip" className="x2f-quote__muted-sm">
        {bandClip(bands, at, offer.currency, market, favourable)}
      </span>
    </section>
  );
}
