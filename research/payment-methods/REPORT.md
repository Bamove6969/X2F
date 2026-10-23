# Payment-method verification — merged report

**Date checked:** 2026-10-21 · **Catalog:** `data/payment-methods.json` (79 entries)

**Method.** Six regional researchers each checked their share of the catalog against primary sources (provider terms and help pages, scheme operators, central banks and regulators), fetched on the date above. Where a primary page could not be fetched they used something else and labelled it: **(inferred)** = the researcher's own reasoning; **(indexed excerpt)** = a search engine's copy of the official page; "secondary" = press, law-firm or third-party pages. This report only combines the six files below. It adds no new facts.

| Short name | File |
|---|---|
| NA | [north-america.md](north-america.md) |
| EU-W | [europe-west.md](europe-west.md) |
| EU-NE | [europe-north-east.md](europe-north-east.md) |
| LATAM | [latam-africa-me.md](latam-africa-me.md) (LatAm, Africa, Middle East, South Asia) |
| APAC | [asia-pacific.md](asia-pacific.md) |
| GLOBAL | [global.md](global.md) |

> **Research only.** Nothing in the catalog has been changed. Every catalog change below is a **proposal** for the lead and the owner to decide. Legal points are questions for a lawyer, not conclusions.

---

## 1. Counts and coverage

### Verdicts (all 79 entries)

| Verdict | Count | Entries |
|---|---|---|
| verified | 20 | 12 provider/scheme entries + 8 generic ones (GLOBAL: NATIONAL_BANK, SAME_BANK, SPECIFIC_BANKS, CASH_DEPOSIT, F2F, PAY_BY_MAIL, CASH_AT_ATM, CUSTOM) |
| verified-with-flags | 53 | |
| outdated | 2 | ADVANCED_CASH (now Volet), PAYTM (now UPI-only) |
| discontinued | 3 | VERSE, PERFECT_MONEY, CELPAY |
| unclear | 1 | CAPITUAL |
| **Total** | **79** | |

By file: NA 8 (2 verified · 6 with flags) · EU-W 11 (5 · 5 · 1 discontinued) · EU-NE 12 (2 · 10) · LATAM 10 (2 · 7 · 1 unclear) · APAC 17 (1 · 15 · 1 outdated) · GLOBAL 21 (8 generic · 10 · 1 outdated · 2 discontinued).

### ID coverage check

All 79 catalog ids appear **exactly once** across the six summary tables. Each also has exactly one detail section.
- Missing: **none**
- Duplicated: **none**
- Ids in the files that are not in the catalog: **none**

---

## 2. Master table (catalog order)

Legend: **vwf** = verified-with-flags. **Legal** = `y` if the region file asks for lawyer review, proposes a `legalReview` flag, or the catalog already has one.

