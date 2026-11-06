# Owner follow-ups, 6 Nov 2026 (research only, no code changed)

Answers to the owner's follow-up questions on B3-B9 and L12 (payment timing, price sources, currencies,
the board-vs-server ranges, gift cards, and the Task 9 "sweep" code). Written in plain English.
Every outside fact has a link. "Known", "Uncertain" and "Not found" are marked where it matters.
Sections are added one at a time; if a section is missing, the writer was cut off before it.

## F1. Payment timing: how long money takes, what we set, and when a buyer may dispute

**How it works in our code today (main line).** Each payment type has a "profile" with a *seller's
confirm window*: how long the seller has to check the money arrived and release the XMR.
Only 8 payment types have their own profile (`data/payment-method-profiles.json`). **Every other
type (101 of the 109) falls back to the "Custom method" profile, which is 24 hours**
(`apps/api/src/trades/take.ts:51` and `:282`). The code only accepts windows from 2 hours to 24 hours
(`apps/api/src/methods/profiles.ts:85-86`).

On the main line, a buyer may open a dispute only **after the confirm window ends**
(`packages/trade/src/machine.ts:416`). The held cap-dispute branch changes that to **30 minutes after
the buyer taps "I've paid", for every payment type** (`wip/second-api-cap-dispute`,
`packages/trade/src/timers.ts:17`, `machine.ts:417`). That 30 minutes is owner question B9. Opening a
dispute does not take money from the seller; it calls in staff. So an early dispute on a slow payment
type mostly creates staff work and stress for an honest seller.

**The table.** "Typical" = what usually happens. "Worst normal" = slow but not a problem (bank
holds, cut-off times, weekends). "Suggested dispute wait" = when the buyer may open a dispute, with a
small margin; my suggestion, not an outside fact.

