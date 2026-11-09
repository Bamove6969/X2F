# Time to pay, method by method: merged report

**Date:** 9 Nov 2026 · **For:** the owner and the lead · **Catalog:** `data/payment-methods.json`, **109 entries** (108 methods plus Custom; the order mentioned 78, but the catalog has grown since 21 Oct).

> **Research only.** Nothing in the code or the catalog has been changed. The windows below are recommendations for the owner to decide.

## The owner's order

> "Research needs to be done on each individual payment method to find out what the average time period is for receiving that payment method. Whatever the average is will become the amount of time that we make the person wait before they are able to cancel, and also the amount of time that the person has to send that payment type." (9 Nov)

## The answer in one table

| Tier | Window | What goes in it | How many |
|---|---|---|---|
| 1 | **60 min** | Wallet or app transfers where both people use the **same** app (Revolut, Cash App, Venmo, PayPal, Skrill, M-PESA and similar). The money arrives in seconds. The hour is for the buyer to notice the trade, open the app and send. | 36 |
| 2 | **90 min** | Instant transfers **between different banks** (Zelle, Interac, Faster Payments, SEPA Instant, Pix, UPI, Bizum, Swish and similar). Still seconds to arrive, but the buyer may have to add a new payee, and banks run more first-time fraud checks. | 33 |
| 3 | **3 h** | Bank transfers that can be slower or need a new beneficiary added first (India's NEFT, RTGS and IMPS; Japan; Wise), remittance services where the buyer goes to an agent or chooses Express (Western Union, MoneyGram, Ria, Remitly, WorldRemit, Xoom), and **all gift cards**, because the buyer may need to go and buy one. | 30 |
| 4 | **24 h** | Bank transfers that settle the same business day but not at weekends (standard SEPA, US domestic wire, Wise USD, Tikkie), cash deposits at a branch, and cash in person. | 6 |
| 5 | **72 h** | Methods that take one business day or more to arrive: US ACH, international SWIFT wire, cash by mail, USPS money order. | 4 |

The full list, method by method, is in the merged table further down.

## How the research was done (and how much to trust it)

- **One researcher, not eight.** The order suggested sending out about eight research agents. The tool for starting sub-agents was not available in this session. So I did all eight groups myself, one after another, and wrote the same eight files the agents would have written. The split is the one the lead proposed.
- **Sources.** About 35 fresh web searches today, plus the provider and regulator pages the 21 Oct regional research had already fetched (`research/payment-methods/*.md`). Each row in the group files gives 1–3 sources, with the provider's own page first where one existed. Today's checks used search summaries, not full page reads. Where only a blog or third-party site was found, the row says "secondary".
- **"Average" is mostly not measurable.** Almost no provider publishes a real average or median. They publish a promise ("within 10 seconds", "next business day") or a vague word ("typically within minutes"). The only real statistics found were:
  - Swift gpi: about 40% of payments credited within 30 minutes, 75% within 6 hours, 92% within 24 hours (2019–2020 figures);
  - Wise: 50% of payments instant, 90% within 24 hours;
  - Remitly Express: 90% within an hour (reported by a review, not by Remitly);
  - WorldRemit: over 90% "ready in minutes";
  - Paysend card-to-card: over 90% within 15 seconds (reported by a review).

  Everywhere else, "typical" means the provider's own wording.
- **Thin data.** The weakest areas are the newer African and fintech methods (Chipper Cash, Afriex, Mixx by Yas, MTN MoMo, Easypaisa), Chime, Payoneer, Capitual, Pago Móvil, Mir and Ukrainian card transfers, and the less common gift cards. For those, the timing is mostly assumed from how that kind of system works.

## How the window was worked out (the margin)

The owner's rule is: **window = the typical time for the money to arrive + a fair margin for a human to actually send it.**

1. **Arrival time.** Taken from the group files.
2. **The human's own time.** In the normal case, an honest buyer needs 5–30 minutes. They have to notice the trade, unlock the phone, log in (often with a second step), copy the details, and confirm. The first payment to a new person also means adding a payee. Some banks then add a short fraud check: Interac allows up to 30 minutes, and some US banks hold a first Zelle payment for a few hours.
3. **A margin of roughly two to three times the normal case.** This way a buyer who is honest but busy (at work, driving, in a meeting) is not punished. Then the window is **rounded up to the next tier**, so the owner has five numbers to manage instead of 109.
4. **The rare worst cases are left out on purpose.** Examples: a 3-day Zelle hold on a first payment; the UK's legal 4-business-day fraud hold; Russia's 2-day anti-fraud hold. These happen, but rarely. Building them into every trade would lock the seller's Monero for days on every trade to cover a one-in-a-hundred event. The builder already lets a buyer **extend by 30 minutes, up to twice** (`TIMERS.extendMin`, `maxExtensions` on branch `wip/lead-launch-rules`). Anything longer goes to a dispute.
5. **Why not make every window long, to be safe?** A long window is not free. While it runs, the seller's coins are locked and the seller cannot cancel. A buyer who takes a trade and never pays ties up the seller for the whole window. Short windows protect sellers; long windows protect slow buyers. The tiers try to be fair to both.

## Outliers and special cases

- **Gift cards (3 h).** The code is "received" the moment the buyer posts it in chat. The delay is buying the card. Amazon itself says an eGift arrives "typically within 1 hour". A physical card means a shop trip. A buyer who already holds the card needs only minutes.
- **Cash pickup and cash codes** (Western Union, MoneyGram, Ria, HalCash, Cash at ATM). Sending is fast, but **the sender can cancel until the cash is collected**. The seller must collect or withdraw before releasing the coins. That is a release rule, not a time-to-pay rule. It should be in the method's warning text.
- **Pix at night.** From 8 pm to 6 am, Brazilian banks cap person-to-person Pix at R$1,000 by default. A large trade taken late at night may be impossible to pay until morning. Suggestion: warn in the offer, or let sellers limit night-time amounts.
- **Remittance services and Wise USD depend on how the buyer sends.** Remitly Express takes minutes; Remitly Economy takes 1–5 days. Xoom funded by card takes minutes; funded from a bank, 3–5 days. Recommended: the method's instructions should require the fast option.
- **Cash in person (24 h).** The real deadline is the meeting time the two people agree. A fixed number is only a backstop.
- **SWIFT (72 h).** Most wires arrive the same day. The tier allows for cut-offs, time zones, intermediary banks and weekends.
- **Same-app wallets are the only 60-minute tier.** Several of them (PayPal, Cash App, Venmo, Revolut) are 90 minutes in the builder today.

## Open questions for the owner

1. **One clock or two?** The order says one number does both jobs: the time the buyer has to send, and the wait before cancelling. The builder on `wip/lead-launch-rules` currently uses **two** clocks:
   - a short "time to pay" (`payWindowMin`, how long the buyer has to *send*);
   - a separate "confirm window" (`confirmWindowMin`, how long the money can take to *arrive* before either side can dispute).

   For instant methods, one clock or two makes no difference. For slow methods it matters. With one clock, an ACH buyer has 72 hours, and a seller whose buyer never pays waits 72 hours to cancel. With two clocks, the buyer must press "I've paid" within a few hours, so a no-show is caught quickly, and the confirm window still allows two days for the money to land. **Which does the owner want?** The table below follows the order as written: one clock.
2. **Weekends and bank holidays.** Standard SEPA, US wires, ACH, SWIFT, Tikkie and cash deposits do not move at weekends. A fixed 24-hour window that starts on Friday evening cannot be met. Options:
   - (a) use the longer tier (what the table does for ACH and SWIFT);
   - (b) pause the clock outside business days;
   - (c) hide those offers at weekends.
3. **Lowering the floor to 60 minutes.** The builder's shortest time to pay is 90 minutes (`TIMERS.payMin = 90`, used as `MIN_PAY_WINDOW_MIN`). Tier 1 needs that lowered to 60. Or keep 90 for everything instant and merge tiers 1 and 2.
4. **Raising the ceiling to 72 hours.** The builder's longest time to pay is 24 hours (`MAX_PAY_WINDOW_MIN = 1440`). Tier 5 needs it raised to 4,320 minutes, unless the owner keeps two clocks (question 1). In that case cash by mail stays at 24 hours to post it, and arrival is covered by the confirm window (4 days today).
5. **Should a seller be allowed to set a longer window than the method's default?** One example is cash in person, where the meeting time decides.
6. **Methods with no reliable timing.** Before launch, someone should check Capitual (its status is unclear), Chime, Payoneer, Afriex, Chipper Cash, Mixx by Yas and MTN MoMo on the providers' own sites.

## Comparison with what the builder does today

Branch `origin/wip/lead-launch-rules`, `data/payment-method-profiles.json`. The order mentioned nine profiles; there are **17**. Every other method uses the Custom method's profile (3 h to pay). The lead's defaults, waiting on the owner, are: 90 min for apps and instant transfers, 3 h for bank transfers, 24 h for cash by mail.

| id | builder: time to pay | builder: confirm window | recommended (one clock) | change |
|---|---|---|---|---|
| ZELLE | 90 min | 90 min | 90 min | none |
| INTERAC_E_TRANSFER | 90 min | 90 min | 90 min | none |
| FASTER_PAYMENTS | 90 min | 3 h | 90 min | none |
| SEPA_INSTANT | 90 min | 90 min | 90 min | none |
| PIX | 90 min | 90 min | 90 min | none |
| UPI | 90 min | 90 min | 90 min | none |
| CASH_APP | 90 min | 90 min | 60 min | shorter |
| VENMO | 90 min | 90 min | 60 min | shorter |
| PAYPAL | 90 min | 90 min | 60 min | shorter |
| REVOLUT | 90 min | 90 min | 60 min | shorter |
| TRANSFERWISE | 3 h | 24 h | 3 h | none |
| CUSTOM | 3 h | 24 h | 3 h | none |
| SEPA | 3 h | 24 h | 24 h | longer |
| DOMESTIC_WIRE_TRANSFER | 3 h | 24 h | 24 h | longer |
| ACH_TRANSFER | 3 h | 48 h | 72 h | longer; above today's 24 h maximum |
| SWIFT | 3 h | 72 h | 72 h | longer; above today's 24 h maximum |
| PAY_BY_MAIL | 24 h | 96 h | 72 h | longer; above today's 24 h maximum |

The four "longer" bank rows and cash by mail are where the owner's one-clock rule and the builder's two-clock design disagree. Under the two-clock design, the builder's current numbers are already reasonable: 3 h to send a bank transfer, then 24–72 h for it to arrive. Under the one-clock rule, the recommended column applies.

## Merged table (all 109 methods, grouped by tier)

"Builder today" is the current time to pay on the branch. Methods without their own profile show the Custom fallback (3 h). A ← marks a row where the recommendation differs from today. Confidence comes from the group file and is about the arrival time, not the reversal risk.

### Tier 60 min (36 methods)

| id | name | typical arrival | recommended window | builder today | confidence | why this tier | file |
|---|---|---|---|---|---|---|---|
| REVOLUT | Revolut | instant | **60 min** (60 min) | 90 min ← | high | same app both sides | [europe](europe.md) |
| MONEY_BEAM | MoneyBeam (N26) | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [europe](europe.md) |
| SATISPAY | Satispay | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [europe](europe.md) |
| LYDIA | Lydia | seconds | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | same app; blog sources only | [europe](europe.md) |
| POSTEPAY | Postepay | immediate | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same card network both sides | [europe](europe.md) |
| PAYSERA | Paysera | seconds | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [europe](europe.md) |
| ZEN | ZEN | usually instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app; same ZEN entity only | [europe](europe.md) |
| YOOMONEY | YooMoney | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same wallet both sides | [uk-nordics-east](uk-nordics-east.md) |
| KASPI | Kaspi.kz (Kaspi Gold) | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [uk-nordics-east](uk-nordics-east.md) |
| CASH_APP | Cash App | instant | **60 min** (60 min) | 90 min ← | medium | same app; rare 24-48 h review | [north-america](north-america.md) |
| VENMO | Venmo | instant | **60 min** (60 min) | 90 min ← | medium | same app; rare review hold | [north-america](north-america.md) |
| APPLE_CASH | Apple Cash | right away | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app; security checks rare | [north-america](north-america.md) |
| CHIME | Chime | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | same app; no official page | [north-america](north-america.md) |
| STRIKE | Strike | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [north-america](north-america.md) |
| MERCADO_PAGO | Mercado Pago | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | balance to balance | [latin-america](latin-america.md) |
| NEQUI | Nequi | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [latin-america](latin-america.md) |
| AIRTM | Airtm | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [latin-america](latin-america.md) |
| ASTROPAY | AstroPay | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [latin-america](latin-america.md) |
| GCASH | GCash | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [asia-pacific](asia-pacific.md) |
| MOMO | MoMo | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [asia-pacific](asia-pacific.md) |
| ALI_PAY | Alipay | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app; removal candidate | [asia-pacific](asia-pacific.md) |
| WECHAT_PAY | WeChat Pay | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app; removal candidate | [asia-pacific](asia-pacific.md) |
| PAYPAY | PayPay | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app; removal candidate | [asia-pacific](asia-pacific.md) |
| MPESA | M-PESA | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | mobile money; 24 h reversal request | [africa-middle-east](africa-middle-east.md) |
| MTN_MOMO | MTN MoMo | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | mobile money; reversal rules vary | [africa-middle-east](africa-middle-east.md) |
| MIXX_BY_YAS | Mixx by Yas | instant (assumed) | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | mobile money; no timing page | [africa-middle-east](africa-middle-east.md) |
| CHIPPER_CASH | Chipper Cash | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | same app; old sources | [africa-middle-east](africa-middle-east.md) |
| EASYPAISA | Easypaisa | instant (wallet) | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | wallet; to/from banks up to 24 h | [africa-middle-east](africa-middle-east.md) |
| PAPARA | Papara | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [africa-middle-east](africa-middle-east.md) |
| PAYPAL | PayPal | instant | **60 min** (60 min) | 90 min ← | high | balance to balance | [global-apps-remittance](global-apps-remittance.md) |
| SKRILL | Skrill | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [global-apps-remittance](global-apps-remittance.md) |
| NETELLER | Neteller | almost immediately | **60 min** (60 min) | 3 h (Custom fallback) ← | high | same app both sides | [global-apps-remittance](global-apps-remittance.md) |
| PAYONEER | Payoneer | reported instant | **60 min** (60 min) | 3 h (Custom fallback) ← | **low** | no official P2P timing | [global-apps-remittance](global-apps-remittance.md) |
| UPHOLD | Uphold | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [global-apps-remittance](global-apps-remittance.md) |
| ADVANCED_CASH | Volet (formerly Advcash) | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [global-apps-remittance](global-apps-remittance.md) |
| PAXUM | Paxum | instant | **60 min** (60 min) | 3 h (Custom fallback) ← | medium | same app both sides | [global-apps-remittance](global-apps-remittance.md) |

### Tier 90 min (33 methods)

| id | name | typical arrival | recommended window | builder today | confidence | why this tier | file |
|---|---|---|---|---|---|---|---|
| ZELLE | Zelle | minutes | **90 min** (90 min) | 90 min | medium | bank-to-bank; first-payee holds | [north-america](north-america.md) |
| INTERAC_E_TRANSFER | Interac e-Transfer | under 30 min | **90 min** (90 min) | 90 min | high | up to 30 min fraud delay | [north-america](north-america.md) |
| SEPA_INSTANT | SEPA Instant | 10 seconds | **90 min** (90 min) | 90 min | high | new IBAN payee to add | [europe](europe.md) |
| BIZUM | Bizum | under 10 s | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [europe](europe.md) |
| MB_WAY | MB WAY | immediate | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | bank-to-bank | [europe](europe.md) |
| WERO | Wero | seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank (SEPA Instant) | [europe](europe.md) |
| TWINT | TWINT | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [europe](europe.md) |
| BLIK | BLIK | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [europe](europe.md) |
| HAL_CASH | HalCash | SMS in seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | high | seller must withdraw before release | [europe](europe.md) |
| FASTER_PAYMENTS | Faster Payments (UK) | seconds-minutes | **90 min** (90 min) | 90 min | high | rare 4-business-day fraud hold | [uk-nordics-east](uk-nordics-east.md) |
| MONESE | Monese | as Faster Payments/SEPA | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | bank rail | [uk-nordics-east](uk-nordics-east.md) |
| SWISH | Swish | seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [uk-nordics-east](uk-nordics-east.md) |
| VIPPS_MOBILEPAY | Vipps / MobilePay | immediate | **90 min** (90 min) | 3 h (Custom fallback) ← | high | card-funded can take 3 bank days | [uk-nordics-east](uk-nordics-east.md) |
| SBP | SBP — Faster Payments System (Russia) | seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | 2-day anti-fraud holds possible | [uk-nordics-east](uk-nordics-east.md) |
| MIR | Mir card | minutes | **90 min** (90 min) | 3 h (Custom fallback) ← | **low** | card-to-card; no official timing | [uk-nordics-east](uk-nordics-east.md) |
| UKRAINE_CARD | Ukrainian bank card transfer | seconds-minutes | **90 min** (90 min) | 3 h (Custom fallback) ← | **low** | card-to-card; NBU limits | [uk-nordics-east](uk-nordics-east.md) |
| PIX | Pix | seconds | **90 min** (90 min) | 90 min | high | night limit R$1,000 (8 pm-6 am) | [latin-america](latin-america.md) |
| SPEI | SPEI | seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [latin-america](latin-america.md) |
| PAGO_MOVIL | Pago Móvil | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | **low** | outages; thin data | [latin-america](latin-america.md) |
| AUSTRALIA_PAYID | PayID (Australia) | real time | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | bank-to-bank | [asia-pacific](asia-pacific.md) |
| PROMPT_PAY | PromptPay | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [asia-pacific](asia-pacific.md) |
| UPI | UPI (India) | instant | **90 min** (90 min) | 90 min | high | no payee set-up needed | [asia-pacific](asia-pacific.md) |
| PAYTM | Paytm | instant (UPI) | **90 min** (90 min) | 3 h (Custom fallback) ← | high | same as UPI | [asia-pacific](asia-pacific.md) |
| QRIS | QRIS (Indonesia) | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | seller shares a QR | [asia-pacific](asia-pacific.md) |
| PAYNOW | PayNow | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [asia-pacific](asia-pacific.md) |
| FPS | FPS (Hong Kong) | real time | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [asia-pacific](asia-pacific.md) |
| DUITNOW | DuitNow | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | bank-to-bank | [asia-pacific](asia-pacific.md) |
| NIP | NIBSS Instant Payment (NIP, Nigeria) | seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | bank-to-bank | [africa-middle-east](africa-middle-east.md) |
| RAAST | Raast | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | high | bank-to-bank | [africa-middle-east](africa-middle-east.md) |
| AFRIEX | Afriex | seconds to same day | **90 min** (90 min) | 3 h (Custom fallback) ← | **low** | cross-border; marketing only | [africa-middle-east](africa-middle-east.md) |
| PAYSEND | Paysend | seconds-minutes | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | card-to-card; up to 3 business days | [global-apps-remittance](global-apps-remittance.md) |
| SAME_BANK | Transfer within the same bank | instant | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | internal book transfer | [global-apps-remittance](global-apps-remittance.md) |
| CASH_AT_ATM | Cash at ATM | code in seconds | **90 min** (90 min) | 3 h (Custom fallback) ← | medium | seller must withdraw before release | [gift-cards-cash](gift-cards-cash.md) |

### Tier 3 h (30 methods)

| id | name | typical arrival | recommended window | builder today | confidence | why this tier | file |
|---|---|---|---|---|---|---|---|
| JAPAN_BANK | Japan bank transfer (Furikomi) | minutes; some banks next business day | **3 h** (180 min) | 3 h (Custom fallback) | medium | bank hours at some banks | [asia-pacific](asia-pacific.md) |
| NEFT | NEFT (India) | 30 min-2 h (batches) | **3 h** (180 min) | 3 h (Custom fallback) | high | half-hourly batches; new-beneficiary cooling | [asia-pacific](asia-pacific.md) |
| RTGS | RTGS (India) | real time | **3 h** (180 min) | 3 h (Custom fallback) | high | new-beneficiary cooling | [asia-pacific](asia-pacific.md) |
| IMPS | IMPS (India) | instant | **3 h** (180 min) | 3 h (Custom fallback) | high | new-beneficiary cooling | [asia-pacific](asia-pacific.md) |
| TRANSFERWISE | Wise | instant to Wise; 90% within 24 h to banks | **3 h** (180 min) | 3 h | high | depends on currency | [global-apps-remittance](global-apps-remittance.md) |
| WESTERN_UNION | Western Union | minutes (cash pickup) | **3 h** (180 min) | 3 h (Custom fallback) | high | buyer goes to an agent or app | [global-apps-remittance](global-apps-remittance.md) |
| MONEY_GRAM | MoneyGram | minutes (cash pickup) | **3 h** (180 min) | 3 h (Custom fallback) | medium | buyer goes to an agent or app | [global-apps-remittance](global-apps-remittance.md) |
| RIA | Ria Money Transfer | minutes (pickup); up to 1 business day (bank) | **3 h** (180 min) | 3 h (Custom fallback) | medium | agent or app | [global-apps-remittance](global-apps-remittance.md) |
| REMITLY | Remitly | minutes (Express) | **3 h** (180 min) | 3 h (Custom fallback) | medium | offer must require Express | [global-apps-remittance](global-apps-remittance.md) |
| WORLDREMIT | WorldRemit | minutes (90%+) | **3 h** (180 min) | 3 h (Custom fallback) | medium | bank payout slower | [global-apps-remittance](global-apps-remittance.md) |
| XOOM | Xoom | minutes (card-funded) | **3 h** (180 min) | 3 h (Custom fallback) | medium | bank-funded 3-5 business days | [global-apps-remittance](global-apps-remittance.md) |
| NATIONAL_BANK | National bank transfer | instant to next business day | **3 h** (180 min) | 3 h (Custom fallback) | **low** | varies by country | [global-apps-remittance](global-apps-remittance.md) |
| SPECIFIC_BANKS | Transfer with specific banks | instant to next business day | **3 h** (180 min) | 3 h (Custom fallback) | **low** | varies by country | [global-apps-remittance](global-apps-remittance.md) |
| CUSTOM | Custom method | unknown | **3 h** (180 min) | 3 h | **low** | unchanged fallback | [global-apps-remittance](global-apps-remittance.md) |
| CAPITUAL | Capitual | unknown | **3 h** (180 min) | 3 h (Custom fallback) | **low** | status unclear; treat as Custom | [latin-america](latin-america.md) |
| AMAZON_GIFT_CARD | Amazon gift card | eGift within 1 h | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| UBER_GIFT_CARD | Uber gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| VISA_GIFT_CARD | Visa prepaid gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| MASTERCARD_GIFT_CARD | Mastercard prepaid gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| APPLE_GIFT_CARD | Apple gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| GOOGLE_PLAY_GIFT_CARD | Google Play gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| STEAM_GIFT_CARD | Steam gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| RAZER_GOLD_GIFT_CARD | Razer Gold gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| XBOX_GIFT_CARD | Xbox gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| PLAYSTATION_GIFT_CARD | PlayStation gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| WALMART_GIFT_CARD | Walmart gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | **low** | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| TARGET_GIFT_CARD | Target gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| SEPHORA_GIFT_CARD | Sephora gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | **low** | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| OTHER_GIFT_CARD | Other gift card | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | **low** | time to buy the card | [gift-cards-cash](gift-cards-cash.md) |
| PAYSAFE | PaysafeCard | instant once bought | **3 h** (180 min) | 3 h (Custom fallback) | medium | time to buy the PIN | [gift-cards-cash](gift-cards-cash.md) |

### Tier 24 h (6 methods)

| id | name | typical arrival | recommended window | builder today | confidence | why this tier | file |
|---|---|---|---|---|---|---|---|
| SEPA | SEPA bank transfer | same business day; max next business day | **24 h** (1440 min) | 3 h ← | high | business days only | [europe](europe.md) |
| TIKKIE | Tikkie | same day; latest next working day | **24 h** (1440 min) | 3 h (Custom fallback) ← | high | working days | [europe](europe.md) |
| DOMESTIC_WIRE_TRANSFER | Domestic wire transfer (US) | within hours, same business day | **24 h** (1440 min) | 3 h ← | high | Fedwire Mon-Fri only | [north-america](north-america.md) |
| TRANSFERWISE_USD | Wise (USD) | hours; ACH up to 4 working days | **24 h** (1440 min) | 3 h (Custom fallback) ← | high | depends on how buyer sends | [global-apps-remittance](global-apps-remittance.md) |
| CASH_DEPOSIT | Cash deposit at bank | same day | **24 h** (1440 min) | 3 h (Custom fallback) ← | medium | branch opening hours | [gift-cards-cash](gift-cards-cash.md) |
| F2F | Cash in person (face to face) | at the meeting | **24 h** (1440 min) | 3 h (Custom fallback) ← | n/a | follows the agreed meeting | [gift-cards-cash](gift-cards-cash.md) |

### Tier 72 h (4 methods)

| id | name | typical arrival | recommended window | builder today | confidence | why this tier | file |
|---|---|---|---|---|---|---|---|
| ACH_TRANSFER | ACH bank transfer (US) | next business day | **72 h** (4320 min) | 3 h ← | high | business days; up to 2-4 days | [north-america](north-america.md) |
| SWIFT | International wire (SWIFT) | 75% within 6 h, 92% within 24 h | **72 h** (4320 min) | 3 h ← | medium | cut-offs, time zones, weekends | [global-apps-remittance](global-apps-remittance.md) |
| PAY_BY_MAIL | Cash by mail | 1-3 business days (US Priority) | **72 h** (4320 min) | 24 h ← | medium | postal delivery | [gift-cards-cash](gift-cards-cash.md) |
| US_POSTAL_MONEY_ORDER | USPS money order | 1-5 business days (mailed) | **72 h** (4320 min) | 3 h (Custom fallback) ← | high | postal delivery | [gift-cards-cash](gift-cards-cash.md) |

## The methods I am least sure about

| id | why |
|---|---|
| CAPITUAL | The provider now presents a business digital-asset service. Whether person-to-person transfers still exist is unknown. Treated as Custom (3 h). |
| CHIME | No Chime page found. Only blogs say Pay Anyone is instant. |
| PAYONEER | Built for business payouts. The only claim that Payoneer-to-Payoneer is instant comes from one blog. |
| AFRIEX | Only Afriex's own marketing ("in seconds") and one comparison site ("same day"). |
| CHIPPER_CASH, MIXX_BY_YAS, MTN_MOMO | Instant is assumed from how mobile money works. The reversal rules come from local news and vary by country. |
| EASYPAISA | Wallet-to-wallet is instant. Transfers to or from banks can be delayed up to 24 hours (SadaPay help page). |
| PAGO_MOVIL, MIR, UKRAINE_CARD | No official timing page. Local limits and outages are the bigger factor. |
| SWIFT | The statistics are from 2019–2020, and the 72 h choice is a judgement about weekends and cut-offs. Most wires arrive the same day. |
| TRANSFERWISE_USD | Anything from instant (Wise to Wise) to 4 working days (ACH), depending on how the buyer sends. 24 h assumes the buyer does not use slow ACH. |
| Gift cards, CASH_DEPOSIT | The 3 h and 24 h windows are about people's errands (a shop trip, branch hours). No provider data exists for that. |

## Files

| Group | File | Methods |
|---|---|---|
| 1. North America apps and banks | [north-america.md](north-america.md) | 9 |
| 2. Europe (SEPA, instant schemes, EU apps) | [europe.md](europe.md) | 16 |
| 3. UK, Nordics, Russia, Ukraine, Kazakhstan | [uk-nordics-east.md](uk-nordics-east.md) | 9 |
| 4. Latin America | [latin-america.md](latin-america.md) | 8 |
| 5. Asia-Pacific | [asia-pacific.md](asia-pacific.md) | 17 |
| 6. Africa, Pakistan and Türkiye | [africa-middle-east.md](africa-middle-east.md) | 9 |
| 7. Global apps, wallets, remittance and generic bank methods | [global-apps-remittance.md](global-apps-remittance.md) | 21 |
| 8. Gift cards, cash in person, cash deposits, cash by mail | [gift-cards-cash.md](gift-cards-cash.md) | 20 |
| **Total** | | **109** |

Coverage check: all 109 catalog ids appear exactly once across the eight group tables and once in the merged table above. No id is missing, duplicated, or absent from the catalog.
