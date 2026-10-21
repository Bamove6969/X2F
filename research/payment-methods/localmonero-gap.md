# LocalMonero payment methods vs the X2F catalog: the gap

**Date checked:** 2026-10-21 · **Our catalog:** `data/payment-methods.json` (79 entries) · **Research only:** nothing in the catalog was changed.

## 1. Sources

**The Wayback Machine could not be used.** Every request to `web.archive.org` from this machine got HTTP 429 (Too Many Requests) all through the session. We retried for about 10 minutes. The availability API still answered and confirmed that snapshots exist, but we could not open them:

- LocalMonero home page, snapshot of 2024-04-30: `http://web.archive.org/web/20240430074847/https://localmonero.co/` (exists; not read)
- AgoraDesk API docs, snapshot of 2024-05-08: `http://web.archive.org/web/20240508104406/https://agoradesk.com/api-docs/v1` (exists; not read)
- No snapshot exists of the public method-list endpoints `localmonero.co/api/v1/payment_methods` or `agoradesk.com/api/v1/payment_methods`, according to the availability API.

**What we used instead (primary source): LocalMonero's own app source code.** LocalMonero and AgoraDesk shipped one open-source mobile app from a single code base. Its README says it holds "two apps under one code base". Repository: https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss. Last commit `c11ba0c`, dated 2024-05-28. That is 3 weeks after the wind-down began on 2024-05-07, and LocalMonero shut down on 2024-11-07 ([AlternativeTo](https://alternativeto.net/software/local-monero/about)). Two files in it name the payment methods:

1. `lib/core/translations/payment_method_mixin.dart` ([link](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/blob/c11ba0cfc2905b7ba884eeb957bd2120b529e400/lib/core/translations/payment_method_mixin.dart)) maps 110 method codes to display names. English names for the generic codes come from `assets/translations/app_en.arb`.
2. `assets/banks/` ([link](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/tree/c11ba0cfc2905b7ba884eeb957bd2120b529e400/assets/banks)) holds 112 icons, one per method code. Ten codes have an icon but no entry in the name map: AFRIEX, AIRTM, CHIME, GOLDBACK, IDEAL, NEOSURF, SOFI_P2P, TWINT, UPI and ZEN. They are almost certainly methods added late, whose names came from the server.

**Caveat.** The app downloaded the live list from the API at run time (`ads_service.dart` calls `/payment_methods`). So the two files above are a **lower bound** on what LocalMonero offered. A method that existed only on the server, with no icon and no name in the app, would not appear here. We think few were missed, because the icons cover even small methods (PYC, Superflash), but this is **unconfirmed** until someone can read a 2023–24 Wayback snapshot of the buy page's method filter. AgoraDesk used the same list; this app serves both brands, so it doubles as the AgoraDesk cross-check.

**How we counted.** We merged the name map and the icon set. We dropped 5 codes that are not methods or are duplicates: `any_payment_method`, `ALL_ONLINE` (filters), `FACEBOOK` (an icon duplicate of FACEBOOK_PAY), "Skrill (Moneybookers)" (an icon duplicate of MONEYBOOKERS) and `KAOSHI_NETWORK` (an icon duplicate of KAOSHI). That leaves **118 distinct LocalMonero methods**.

Status checks for providers (still operating?) come from web searches on 2026-10-21 and from fetching each provider's home page with curl the same day. "Site live" means the provider's own domain answered HTTP 200 or 403 (403 = blocked our bot, site exists). A live site does not prove that the P2P feature still works. Those rows are marked "(site live only)".

## 2. Summary counts

| | Count |
|---|---|
| LocalMonero methods (distinct, lower bound) | **118** |
| Matched to an X2F entry | **53**: 46 direct, 7 via a generic or near entry |
| Missing from X2F | **65**: 8 are gift-card codes |
| X2F entries with no LocalMonero counterpart ("ours, not theirs") | **36** of 79 |

