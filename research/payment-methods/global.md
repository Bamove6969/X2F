# Payment-method verification — global region

Checked: 2026-10-21. Research only. `data/payment-methods.json` was not edited.
Brief: `_briefs/pm-research.md`. Anything marked **(inferred)** is my reading, not a sourced fact.
Where an official page could not be fetched, the section says so and names the secondary source used.

## Summary

| id | name | verdict | reversal risk | crypto clause | note |
|---|---|---|---|---|---|
| UPHOLD | Uphold | verified-with-flags | medium | yes (indirect) | Operating. Terms ban acting as a "payment intermediary". EEA deposits reportedly paused since 2026-07-01 (secondary sources only). |
| PERFECT_MONEY | Perfect Money | discontinued | n/a | unknown | Official domains no longer resolve. Secondary sources report a 2024–2025 wind-down. |
| ADVANCED_CASH | Advcash | outdated | low | no clause found | Renamed **Volet.com** (March 2024). advcash.com redirects to volet.com. No US persons. |
| TRANSFERWISE | Wise | verified-with-flags | low–medium | **yes** | Wise explicitly bars receiving money from P2P crypto trading. |
| TRANSFERWISE_USD | Wise (USD) | verified-with-flags | low–medium | **yes** | Same Wise policy. USD funded by ACH carries return risk. |
| PAXUM | Paxum | verified-with-flags | low | **yes** | Terms bar "sale, purchase or exchange of virtual currencies". Offshore bank in Dominica. |
| CELPAY | CelPay | discontinued | n/a | n/a | Celsius apps shut down 2024-02-29 after bankruptcy. |
| PAYPAL | PayPal | verified-with-flags | **high** | yes (pre-approval) | Chargebacks, bank reversals, unauthorized-transaction claims. Crypto is on the AUP "requires approval" list. |
| PAYSAFE | Paysafecard | verified-with-flags | medium | no clause found | Terms ban transfer or sale of PINs and "exchange platforms". Gift-card owner decision is open. |
| AMAZON_GIFT_CARD | Amazon eGift card | verified-with-flags | **high** | no clause found | Terms (as reproduced by resellers) bar resale and transfer for value. Gift-card owner decision is open. |
| MONEY_GRAM | MoneyGram | verified-with-flags | medium | no (stranger ban) | US terms bar sending "to anyone you do not know". |
| WESTERN_UNION | Western Union | verified-with-flags | medium | no clause found | Sender can cancel until pickup. Russia/Belarus suspended since 2022-03-24. |
| SWIFT | International wire (SWIFT) | verified-with-flags | low–medium | n/a (network) | Sanctions screening; recalls need the beneficiary bank's cooperation. |
| NATIONAL_BANK | National bank transfer | verified (generic) | low–medium | n/a | Generic — no provider to verify. Fraud-recall and APP-reimbursement risk varies by country. |
| SAME_BANK | Transfer within the same bank | verified (generic) | low–medium | n/a | Generic — no provider to verify. |
| SPECIFIC_BANKS | Transfer with specific banks | verified (generic) | low–medium | n/a | Generic — no provider to verify. |
| CASH_DEPOSIT | Cash deposit at bank | verified (generic) | low | n/a | Generic — no provider to verify. |
| F2F | Cash in person (face to face) | verified (generic) | low | n/a | Generic — no provider to verify. Physical-safety and counterfeit risk. |
| PAY_BY_MAIL | Cash by mail | verified (generic) | medium | n/a | Generic — no provider to verify. Loss and "never arrived" disputes. |
| CASH_AT_ATM | Cash at ATM | verified (generic) | low | n/a | Generic — no provider to verify. The sender can cancel the code before withdrawal. |
| CUSTOM | Custom method | verified (generic) | unknown | n/a | X2F's own catch-all, already marked `verified: true`. Risk depends on what users enter. |

**Verdict counts (21 entries):**
- verified-with-flags: 10 (UPHOLD, TRANSFERWISE, TRANSFERWISE_USD, PAXUM, PAYPAL, PAYSAFE, AMAZON_GIFT_CARD, MONEY_GRAM, WESTERN_UNION, SWIFT)
- verified (generic): 8 (NATIONAL_BANK, SAME_BANK, SPECIFIC_BANKS, CASH_DEPOSIT, F2F, PAY_BY_MAIL, CASH_AT_ATM, CUSTOM)
- outdated: 1 (ADVANCED_CASH)
- discontinued: 2 (PERFECT_MONEY, CELPAY)
- unclear: 0

