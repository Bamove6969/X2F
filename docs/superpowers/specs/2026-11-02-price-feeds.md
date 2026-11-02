# Several price feeds, per-currency fallback (2026-11-02)

Owner (via the lead, 2 Nov 08:02): "several price feeds: if one feed doesn't cover a currency, fall back
to another; a currency with no price is hidden for that currency only". The hiding of offers is Task 34's
(wip/second-p3-task34); this note covers the server side that answers, per currency, "a price or none".
Branch `wip/second-price-feeds` from main line e7636c74.

## What exists (Plan 3 Task 3/5, spec 11 item 6, decided 2026-10-24)

- **XMR/USD:** the median of Kraken, Bitfinex and CoinGecko (`price/feed.ts`, `price/sources.ts`), from
  at least 2 sources agreeing within 5% (2% when only two quote), dated by its oldest quote, refused
  after 5 min; a timestamp-less quote that stops moving while others move is dropped after 30 min.
- **USD→X exchange rates:** Coinbase, BitPay, CoinGecko in a FIXED trust order (`price/fx.ts`): per
  currency the highest-ranked fresh source wins; never an average. Stale after 1 h by fetch time (owner
  setting), 10% sanity guard against the last hour (owner setting), 3 failures in a row = down.
- **Market price of X** = XMR/USD median × USD→X (`price/market.ts`). No USD median pauses every currency;
  no fresh rate pauses only that currency. `MarketPrices.quote(c)` / `current(c)` return null for "none".
- **Currencies:** the 45 in `CURRENCY_EXPONENTS`; anything else has no price (400 on `/v1/price`).

So per-currency fallback across exchange-rate sources is already built. What is missing is a fallback
across *ways of pricing* a currency, room for more vendors, and a per-currency view of which one is in use.

## The chain (built here)

- A **price route** is one way to get XMR's price in currency X: `{ name, quote(currency) }` returning a
  market quote (price, time, its USD value) or null. `price/chain.ts`.
- **Per currency, the routes are tried in a fixed order; the first with a fresh, sane quote wins.** Never
  an average across routes (the same rule the owner set for exchange rates).
- Routes:
  1. `market` (default, first, unchanged): XMR/USD median × the FX trust chain, as today.
  2. `direct` (OFF by default): XMR/X straight from the XMR sources that quote X (Kraken quotes EUR,
     CoinGecko every currency), under the same median rules (at least 2 sources agreeing). Today only EUR
     can reach 2 sources; a candidate XMR source (below) would add more. It still needs the XMR/USD
     median for the USD value (Q9: a trade with no USD price is refused), so it helps when the exchange
     rates for X are down or stale, not when XMR/USD is.
- **Chain checks on every route's answer** (defence in depth on top of each route's own checks): price
  > 0, USD value > 0, not older than the XMR feed's 5 min limit (the `at` of a quote is its oldest XMR
  quote), currency in the supported list.
- **Disagreement between routes:** optional. When `PRICE_ROUTE_MAX_GAP_PCT` is set and another route also
  has a price for X, a chosen price further than that from any of them means X has NO price (fail closed;
  a wrong feed must not set a trade rate). Unset (default) = no cross-route check, today's behaviour.
  The limit is an owner call (OC2).
- **Per-currency "price or none":** `MarketPrices.quote(c)` and `current(c)` keep their shape (every
  current caller unchanged); the quote gains `route` (which route priced it). `health()` gains
  `coverage`: for every supported currency, the route in use or null. `paused` = the currencies with
  null, as today, so the "<CCY> market prices paused" alerts and the 503 `price-unavailable` keep working.

## Candidate vendors (adapters written, OFF by default)

Each needs no key and answers plain JSON. Their shapes are written from the vendors' public docs and are
NOT yet verified over Tor (the 2026-10-24 sources were): verify before enabling, as in
`~/x2f-comms/briefs/p3-t3-*.md`. They are only used when named in config.

| Name | Kind | URL | Covers | Updates |
|---|---|---|---|---|
| `coinpaprika` | XMR price | https://api.coinpaprika.com/v1/tickers/xmr-monero?quotes=USD,EUR | USD, EUR | minutes |
| `frankfurter` | USD→X | https://api.frankfurter.dev/v1/latest?base=USD | ~30 (ECB) | once a working day |
| `erapi` | USD→X | https://open.er-api.com/v6/latest/USD | ~160 | once a day |