| Payment type | Typical arrival | Worst normal case | Our confirm window today | Suggested dispute wait |
|---|---|---|---|---|
| Zelle (US) | minutes, if the receiver is enrolled ([USAA](https://usaa.com/support/banking/zelle)) | 1-3 business days if not enrolled ([Ally](https://www.ally.com/help/bank/zelle.html), [U.S. Bank](https://usbank.com/customer-service/knowledge-base/KB0070076.html)); some banks hold first payments | 2 h (own profile) | 1 h |
| Interac e-Transfer (Canada) | minutes, up to ~30 min ([Neo](https://support.neofinancial.com/hc/articles/4403387339661), [Western Union guide](https://www.westernunion.com/blog/en/ca/how-long-does-e-transfer-take-in-canada/)) | security review on large or new-payee transfers: hours (same sources) | 24 h (fallback) | 1 h |
| SEPA Instant (euro) | 10 seconds, 24/7 ([European Payments Council](https://www.europeanpaymentscouncil.eu/what-we-do/sepa-instant-credit-transfer)) | 20 seconds hard limit (same); bank fraud holds possible | 24 h (fallback) | 30 min |
| SEPA standard (euro) | next business day ([EPC/Treezor](https://www.treezor.com/insights/knowledge-center/how-sepa-transfers-work/)) | after the bank's cut-off it starts next business day; Friday evening to Tuesday | 24 h (own profile) | 24 h (business days would be better, see below) |
| Faster Payments (UK) | seconds ([Pay.UK](https://www.wearepay.uk/what-we-do/payment-systems/faster-payment-system/how-faster-payments-work/)) | up to 2 hours (same) | 24 h (fallback) | 3 h |
| Domestic wire (US, Fedwire) | same business day, often within hours | Fedwire runs 9 pm-7 pm ET, Mon-Fri, not holidays ([Federal Reserve](https://frbservices.org/resources/financial-services/wires/operating-hours.html)); banks set earlier cut-offs. Sent Friday afternoon = Monday | 24 h (fallback) | 24 h |
| International (SWIFT) wire | 90% reach the receiving *bank* within an hour, but only 43% reach the customer's account within an hour ([Swift, 2023](https://www.swift.com/news-events/press-releases/swift-cross-border-payment-processing-speed-stretches-further-ahead-g20-target)); 92% within 24 h ([Finextra on Swift's report](https://www.finextra.com/pressarticle/84415/swift-publishes-report-on-gpi-role-in-reshaping-cross-border-payments)) | 2-5 business days with middle banks, weekends, holidays (inferred from the 8% beyond 24 h) | 24 h (fallback) | 48-72 h |
| ACH (US) | 1 business day; same-day ACH settles within hours ([Nacha schedule](https://www.nacha.org/system/files/2021-03/SDA_Schedules_and_Funds_Availability.pdf), [Lead Bank docs](https://docs.lead.bank/products/ach/timing)) | 2-3 business days with weekends; **can be reversed later** | 24 h (own profile) | 48 h |
| PayPal | instant into the PayPal balance | PayPal may hold received money up to 21 days for new or unusual accounts ([PayPal help](https://www.paypal.com/us/cshelp/article/help129)) | 24 h (fallback) | 1 h (a hold is visible to the seller as "pending") |
| Cash App (US) | instant | account reviews (no official page found; uncertain) | 2 h (own profile) | 30 min |
| Venmo (US) | instant into the Venmo balance | "payment in review" holds ([Venmo help](https://help.venmo.com/hc/en-us/articles/217532157-Payment-In-Review)) | 24 h (fallback) | 30 min |
| Revolut | instant between Revolut users (no official figure fetched; uncertain) | to a bank: like SEPA/Faster Payments | 2 h (own profile) | 1 h |
| Wise | 74% under 20 seconds, 95% within 24 h ([Wise, Q4 2025](https://wise.com/gb/account), [Wise Q1 2025](https://wise.com/gb/blog/q1-2025-mission-update-speed)) | 1-2 days on some routes (13% instant to THB: [Wise](https://wise.com/sg/blog/instant-transfers-to-thb-pkr-lkr)) | 8 h (own profile) | 24 h |
| Cash by mail (US) | Priority Mail 1-3 business days; Express 1-2 days ([USPS archived page](https://webarchive.library.unt.edu/web/20201218013146/https://www.usps.com/ship/priority-mail.htm)) | lost or late mail; weekends | 24 h (own profile, and the maximum the code allows) | 4 days after marked paid (or "after tracking says delivered") |
| Gift cards (any) | instant (a code is sent in the chat) | the code must be redeemed and checked; region mismatch | 24 h (fallback) | 30 min |
| PIX (Brazil) / UPI (India) | seconds, 24/7 ([Banco Central do Brasil](https://www.bcb.gov.br/en/financialstability/pix_en), [NPCI](https://www.npci.org.in/what-we-do/upi/product-overview); pages not fetched today) | bank holds | 24 h (fallback) | 30 min |

**The owner's direct question: is 24 h typical for a wire?** No, not as a "typical" time. 24 hours is
closer to the *worst normal* time for a weekday wire:
- A US domestic wire usually lands the same business day, often within hours. But wires only move
  on business days and before cut-off, so a wire sent Friday after the cut-off lands Monday (about
  3 days later; Fedwire hours above).
- An international SWIFT wire usually reaches the other bank within an hour, but less than half reach
  the customer's account within an hour, and about 1 in 12 takes more than a day (Swift figures above).
- So 24 h covers most weekday wires, not weekend ones. Our code cannot set more than 24 h today.

**What I'd suggest (owner call, B9):**
1. Do not use one 30-minute wait for every payment type. Use 3 groups:
   - *Instant* (Zelle, Interac, SEPA Instant, Faster Payments, PayPal, Cash App, Venmo, Revolut, PIX,
     UPI, gift cards): 30 min to 1 h; Faster Payments 3 h.
   - *Same day / next day* (SEPA standard, domestic wire, Wise): 24 h.
   - *Days* (ACH, SWIFT, cash by mail): 48 h to 4 days.
2. Give every payment type its own profile instead of the 24 h fallback. Today SEPA Instant and
   Faster Payments get 24 h, the same as a wire, which is far too long for the seller's window.
3. For bank payment types, consider counting **business days** (pausing over weekends), or simply
   allowing longer than 24 h for SWIFT and cash by mail. The code's 24 h maximum would need raising.
4. Uncertain: bank "first-time payee" holds vary by bank and are not published in one place. The
   seller should be told "money from a new sender may be held by your bank".

## F2. Where other sites got their Monero prices, and what that means for X2F

**Bisq** (Bitcoin peer-to-peer exchange; Haveno is built from Bisq's code). *Known, from its source code.*
- Bisq runs its own "price nodes": small servers that collect prices and hand them to the Bisq apps.
  The apps reach them over Tor (hard-coded .onion addresses), and a user can point to other nodes
  ([bisq-pricenode README](https://github.com/bisq-network/bisq-pricenode)).
- Sources: about 20 exchanges and services, including Kraken, Bitfinex, Bitstamp, Binance, Coinbase
  Pro, KuCoin, Poloniex, CoinGecko, CoinMarketCap, and older BitcoinAverage
  ([provider list](https://github.com/bisq-network/bisq-pricenode/tree/main/src/main/java/bisq/price/spot/providers)).
  Each is asked every 1 minute (e.g. [Kraken.java](https://github.com/bisq-network/bisq-pricenode/blob/main/src/main/java/bisq/price/spot/providers/Kraken.java),
  [CoinGecko.java](https://github.com/bisq-network/bisq-pricenode/blob/main/src/main/java/bisq/price/spot/providers/CoinGecko.java));
  BitcoinAverage only every 100 minutes (a paid API with quotas). A price older than 10 minutes is dropped
  ([ExchangeRateProvider.java](https://github.com/bisq-network/bisq-pricenode/blob/main/src/main/java/bisq/price/spot/ExchangeRateProvider.java)).
- How they combine: for each currency, the **average of all sources, after throwing out outliers**
  (anything more than 1.1 standard deviations from the rest); with one source, that source alone
  ([ExchangeRateService.java](https://github.com/bisq-network/bisq-pricenode/blob/main/src/main/java/bisq/price/spot/ExchangeRateService.java)).
- Street rates: for the Argentine peso, Bisq multiplies the official rate by the "blue" (street) market
  gap ([ArsBlueRateTransformer.java](https://github.com/bisq-network/bisq-pricenode/blob/main/src/main/java/bisq/price/spot/ArsBlueRateTransformer.java)).
- What went wrong: they had to switch off Binance as an XMR source (`BINANCE:XMR` excluded in
  [application.properties](https://github.com/bisq-network/bisq-pricenode/blob/main/src/main/resources/application.properties)),
  after Binance delisted XMR in February 2024 ([The Block](https://www.theblock.co/news/business/2024-02-06-binance-delisting-monero-276176)).

**Haveno** (the Monero version of Bisq). *Known, from its source code.*
- Same design as Bisq: its own price node, same exchange list minus a few, average after removing
  outliers, every source polled every minute
  ([haveno-pricenode](https://github.com/haveno-dex/haveno-pricenode),
  [ExchangeRateService.java](https://github.com/haveno-dex/haveno-pricenode/blob/main/src/main/java/haveno/price/spot/ExchangeRateService.java)).
- How it gets XMR in a currency: the exchange's direct XMR/currency price if one exists; otherwise
  XMR/BTC × BTC/currency (Bitcoin as the bridge, where we use the US dollar). It excludes Binance for
  XMR and the Lebanese pound entirely ([application.properties](https://github.com/haveno-dex/haveno-pricenode/blob/main/src/main/resources/application.properties)).
- The app has 3 price nodes on Tor (run by Haveno, Cake Wallet and Agorise) plus a normal-web backup,
  asks every 60 seconds and moves to another node when one fails
  ([ProvidersRepository.java](https://github.com/haveno-dex/haveno/blob/master/core/src/main/java/haveno/core/provider/ProvidersRepository.java),
  [PriceFeedService.java](https://github.com/haveno-dex/haveno/blob/master/core/src/main/java/haveno/core/provider/price/PriceFeedService.java)).
- Useful for B3: Haveno's default "max distance from market price" for an offer is **30%**
  (a user setting from 0 to 100%; [PreferencesPayload.java](https://github.com/haveno-dex/haveno/blob/master/core/src/main/java/haveno/core/user/PreferencesPayload.java)).

**LocalMonero and AgoraDesk** (same company; closed in 2024). *Known in part, from their open-source app.*
- An offer's price was a *formula*. The simple "market price + X%" option was written as
  `coingeckoxmrusd*1.02`, i.e. **CoinGecko alone** by default
  ([add_edit_ad_view_model.dart, lines ~404-419](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/blob/main/lib/features/ads/models/add_edit_ad_view_model.dart)).
  Vendors could instead write formulas using 13 markets: CoinGecko, Binance, Bitfinex, Bitstamp,
  Coinbase, Coinbase Pro, EXMO, Kraken, Poloniex, UPbit, MEXC, KuCoin, Gate.io
  ([market_data.dart](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/blob/main/lib/features/ads/data/models/market_data.dart)).
- How often: our earlier research of OpenMonero (a LocalMonero clone) says prices refreshed every
  10 minutes (`research/openmonero-parity-2026-10-27.md`, row 10). For LocalMonero itself: *uncertain*.
- What went wrong: *not found*. I found no public report of a price failure. The obvious weak points were
  one default source and vendor formulas pointing at exchanges that later dropped XMR (Binance in
  Feb 2024; OKX in Jan 2024, same article). LocalMonero closed in May 2024 for "internal and external
  factors" ([The Block](https://www.theblock.co/news/markets/2024-05-08-localmonero-closes-down-293064),
  [Decrypt](https://decrypt.co/229844/monero-exchange-localmonero-is-winding-down-its-operations)).

**LocalCoinSwap.** *Not found.* I found no public description of its price source. Unknown.

**Lessons that apply to us:**
1. **Exchanges drop Monero.** Binance (2024), OKX (2024), and Kraken in Europe (trading stopped
   31 Oct 2024: [Cointelegraph](https://cointelegraph.com/news/kraken-ends-monero-support-european-economic-area)).
   Kraken is one of our three XMR sources. Its public price still exists for now, but a further
   delisting would leave us with Bitfinex + CoinGecko. Plan for losing a source.
2. **Everyone serious uses several sources and drops outliers.** We use the middle value of 3 (the
   "median"), which naturally ignores one bad source. That is as good as Bisq's method for 3 sources.
3. **Street rates matter** in a few currencies (Bisq/Haveno handle Argentina specially; Haveno drops
   Lebanon). See F3.
4. **Tor.** Bisq and Haveno publish prices *over* Tor to their users; the price node itself fetches from
   exchanges over the normal internet as far as I can tell (*uncertain*; the code uses ordinary web
   requests). Our plan is stricter: the X2F server itself fetches over Tor. Risk: some services block
   or rate-limit Tor exits (CoinGecko's keyless API is rate-limited). The spec says the current 6
   sources were checked over Tor on 24 Oct; new ones must be too.

**Recommendation for X2F (fits the price-feeds plan):**
- Keep today's design: XMR/USD = middle of Kraken, Bitfinex, CoinGecko, at least 2 agreeing; exchange
  rates in a fixed trust order (Coinbase, BitPay, CoinGecko).
- Add a 4th XMR source now-ish (CoinPaprika, owner B4 option c) once its Tor check passes, so losing
  Kraken does not leave us with only 2. If the owner is wary of more vendors, an exchange that still
  lists XMR would be a better 4th than another aggregator (our rules already require at least one
  exchange in the mix).
- Say yes to the 3% disagreement limit (B5): a wrong price must not set a trade.
- An owner-only alert when a source is lost or a currency falls back (L14), so a delisting is noticed
  the same day.

## F3. Why exactly 45 currencies?

**Where the 45 comes from (known, from our code).** The list is in `apps/api/src/price/currencies.ts:7-12`.
Its own comment says (lines 1-5): it is "the fiat set the proposed sources quote (CoinGecko's, minus
non-ISO codes)". In other words, someone took the list of ordinary money that CoinGecko (one of our
price services) can price things in, and removed codes that are not real currency codes.

I checked CoinGecko's public list today: it has 46 government currencies, plus gold, silver and an IMF
accounting unit ([CoinGecko supported currencies](https://api.coingecko.com/api/v3/simple/supported_vs_currencies)).
Our 45 is exactly that list minus **VEF**, the old Venezuelan bolivar code that Venezuela replaced in
2018 (BitPay lists only the new code, VES: [BitPay rates](https://bitpay.com/api/rates)).
So **45 is an accident of one vendor's list, not a business choice.** Nobody picked it for demand.

**How we actually price a currency today** (from the price-feeds spec on `wip/second-price-feeds`):
the price of 1 XMR in US dollars (middle value of Kraken, Bitfinex, CoinGecko), times the exchange
rate "1 USD = how many of currency X" from the first fresh source of Coinbase, then BitPay, then
CoinGecko. So the XMR side is always in USD; the currency side only needs an exchange rate.

**Which sources cover what (checked 6 Nov):**

| Source | Role | Currencies it covers |
|---|---|---|
| CoinGecko | XMR price and exchange rates | the 46 above (45 after VEF) ([list](https://api.coingecko.com/api/v3/simple/supported_vs_currencies)) |
| Coinbase | exchange rates (1st choice) | about 150 ([rates](https://api.coinbase.com/v2/exchange-rates?currency=USD)) |
| BitPay | exchange rates (2nd choice) | about 156 ([rates](https://bitpay.com/api/rates)) |
| Kraken | XMR price | USD and EUR only (per our spec) |
| Bitfinex | XMR price | USD (our code fetches only XMR/USD) |

Examples that Coinbase and BitPay both cover but we do not offer: Colombian peso (COP), Peruvian sol
(PEN), Kenyan shilling (KES), Ghanaian cedi (GHS), Egyptian pound (EGP), Moroccan dirham (MAD),
Kazakh tenge (KZT), Venezuelan bolivar (VES), the West/Central African francs (XOF, XAF), and more.

**What really stops us going beyond 45 (the real limits):**

1. *Not price coverage.* Two of our three exchange-rate sources already cover about 150 currencies.
   With 2 sources per extra currency (Coinbase then BitPay) we keep the "backup source" rule. Only
   CoinGecko, the third backup, would be missing for them.
2. *Not the USD value for new-account limits.* Because every price goes through USD, any currency
   with an exchange rate automatically has a USD value. The owner's rule "no USD price = no trade"
   (Task 34, Q9) is met for free.
3. *A small table we keep by hand.* Each currency needs its number of decimal places (yen has none,
   Kuwaiti dinar has 3). That is a 1-minute table edit per currency, from the official ISO list.
4. *Sanctions and law (real limit).* Some currencies belong to sanctioned countries (for example the
   Iranian rial is on Coinbase's list). Note: the Russian rouble (RUB) is *already* in our 45, while
   the Russian payment types (SBP, Mir, YooMoney) are marked "needs lawyer sign-off" in our catalog
   (`data/payment-methods.json`). The lawyer check should cover currencies too, not only payment types.
5. *Official vs street rates (real limit).* In some countries the bank rate and the street rate differ.
   Our sources give the official rate. For example, the Nigerian naira's street rate ran about 3-6%
   above the official rate in 2026 ([Nairametrics, Feb 2026](https://nairametrics.com/2026/02/05/exchange-rate-gap-at-6-4-revives-arbitrage-concerns/),
   [TechEconomy, Oct 2026](https://www.techeconomy.ng/dollar-to-naira-today-naira-weakens-to-1331-officially-1375-in-parallel-market)).
   Vendors in such currencies need a bigger margin to match the street. This matters for B3
   (a ±10% margin cap may be too tight for currencies like VES or ARS in a bad month).
6. *Fast-moving currencies.* Our safety check refuses an exchange rate that jumps more than 10% within
   an hour unless the sources agree. For very high inflation currencies this may pause trading more.
7. *Liquidity (uncertain).* More currencies only help if vendors actually trade them. An empty currency
   list costs nothing but looks thin. I found no data on demand by currency for X2F.

**What we'd gain:** Latin American, African and Central Asian traders who today cannot list their own
currency (they would have to price in USD). Peer-to-peer Monero trading is popular exactly in places
with weak banks and capital controls. **What it costs:** the decimal-places table, a sanctions review,
and possibly one more daily backup source if we want 3 sources for the exotic ones (owner question B6).

**Suggestion:** keep the 45 for launch (it is simple and tested), but drop VEF-style accidents from
the reasoning: the true boundary should be "currencies Coinbase AND BitPay both quote, minus a
sanctions list". Add currencies when a vendor asks, a handful at a time.

## F4. The board-vs-server ranges (owner question B3), explained in full

**Words.** The *board* is the design (Claude Design's screens) of the "post an offer" form: what the
sliders and boxes let a vendor type. The *server* is the code that accepts or refuses the offer. Today
they disagree, so the server would accept offers the form can never produce (or, if the form is changed
later, the form could produce offers the owner never meant to allow).

**The three numbers, and what each means for a vendor** (from the Task 34 code on
`wip/second-p3-task34`, `packages/trade/src/flexOffer.ts:168-171` and `apps/api/src/offers/routes.ts`):

| Setting | What it is | Board today | Server today |
|---|---|---|---|
| Price margin (per amount band) | How far above or below the market price the vendor sells/buys. +3% = "market price plus 3%". | -10% to +10% | -50% to +50% |
| Payment-type extra | An extra % for one payment type, on top of the margin. "+2% if you pay by Zelle", "0% for bank transfer". | -5% to +10% | -20% to +20% |
| Amount bands per currency | Price steps by trade size: "100-500 USD at +3%, 501-2000 USD at +1.5%". | up to 5 | up to 10 |

Also on the server: margin + payment-type extra together must stay within -50% to +50%
(`routes.ts:516`), an offer may list up to 5 currencies, and today the server still refuses more than
one band per currency until Task 35 (the "tiers-not-yet" rule). The board's combined limit is not
stated anywhere I could find; with its numbers it could reach -15% to +20%.

**The price formula** (same code): price per XMR = market price × (1 + band margin + payment-type extra).
The same formula is used whether the vendor is selling or buying XMR.

**Worked example** (made-up market prices, for the arithmetic only: 1 XMR = $350.00 = €300.00).
A vendor *sells* XMR and lists two currencies:
- USD bands: 100-500 at +3%, 501-2000 at +1.5%. EUR bands: 100-500 at +3%, 501-2000 at +1.5%.
- Payment types: Zelle (USD only) +2%; bank transfer (ACH in USD, SEPA in EUR) 0%.

| Buyer pays | With | Price per XMR | Buyer gets |
|---|---|---|---|
| $300 | Zelle (3% + 2% = 5%) | $350 × 1.05 = $367.50 | 0.8163 XMR |
| $300 | ACH bank transfer (3% + 0%) | $350 × 1.03 = $360.50 | 0.8322 XMR |
| $1,500 | Zelle (1.5% + 2% = 3.5%) | $350 × 1.035 = $362.25 | 4.1408 XMR |
| $1,500 | ACH (1.5%) | $350 × 1.015 = $355.25 | 4.2224 XMR |
| €400 | SEPA (3%) | €300 × 1.03 = €309.00 | 1.2945 XMR |

**What the buyer could pay under each set of limits** (same example, worst case for the buyer):
- *Board limits:* the vendor could charge at most +10% margin +10% Zelle = **+20%**: $420.00 per XMR,
  so $300 buys 0.7143 XMR.
- *Server limits:* at most **+50%** in total: $525.00 per XMR, so $300 buys 0.5714 XMR.
- At the low end, the server would also allow an offer at **-50%** ($175 per XMR), i.e. "half price".

The buyer always sees the final price before taking, so a high price is not hidden. The danger is
different: very cheap "bait" offers (lure buyers into a scam chat, or make the vendor look like the
best deal), very expensive offers that catch new users, and plain typing mistakes (a vendor types 30
instead of 3).

**What each choice changes:**

*(a) The server follows the board (±10% margin, -5%..+10% extra, 5 bands).*
- Vendors: simple, matches the screens. Too tight for some real cases: currencies where the street
  rate is well above the official rate (see F3: Nigeria ran 3-6% in 2026; worse in crisis months
  elsewhere), and gift cards, which usually trade at large discounts/premiums (see F5).
- **A gap I noticed:** the extra for a payment type goes down only to -5% but up to +10%. That suits
  vendors who *sell* XMR (they add a surcharge for risky payment types). Vendors who *buy* XMR want the
  opposite: pay *less* for risky payment types (for example -8% when paid with a gift card). With -5%
  as the floor, buy-side vendors are squeezed. A symmetric range (-10%..+10%) fixes this.
- Buyers: protected from extreme prices. Safety: best. Changing later: loosening later is easy
  (no posted offer breaks); tightening later would make posted offers invalid. That is why (a) first.

*(b) The board follows the server (±50%, ±20%, 10 bands).*
- Vendors: maximum freedom. Buyers: more risk of bad prices and bait offers; sorting by "best price"
  would put -50% bait offers at the top. Screens get busier (10 bands × 5 currencies = 50 price rows
  per offer). Safety: weakest. Needs extra warnings in the design ("this price is 40% above market").

*(c) Other numbers (example: margin -20%..+20%, payment-type extra -10%..+10%, total within ±25%,
5 bands).* Leaves room for street-rate currencies and gift cards, keeps the buy-side symmetric, still
blocks half-price bait.

**Comparison (outside, for context):** Haveno (built on Bisq) lets a trader set a market-based price
up to a "max distance from market" that defaults to **30%** (see F2 for the source). LocalMonero let vendors type a price *formula*, i.e. effectively no
cap (our own research note `research/openmonero-parity-2026-10-27.md`, row 3).

**My lean:** (a) as recommended, with one change: make the payment-type extra symmetric (-10% to
+10%), and decide the combined cap explicitly (suggest ±20%). If the owner wants gift cards or
high-inflation currencies to work well at launch, pick (c) instead.

## F5. Gift cards: what other sites did, what X2F does today, and a recommendation

**What other sites did:**

| Site | Gift cards allowed? | Which | Rules and evidence | Source |
|---|---|---|---|---|
| Paxful (closed 2025) | Yes, its biggest market | Steam, Apple/iTunes, Razer Gold, Walmart, Amazon and many more | In a dispute you had to prove the card was yours: a photo of the card with the trade chat visible, the full receipt, for e-codes the original invoice and a video of your bank statement; a video of the balance before sending. Missing evidence within 12 hours lost the dispute; gift card disputes could take up to 3 weeks. Reselling cards bought from others ("brokering") was banned. | Paxful help pages (they block automated reading, so via search summaries: [dispute evidence](https://support.paxful.com/support/solutions/articles/150000104261-what-information-should-i-provide-during-a-dispute-), [why I lost a gift card dispute](https://support.paxful.com/support/solutions/articles/150000104341-why-did-i-lose-a-gift-card-dispute-)) |
| Paxful, the outcome | | | Closed 1 Nov 2025; in Dec 2025 pleaded guilty in the US. The Justice Department said the platform let users trade crypto for gift cards and prepaid cards and knew customers moved money from fraud schemes. | [Bitcoin.com News](https://news.bitcoin.com/paxful-to-wind-down-operations-by-november-1-2025), [US Justice Dept](https://www.justice.gov/usao-edca/pr/virtual-asset-trading-platform-pleads-guilty-violating-travel-act-and-other-federal), [Decrypt](https://decrypt.co/351913/bitcoin-exchange-paxful-agrees-plead-guilty-7-5-million-penalties) |
| LocalBitcoins (closed 2023) | Reportedly **banned** gift card codes (Amazon, Apple, Steam, Walmart, "any gift card") "for security reasons" | | Date not confirmed | [ToS;DR summary of LocalBitcoins terms](https://edit.tosdr.org/documents/6067) (*uncertain*) |
| LocalMonero / AgoraDesk (closed 2024) | Yes | Amazon, Apple Store, iTunes, eBay, Starbucks, Steam, Walmart, "any brand", "global" | No published gift-card rules found | method list in its open app ([payment_method_mixin.dart](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/blob/c11ba0cfc2905b7ba884eeb957bd2120b529e400/lib/core/translations/payment_method_mixin.dart); our `research/payment-methods/localmonero-gap.md`) |
| LocalCoinSwap | Yes | not listed | Advice only: prove you own the card, keep the receipt or e-mail, film the screen while receiving and checking the card, avoid "brokers reselling cards of unknown origin". Moderator decides disputes. | [LocalCoinSwap blog, Feb 2021](https://localcoinswap.com/blog/gift-cards-disputes) |
| Bisq | **Only Amazon eGift cards**, one account per currency/Amazon region | Amazon | Bisq accepts eGift cards (bought on Amazon, sent by e-mail) and not plain codes, because scam-bought codes can get the receiver's Amazon account banned and balance erased | [Bisq wiki](https://bisq.wiki/Amazon_eGift_card), [Bisq payment methods](https://bisq.wiki/Payment_methods) (via search summary) |
| Haveno | Amazon eGift card and PaysafeCard | | (same model as Bisq) | our catalog's `source` field: "haveno PaymentMethod.java" |

**Common problems (well documented):** codes work like cash until redeemed, and the sender can keep a
copy; issuers void or freeze cards linked to fraud, sometimes closing the receiver's whole account;
most cards on P2P markets were bought with scam money; drained or never-activated cards; region and
currency locks; Visa/Mastercard prepaid cards can be cancelled and refunded to whoever holds the
receipt. Every one of these is sourced card by card in our earlier research,
`research/payment-methods/gift-cards.md` (21 Oct), e.g. the [FTC on scammers and gift cards](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2021/12/scammers-prefer-gift-cards-not-just-any-card-will-do)
and [Amazon's gift card restrictions](https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=G7KXB4EYEHXZRUMA).

**What X2F does today (from the code on main):**
- 15 gift card types in the catalog, group "Gift cards & vouchers": Amazon, Uber, Visa prepaid,
  Mastercard prepaid, Apple, Google Play, Steam, Razer Gold, Xbox, PlayStation, Walmart, Target,
  Sephora, PaysafeCard, "Other gift card" (`data/payment-methods.json`). None needs legal review.
- A gift card offer **must name the card's country** (2-letter code), and no other offer may
  (`apps/api/src/offers/routes.ts:446-452`). The card's *currency* is not enforced (pending question 36
  in the 5 Nov handoff: "a gift card limited to its country's currency. Rec: yes").
- A warning is shown when posting and during the trade: "When trading Monero for gift cards, you accept
  all risks and responsibilities that come with gift cards. Buyer beware."
  (`apps/web/src/screens/post/offerForm.ts:57`, `screens/trade/paySeams.ts:61`, `TradeFund.tsx:38`).
- No gift card has its own timing profile, so the seller gets the 24 h fallback window (see F1), and
  no rules about receipts, partial balances or evidence exist in the product. Those are left to the
  vendor's own terms, per the owner's 21 Oct decision ("the people buying the gift card assume all
  responsibility", HANDOFF.md item 6).
- Not built: "listed amounts only" (e.g. 25/50/100), which LocalMonero had and which suits cards
  (our parity note, row 5).

**Recommendation** (product and safety calls are the owner's):
1. Keep gift cards (owner decision), but **make the card's currency follow its country** (question 36: yes).
2. Add a gift card profile: dispute wait 30 min and a seller confirm window of about 2 h (codes arrive
   at once; the receiver should redeem while both are online).
3. Add a short evidence checklist to the dispute screen for gift cards, modelled on Paxful's:
   receipt, photo of the card with the trade code, screen recording of the redemption. Staff cannot
   check a card's validity, so without this a gift card dispute is one person's word against another's.
4. Offer "suggested terms" the vendor can tick (e-codes only, receipt required, no partial balances,
   redeem while online), as listed in `gift-cards.md`. They stay the vendor's terms, not X2F rules.
5. Consider "listed amounts only" for gift card offers (card face values).
6. Flag to the owner: Visa/Mastercard prepaid are the riskiest (the original buyer can cancel the card
   with the receipt after the XMR is gone), and Paxful's fate shows regulators link gift-card P2P trade
   to fraud money. Worth the lawyer's look (the two lawyer questions are already in `gift-cards.md`).

## F6. The Task 9 "sweep" code: what is on the main line, and does anything run it?

("Main line" = `origin/main` as of 6 Nov.)

**Words first.** The *escrow* is the shared Monero wallet that holds a trade's coins; it needs 2 of 3
keys to spend (buyer, seller, X2F's moderator). A *sweep* is the one transaction that empties that
wallet completely to the agreed address(es). "Task 9 I/O" is the moderator-side machinery: a separate
X2F program (the *moderation service*) that would join every escrow as the third key holder, watch
the blockchain every 15 seconds, and report "coins arrived / coins left" to the trading server.

**Short answer: the Task 9 I/O code is NOT on the main line, and nothing on the main line runs it.**

- It was merged once (commit 23592e9a, 30 Oct) and then taken out again on the owner's hold
  (commit a55abfc7, 30 Oct: "Revert ... Plan 3 Task 9 I/O landing, owner hold"). That revert removed
  the moderator watcher and sweep detection (`apps/moderation/src/watcher.ts`, `party.ts`), the
  server's trade timer loop (`apps/api/src/trades/timers.ts` and its start in `apps/api/src/main.ts`),
  the internal "watch report" routes, and database migration 113. I checked: none of these files
  exist on main today.
- The branch `wip/second-p3-task9-io` no longer exists on the shared server (only
  `wip/second-p3-task9-view`, the screens, is still there, held). Its commits survive only inside the
  main line's history, in their reverted form.
- A built-in "tripwire" test on main proves the moderator still does nothing with money:
  `packages/trade/test/task9-io-tripwire.test.ts:14-19` fails the build the day someone wires it in.

**What IS on the main line (and what each part can do with real coins):**

1. *The moderation service* (`apps/moderation/src/main.ts`). It signs the "who is in this trade"
   statement and registers the trade's message channels. Where it would start the moderator's escrow
   key it only writes a log line "party-deferred" (`main.ts:97`). So it holds no escrow wallet, signs
   no transaction and moves no coins. It is started only by hand (`npm start` in that folder,
   `apps/moderation/package.json` "start": "tsx src/main.ts"); no server start-up, scheduled job,
   web route or deploy script on main launches it (I searched the whole tree; there are no Docker,
   systemd, cron or CI deploy files). It needs these settings to start: `MOD_DATABASE_URL`,
   `X2F_API_INTERNAL_URL`, `RELAY_ADMIN_URL`, `MONERO_DAEMON_URI`, `MOD_KEYSTORE_KEY`,
   `MOD_SIGNING_SECRET`, `X2F_FEE_WALLET` (`main.ts:319-331`). There is no on/off flag; it is "off"
   simply because nobody runs it and because the money part is not there.
2. *Pure "decision" code for Task 9* (`packages/trade/src/watch.ts`, `timerLoop.ts`, `modParty.ts`).
   These are calculators: given facts, they say what the watcher should report. They cannot reach a
   wallet or the network on their own, and nothing on main calls them outside tests (`watchStep`,
   `modPartyArgs` and the timer loop are only exported, `packages/trade/src/index.ts:58-73`).
3. *The escrow engine* (`packages/escrow`, from Plan 1). This is the real money code, and it is used
   today **only by the traders' own browsers** (`apps/web/src/escrow/worker.ts`, `runtime.ts`), not
   by any X2F server. What it can do:
   - Build a sweep: one transaction that pays out the *whole* escrow, network fee taken from the
     first payout (`packages/escrow/src/monero.ts:138-161`). It refuses while any coin is still
     locked (`monero.ts:132-135`).
   - Co-sign a sweep someone else built, only after checking it pays exactly the expected addresses
     and amounts: one transaction, no hidden "change" output, no time lock, fee capped, inputs equal
     to the escrow balance (`packages/escrow/src/verify.ts:43-68`; signing at `monero.ts:173-201`).
   - Who triggers it: a trader taps a button (seller releases; buyer cancels; both agree to cancel),
     and the other trader's device co-signs. Every co-sign goes through one gate,
     `apps/web/src/escrow/policy.ts` (`cosignPolicy`, top comment lines 1-24), which only allows the
     payout shapes the trade terms both sides signed allow, to addresses each side signed.
   - Keys it needs: each trader's own escrow key share, kept in their browser; two of three must sign.
     X2F's moderator share does not exist yet on main (point 1), so today a trade can only be paid
     out when **both traders' devices** agree. No-show refunds and dispute rulings (which need the
     moderator's key) cannot happen on main yet.
   - Which Monero network: set at build time by `VITE_MONERO_NETWORK` = mainnet, stagenet or regtest
     (`apps/web/src/escrow/worker.ts:117-118`), together with `VITE_MOD_SIGNING_PUBLIC`,
     `VITE_FEE_WALLET`, `VITE_RELAY_URL`, `VITE_NODE_PROXY_URL`. Missing values stop it from starting.
     **I found no code that refuses `mainnet`**; the "mainnet gate" lives in the Plan 6 checklist, not
     in code. So the protection against real-money use today is that X2F is not deployed, not a lock.

**What the held Task 9 I/O would add when it lands (for context):** the moderator joins each escrow
as the third key holder (`startModParty`, in the reverted `apps/moderation/src/party.ts`), watches it
every 15 s, tells the server when coins arrive, unlock, or leave in a sweep, closes the trade's
channels, and flags coins sent after a trade closed. Even then it does not pay anything out by itself:
moderator-signed refunds are Task 10 and dispute rulings are Plan 4 (`rulings.ts` is planned to refuse
everything until then; Plan 3, Task 10 text).

## Summary of recommendations

1. **Dispute wait (B9):** not one 30 minutes for all. Three groups: instant payment types 30-60 min
   (Faster Payments 3 h); same/next-day types (SEPA standard, domestic wire, Wise) 24 h; slow types
   (ACH, SWIFT, cash by mail) 48 h to 4 days. **A wire is not typically 24 h**: a weekday wire usually
   lands the same day; 24 h is near its worst normal case, and weekends push it to about 3 days.
2. **Give every common payment type its own timing profile.** Today 101 of 109 use the 24 h fallback,
   so SEPA Instant and Faster Payments wait as long as a wire. Allow more than 24 h for SWIFT and mail.
3. **Price sources (B4, B5):** keep the 3-source middle value; add a 4th XMR source after its Tor check
   (Kraken already stopped XMR trading in Europe, Binance and OKX dropped XMR in 2024); 3% disagreement
   limit; owner-only alert when a source fails or a currency falls back (L14).
4. **Currencies (B7):** 45 is CoinGecko's list minus one dead code, not a business choice. Keep it for
   launch; later expand to "what Coinbase and BitPay both quote, minus sanctioned currencies", with a
   sanctions check that also covers RUB (already in the 45).
5. **Ranges (B3):** server follows the board (a), but make the payment-type extra symmetric (-10% to
   +10%) so buy-side vendors are not squeezed, and set an explicit combined cap (about ±20%). Choose
   wider limits (c) only if gift cards and high-inflation currencies must work well at launch.
6. **Gift cards:** keep (owner decision); card currency follows its country; a gift card timing
   profile (short); an evidence checklist in gift card disputes; tick-box suggested terms; listed
   amounts; lawyer look at Visa/Mastercard prepaid cards.
7. **Task 9 sweep code:** nothing to decide now. It is **not on the main line** (reverted 30 Oct), and
   nothing on main can move coins without both traders' devices. One gap to note for later: no code
   refuses a mainnet build today; the mainnet gate is a checklist item (Plan 6), not a lock.