| # | id | name | file | verdict | reversal risk | crypto / commercial-use clause | legal | note |
|---|---|---|---|---|---|---|---|---|
| 1 | UPHOLD | Uphold | [GLOBAL](global.md) | vwf | medium | indirect: bars acting as a "payment intermediary" and unlicensed money transmission | y | EEA deposits reportedly paused since 2026-07-01 (secondary only); funding chargebacks are clawed back from the account |
| 2 | MONEY_BEAM | MoneyBeam (N26) | [EU-W](europe-west.md) | verified | low | none found | n | N26-to-N26 only; €5,000/24h; cannot be reversed |
| 3 | REVOLUT | Revolut | [EU-NE](europe-north-east.md) | vwf | medium | yes: restricts accounts tied to P2P crypto platforms (indexed excerpt) | n | May confiscate funds received from fraud victims; UK APP reimbursement |
| 4 | PERFECT_MONEY | Perfect Money | [GLOBAL](global.md) | discontinued | n/a | unknown | n | Domains don't resolve; wind-down reported 2024–25 (secondary) |
| 5 | SEPA | SEPA | [EU-W](europe-west.md) | vwf | medium | unknown (bank-specific) | n | Payer's bank can send a fraud recall for up to 13 months |
| 6 | SEPA_INSTANT | SEPA Instant | [EU-W](europe-west.md) | vwf | medium | unknown (bank-specific) | n | Arrives in 10 s, no scheme maximum; same 13-month fraud recall |
| 7 | SPEI | SPEI | [LATAM](latam-africa-me.md) | verified | low | unknown | y | Credits final; Banxico CEP receipt lets seller verify a payment |
| 8 | FASTER_PAYMENTS | Faster Payments (UK) | [EU-W](europe-west.md) | vwf | **high** | unknown (bank-specific) | y | UK APP-scam reimbursement: £85k, 13-month claims, receiving bank pays 50% |
| 9 | GCASH | GCash | [APAC](asia-pacific.md) | vwf | medium | none (GCash sells crypto itself) | y | AFASA lets GCash hold disputed funds up to 30 days |
| 10 | NATIONAL_BANK | National bank transfer | [GLOBAL](global.md) | verified (generic) | low–medium | n/a | n | Fraud-recall / APP risk varies by country |
| 11 | JAPAN_BANK | Japan bank transfer (Furikomi) | [APAC](asia-pacific.md) | vwf | medium | unknown (generic) | y | Furikome Fraud Relief Act lets banks freeze a recipient account |
| 12 | AUSTRALIA_PAYID | PayID (Australia) | [APAC](asia-pacific.md) | vwf | medium | none at scheme level; banks vary | y | Scams Prevention Framework phasing in; receiving bank in scope |
| 13 | SAME_BANK | Transfer within the same bank | [GLOBAL](global.md) | verified (generic) | low–medium | n/a | n | Instant and final; bank recalls/freezes possible |
| 14 | SPECIFIC_BANKS | Transfer with specific banks | [GLOBAL](global.md) | verified (generic) | low–medium | n/a | n | Same profile as national bank transfer |
| 15 | SWISH | Swish | [EU-NE](europe-north-east.md) | verified | low | none in Swish pages (banks have cut crypto firms) | n | Sweden/SEK; sender cannot cancel |
| 16 | ALI_PAY | Alipay | [APAC](asia-pacific.md) | vwf | **high** | yes: provider stance + PRC Yinfa [2026] No. 42 | y | Removal candidate |
| 17 | WECHAT_PAY | WeChat Pay | [APAC](asia-pacific.md) | vwf | **high** | yes: 2019 agreement + PRC Yinfa [2026] No. 42 | y | Removal candidate; foreign-card users can't send P2P |
| 18 | ZELLE | Zelle | [NA](north-america.md) | vwf | medium | none; "people you know and trust" | y | Bank fraud/scam claims can still pull funds back |
| 19 | INTERAC_E_TRANSFER | Interac e-Transfer | [NA](north-america.md) | verified | low | none | y | Canada; final once deposited; FINTRAC MSB question |
| 20 | US_POSTAL_MONEY_ORDER | US Postal money order | [NA](north-america.md) | vwf | **high** (counterfeits) | none | y | $1,000 cap; buyer can't stop payment; fakes are the danger |
| 21 | CASH_DEPOSIT | Cash deposit at bank | [GLOBAL](global.md) | verified (generic) | low | n/a | n | No chargeback; banks may refuse third-party cash |
| 22 | MERCADO_PAGO | Mercado Pago | [LATAM](latam-africa-me.md) | vwf | medium | yes (AR regulation: BCRA Com. "A" 7759) | y | Card-funded payments can be disputed; account suspensions |
| 23 | MOMO | MoMo | [APAC](asia-pacific.md) | vwf | medium | none in terms; VN Decree 284/2026 | y | M_Service may freeze disputed funds |
| 24 | MONEY_GRAM | MoneyGram | [GLOBAL](global.md) | vwf | medium | no crypto ban; bans sending to "anyone you do not know" | y | Cancellable before pickup |
| 25 | WESTERN_UNION | Western Union | [GLOBAL](global.md) | vwf | medium | none found | n | Cancellable until pickup; Russia/Belarus suspended |
| 26 | HAL_CASH | HalCash | [EU-W](europe-west.md) | verified | low (after withdrawal) | none found | n | Sender can cancel until ATM withdrawal; €10–600 per order |
| 27 | F2F | Cash in person (face to face) | [GLOBAL](global.md) | verified (generic) | low | n/a | y | Safety/counterfeit; cash caps or licensing (inferred) |
| 28 | PROMPT_PAY | PromptPay | [APAC](asia-pacific.md) | vwf | medium | unknown (scheme); Thai SEC position | y | Mule-account decree: 72 h holds, up to 7-day suspensions |
| 29 | ADVANCED_CASH | Advcash | [GLOBAL](global.md) | outdated | low | none found on P2P crypto | y | Now Volet.com; no US persons; sanctions check |
| 30 | TRANSFERWISE | Wise | [GLOBAL](global.md) | vwf | low–medium | **yes**: bans receiving P2P crypto proceeds | y | Account closure is the stated consequence |
| 31 | TRANSFERWISE_USD | Wise (USD) | [GLOBAL](global.md) | vwf | low–medium | **yes** (same policy) | y | ACH-funded USD can be returned |
| 32 | PAYSERA | Paysera | [EU-NE](europe-north-east.md) | vwf | low | **yes**: terms forbid crypto trading | y | Restriction/closure on repeat use |
| 33 | PAXUM | Paxum | [GLOBAL](global.md) | vwf | low | **yes**: bans virtual-currency sale/purchase/exchange | y | Offshore bank (Dominica) |
| 34 | NEFT | NEFT (India) | [APAC](asia-pacific.md) | vwf | **high** | none at scheme level | y | Cyber-cell liens/freezes common for P2P crypto sellers |
| 35 | RTGS | RTGS (India) | [APAC](asia-pacific.md) | vwf | **high** | none at scheme level | y | ₹2 lakh minimum; same freeze risk |
| 36 | IMPS | IMPS (India) | [APAC](asia-pacific.md) | vwf | **high** | none at scheme level | y | ₹5 lakh per transaction; same freeze risk |
| 37 | UPI | UPI | [APAC](asia-pacific.md) | vwf | **high** | none at scheme level | y | ₹1 lakh P2P cap; freeze risk dominates |
| 38 | PAYTM | Paytm | [APAC](asia-pacific.md) | outdated | **high** | unknown | n | Payments Bank licence cancelled; app is now a UPI app only |
| 39 | NEQUI | Nequi | [LATAM](latam-africa-me.md) | verified | low–medium | unknown | n | Colombia; mass account freezes reported |
| 40 | BIZUM | Bizum | [EU-W](europe-west.md) | verified | low | none found | n | €1,000 per operation; cannot be cancelled; tax reporting |
| 41 | PIX | PIX | [LATAM](latam-africa-me.md) | vwf | **high** | unknown | y | MED fraud claims up to 80 days |
| 42 | AMAZON_GIFT_CARD | Amazon eGift card | [GLOBAL](global.md) | vwf | **high** | no crypto clause; bans resale/"transfer for value" | y | Gift-card owner decision open |
| 43 | PAY_BY_MAIL | Cash by mail | [GLOBAL](global.md) | verified (generic) | medium | n/a | n | Loss and "never arrived" disputes |
| 44 | CASH_AT_ATM | Cash at ATM | [GLOBAL](global.md) | verified (generic) | low | n/a | n | Sender can cancel the code before withdrawal |
| 45 | CAPITUAL | Capitual | [LATAM](latam-africa-me.md) | **unclear** | unknown | unknown (crypto-native, inferred) | n | Site now presents a B2B digital-asset business |
| 46 | CELPAY | CelPay | [GLOBAL](global.md) | discontinued | n/a | n/a | n | Celsius apps shut 2024-02-29 |
| 47 | MONESE | Monese | [EU-NE](europe-north-east.md) | vwf | medium | none in current terms | n | Pockit takeover after going-concern warning; UK APP |
| 48 | MPESA | M-Pesa | [LATAM](latam-africa-me.md) | vwf | medium | none found; Ethiopia NBE ban | y | Sender can reverse via 456 until funds are used |
| 49 | SATISPAY | Satispay | [EU-W](europe-west.md) | vwf | low | no crypto; personal use only | y (lawyer to decide) | 10-day reversal for unauthorised funds |
| 50 | TIKKIE | Tikkie | [EU-W](europe-west.md) | vwf | low | no crypto; business use banned | y (lawyer to decide) | NL; €950 per request |
| 51 | VERSE | Verse | [EU-W](europe-west.md) | discontinued | n/a | n/a | n | Block shut it down in 2023 |
| 52 | STRIKE | Strike | [NA](north-america.md) | vwf | low | partial: AUP bans currency exchanges/dealers; ToS bans commercial third-party use | y | BTC/USD only in US; transactions final |
| 53 | SWIFT | International wire (SWIFT) | [GLOBAL](global.md) | vwf | low–medium | n/a (network) | n | Recalls need beneficiary bank's cooperation; sanctions screening |
| 54 | ACH_TRANSFER | Bank transfer (ACH) | [NA](north-america.md) | vwf | **high** | n/a (generic) | y | 5-banking-day reversals; R17/R06 fraud returns |
| 55 | DOMESTIC_WIRE_TRANSFER | Domestic wire transfer | [NA](north-america.md) | verified | low | n/a (generic) | y | Fedwire final; only voluntary fraud-recall requests |
| 56 | CASH_APP | Cash App | [NA](north-america.md) | vwf | **high** | P2P limited to personal, non-commercial use | y | Can claw back "invalid" payments; card funding |
| 57 | VENMO | Venmo | [NA](north-america.md) | vwf | **high** | yes: PayPal AUP + personal G&S ban | y | Reversals for compromised funding; card funding |
| 58 | PAYPAL | PayPal | [GLOBAL](global.md) | vwf | **high** | yes: crypto needs pre-approval | y | Chargebacks, reversals, holds up to 180 days |
| 59 | PAYSAFE | Paysafecard | [GLOBAL](global.md) | vwf | medium | no crypto; bans PIN sale on "exchange platforms" and commercial use | y | Gift-card owner decision open |
| 60 | BLIK | BLIK | [EU-NE](europe-north-east.md) | verified | low | none found | n | Poland; Slovakia e-commerce only |
| 61 | VIPPS_MOBILEPAY | Vipps MobilePay | [EU-NE](europe-north-east.md) | vwf | medium | no crypto; bans commercial use (§4.4) | y | MobilePay becomes "Vipps" on 12 Jan 2027 |
| 62 | TWINT | TWINT | [EU-NE](europe-north-east.md) | vwf | low | no confirmed crypto clause; bans commercial use (§1.8) | y | Switzerland/CHF |
| 63 | NIP | NIP (Nigeria) | [LATAM](latam-africa-me.md) | vwf | medium–high | yes (regulation: banks can't trade VCs) | y | 14-working-day error reversals; NPS will replace NIP |
| 64 | PAGO_MOVIL | Pago Móvil | [LATAM](latam-africa-me.md) | vwf | low | none found | y | US Venezuela sanctions; partly eased by GL 57 |
| 65 | QRIS | QRIS | [APAC](asia-pacific.md) | vwf | low–medium | yes (BI regulation) | y | A QR standard, not a rail; Rp10m per transaction |
| 66 | PAPARA | Papara | [LATAM](latam-africa-me.md) | vwf | low–medium | yes (Turkish regulation) | y | Trustee, licence revoked/reinstated, sold to Emlak Katılım |
| 67 | RAAST | Raast | [LATAM](latam-africa-me.md) | vwf | low | yes (regulation: banks can't trade/hold VAs) | y | New Virtual Assets Act / PVARA |
| 68 | PAYNOW | PayNow | [APAC](asia-pacific.md) | vwf | low–medium | unknown (scheme) | y | Singapore FSMA Part 9 |
| 69 | WERO | Wero | [EU-W](europe-west.md) | verified | low | none found | n | Replaces Payconiq (LU), Paylib (FR); iDEAL (NL) migrating |
| 70 | FPS | FPS (Hong Kong) | [APAC](asia-pacific.md) | vwf | low–medium | unknown (scheme) | y | HK VA dealing-licence bill; check id mapping |
| 71 | DUITNOW | DuitNow | [APAC](asia-pacific.md) | verified | low–medium | unknown (scheme) | n | Malaysia; up to RM50,000 per transaction |
| 72 | MB_WAY | MB WAY | [EU-W](europe-west.md) | verified | low | none found | n | Portugal; links to Bizum and Bancomat |
| 73 | PAYPAY | PayPay | [APAC](asia-pacific.md) | vwf | medium | **yes**: bans P2P transfers mainly for crypto trading | y | File recommends removal |
| 74 | SBP | SBP (Russia) | [EU-NE](europe-north-east.md) | vwf | medium | yes (CBR 16-MR; 282-FZ) | y | Sanctions (existing legalReview) |
| 75 | MIR | Mir card | [EU-NE](europe-north-east.md) | vwf | **high** | yes (same Russian framework) | y | Sanctions (existing legalReview) |
| 76 | YOOMONEY | YooMoney | [EU-NE](europe-north-east.md) | vwf | low | **yes**: wallet terms forbid crypto buy/sell | y | OFAC SDN (existing legalReview) |
| 77 | UKRAINE_CARD | Ukrainian bank card transfer | [EU-NE](europe-north-east.md) | vwf | medium | unknown (generic) | y | NBU anti-"drop" limits; crypto law unsettled |
| 78 | KASPI | Kaspi | [EU-NE](europe-north-east.md) | vwf | low | yes (press statement, not in terms) | y | 2M KZT/day; account-freeze risk |
| 79 | CUSTOM | Custom method | [GLOBAL](global.md) | verified (generic) | unknown | n/a | n | X2F catch-all; should inherit strictest generic warnings |

---

## 3. Proposed catalog changes

These are proposals only, worded as the region files word them. Where files disagree, both views are shown under **Disagreements between files**.

### Remove

| id | Proposal | Reason | Source |
|---|---|---|---|
| VERSE | Remove | Block shut it down; app deactivated Sept 2023 | [EU-W](europe-west.md) |
| PERFECT_MONEY | Remove | Domains dead; reported wind-down 2024–25; "should not be offered" regardless | [GLOBAL](global.md) |
| CELPAY | Remove | Celsius apps shut 2024-02-29 | [GLOBAL](global.md) |
| PAYPAY | Remove | General Rules §6(1) ban P2P transfers made mainly for crypto trading | [APAC](asia-pacific.md) |
| PAYTM | Remove **or** merge into UPI | Payments Bank licence cancelled 2026-04-24, bank being wound up; app is now a UPI app | [APAC](asia-pacific.md) |
| CAPITUAL | Candidate, unless the consumer account is confirmed | Site now presents a B2B digital-asset business | [LATAM](latam-africa-me.md) |
| ALI_PAY, WECHAT_PAY | "Strong removal candidates" (proposed as legalReview) | PRC Yinfa [2026] No. 42 plus provider crypto bans | [APAC](asia-pacific.md) |
| RTGS | Optional: note the minimum, or drop | ₹2 lakh minimum is unsuited to retail P2P | [APAC](asia-pacific.md) |

Not proposed for removal: all NA entries ("all eight are operating"). EU-NE: "sanctions entries are the lawyer's call".

### Rename

| id | Current | Proposed | File |
|---|---|---|---|
| US_POSTAL_MONEY_ORDER | US Postal money order | **USPS money order** | NA |
| DOMESTIC_WIRE_TRANSFER | Domestic wire transfer | "Domestic wire transfer (US)" if US-only; otherwise mark generic and move out of NA | NA |
| ACH_TRANSFER | Bank transfer (ACH) | optional: "ACH bank transfer (US)" | NA |
| SEPA | SEPA | optional: "SEPA bank transfer" | EU-W |
| VIPPS_MOBILEPAY | Vipps MobilePay | "Vipps / MobilePay" now; **"Vipps"** from 12 Jan 2027 | EU-NE |
| SBP | SBP (Russia) | **SBP — Faster Payments System (Russia)** | EU-NE |
| KASPI | Kaspi | **Kaspi.kz (Kaspi Gold)** (proposal list); the entry's name check says "Kaspi.kz (Kaspi Gold transfer)" | EU-NE |
| PIX | PIX | **Pix** (BCB styling) | LATAM |
| NIP | NIP (Nigeria) | **NIBSS Instant Payment (NIP, Nigeria)** | LATAM |
| MPESA | M-Pesa | optional: "M-PESA" | LATAM |
| UPI | UPI | **UPI (India)** | APAC |
| QRIS | QRIS | **QRIS (Indonesia)**; consider moving it out of "Bank transfers" | APAC |
| WECHAT_PAY | WeChat Pay | optional alias "Weixin Pay" | APAC |
| ADVANCED_CASH | Advcash | **Volet (formerly Advcash)** | GLOBAL |
| PAYSAFE | Paysafecard | optional: "PaysafeCard" (issuer's current spelling) | GLOBAL |

Name-check suggestions that are not in any proposal list: BLIK → "BLIK phone transfer (Poland)" (EU-NE). SWIFT: the operator now writes "Swift" (GLOBAL). FASTER_PAYMENTS: keep as is (EU-W).

### Merge / remap

- **PAYTM → UPI** (APAC).
- **WERO:** if the catalog has PAYCONIQ, PAYLIB or iDEAL entries, mark them outdated in favour of WERO. None exist in the current catalog (EU-W).
- **FPS id mapping:** check whether Haveno's "FPS" meant UK Faster Payments, not Hong Kong FPS (APAC). The catalog already has a separate FASTER_PAYMENTS entry (EU-W).
- **Countries / scope** (NA): ZELLE, ACH, VENMO, CASH_APP, USPS → `US` only. INTERAC → `CA` only. STRIKE → multi-region.
- **MPESA:** consider excluding Ethiopia (NBE virtual-asset ban, Jul 2026) (LATAM).

### Add `legalReview` (reason text as the files give it)

**Already in the catalog** (SBP, MIR, YOOMONEY: "sanctions: needs lawyer sign-off before launch"). Keep, and add detail (EU-NE):
- SBP: "EU 19th package bars EU operators from SBP; operator Bank of Russia (OFAC Directive 4); NSPK SDN (US) and UK-designated"
- MIR: "NSPK: OFAC SDN 23 Feb 2024; UK designated 15 Oct 2025; EU operators barred"
- YOOMONEY: "OFAC SDN 6 Apr 2022 (Sberbank subsidiary)"

**New:**

| id | Reason text | File |
|---|---|---|
| VENMO | AUP currency-exchange prohibition and crypto pre-approval, plus ban on personal payments for goods and services | NA |
| STRIKE | AUP bans currency exchanges/dealers; ToS §15(e) bans commercial use | NA |
| CASH_APP | P2P limited to personal, non-commercial purposes | NA |
| ZELLE | Bank terms say "only people you know and trust"; scam-reimbursement clawback | NA |
| US_POSTAL_MONEY_ORDER | Counterfeits; BSA record-keeping and anti-structuring guidance | NA |
| All US entries (incl. ACH, DOMESTIC_WIRE) | FinCEN money-transmitter status of P2P sellers | NA |
| INTERAC_E_TRANSFER (Canada) | FINTRAC MSB registration for virtual-currency dealers | NA |
| FASTER_PAYMENTS | "UK APP-scam mandatory reimbursement (PSR, since 7 Oct 2024, 13-month claims, receiving bank pays 50%): high freeze/clawback risk for sellers; check FCA crypto regime for UK users." | EU-W |
| TIKKIE, SATISPAY | Note "Provider terms are for personal, non-business use only. Frequent sellers risk account closure." **Lawyer to decide** whether this needs `legalReview` | EU-W |
| KASPI | "crypto: provider may close accounts; KZ restricts off-exchange crypto" | EU-NE |
| PAYSERA | "crypto: provider terms forbid crypto trading" (file says "new flag") | EU-NE |
| TWINT | "terms ban receiving P2P payments for commercial sales" (file says "new flag") | EU-NE |
| UKRAINE_CARD | "martial-law FX/P2P rules and pending virtual-asset law — check before launch" | EU-NE |
| PIX | `legalReview`/risk flag: high reversal risk (MED, 80 days) | LATAM |
| PAGO_MOVIL | OFAC Venezuela sanctions; GL 57 relaxations | LATAM |
| PAPARA | Trustee/licence history, Turkish crypto-intermediation ban, new owner Emlak Katılım | LATAM |
| MERCADO_PAGO | Argentina (BCRA Com. "A" 7759) | LATAM |
| NIP | Nigerian SEC VASP regime | LATAM |
| RAAST | Pakistan Virtual Assets Act / PVARA | LATAM |
| ALI_PAY, WECHAT_PAY | PRC ban (Yinfa [2026] No. 42) and provider crypto bans; strong removal candidates | APAC |
| MOMO | Vietnam Decree 284/2026 fines for crypto trading outside licensed providers | APAC |
| PROMPT_PAY | Thai SEC treats foreign P2P crypto services as unlicensed exchanges | APAC |
| QRIS | Bank Indonesia bars payment-system operators from processing virtual-currency transactions | APAC |
| NEFT, RTGS, IMPS, UPI | India cyber-cell account-freeze risk; FIU-IND VASP registration | APAC |
| PAYNOW | Singapore FSMA Part 9 | APAC |
| FPS | HK virtual-asset dealing licence bill | APAC |
| JAPAN_BANK | Payment Services Act exchange-registration question | APAC |
| TRANSFERWISE, TRANSFERWISE_USD | Explicit ban on receiving P2P crypto proceeds | GLOBAL |
| PAXUM | Explicit virtual-currency ban; offshore bank | GLOBAL |
| PAYPAL | Crypto needs PayPal pre-approval; high chargeback risk | GLOBAL |
| MONEY_GRAM | Terms ban sending to people you don't know | GLOBAL |
| UPHOLD | Ban on acting as a payment intermediary; EEA/MiCA status unresolved | GLOBAL |
| ADVANCED_CASH (Volet) | Offshore entities; CIS/Russia usage; sanctions review | GLOBAL |
| PAYSAFE, AMAZON_GIFT_CARD | Issuer terms ban transfer or resale for value; gift-card owner decision still open | GLOBAL |

Tally: **3** existing flags to keep with added detail. **37** named entries proposed for a new flag or `legalReview`. **2** where the lawyer decides (TIKKIE, SATISPAY). Plus the cross-cutting US and Canada flags.

### Add seller-facing warnings / notes

| id | Warning / note | File |
|---|---|---|
| SEPA, SEPA_INSTANT | "Payer bank can recall for fraud up to 13 months (EPC rulebook)." | EU-W |
| HAL_CASH | UI: "Sender can cancel until cash is withdrawn; release only after withdrawal. €10–600 per order." | EU-W |
| MONEY_BEAM | "Only between N26 customers." | EU-W |
| WERO | "Replaces Payconiq (LU, 30 Sep 2026), Paylib (FR); iDEAL (NL) migrating to iDEAL \| Wero through 2027." | EU-W |
| REVOLUT, MONESE | "UK APP-scam reimbursement — incoming payments can be clawed back up to 13 months" | EU-NE |
| VIPPS_MOBILEPAY | Private-user terms ban commercial use | EU-NE |
| India rails (NEFT, RTGS, IMPS, UPI) and GCASH | Triangulation fraud can trigger bank freezes after the trade (AFASA up to 30 days; Indian cyber-cell liens) | APAC |
| RTGS | Note the ₹2 lakh minimum | APAC |
| PIX | High reversal risk (MED, 80 days) | LATAM |
| MPESA | Risk flag: sender reversal via 456 | LATAM |
| NIP | NIBSS plans to replace NIP with the National Payment Stack; watch for renaming | LATAM |
| PAYPAL, AMAZON_GIFT_CARD | High reversal-risk warning in the UI | GLOBAL |
| CUSTOM | Should inherit the strictest generic warnings | GLOBAL |
| Reversal-risk field (if added) | high: ACH, CASH_APP, VENMO, USPS (counterfeit); medium: ZELLE; low: INTERAC (after deposit), DOMESTIC_WIRE, STRIKE | NA |

### Disagreements between files

- **PayPal AUP and "currency exchanges".** NA (VENMO) says the AUP *prohibits* transactions that "involve currency exchanges or check cashing businesses". GLOBAL (PAYPAL) puts "currency exchanges" under item (g) of the *Activities Requiring Approval* list. Both agree crypto needs pre-approval. Re-read the AUP to settle this.
- **The same UK APP-reimbursement mechanism is rated differently.** FASTER_PAYMENTS is rated **high** (EU-W). REVOLUT and MONESE are rated **medium** (EU-NE). NATIONAL_BANK is rated **low–medium** (GLOBAL), which mentions the UK regime as one case among many.
- **FPS.** APAC treats FPS as Hong Kong FPS but suspects the Haveno id meant UK Faster Payments. EU-W covers UK Faster Payments separately as FASTER_PAYMENTS.
- **KASPI rename wording.** "Kaspi.kz (Kaspi Gold)" (proposal list) vs "Kaspi.kz (Kaspi Gold transfer)" (name check). Same file, both shown above.

---

## 4. Biggest risks for sellers

**High reversal risk (as rated by the files):** ACH_TRANSFER, CASH_APP, VENMO, US_POSTAL_MONEY_ORDER (counterfeit), FASTER_PAYMENTS, PIX, MIR, ALI_PAY, WECHAT_PAY, NEFT, RTGS, IMPS, UPI, PAYTM, PAYPAL, AMAZON_GIFT_CARD. NIP is rated medium–high.

The common pattern is **triangulation**: a scammer uses a fraud victim's money to pay the seller. The victim's claim then pulls the money back or freezes the seller's account after the XMR has been released (EU-W, APAC, LATAM).

### Fraud recall and refund schemes
- **SEPA / SEPA Instant / Wero:** the payer's bank can send a fraud recall for **13 months** (EPC rulebook). Wero inherits it from SCT Inst (inferred). (EU-W)
- **UK APP-scam reimbursement:** since 7 Oct 2024, claims up to £85,000, up to **13 months** after payment. The receiving firm pays 50%, so receiving accounts get frozen or closed. Affects FASTER_PAYMENTS, REVOLUT, MONESE, and NATIONAL_BANK in the UK. (EU-W, EU-NE, GLOBAL)
- **Pix MED:** a payer who claims fraud gets the funds blocked and returned for up to **80 days**. MED 2.0 traces funds onward. Mercado Pago in Brazil and Capitual inherit this. (LATAM)
- **Russia (SBP, MIR):** banks must hold transfers to accounts in the CBR fraud database for 2 days, and refund the sender within 30 days if they failed to. (EU-NE)
- **ACH:** reversals within 5 banking days. R17/R06 fraud returns since the 2026 rules. R10 unauthorised-debit returns up to 60 days (inferred). Same for Wise USD funded by ACH. (NA, GLOBAL)
- **Zelle:** bank scam-reimbursement claims may be recovered from the recipient's bank (inferred/secondary). (NA)
- **Australia PayID:** bank clawback of mistaken payments; the Scams Prevention Framework puts receiving banks in scope. (APAC)
- **NIP:** written reversal requests for erroneous transfers within 14 working days. (LATAM)
- **M-Pesa:** the sender forwards the SMS to 456 and the payment is reversed "as long as the recipient has not utilized the funds". (LATAM)
- **Wires (DOMESTIC_WIRE, SWIFT):** no chargeback, only voluntary recall requests (Fedwire; gpi Stop and Recall). (NA, GLOBAL)
- **Smaller windows:** Satispay can reverse within 10 days for unauthorised funds (EU-W). The BLIK rulebook allows corrections for technical error within 13 months (EU-NE).

### Chargebacks (card-funded payments)
- **PayPal:** chargebacks, bank reversals, unauthorized-transaction claims, holds up to 180 days. Friends & Family still exposed. (GLOBAL)
- **Venmo:** reversals for "compromised payment method"; Purchase Protection; card funding (inferred). (NA)
- **Cash App:** "Invalid P2P Payments" (§VII.11) are moved back out of the recipient's balance; card funding (inferred). (NA)
- **Mercado Pago:** card-funded payments are held during disputes. (LATAM)
- **Vipps MobilePay:** card-funded payments can be charged back (inferred). (EU-NE)
- **Uphold:** funding chargebacks are clawed back from the account. (GLOBAL)
- **Also via card top-ups or card funding:** Revolut, Monese, Wise top-ups, Ukrainian cards, Mir (some inferred). (EU-NE, GLOBAL)

### Account freezes after fraud complaints or crypto detection
- **India (NEFT, RTGS, IMPS, UPI, PAYTM):** 1930 / cyber-cell liens and full-account freezes are widespread for P2P crypto sellers. (APAC)
- **Japan (JAPAN_BANK):** under the Furikome Fraud Relief Act, the account is frozen, then 60+ days of public notice, then payout to victims. (APAC)
- **Thailand (PROMPT_PAY):** 72-hour holds and up to 7-day mule-account suspensions. (APAC)
- **Philippines (GCASH):** AFASA holds up to 30 days, longer with a court order. (APAC)
- **Vietnam (MOMO):** M_Service may freeze funds in disputes (§11.8) or recover them on suspected violations (§10.2). (APAC)
- **Hong Kong (FPS):** HKMA/police "Suspicious Proxy ID Alert". (APAC)
- **China (ALI_PAY, WECHAT_PAY):** accounts limited or closed for crypto. (APAC)
- **Provider closures for crypto:** Revolut (may confiscate fraud-victim funds), Paysera, Wise (FOS upheld a closure), Kaspi (prosecutors froze accounts in a 2025 P2P-crypto case). (EU-NE, GLOBAL)
- **Other freezes:** Nequi mass freezes (about 2 weeks), Papara trustee-period blocks, NIP post-no-debit freezes (inferred), N26 strict AML monitoring (inferred). (LATAM, EU-W)

### Cancel before pickup / withdrawal, and voidable bearer instruments
- **Cancellable until collected:** HalCash (until ATM withdrawal), Western Union and MoneyGram (until pickup), Cash at ATM (code cancellable), Interac (until deposit), Zelle (unenrolled recipient, 14 days), TWINT (unregistered recipient, auto-cancel after 4 days). Rule: release only after the cash or deposit is in hand. (EU-W, GLOBAL, NA, EU-NE)
- **Voidable or fake after acceptance:** Amazon gift cards bought with stolen funds can be voided. PaysafeCard PINs can be blocked (§6.3). USPS money orders can be counterfeit, and the bank then reverses the deposit (inferred). Cash by mail can go missing. F2F carries counterfeit-note risk. (GLOBAL, NA)

---

## 5. Terms that forbid or restrict this use

### Provider terms

| id | Restriction (short quote) | File |
|---|---|---|
| VENMO | Personal payments for goods and services prohibited. PayPal AUP: currency exchanges (see disagreement); "Cryptocurrency" needs pre-approval | NA |
| PAYPAL | AUP "Activities Requiring Approval", item 7 "Cryptocurrency"; (g) "currency exchanges" | GLOBAL |
| CASH_APP | P2P is "for peer-to-peer personal, non-commercial purposes" (ToS §VII.1) | NA |
| STRIKE | AUP prohibits "currency exchanges or dealers"; ToS §15(e) bars use "on behalf of a third party on a professional or commercial basis" | NA |
| ZELLE | Pay only "people you know and trust" (no crypto clause in bank copies checked) | NA |
| MONEY_GRAM | "may not use the services … to send money to anyone you do not know" | GLOBAL |
| TRANSFERWISE(_USD) | Breach: "Receiving money from peer-to-peer (P2P) cryptocurrency trading"; AUP §1.2.2 | GLOBAL |
| PAXUM | Prohibited: "Transactions involving the sale, purchase or exchange of virtual currencies" | GLOBAL |
| UPHOLD | Bars users who "Act as a payment intermediary or aggregator" without approval; unlicensed money transmission | GLOBAL |
| PAYSAFE | §8.2 "Transfer, sale or use of PaysafeCards for commercial purposes is prohibited"; §4.7 bans PIN sale on "exchange platforms" | GLOBAL |
| AMAZON_GIFT_CARD | "cannot be reloaded, resold, transferred for value, redeemed for cash" (reseller reproduction) | GLOBAL |
| ADVANCED_CASH | Appendix 1 prohibits unlicensed intermediaries (no P2P-crypto clause) | GLOBAL |
| PAYSERA | Terms require "not to use our services for cryptocurrency trading"; business agreement bars virtual-currency buying/exchanging | EU-NE |
| REVOLUT | Crypto terms: "Any transaction made directly with third parties is prohibited" (in-app crypto); P2P crypto platforms cited as a reason for account restrictions (indexed excerpts) | EU-NE |
| VIPPS_MOBILEPAY | §4.4: not "to send and/or receive payments for commercial or business purposes" | EU-NE |
| TWINT | §1.8: "may not be used for commercial purposes"; no receiving P2P payments from commercial sales (indexed excerpt) | EU-NE |
| YOOMONEY | "Кошелёк ЮMoney запрещено использовать для операций… купли-продажи или обмена… криптовалют" | EU-NE |
| KASPI | May end the relationship on signs of crypto buying/selling (statement to press; not in terms) | EU-NE |
| SATISPAY | Consumer service only for natural persons "acting outside any trade, business… or profession" (cl. 1) | EU-W |
| TIKKIE | "Zakelijk gebruik van de app is niet toegestaan" | EU-W |
| ALI_PAY | "not providing services to virtual currency transactions" (Ant statement via press; clause not reached) | APAC |
| WECHAT_PAY | 2019 agreement bars "operating virtual currency trading" (via press; current text not reached) | APAC |
| PAYPAY | §6(1): "暗号資産…の取引を主な目的として、個人間での譲渡・送金を行う行為"; also bars receiving commercial sale proceeds via P2P | APAC |

### Regulator rules

| id(s) | Rule | File |
|---|---|---|
| SBP, MIR | CBR 16-MR (2021): banks to detect/limit P2P transfers for crypto via "drops". 282-FZ (in force 1 Sep 2026): only licensed intermediaries; crypto payments in Russia stay banned | EU-NE |
| UKRAINE_CARD | NBU: crypto purchases are "quasi-cash" (No. 58); cross-border P2P restricted (Resolution 18) | EU-NE |
| KASPI | Kazakhstan limits resident crypto trading to licensed AIFC/AFSA venues | EU-NE |
| MERCADO_PAGO | BCRA Com. "A" 7759: providers "no podrán realizar ni facilitar… operaciones con activos digitales" (reach to P2P proceeds unclear) | LATAM |
| PAPARA | CBRT 2021: payment/e-money firms cannot intermediate transfers to/from crypto platforms | LATAM |
| NIP | CBN: banks "prohibited from holding, trading and/or transacting in virtual currencies" | LATAM |
| RAAST | SBP circular (14 Apr 2026): banks may not trade, invest in or hold digital assets | LATAM |
| MPESA (Ethiopia) | NBE broadened virtual-asset ban, Jul 2026, covering VA-fiat exchange | LATAM |
| ALI_PAY, WECHAT_PAY | PRC Yinfa [2026] No. 42: fiat-crypto exchange is illegal financial activity; payment institutions may not serve VC business | APAC |
| MOMO | VN Decree 284/2026: fines of 30–50m VND for trading crypto outside licensed providers | APAC |
| PROMPT_PAY | Thai SEC treats foreign P2P crypto providers as unlicensed exchanges | APAC |
| QRIS | BI 18/40/PBI/2016 and 19/12/PBI/2017 forbid operators "to process transactions using virtual currency" (still in force not confirmed) | APAC |
| PAYNOW | Singapore FSMA Part 9: licence needed for Singapore-based digital-token service providers | APAC |

---

## 6. Questions for the lawyer

Grouped by country or regulator. Entries affected are in brackets.

**Cross-cutting**
- Does listing a method whose terms ban this exact use create exposure for X2F (inducing breach of contract or similar)? [TRANSFERWISE, TRANSFERWISE_USD; by extension every entry in section 5]
- Should personal-use-only terms get a `legalReview` flag? [TIKKIE, SATISPAY; similar: CASH_APP, VIPPS_MOBILEPAY, TWINT, STRIKE]
- Gift cards: the owner decision is still open. [PAYSAFE, AMAZON_GIFT_CARD]
- Cash: cash-payment caps; whether repeated crypto-for-cash trading is licensable; cash structuring. [F2F, CASH_DEPOSIT, US_POSTAL_MONEY_ORDER]

**United States (FinCEN / OFAC / BSA)**
- Is P2P XMR selling for USD money transmission (FIN-2019-G001)? [ACH_TRANSFER, DOMESTIC_WIRE_TRANSFER, all US entries, TRANSFERWISE_USD]
- Breach of provider terms by stranger-to-stranger or repeated sales: [ZELLE ("people you know and trust"), CASH_APP (non-commercial), VENMO (both clauses), STRIKE ("currency dealer"), PAYPAL (pre-approval), MONEY_GRAM (stranger clause)]
- BSA: cash money-order purchases over $3,000 trigger record-keeping; anti-structuring guidance for users. [US_POSTAL_MONEY_ORDER]
- Confirm past FTC/DOJ fraud orders (not re-sourced). [MONEY_GRAM, WESTERN_UNION]

**Canada (FINTRAC)** — Would frequent X2F sellers need MSB registration as virtual-currency dealers? [INTERAC_E_TRANSFER]

**UK (PSR / FCA)** — How does APP reimbursement apply to P2P crypto sellers? Does the FCA cryptoasset regime (financial promotions, registration) apply to offers shown to UK users? [FASTER_PAYMENTS, REVOLUT, MONESE, NATIONAL_BANK]

**EU** — Uphold's EEA/MiCA status. [UPHOLD] Russia sanctions: see the facts block below. [SBP, MIR, YOOMONEY]

**Russia** — CBR 16-MR and 282-FZ. [SBP, MIR, YOOMONEY]

**Ukraine** — Martial-law FX/P2P rules; virtual-asset bill 10225-d (no second reading found). [UKRAINE_CARD]

**Kazakhstan** — Off-exchange crypto restriction (AIFC/AFSA); EU secondary sanctions on Kazakh banks (Kaspi not among them as far as found). [KASPI]

**Mexico** — AML "actividades vulnerables" for virtual assets (inferred). [SPEI]

**Argentina** — Does BCRA "A" 7759 reach P2P sale proceeds, and is it still current? [MERCADO_PAGO]

**Brazil** — VASP regime under Law 14.478/2022 for sellers receiving Pix at volume (inferred). [PIX, CAPITUAL]

**Venezuela** — OFAC sanctions and GL 57; SUNACRIP. [PAGO_MOVIL]

**Nigeria** — SEC VASP licensing; P2P crypto under FX-abuse enforcement. [NIP]

**Turkey** — Criminal probe of former owners, licence history, new state-bank owner, CBRT ban. [PAPARA]

**Pakistan** — Does a non-custodial P2P venue count as a VASP under the Virtual Assets Act / PVARA? [RAAST]

**Kenya / Ethiopia** — Ethiopia NBE ban (exclude Ethiopia?); April 2026 Kenyan freezes of Binance users. [MPESA]

**China** — Offering the method facilitates trade the PRC classes as illegal (Yinfa [2026] No. 42). [ALI_PAY, WECHAT_PAY]

**Vietnam** — Decree 284/2026; Resolution 05/2025 pilot. [MOMO]

**Thailand** — Thai SEC position on foreign P2P crypto providers. [PROMPT_PAY]

**India** — FIU-IND VASP registration under PMLA; 30% tax + 1% TDS; freeze case law (Kerala HC). [NEFT, RTGS, IMPS, UPI, PAYTM]

**Indonesia** — Is the BI virtual-currency rule still in force? OJK supervision. [QRIS]

**Singapore** — FSMA Part 9, if any X2F operator is Singapore-based. [PAYNOW]

**Hong Kong** — VA dealing (OTC) licensing bill, no deemed-licence transition. [FPS]

**Japan** — Does repeated individual P2P selling need FSA registration as a "crypto-asset exchange business" (Payment Services Act)? [JAPAN_BANK, PAYPAY]

**Philippines** — 2025 SEC rules for crypto-asset service providers serving Filipinos. [GCASH]

**Australia** — Do individual P2P sellers need AUSTRAC registration as digital-currency exchanges? [AUSTRALIA_PAYID]

### Sanctions facts (no keep/remove recommendation)

| Entry | Facts as stated in the files |
|---|---|
| **SBP** (EU-NE) | **EU:** 19th package (23 Oct 2025) bars EU operators from engaging with SBP; secondary sources say from 25 Jan 2026 via Reg. (EU) 2025/2033 (Art. 5ac Reg. 833/2014), to confirm on EUR-Lex. **US:** operator is the Central Bank of Russia, covered by OFAC Directive 4 under E.O. 14024 (28 Feb 2022); NSPK (operational centre) has been an SDN since 23 Feb 2024. **UK:** NSPK designated 15 Oct 2025 (RUS3076); SBP itself not listed. |
| **MIR** (EU-NE) | **US:** NSPK (Mir operator) designated under E.O. 14024 on 23 Feb 2024. **UK:** NSPK designated 15 Oct 2025, asset freeze + trust services, RUS3076. **EU:** 19th package bars EU operators from Mir. Foreign acceptance has shrunk (press only). |
| **YOOMONEY** (EU-NE) | **US:** "Limited Liability Company Yoomoney" fully blocked 6 Apr 2022 as a Sberbank subsidiary (E.O. 14024; earlier CAPTA listing 24 Feb 2022 per aggregators). **UK/EU:** no separate listing found; parent Sberbank is designated, and ownership/control rules may extend restrictions (not verified against current consolidated lists). |
| **PAGO_MOVIL** (LATAM) | US sanctions on the Government of Venezuela; BCV and Banco de Venezuela are blocked parties. OFAC GL 57 (14 Apr 2026) authorised financial services involving BCV, Banco de Venezuela, Banco Digital de los Trabajadores and Banco del Tesoro; sanctions not lifted. Uphold left Venezuela in 2022 citing OFAC (GLOBAL). |
| **ADVANCED_CASH / Volet** (GLOBAL) | Renamed Volet.com (Mar 2024). Canada MSB (Queensland Foreign Exchange Inc., FINTRAC M23153297), Costa Rica agreement, formerly Belize. No US persons. Historically popular with Russian/CIS users; a third-party guide markets it for sending money to Russia. File asks a lawyer to check sanctions exposure. |

---

## 7. Gaps to re-check by hand

Places where a researcher could not reach the primary source, or relied on an excerpt, a secondary source or inference for a load-bearing fact.

**NA**
- zelle.com user-service agreement body: "Access Denied". The network rule for recovering scam reimbursements is not confirmed (secondary).
- Cash App UK exit (Sept 2024): unconfirmed. Cash App limit figures vary between help pages.
- ACH R10 60-day rule: not re-fetched. BSA $3,000 money-order rule: not checked on a USPS page.
- Canada Lynx (equivalent of domestic wire): not checked.

**EU-W**
- europeanpaymentscouncil.eu HTML pages returned 403 (rulebook PDFs used instead). Serbian SEPA connection is from a secondary source.
- mbway.pt returned 403. wero-wallet.eu showed a maintenance page. Wero help centre unreachable. EPI consumer terms not reached.
- Wero NL P2P being live is unconfirmed. Bizum 13-country P2P link being live is unconfirmed. Bizum has no public terms (bank terms only).
- HalCash: no confirmed non-Spain corridor; Pin4 stake report unconfirmed; bank terms not reviewed.
- Tikkie Germany today: unconfirmed. Satispay Germany: inferred. N26 UK exit: inferred, not re-checked.

**EU-NE**
- revolut.com and twint.ch returned 403. The Revolut countries list, transfer/cancel rules, crypto terms and blog, and the TWINT cancel FAQ and terms §1.8, are all **indexed excerpts**. TWINT German terms' reported crypto mention: unconfirmed (PDF blocked).
- Swish payment how-to: indexed excerpt. Getswish ownership: inferred.
- EU SBP/Mir ban date and Reg. 2025/2033: secondary; confirm on EUR-Lex. YooMoney UK/EU status not checked against consolidated lists.
- Kaspi crypto stance: one press source only. Monese takeover: trade press. Mir foreign acceptance: press only.
- Vipps: only the Norwegian terms checked; Danish/Finnish MobilePay terms not checked.

**LATAM**
- Fetch failures (403/404): safaricom.co.ke (M-Pesa customer T&Cs), sbp.org.pk, papara.com (ToS not retrieved), mercadopago.com.ar (ToS), banxico.org.mx (SPEI pages), Nequi reglamento. bcv.org.ve not fetched.
- BCRA "A" 7759 status in 2026: unconfirmed. CBRT lifting the Papara suspension (21 Jan 2026): secondary.
- Capitual consumer account: needs someone who can log in, or a question to the company.
- M-Pesa limits: third-party figures that conflict with older Safaricom FAQ figures. Non-Kenya/Ethiopia markets not re-sourced.
- Pix IN BCB 766 contest window: secondary. SPEI MTU limit figures vary.
- Banxico 2019 crypto restrictions and Brazil Law 14.478/2022: not re-sourced.

**APAC**
- Alipay user-agreement clause and WeChat Pay current agreement: not reached (press only).
- Paytm terms: not reached. GCash Overseas: not verified; GCash limits not captured.
- India: RBI 2018 ban / 2020 Supreme Court, FIU-IND registration, 30% + 1% TDS, not re-verified. Kerala HC freeze ruling: secondary.
- QRIS BI rule still in force: not confirmed. OJK takeover from Bappebti: not re-verified.
- DuitNow limits via a search snippet. Malaysia SC licensing: not re-verified. PayNow irrevocability not stated by ABS.
- Australian banks' crypto restrictions: not verified. Philippine SEC CASP rules, Singapore FSMA, HK VA bill, Australia SPF: law-firm/secondary sources.
- Japan: no source found on whether individual P2P selling needs registration.
- FPS id mapping (HK vs UK) unresolved.

**GLOBAL**
- Uphold EEA deposit pause: secondary only; Topper notice returned 403; not confirmed on an Uphold page.
- Perfect Money: no official closure statement. CelPay: no separate shutdown notice (inferred from the Celsius shutdown).
- amazon.com/gc-legal returned 503; Amazon terms come from a reseller reproduction. Marketplace-only redemption: inferred.
- PayPal AUP page shows last updated 2022-10-29. Its "currency exchanges" item is read differently by NA and GLOBAL (see section 3).
- Not re-sourced: Wise-to-Wise speed; MoneyGram FTC/DOJ orders; WU $586M settlement; gift-card FTC statistic. SWIFT gpi stats and HKMA Perfect Money alert come via search. Paysafe group ownership: inferred.

