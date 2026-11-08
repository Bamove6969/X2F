import { useId, useState } from 'react';
import { Icon } from '../../ui/icons.js';
import { formatMinor } from '../browse/api.js';
import { bandAt, bandRate, bandXmr, clipLines, markupText, offerBands, rangeText, type BandAt } from '../browse/bands.js';
import { RadioChips } from '../browse/RadioChips.js';
import type { MarketNow, Quote, QuoteOffer } from './quoteModel.js';

// "This offer's bands" (BuyQuote board, canvas v142; owner 2026-11-08 #4, #11 and "Offer amounts in
// XMR or fiat"): right under "You receive", so the buyer never goes back a screen to see where the
// price clips. Each band: its range in the offer's unit and in XMR ("≈"), its rate and markup; the
// band holding the amount has the 2 px ink ring and a "Your amount" tag; under the list, where the
// rate changes; "With markup / Without" converts the XMR at each band's price or at the market rate
// (with the freshness line). Money maths is in browse/bands.ts, all bigint.
// COPY-UNSIGNED (board, 8 Nov): "This offer's bands", "The price changes with the amount", "With
// markup", "Without", "Band N", "Your amount", "markup" / "market rate", the clip lines, the
// freshness line. Not on the board, kept from the owner's rules (Q27): "N+ completed trades" on a
// band that asks for them. SellQuote has no board yet (design draws it next); it shows the same card.

type View = 'with' | 'without';
const VIEWS = [
  { id: 'with', label: 'With markup' },
  { id: 'without', label: 'Without' },
] as const satisfies readonly { id: View; label: string }[];

/** Where the quote's amount falls: by the fiat total of a good quote; nowhere otherwise. */
function quoteBandAt(q: Quote | null, bands: ReturnType<typeof offerBands>): BandAt | null {
  return q?.kind === 'ok' ? bandAt(bands, q.fiatCents) : null;
}

/** "14:05" from the feed's ISO time, in UTC; null when it is unknown. */
function utcTime(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(11, 16);
}

export function QuoteBands({ offer, quote, market }: { offer: QuoteOffer; quote: Quote | null; market: MarketNow | null }) {
  const id = useId();
  const [view, setView] = useState<View>('with');
  const withMarkup = view === 'with';
  const marketCents = market?.centsPerXmr ?? null;
  const bands = offerBands(offer);
  const at = quoteBandAt(quote, bands);
  const clips = clipLines(bands, at, offer.currency, marketCents);
  const updated = withMarkup ? null : utcTime(market?.at);
  return (
    <section data-part="offer-bands" aria-labelledby={`${id}-title`} className="x2f-quote__card x2f-quote__bands">
      <div className="x2f-quote__bands-head">
        <span aria-hidden="true" className="x2f-quote__bands-tile">
          <Icon name="bands" size={20} stroke={1.75} />
        </span>
        <span className="x2f-quote__bands-titles">
          <h2 id={`${id}-title`} className="x2f-quote__bands-title">
            This offer&apos;s bands
          </h2>
          <span className="x2f-quote__muted-sm">The price changes with the amount</span>
        </span>
      </div>
      <RadioChips label={{ name: 'Amounts in XMR' }} options={VIEWS} value={view} onChange={setView} className="x2f-quote__bands-views" />
      <ul aria-label="Bands" className="x2f-quote__band-list">
        {bands.map((b, i) => {
          const here = at?.kind === 'in' && at.index === i;
          const rate = bandRate(b, offer.currency, marketCents, withMarkup);
          const markup = withMarkup ? markupText(b.pricing, marketCents) : null;
          return (
            <li key={i} data-part="band" className="x2f-quote__band" aria-current={here ? 'true' : undefined}>
              <span className="x2f-quote__band-line">
                <span className="x2f-quote__band-name">
                  <span className="x2f-quote__band-label">Band {i + 1}</span>
                  {here ? <span className="x2f-quote__band-here">Your amount</span> : null}
                </span>
                {rate ? (
                  <span className="x2f-quote__band-rate">
                    <span data-part="band-rate" className="x2f-quote__mono">
                      {formatMinor(rate.centsPerXmr, offer.currency)}
                    </span>{' '}
                    / XMR
                  </span>
                ) : null}
              </span>
              <span className="x2f-quote__band-line">
                <span className="x2f-quote__band-range">
                  <span data-part="band-range" className="x2f-quote__mono">
                    {rangeText(b.fromFiatCents, b.toFiatCents, offer.currency)}
                  </span>{' '}
                  <span className="x2f-quote__band-unit">{offer.currency}</span>
                </span>
                {withMarkup ? (
                  markup === null ? null : (
                    <span className="x2f-quote__band-markup">
                      <span data-part="band-markup" className="x2f-quote__mono">
                        {markup}
                      </span>{' '}
                      markup
                    </span>
                  )
                ) : (
                  <span className="x2f-quote__band-markup">market rate</span>
                )}
              </span>
              {rate ? (
                <span className="x2f-quote__muted-sm">
                  <span data-part="band-xmr" className="x2f-quote__mono">
                    ≈ {bandXmr(b, rate)}
                  </span>{' '}
                  <span className="x2f-quote__band-xmr-unit">XMR</span>
                </span>
              ) : null}
              {b.minTrades > 0 ? <span className="x2f-quote__muted-sm">{b.minTrades}+ completed trades</span> : null}
            </li>
          );
        })}
      </ul>
      {clips.map((c) => (
        <p key={c.dir} data-part="band-clip" className="x2f-quote__band-clip">
          <Icon name={c.dir === 'up' ? 'arrow-up-right' : 'arrow-down-right'} size={16} stroke={1.75} />
          <span>
            {c.dir === 'up' ? 'Above ' : 'Below '}
            <span className="x2f-quote__mono">{c.at}</span> the rate changes to <span className="x2f-quote__mono">{c.rate}</span>.
          </span>
        </p>
      ))}
      {updated === null ? null : (
        <span data-part="band-updated" className="x2f-quote__band-updated">
          <Icon name="clock" size={14} stroke={2} />
          Market rate · updated <span className="x2f-quote__mono">{updated}</span> UTC
        </span>
      )}
    </section>
  );
}