The two FX candidates update daily, which breaks the spec's "sources must update at least hourly"; fetch
time would always look fresh, so each adapter refuses an answer whose own published time is older than a
limit (frankfurter 4 days, to ride over weekends and holidays; erapi 2 days). Those limits are OC3.
Both also refuse a published time in the future (frankfurter: a day after today, UTC; erapi: more than
5 min ahead of the server clock), and frankfurter refuses any `amount` but 1 (it scales the rates).
(Review M2, M3.)

## Privacy (how the server fetches)

- Fetches run only on the server's own timer (XMR every 1 min, FX every 5 min), never because a user
  asked for a price, browsed a currency or took an offer. Each URL is a constant: the same currency list
  every time, so a vendor learns nothing about which currencies X2F users look at.
- No API keys, no cookies (`credentials: 'omit'`), no redirects, a 256 KiB body cap, a 5 s / 10 s timeout:
  every adapter goes through the one `getJson(f, url)` seam.
- No user data is ever in a request. A vendor sees the server's IP and the fixed pattern only.
- Over Tor: still the Plan 6 follow-up (docs/coordination.md, 2026-10-24): route the `f` seam through a
  SOCKS dispatcher. Unchanged here; each new vendor is one more party that sees the server's IP until then.

## Config

**Ordering fails closed (review M1, 2026-11-02):** a bad setting stops the server at startup.
- `PRICE_SOURCES`: a candidate only after every approved source named, and at least one exchange
  (Kraken or Bitfinex) must be in the set: a median made only of aggregators (CoinGecko, CoinPaprika)
  is refused.
- `FX_SOURCES`: a candidate only after every approved source named, never first and never alone.
- `PRICE_ROUTES`: must start with `market`; `direct` only after it, never alone or ahead.
Relaxing any of these is part of owner calls OC1 (vendors) and OC3 (daily sources).

- `PRICE_SOURCES`: XMR sources (default `kraken,bitfinex,coingecko`); now also accepts `coinpaprika`,
  only when named.
- `FX_SOURCES`: exchange-rate sources in trust order (default `coinbase,bitpay,coingecko`); now also
  accepts `frankfurter`, `erapi`, only when named.
- `PRICE_ROUTES`: the routes in order, from `market`, `direct`; default `market` (today's behaviour).
- `PRICE_ROUTE_MAX_GAP_PCT`: integer 1..50, unset = off.

## Owner calls (not decided here; lead to ask)

- **OC1. Which feeds to add and enable by default** (privacy/vendor). Options: (a) none, keep today's 3+3;
  (b) turn on the `direct` route only: no new vendor, EUR survives an FX outage; (c) also add
  `coinpaprika` as a 4th XMR source (fewer USD pauses, one more vendor sees the server IP); (d) add the
  daily FX sources for currencies beyond today's 45 or as a last fallback. *Recommendation: (b) now; (c)
  after a Tor fetch confirms its shape; (d) only if the owner wants more currencies (OC4).*
- **OC2. How far routes may disagree before a price is refused.** Options: off (today); 2%; 3%; 5%.
  Kraken's XMR/EUR and the USD median × EUR rate normally sit within about 1%. *Recommendation: 3%,
  failing closed (no price) past it.*
- **OC3. Staleness for daily sources.** Options: (a) never use sources slower than hourly (the spec's
  rule); (b) allow them last in the trust order with a published-age limit (2 days; 4 days for ECB data
  over weekends). *Recommendation: (a) unless OC4 adds currencies only they cover, then (b).*
- **OC4. Which currencies X2F prices.** Today 45. Options: keep 45; add every ISO currency an enabled
  source covers. *Recommendation: keep 45 until a vendor asks for one.*
- **OC6. An alert when a currency moves to a backup route** (review M5). Today, when EUR moves from
  `market` to `direct` it is not paused, so no "market prices paused" alert fires; only the exchange-rate
  source's own failing alert does, and the owner sees the route only in `coverage`. Options: (a) no extra
  alert; (b) an owner-only info alert "<CCY> priced by a backup route" (and an all-clear when it moves
  back), grouped like the other price alerts. *Recommendation: (b), owner-only.* Not built.
- **OC5. Anything users see.** Today a currency with no price is hidden (Task 34) and a take is refused
  with the CantDoThat popup (Q9). Should users ever see which feed priced their currency, or that a
  backup is in use? *Recommendation: no; only the owner's Price health panel (Plan 4) shows `coverage`.*
