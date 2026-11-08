-- Owner, 8 Nov 2026 ("Offer amounts in XMR or fiat"): an offer keeps its trade size in the unit
-- its poster chose. 'fiat' (every offer so far) keeps min_fiat_cents / max_fiat_cents in the
-- currency's minor units; 'xmr' keeps min_atomic / max_atomic in atomic units (1 XMR = 10^12) and
-- no fiat figures. Either way the offer sells or buys XMR: the other unit is worked out at the
-- live price whenever it is needed (@x2f/trade offerRange.ts), and the take records the fiat
-- limits at the rate it locks (trades.min_fiat_cents / max_fiat_cents, unchanged).
alter table offers
  add column amount_unit text not null default 'fiat' check (amount_unit in ('fiat', 'xmr')),
  add column min_atomic numeric(30, 0) check (min_atomic > 0),
  add column max_atomic numeric(30, 0),
  alter column min_fiat_cents drop not null,
  alter column max_fiat_cents drop not null;

-- Exactly the pair of the offer's own unit, the other pair null.
alter table offers add constraint offers_amount_pair check (
  (amount_unit = 'fiat' and min_fiat_cents is not null and max_fiat_cents is not null and min_atomic is null and max_atomic is null)
  or (amount_unit = 'xmr' and min_atomic is not null and max_atomic is not null and max_atomic >= min_atomic
      and min_fiat_cents is null and max_fiat_cents is null)
);