The 7 matched via a generic or near entry: POSTAL_ORDER → US_POSTAL_MONEY_ORDER (LocalMonero's was not US-only); PRIVAT24 → UKRAINE_CARD; IDEAL → WERO (iDEAL is moving to Wero, see [REPORT.md](REPORT.md) #69); OTHER_ONLINE_WALLET and OTHER_ONLINE_WALLET_GLOBAL → CUSTOM; CASH_ON_DELIVERY → F2F; UP (an Australian neobank) → AUSTRALIA_PAYID.

The direct matches include renamed or merged services: YANDEXMONEY → YOOMONEY; CHASE_QUICKPAY → ZELLE (Chase's QuickPay became Zelle); the three Danske MobilePay codes (DK, FI, NO) and VIPPS → VIPPS_MOBILEPAY; MPESA_KENYA and MPESA_TANZANIA → MPESA; SQUARE_CASH → CASH_APP; CASH (local cash trades) → F2F; OTHER ("Other online payment") → CUSTOM.

**Ours, not theirs (36):** UPHOLD, MONEY_BEAM, SEPA_INSTANT, SPEI, FASTER_PAYMENTS, GCASH, JAPAN_BANK, SAME_BANK, MOMO, PROMPT_PAY, TRANSFERWISE_USD, PAYSERA, NEFT, RTGS, NEQUI, PIX, CAPITUAL, CELPAY, MONESE, TIKKIE, VERSE, ACH_TRANSFER, DOMESTIC_WIRE_TRANSFER, BLIK, NIP, PAGO_MOVIL, QRIS, PAPARA, RAAST, PAYNOW, FPS, DUITNOW, PAYPAY, SBP, MIR, KASPI. Most of these are national bank rails. On LocalMonero a seller would have put them under "National bank transfer" or "Transfers with specific bank" and named the rail in the ad text, so this number overstates the real difference (inferred).

## 3. Missing methods (57 non-gift-card codes)

"Type" uses our catalog's groups. **Still operating?** is the provider's status on 2026-10-21. "(site live only)" = our curl got 200/403 from the provider's domain that day; the P2P feature itself was not checked.

| LocalMonero code / name | Type | Region | Still operating today? (source) | Note |
|---|---|---|---|---|
| AFRIEX · Afriex | Payment app (remittance) | US/CA/UK → Africa | Yes (site live only) https://www.afriex.com | Late addition (icon only) |
| AIRTM · Airtm | Payment app | Latin America | Yes; MSB, USDC-backed balance (secondary) https://www.forbesargentina.com/money/la-plataforma-permite-comprar-dolares-sin-limites-llego-pais-como-funciona-n11106 | Crypto-native; runs its own P2P exchange, so it competes with us |
| AMEX · Amex | unclear (card or Amex Serve?) | US | Unclear what the code meant | If it meant Serve, see SERVE2SERVE |
| APPLE_PAY · Apple Pay | Payment app (Apple Cash P2P) | US | Yes (site live only) https://www.apple.com/apple-cash/ | Card-funded, so reversal risk (inferred) |
| ASTROPAY · AstroPay | Payment app / voucher | LatAm, global | Yes (site live only) https://www.astropay.com | |
| BPAY · BPAY Bill Payment | Bank transfer (bill pay) | Australia | Yes; now under AusPayNet's Australian Payments Plus (curl redirect to https://www.auspayplus.com.au/solutions/bpay) | Pays billers, not people. PayID covers person-to-person |
| CASHIERS_CHECK · Cashier's check | Cash & money orders | US | Generic instrument, still exists | Counterfeits are common (inferred), like US_POSTAL_MONEY_ORDER |
| CASHU · CashU | Payment app / prepaid | Middle East | **Probably shut down**: Wikipedia lists it defunct around 2018 https://en.wikipedia.org/wiki/CashU; cashu.com does not resolve (our curl) | |
| CHIME · Chime ("Pay Anyone") | Payment app | US | Yes (site live only) https://www.chime.com/pay-anyone/ | Late addition (icon only) |
| CHIPPER_CASH · Chipper | Payment app | Africa (NG, GH, UG and others) | Yes (site live only) https://chippercash.com | |
| CREDITCARD · Credit card | card | Global | n/a (generic) | Chargeback and stolen-card risk; we suggest not adding it |
| CRYPTOCURRENCY · Cryptocurrency | crypto | Global | n/a | Out of scope: X2F trades XMR for fiat |
| DWOLLA · Dwolla | Payment app | US | Company live, but now a business payments API (site live only) https://www.dwolla.com; consumer P2P end date **unconfirmed** | Not a consumer P2P method any more (inferred) |
| EASYPAISA · Easypaisa | Payment app | Pakistan | Yes (site live only) https://easypaisa.com.pk | Pakistan's virtual-asset rules apply; see the RAAST flag in REPORT.md |
| FACEBOOK_PAY · Facebook/Meta Pay | Payment app | US (ended in UK/FR 2019) | Messenger P2P ended in UK/France 2019-06-15 https://techcrunch.com/2019/04/16/facebook-is-discontinuing-p2p-payments-in-messenger-in-the-uk-and-france-on-june-15; US status **unconfirmed** | |
| GOLDBACK · Goldback | physical gold notes | US (some states) | Yes https://www.goldback.com | Not fiat; would be a variant of in-person or by-mail trades |
| GOOGLEWALLET · Google Wallet | Payment app | US | **US P2P ended 2024-06-04** https://www.engadget.com/google-pay-is-shutting-down-in-the-us-later-this-year-105720968.html | Google Pay India runs on UPI, which we already list |
| GREEN_DOT_CARD · Green Dot | prepaid card | US | Yes https://www.greendot.com | Reload codes are a known scam tool (inferred) |
| HYPERWALLET · hyperWALLET | payout platform | Global | Yes, as PayPal's business payout service (site live only) https://www.hyperwallet.com | Not consumer P2P (inferred) |
| KAOSHI · Kaoshi (Network) | P2P currency exchange | Nigeria / diaspora | **Unconfirmed**: kaoshi.com did not resolve in our curl; an undated blog calls it live https://www.kyshi.co/blog/best-p2p-currency-exchange-platforms-in-nigeria | |
| KORONAPAY · KoronaPay (Zolotaya Korona) | remittance | Russia / CIS / EU | **Sanctioned**: US SDN listing of its software developer CFT (Aug 2024); EU listing of its operator (Jul 2026); EU arm leaving the market https://ru.themoscowtimes.com/2026/08/20/krupneishaya-platezhnaya-sistema-perevodov-rossii-uidet-s-rinka-es-iz-za-sanktsii-a203952 | Do not add |
| LYDIA · Lydia | Payment app | France (also ES, DE) | Yes; P2P-only app after banking was spun off as Sumeria in 2024 https://www.finextra.com/newsarticle/44147/french-payments-app-lydia-launches-mobile-bank | lydia-app.com redirected our curl to sumeria.eu |
| MOBILE_TOP_UP · Mobile top up | voucher | Global | n/a (generic) | Belongs with gift cards |
| MONEYBOOKERS · Moneybookers / Skrill | Payment app | Global | Yes (site live only) https://www.skrill.com | On LocalMonero's "worldwide" shortlist in the app source |
| MTN_MOBILE_MONEY · MTN MoMo | Payment app | Africa (GH, UG, CM, CI, RW and others) | Yes (site live only) https://momo.mtn.com | Not the same as our MOMO (Vietnam) |
| NEOSURF · Neosurf | prepaid voucher | EU, AU, global | Yes https://www.neosurf.com | Gift-card-like; late addition (icon only) |
| NETELLER · Neteller | Payment app | Global | Yes https://www.neteller.com | On LocalMonero's "worldwide" shortlist; same owner as Skrill (Paysafe) |
| NETSPEND · NetSpend Reload Pack | prepaid reload | US | Yes (site live only) https://www.netspend.com | Gift-card-like |
| ONECARD · OneCard | prepaid voucher | Middle East | Yes https://www.onecard.com | Gift-card-like (gaming vouchers) |
| OTHER_PRE_PAID_DEBIT · Other pre-paid debit card | prepaid card | Global | n/a (generic) | Card-detail sales; fraud-prone (inferred) |
| OTHER_REMITTANCE · Other remittance | remittance | Global | n/a (generic) | CUSTOM covers it |
| PAYEER · Payeer | Payment app | Global (RU-linked) | **EU transaction ban (19th package, 2025-10-23); wind-down announced** (secondary) https://fintelegram.com/us-19th-russia-sanctions-hit-payeer-with-full-transaction-ban/; payeer.com did not resolve in our curl | Do not add |
| PAYM · Paym | Bank transfer (mobile) | UK | **Closed 2023** (secondary; official date unconfirmed) https://www.edgardunn.com/articles/rest-in-peace-paym | Faster Payments covers it |
| PAYONEER · Payoneer | Payment app | Global | Yes https://www.payoneer.com | Built for freelancers; terms not checked |
| PAYPALMYCASH · PayPal My Cash | prepaid reload | US | **Discontinued** around 2015 (secondary, date unconfirmed) https://frequentmiler.com/beware-buying-paypal-my-cash-cards/ | |
| PAYSEND · Paysend | remittance (card to card) | Global | Yes (site live only) https://paysend.com | |
| PINGIT · Pingit | Payment app | UK | **Closed 2021-06-30** https://finextra.com/newsarticle/37846/barclays-to-shut-down-pingit-on-30-june | |
| POLI · POLi | bank payment | AU, NZ | **AU closed 2023-09-30; NZ continues** https://instarem.com/blog/poli-exits-australia | Merchant checkout, not P2P |
| PostePay · PostePay | prepaid card with IBAN | Italy | Yes (site live only) https://www.poste.it/ | Card-to-card P2P inside Poste Italiane (inferred) |
| PYC · PYC | unidentified | n/a | **Unidentified**: no source found | |
| QIWI · QIWI | Payment app | Russia, CIS | **Bank licence revoked 2024-02-21** https://www.cbr.ru/eng/press/pr/?id=39708 | Do not add |
| RELOADIT · Reloadit | prepaid reload | US | **Unconfirmed**: reloadit.com did not resolve in our curl | |
| REMITLY · Remitly | remittance | Global | Yes https://www.remitly.com | |
| RIA · RIA Money Transfer | remittance (cash pickup) | Global | Yes (site live only) https://www.riamoneytransfer.com | Like MoneyGram and Western Union |
| SERVE2SERVE · Amex Serve | prepaid P2P | US | **Discontinued**: closed to new customers 2025-07-02, closed for existing customers June 2026 (secondary) https://www.nerdwallet.com/banking/learn/american-express-serve-review | |
| SOFI_P2P · SoFi P2P | bank P2P | US | Yes (site live only) https://www.sofi.com/banking/ | SoFi-to-SoFi only (inferred); late addition (icon only) |
| SOLIDTRUSTPAY · SolidTrustPay | Payment app | Global (Canada-based) | **Shut down 2020-04-01** https://behindmlm.com/payment-processors/solidtrust-pay-shutting-down-cites-regulatory-conditions | Its domain still answers |
| SUPERFLASH · Superflash | prepaid card | Italy | Yes https://www.intesasanpaolo.com/it/persone-e-famiglie/prodotti/carte/carte-prepagate/carta-superflash.html | Niche |
| TELEGRAMATIC_ORDER · Telegramatic order | postal or telegraph money order | probably Russia / CIS (inferred) | **Unidentified**: no source found | |
| TIGOPESA_TANZANIA · Tigo Pesa | Payment app | Tanzania | **Renamed "Mixx by Yas"** in Nov 2024 https://www.thecitizen.co.tz/tanzania/business/tigo-tanzania-rebrands-to-yas-in-shift-towards-pan-african-ambitions-4836754 | Still operating under the new name |
| VANILLA · Vanilla | prepaid gift card | US | Yes (site live only) https://www.vanillagift.com | Gift-card-like |
| VIRTUAL_VISA_MASTERCARD · Virtual Visa/MasterCard | prepaid card | Global | n/a (generic) | Card-detail sales; fraud-prone (inferred) |
| WALMART2WALMART · Walmart-2-Walmart | remittance (cash pickup) | US, MX | **Unconfirmed**: run by Ria; a 2025 guide calls it live https://expertbeacon.com/what-is-walmart-2-walmart/; Walmart's own page returned 404 | |
| WEBMONEY · WebMoney | Payment app | CIS, global | Operating, but banned in Ukraine since 2021 and RUB wallets ended in 2022 https://komersant.ua/en/popry-sanktsii-ukraintsi-dosi-korystuiutsia-rosiyskoiu-webmoney-transfer | Sanctions risk; lawyer question |
| WORLDREMIT · WorldRemit | remittance | Global | Yes https://www.worldremit.com | |
| XOOM · Xoom | remittance | US → global | Yes https://www.xoom.com | Owned by PayPal; inherits PayPal's reversal risk (inferred) |
| ZEN · ZEN.com | Payment app | EU | Yes (site live only) https://www.zen.com | Late addition (icon only) |

**Status tally of the 57.** 33 operating (16 of them "site live only"). 10 shut down or replaced: Tigo Pesa renamed; Google Wallet US P2P, Pingit, Paym, PayPal My Cash, SolidTrustPay, Amex Serve, CashU, POLi AU and QIWI closed. 3 sanctioned: KoronaPay, Payeer (also winding down), WebMoney (partly). 7 generic, not a provider: credit card, crypto, cashier's check, mobile top-up, other prepaid, other remittance, virtual card. 4 unidentified or unconfirmed: PYC, Telegramatic order, Kaoshi, Reloadit. Amex, Dwolla, Facebook Pay and Walmart-2-Walmart are counted as operating-but-unclear (inferred). This tally is approximate.

## 4. Gift cards LocalMonero had

Listed here only. Another researcher covers the top ~15 gift cards in detail.

| LocalMonero code | Name | In X2F? |
|---|---|---|
| GIFT_CARD_CODE_AMAZON | Amazon Gift Card Code | Yes (AMAZON_GIFT_CARD) |
| GIFT_CARD_CODE | Gift Card Code (any brand) | No |
| GIFT_CARD_CODE_GLOBAL | Gift Card Code (Global) | No |
| GIFT_CARD_CODE_APPLE_STORE | Apple Store Gift Card Code | No |
| GIFT_CARD_CODE_ITUNES | iTunes Gift Card Code | No (Apple now sells one combined Apple Gift Card, inferred) |
| GIFT_CARD_CODE_EBAY | eBay Gift Card Code | No |
| GIFT_CARD_CODE_STARBUCKS | Starbucks Gift Card Code | No |
| GIFT_CARD_CODE_STEAM | Steam Gift Card Code | No |
| GIFT_CARD_CODE_WALMART | Walmart Gift Card Code | No |

Vouchers and prepaid codes that work like gift cards (in the table above): PAYSAFECARD (we have it as PAYSAFE), NEOSURF, ONECARD, VANILLA, GREEN_DOT_CARD, NETSPEND, RELOADIT, MOBILE_TOP_UP, CASHU (closed), PAYPALMYCASH (closed). Names were checked against the app's English strings (`assets/translations/app_en.arb`).

## 5. Proposals for the catalog (text only, for the lead and the owner)

The catalog's existing schema is `id`, `name`, `group` (one of "Payment apps", "Bank transfers", "Cash & money orders", "Gift cards & vouchers", "Other"), `source`, `verified`, and optionally `legalReview`. **The schema has no region field**, so the region below is for the reader only. If a region is wanted in the JSON, that is a separate schema decision. In every proposal: `"source": "LocalMonero app source, agoradesk-app-foss c11ba0c (names only)"`, `"verified": false`. Each entry still needs the same provider-terms check that REPORT.md did.

### 5a. Add: operating P2P or remittance methods, no sanctions found

| id | name | group | region (reader only) | why |
|---|---|---|---|---|
| SKRILL | Skrill | Payment apps | Global | On LocalMonero's "worldwide" shortlist |
| NETELLER | Neteller | Payment apps | Global | On the same "worldwide" shortlist |
| APPLE_CASH | Apple Cash | Payment apps | US | LocalMonero "Apple Pay"; check card-funding reversals |
| CHIME | Chime | Payment apps | US | |
| REMITLY | Remitly | Cash & money orders | Global | Remittance; same group as MoneyGram/WU |
| WORLDREMIT | WorldRemit | Cash & money orders | Global | |
| RIA | Ria Money Transfer | Cash & money orders | Global | Also covers Walmart-2-Walmart, which Ria runs |
| XOOM | Xoom (PayPal) | Cash & money orders | US → global | Flag PayPal-style reversal risk |
| PAYSEND | Paysend | Payment apps | Global | |
| MTN_MOMO | MTN Mobile Money | Payment apps | Africa | Name must differ from MOMO (Vietnam) |
| MIXX_BY_YAS | Mixx by Yas (formerly Tigo Pesa) | Payment apps | Tanzania | |
| CHIPPER_CASH | Chipper Cash | Payment apps | Africa | |
| EASYPAISA | Easypaisa | Payment apps | Pakistan | add `"legalReview"` (Pakistan VA rules, as for RAAST) |
| AIRTM | Airtm | Payment apps | Latin America | Crypto-native; check terms for competing exchanges |
| ASTROPAY | AstroPay | Payment apps | LatAm, global | |
| LYDIA | Lydia | Payment apps | France | |
| POSTEPAY | PostePay | Payment apps | Italy | |
| PAYONEER | Payoneer | Payment apps | Global | |
| ZEN | ZEN.com | Payment apps | EU | |
| AFRIEX | Afriex | Payment apps | Africa diaspora | |

Lower priority (niche, or reversal-prone): CASHIERS_CHECK "Cashier's check" (Cash & money orders, US; counterfeit risk like US_POSTAL_MONEY_ORDER); SOFI "SoFi P2P" (Payment apps, US); SUPERFLASH "Superflash" (Payment apps, Italy). Also consider widening US_POSTAL_MONEY_ORDER, or adding a generic POSTAL_ORDER "Postal order", because LocalMonero's version was not US-only (UK postal orders, for example).

### 5b. Gift cards and vouchers: defer to the gift-card researcher

These would go in group "Gift cards & vouchers": the 8 gift-card codes above, plus NEOSURF, ONECARD, VANILLA, GREEN_DOT and NETSPEND (reload packs), and possibly MOBILE_TOP_UP. Each should get a `legalReview` like AMAZON_GIFT_CARD and PAYSAFE have, because of the resale clauses noted in REPORT.md.

### 5c. Do not add

- **Shut down or replaced:** POLi (AU), Pingit, Paym, PayPal My Cash, SolidTrustPay, CashU, Amex Serve, Google Wallet US P2P, QIWI. Tigo Pesa is now Mixx (see 5a).
- **Sanctioned or sanctions-heavy:** KoronaPay, Payeer, WebMoney. Add them only if a lawyer approves, and with `legalReview`, like SBP/MIR/YOOMONEY.
- **Reversal or fraud by design:** credit card, virtual Visa/MasterCard, other prepaid debit.
- **Out of scope:** cryptocurrency.
- **Not consumer P2P:** Dwolla, Hyperwallet, BPAY (biller payments; PayID covers person-to-person).
- **Generic, already covered by CUSTOM:** other remittance, other online wallet.
- **Unidentified or unconfirmed:** PYC, Telegramatic order, Kaoshi, Reloadit, Amex, Facebook/Meta Pay (US status unknown). Leave out until identified.
- **Not fiat:** Goldback. It could be mentioned in F2F/by-mail ad text.

## 6. Open items

- When the Wayback Machine stops returning 429 (or from another network), read a 2023–24 snapshot of LocalMonero's buy page method filter. That would confirm the 118 list and show any server-only methods the app source doesn't name. Snapshots to try first are listed in section 1.
- Rows marked "(site live only)" and "unconfirmed" need a provider-terms check before any entry goes into the catalog. That is the same process as REPORT.md.