---

## UPHOLD — Uphold

1. **Status:** Operating. The site is live (© 2026) and has a platform status link. https://uphold.com
2. **Official site:** https://uphold.com. The non-US user agreement is with Uphold Worldwide Ltd. (Nassau, Bahamas). https://uphold.com/legal/membership-agreement/world
3. **Where it works:**
   - The world agreement covers residents outside the US, Canada, EEA, EU, UK and Switzerland. Those regions have separate agreements.
   - Sanctioned jurisdictions (Cuba, Iran, North Korea, Syria, etc.) are excluded.
   - In New York, only selling crypto to fiat is allowed.
   - Source: same agreement.
   - **EEA:** third-party sources say EEA deposits have been paused since 2026-07-01 while Uphold's MiCA application in Portugal is pending. Topper, Uphold's on-ramp, published a "Temporary Service Disruption MiCAR" notice (https://support.topperpay.com/hc/en-us/articles/28564092554524-Temporary-Service-Disruption-MiCAR, returned 403 when fetched; summary via search). Secondary source: https://www.datawallet.com/zh/隐蔽性/支持的国家. **Not confirmed from an Uphold page.**
4. **Transfer characteristics:**
   - The user agreement says users must not reverse a completed add-funds transaction. Uphold may claw back amounts if a bank or card funding is charged back or found fraudulent.
   - So a P2P buyer who funded Uphold by card or ACH can create a reversal that Uphold recovers from the account (who bears it is **(inferred)**).
   - Arrival time between Uphold users is not stated; the agreement says transactions may be delayed.
5. **Crypto stance:** No P2P-crypto clause. The Prohibited Uses page bars users who "Act as a payment intermediary or aggregator" without written approval, and bars unlicensed money transmission. https://uphold.com/legal/prohibited-businesses-and-uses. Uphold is itself a crypto platform.
6. **Legal flags:**
   - The intermediary and money-transmitter clause could reach a regular P2P seller.
   - The EEA/MiCA status is unresolved.
   - Uphold left Venezuela in 2022 citing OFAC (https://investing.com/news/cryptocurrency-news/uphold-leaves-venezuela-and-asks-users-to-withdraw-their-funds-2840350).
7. **Name check:** "Uphold" is correct.
8. **Verdict:** verified-with-flags.

## PERFECT_MONEY — Perfect Money

1. **Status:** Discontinued (from secondary sources plus my own DNS check).
   - On 2026-10-21, `perfectmoney.com` and `perfectmoney.is` did not resolve from my environment.
   - `perfect.money` returned a Cloudflare redirect loop.
   - Secondary reports:
     - Merchants were told in Oct 2024 that service ended for Lithuania and "other European countries".
     - German and Bangladeshi accounts were closed in late 2024.
     - A bitcointalk thread (2025) reports all operations closed. https://bitcointalk.org/index.php?topic=5538526.0
     - A 2026 article reports the domain no longer resolves. https://bonustiime.com/casinos/payment-methods/perfect-money/
   - No official closure statement was found.
2. **Official site:** perfectmoney.com / perfectmoney.is (both unreachable).
3. **Where it works:** Nowhere confirmed. It historically excluded US customers (2013, https://www.financemagnates.com/fintech/payments/perfect-money-another-step-out-of-the-us/).
4. **Transfer characteristics:** n/a.
5. **Crypto stance:** Unknown (terms unreachable).
6. **Legal flags:**
   - It is a long-standing high-risk e-currency, widely reported as a Liberty Reserve substitute (https://krebsonsecurity.com/tag/perfect-money/).
   - HKMA issued a website alert in 2023 (reported by search).
   - Regardless of status, it should not be offered.
7. **Name check:** n/a.
8. **Verdict:** **discontinued**. Remove it.

## ADVANCED_CASH — Advcash

1. **Status:** Renamed. https://advcash.com returns a 301 redirect to https://volet.com/ (checked 2026-10-21). The site carries a headline "Advcash Is Now Volet.com". The rebrand was announced March 2024 (https://www.aap.com.au/aapreleases/cision20240325ae68795/).
2. **Official site:** https://volet.com
3. **Where it works:**
   - The site claims users in 180 countries, with USD and EUR fiat plus crypto.
   - Canadian terms: Queensland Foreign Exchange Inc., FINTRAC MSB M23153297, in force 2024-03-26.
   - No accounts for US citizens, US residents or US entities. https://volet.com/agreement-canada
   - A Costa Rica agreement also exists.
4. **Transfer characteristics:** Internal transactions are "final and are not subject to disputes, revisions or cancellations". The exception is some external top-ups flagged as fraud. Low reversal risk.
5. **Crypto stance:** No clause found on P2P crypto. Volet itself sells and swaps crypto. The Appendix 1 prohibited list includes unlicensed intermediaries and instruments without owner identification.
6. **Legal flags:**
   - It is historically popular with Russian/CIS users. A third-party guide markets Volet for sending money to Russia (https://russiable.com/send-money-russia-volet-swapcoin/).
   - It sits in offshore and light-touch jurisdictions (Canada MSB, Costa Rica; formerly Belize).
   - A lawyer should check sanctions exposure.
7. **Name check:** Should be **"Volet (formerly Advcash)"**.
8. **Verdict:** **outdated**. Rename to Volet.

## TRANSFERWISE — Wise

1. **Status:** Operating. https://wise.com
2. **Official site:** https://wise.com
3. **Where it works:**
   - Most countries.
   - Unsupported: Afghanistan, Belarus, Cuba, Iran, North Korea, Russia, Syria, Venezuela, occupied Ukrainian regions, and others. https://wise.com/help/articles/2978049/which-countries-can-i-use-wise-in
   - Wise balances are not available to some residents, e.g. Nevada.
4. **Transfer characteristics:**
   - Wise-to-Wise transfers are usually instant **(inferred from product behaviour; not re-sourced)**.
   - Completed transfers can't be cancelled; recovery depends on the recipient or the recipient's bank. https://wise.com/help/articles/2565014/i-want-to-cancel-a-transfer-thats-completed
   - Card-funded or bank-funded top-ups can still be charged back or recalled upstream.
   - Scam reports can lead to the recipient's account being frozen **(inferred)**.
5. **Crypto stance:** **Yes.**
   - The help article lists among breaches: "Receiving money from peer-to-peer (P2P) cryptocurrency trading." https://wise.com/help/articles/2v3OMcg97Z7gObSifJbjsu/understanding-wises-position-on-cryptocurrency
   - AUP §1.2.2 (updated 2026-03-25) also covers businesses trading cryptocurrencies. https://wise.com/acceptable-use-policy
   - Account closure is the stated consequence, and the UK FOS upheld one (https://financial-ombudsman.org.uk/decision/DRN-4698168.pdf).
6. **Legal flags:** X2F would be listing a method whose terms explicitly ban this exact use. A lawyer should look at whether listing it creates exposure (inducing breach of contract or similar).
7. **Name check:** "Wise" is correct. The id `TRANSFERWISE` is the legacy name, which is fine internally.
8. **Verdict:** verified-with-flags.

## TRANSFERWISE_USD — Wise (USD)

1. **Status:** Operating (same provider).
2. **Official site:** https://wise.com
3. **Where it works:** Wise USD balances and account details for eligible residents; same exclusions as above.
4. **Transfer characteristics:**
   - Wise-to-Wise USD is fast.
   - USD paid in via ACH from a US bank can be returned. Unauthorized consumer debits can be returned within about 60 days under Nacha rules **(inferred; general ACH rule, not Wise-specific)**.
   - Wire-funded payments are effectively final.
5. **Crypto stance:** **Yes**, same Wise policy as above.
6. **Legal flags:** As for Wise. US transfers also add US money-transmission regulation **(inferred)**.
7. **Name check:** "Wise (USD)" is fine.
8. **Verdict:** verified-with-flags.

## PAXUM — Paxum

1. **Status:** Operating (site © 2026). https://www.paxum.com
2. **Official site:** https://www.paxum.com. Operated by Paxum Bank Limited, Roseau, Dominica, chartered under Dominica's Offshore Banking Act and supervised by the FSU. https://www.paxum.com/about-us/licenses
3. **Where it works:**
   - Worldwide, except Dominica residents.
   - Local bank (EFT) payouts in 50+ countries and 20+ currencies, plus wires. https://www.paxum.com
   - It is aimed at adult and high-risk industries.
4. **Transfer characteristics:**
   - Internal transfers go to another client's account or email.
   - Payment orders are "irrevocable after confirmation".
   - Unauthorized-transaction reversals are possible within the bank's procedure (up to 90 days for resolution).
   - Terms last updated 2023-03-01. https://www.paxum.com/legal/terms-and-conditions
5. **Crypto stance:** **Yes.** The prohibited list includes "Transactions involving the sale, purchase or exchange of virtual currencies"; the stated consequence is account revocation. Same page. The card clause also bars virtual-currency purchases.
6. **Legal flags:** Offshore bank in Dominica. An explicit crypto ban. The platform terms (2018) list a Quebec entity (Gestion Paxum Bank Limited).
7. **Name check:** "Paxum" is correct.
8. **Verdict:** verified-with-flags.

## CELPAY — CelPay

1. **Status:** **Discontinued.**
   - Celsius Network filed Chapter 11 on 2022-07-13 and emerged 2024-01-31.
   - "On February 29, 2024, the Celsius mobile and web apps were shut down" as part of the wind-down. https://celsius.network
   - CelPay was a feature of the Celsius app **(inferred: no separate CelPay notice found)**.
2. **Official site:** https://celsius.network (wind-down notice only).
3–6. n/a. The bankruptcy is history; there is no current exposure.
7. **Name check:** n/a.
8. **Verdict:** **discontinued**. Remove it.

## PAYPAL — PayPal

1. **Status:** Operating. https://www.paypal.com
2. **Official site:** https://www.paypal.com
3. **Where it works:** About 200 markets, many currencies (from the country selector; not enumerated here).
4. **Transfer characteristics:** **High reversal risk.**
   - The US user agreement has a "Refunds, Reversals and Chargebacks" section. Reversals can follow a buyer's card chargeback, a bank reversal, an unauthorized-transaction claim, or a dispute.
   - PayPal may hold funds for up to 180 days. https://www.paypal.com/us/legalhub/paypal/useragreement-full
   - Friends & Family payments lack Purchase Protection, but unauthorized-use claims and funding-source chargebacks still apply.
   - This is the classic P2P crypto scam vector **(inferred)**.
5. **Crypto stance:** **Yes (requires approval).**
   - The AUP's "Activities Requiring Approval" list includes item 7, "Cryptocurrency" ("Any digital representation of value that can be digitally traded…").
   - (g) also covers "currency exchanges".
   - https://www.paypal.com/us/legalhub/paypal/acceptableuse-full (page shows last updated 2022-10-29).
6. **Legal flags:** Accepting payments for crypto without PayPal's pre-approval breaches the AUP.
7. **Name check:** "PayPal" is correct.
8. **Verdict:** verified-with-flags.

## PAYSAFE — Paysafecard  *(gift-card owner decision is open — facts only)*

1. **Status:** Operating. https://www.paysafecard.com
2. **Official site:** https://www.paysafecard.com. The UK issuer is Prepaid Services Company Limited, an FCA e-money institution (FRN 900021). It is part of Paysafe **(inferred from branding)**.
3. **Where it works:** Sold in many countries with a country-specific PIN currency; see the country selector. Terms are per-country; the UK version is valid from 2026-05-26.
4. **Transfer characteristics:**
   - A prepaid PIN, once handed over, works as a bearer instrument.
   - The issuer "may block or terminate a PaysafeCard" on suspected fraud or misuse (§6.3).
   - So a PIN bought with stolen funds can be blocked after the seller accepts it (**(inferred)** risk pattern).
5. **Crypto stance:** No crypto clause found.
   - However, §8.2 says "Transfer, sale or use of PaysafeCards for commercial purposes is prohibited".
   - §4.7 bans selling or trading PINs on unauthorised internet platforms, explicitly "exchange platforms".
   - Source: UK T&C PDF linked from https://www.paysafecard.com/en-gb/terms-and-conditions/
6. **Legal flags:** Using PINs as payment between strangers sits directly against §4.7 and §8.2. Prepaid vouchers are a known AML/scam typology **(inferred)**.
7. **Name check:** The issuer now writes **"PaysafeCard"** (capital C) in its UK terms. "Paysafecard" is also widely used, so either is acceptable.
8. **Verdict:** verified-with-flags.

## AMAZON_GIFT_CARD — Amazon eGift card  *(gift-card owner decision is open — facts only)*

1. **Status:** Operating.
2. **Official site:** https://www.amazon.com/gc-legal. It returned 503 to my fetches on 2026-10-21, so the terms below come from verbatim reproductions on reseller pages.
3. **Where it works:** Each card is redeemable on its issuing Amazon marketplace only **(inferred; standard Amazon terms, not re-verified)**.
4. **Transfer characteristics:**
   - Codes are bearer value until redeemed. Once redeemed, the balance is tied to the account.
   - **High risk:** cards bought with stolen payment methods can be voided, or the redeeming account locked **(inferred; common scam pattern, Amazon terms reserve fraud rights)**.
5. **Crypto stance:** No crypto clause found.
   - US terms as reproduced: "cannot be reloaded, resold, transferred for value, redeemed for cash". Source: https://www.shangri-la.com/corporate/shangrilacircle/redeem-points/lifestyle/product-categories/egift-cards/america/amazonusd50/ (reseller reproducing amazon.com/gc-legal).
   - Using a card as payment for XMR is "transfer for value".
6. **Legal flags:**
   - Explicit resale/transfer-for-value ban.
   - Gift cards are the top FTC-reported scam payment method **(inferred; not re-sourced)**.
7. **Name check:** "Amazon eGift card" is fine. Amazon's own term is "Amazon.com Gift Card" / "eGift Card".
8. **Verdict:** verified-with-flags.

## MONEY_GRAM — MoneyGram

1. **Status:** Operating. It has been private (Madison Dearborn) since June 2023 and launched its MGUSD stablecoin in June 2026 (https://theblock.co/post/403320/moneygram-debuts-mgusd-stablecoin-on-stellar-for-its-global-payments-network).
2. **Official site:** https://www.moneygram.com. The US provider is MoneyGram Payment Systems, Inc.
3. **Where it works:** 200+ countries and territories, cash pickup and account deposit (company figures via the sources above).
4. **Transfer characteristics:**
   - Cash pickup is minutes to hours.
   - Refund rights are per the transfer disclosure, and pre-pickup cancellation is possible.
   - After pickup, cash is final.
   - Card- or bank-funded online sends can still be charged back against the sender, not the receiver **(inferred)**.
   - Risk for a seller is medium: it is mostly a pre-pickup cancel or fraud hold.
5. **Crypto stance:** No crypto ban, since MoneyGram offers crypto itself. However, the US terms say users "may not use the services … to send money to anyone you do not know". https://www.moneygram.com/mgo/us/en/m/terms-and-conditions
6. **Legal flags:** The stranger clause conflicts directly with P2P trading between strangers. MoneyGram has had past FTC/DOJ fraud-related orders **(not re-sourced; lawyer to confirm)**.
7. **Name check:** "MoneyGram" is correct.
8. **Verdict:** verified-with-flags.

## WESTERN_UNION — Western Union

1. **Status:** Operating. Services in Russia and Belarus have been suspended since 2022-03-24. https://www.westernunion.com/blog/en/russia-and-belarus/
2. **Official site:** https://www.westernunion.com. US: Western Union Financial Services, Inc. https://www.westernunion.com/us/en/legal/terms-conditions.html
3. **Where it works:** 200+ countries (not enumerated here).
4. **Transfer characteristics:**
   - "You may cancel a Transaction for a refund, unless the funds have been picked up or deposited" (US online terms §IX).
   - The terms open with a consumer fraud alert about strangers asking for money.
   - After pickup, cash is final; card-funded sends can be charged back against the sender **(inferred)**.
5. **Crypto stance:** No clause found in the US online money-transfer terms. In 2017 WU reportedly blocked crypto-exchange transfers (https://cointelegraph.com/news/western-union-blocks-cryptocurrency-related-transactions). It now sells crypto via WU Wallet.
6. **Legal flags:** Sanctions screening, and the scam-typology history (WU paid $586M in the 2017 FTC/DOJ settlement; **not re-sourced**).
7. **Name check:** "Western Union" is correct.
8. **Verdict:** verified-with-flags.

## SWIFT — International wire (SWIFT)

1. **Status:** Operating network. https://www.swift.com
2. **Official site:** https://www.swift.com (network operator; banks are the providers).
3. **Where it works:** Global interbank. Certain Russian and Belarusian banks have been disconnected under EU Regulation 2022/345 and 2022/398 (https://www.dlapiper.com/en/insights/publications/global-sanctions-alert/2022/explaining-swift-and-recent-actions).
4. **Transfer characteristics:**
   - Swift says nearly 50% of gpi payments are credited within 30 minutes and almost 100% within 24 hours (https://swift.com/swift_resource/185221, via search).
   - gpi "Stop and Recall" lets the sending bank try to recall for fraud or error. Success depends on the beneficiary bank and usually needs the beneficiary's consent **(inferred)**.
   - Overall reversal risk is low to medium.
5. **Crypto stance:** n/a (network). Individual banks' policies vary; a payment reference mentioning crypto can trigger holds **(inferred)**.
6. **Legal flags:** Sanctions screening and correspondent-bank de-risking. Cross-border AML reporting.
7. **Name check:** "International wire (SWIFT)" is fine. The operator now styles itself "Swift".
8. **Verdict:** verified-with-flags.

## NATIONAL_BANK — National bank transfer
Generic — no provider to verify.
- Push transfers are generally final once settled. However, fraud recalls exist, and in the UK the APP-fraud mandatory reimbursement scheme (from 2024-10-07, up to £85,000) makes the *receiving* PSP pay 50%. That means sellers' accounts can be frozen or debited after scam claims (https://www.freshfields.com/en/our-thinking/briefings/2024/09/authorised-push-payment-fraud-a-new-mandatory-reimbursement-regime-for-uk-psps).
- US ACH has return windows.
- Risk: low–medium. **Verdict:** verified (generic).

## SAME_BANK — Transfer within the same bank
Generic — no provider to verify. Usually instant and final. Bank fraud recalls and freezes remain possible. Risk: low–medium. **Verdict:** verified (generic).

## SPECIFIC_BANKS — Transfer with specific banks
Generic — no provider to verify. Same profile as a national bank transfer. Risk: low–medium. **Verdict:** verified (generic).

## CASH_DEPOSIT — Cash deposit at bank
Generic — no provider to verify.
- A cash deposit cannot be charged back.
- Risks: a bank may refuse third-party cash deposits, and cash-structuring/AML reporting applies **(inferred; varies per bank)**.
- Risk: low. **Verdict:** verified (generic).

## F2F — Cash in person (face to face)
Generic — no provider to verify.
- No reversal.
- Risks: physical safety, counterfeit notes, robbery.
- Some jurisdictions cap cash payments or treat repeated crypto-for-cash trading as licensable activity **(inferred; lawyer to check)**.
- Risk: low (reversal). **Verdict:** verified (generic).

## PAY_BY_MAIL — Cash by mail
Generic — no provider to verify.
- No chargeback, but there are "never arrived" disputes and loss or theft in transit.
- Many postal operators restrict cash in ordinary mail **(inferred; varies by operator)**.
- Risk: medium. **Verdict:** verified (generic).

## CASH_AT_ATM — Cash at ATM
Generic — no provider to verify.
- Cardless cash codes: the sender can cancel the code before withdrawal. After withdrawal, the cash is final.
- Risk: low. **Verdict:** verified (generic).

## CUSTOM — Custom method
X2F's own catch-all (`source: x2f`, already `verified: true`). Not a provider. Risk depends entirely on what users enter, so it should inherit the strictest generic warnings. **Verdict:** verified (generic).

---

## Proposed catalog changes (proposals only)

**Remove**
- `PERFECT_MONEY`: discontinued (domains dead; reported wind-down 2024–25).
- `CELPAY`: discontinued (Celsius apps shut 2024-02-29).

**Rename**
- `ADVANCED_CASH`: "Advcash" → **"Volet (formerly Advcash)"**.
- Optional: `PAYSAFE` "Paysafecard" → "PaysafeCard", the issuer's current spelling.

**New `legalReview` flags (crypto clause or ToS conflict)**
- `TRANSFERWISE`, `TRANSFERWISE_USD`: explicit ban on receiving P2P crypto proceeds.
- `PAXUM`: explicit virtual-currency ban; offshore bank.
- `PAYPAL`: crypto needs PayPal pre-approval; high chargeback risk.
- `MONEY_GRAM`: terms ban sending to people you don't know.
- `UPHOLD`: ban on acting as a payment intermediary; EEA/MiCA status unresolved.
- `ADVANCED_CASH`/Volet: offshore entities; CIS/Russia usage; sanctions review.
- `PAYSAFE`, `AMAZON_GIFT_CARD`: issuer terms ban transfer or resale for value. The owner decision on gift cards is still open.

**High reversal-risk warning in the UI:** `PAYPAL`, `AMAZON_GIFT_CARD`.
