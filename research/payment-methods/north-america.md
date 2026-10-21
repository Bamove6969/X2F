# Payment-method verification — North America

Checked: **2026-10-21**. Scope: catalog entries ZELLE, INTERAC_E_TRANSFER, US_POSTAL_MONEY_ORDER, ACH_TRANSFER, DOMESTIC_WIRE_TRANSFER, CASH_APP, VENMO, STRIKE (from `data/payment-methods.json`).
Method: provider terms, help pages and scheme-operator / central-bank pages fetched on the date above. Anything not stated by a source is marked **(inferred)**. Research only — no catalog edits.

## Summary

| id | name | verdict | reversal risk | crypto clause | note |
|---|---|---|---|---|---|
| ZELLE | Zelle | verified-with-flags | medium | no (none found) | US bank-app only since the standalone app closed (Apr 2025); can't cancel once sent to an enrolled user, but bank fraud and scam claims can still pull funds back |
| INTERAC_E_TRANSFER | Interac e-Transfer | verified | low | no (none found) | Canada only; final once deposited; limits set by each bank |
| US_POSTAL_MONEY_ORDER | US Postal money order | verified-with-flags | high (counterfeits) | no (none found) | $1,000 cap; the buyer can't stop payment, but counterfeit money orders are the main danger |
| ACH_TRANSFER | Bank transfer (ACH) | verified-with-flags | high | n/a (generic) | generic, no single provider. 5-banking-day reversal window, longer return windows for unauthorized entries, R17/R06 fraud returns |
| DOMESTIC_WIRE_TRANSFER | Domestic wire transfer | verified | low | n/a (generic) | generic. Fedwire is final and irrevocable; the risk is fraud recall requests, not chargebacks |
| CASH_APP | Cash App | verified-with-flags | high | no (none found) | US only. Personal, non-commercial P2P only; Cash App can claw back "invalid" payments; card funding allowed |
| VENMO | Venmo | verified-with-flags | high | yes (PayPal AUP) | US only. Personal payments for goods and services are prohibited; the PayPal AUP requires pre-approval for crypto and bans currency exchanges |
| STRIKE | Strike | verified-with-flags | low | partial (AUP bans currency exchanges/dealers; ToS bans commercial third-party use) | Bitcoin/USD only; transactions are final and irreversible under the ToS |

Counts: verified 2 · verified-with-flags 6 · outdated 0 · discontinued 0 · unclear 0.

---

## ZELLE — Zelle

1. **Status:** Operating. The standalone Zelle app was shut down in April 2025, and Zelle now works only inside participating bank and credit-union apps. Sources: <https://en.wikipedia.org/wiki/Zelle> (secondary) and <https://www.fox5ny.com/news/zelle-app-ends-how-to-send-money-online> (secondary). The current zelle.com footer says Zelle is "available in over 2,400 banking and credit union apps" (<https://www.zelle.com/legal/user-service-agreement>, footer of the page; the agreement body returned "Access Denied" on the check date).
2. **Official site:** <https://www.zelle.com>. Operator: Early Warning Services, LLC (footer of zelle.com).
3. **Where it works:** United States only, in USD. Both parties need an eligible US checking or savings account and a US mobile number or email address (<https://www.zelle.com/faq/there-limit-how-much-money-i-can-send-or-receive>).
4. **Transfer characteristics:**
   - **Arrival:** Payments to enrolled users "typically occur within minutes" (zelle.com footer).
   - **Cancellation:** A payment can be cancelled only if the recipient has not yet enrolled. Once the recipient is enrolled, the payment cannot be cancelled or reversed by the sender (FAQ above). An unenrolled recipient has 14 days to enroll before the payment expires (<https://www.zelle.com/faq/how-long-does-it-take-receive-money-zelle>).
   - **Residual risk:** The sending bank can still treat a payment as unauthorized (account takeover) under Reg E. Banks also reimburse some impostor-scam claims, and press reports say those reimbursements can be recovered from the recipient's bank. That would claw back the seller's funds **(inferred / secondary; network rule not confirmed from a primary source)**.
   - **Limits:** Set by each bank; Zelle publishes no network-wide limit (FAQ above).
5. **Crypto stance:** **No clause found.** The zelle.com agreement body was access-denied. The bank copies of the standard template we checked (Truist <https://truist.com/terms-and-conditions/zelle>, Comerica <https://www.comerica.com/PersonToPersonTerms>) ban illegal payments, gambling debts, tax payments and similar, but they do not name crypto. Zelle repeatedly says to pay only "people you know and trust." Individual banks may block crypto-related transfers **(inferred)**.
6. **Legal / sanctions:** No sanctions exposure. Zelle has been the subject of US regulatory and state litigation over scam reimbursement. A lawyer should look at whether a stranger-to-stranger XMR sale breaches bank-level Zelle terms ("people you know and trust").
7. **Name check:** "Zelle" is correct (the official mark is "Zelle®").
8. **Verdict:** `verified-with-flags`. The flags are medium clawback risk through bank fraud and scam claims, and terms that say the service is only for people you know.

## INTERAC_E_TRANSFER — Interac e-Transfer

1. **Status:** Operating. Interac Corp. product page: <https://www.interac.ca/en/consumers/products/interac-e-transfer/>.
2. **Official site:** <https://www.interac.ca>
3. **Where it works:** Canada. You need an account at a participating Canadian financial institution (Terms of Use, <https://www.interac.ca/en/interac-e-transfer-terms-of-use/>). Domestic transfers are in CAD. International sending exists via Mastercard and Western Union partners, but that is a different flow (product page).
4. **Transfer characteristics:**
   - **Arrival:** Usually near-instant. Deposits may be delayed by fraud checks between institutions (<https://www.interac.ca/en/content/life/interac-e-transfer-101-everything-you-need-to-know-about-sending-and-receiving-money/>).
   - **Cancellation:** The sender can cancel only before deposit or autodeposit. Once deposited the transfer is final: "the e-Transfer transaction will be final" (Terms of Use, last updated 2021-08-07). Interac says it cannot trace, hold, recall or cancel funds and sends fraud cases to the customer's bank (e-Transfer 101 page).
   - **Limits:** Set by each institution, typically $2,000–$3,000 per transaction for consumers (e-Transfer 101 page).
   - **Seller tip:** A seller should use Autodeposit and wait for the deposit, not the email notification, because fake notification emails are a known scam pattern **(inferred)**.
5. **Crypto stance:** **No clause found** in the Interac Terms of Use. The terms only say you may send your own funds and must not use the service unlawfully. Individual Canadian banks have historically blocked crypto-related payments; a 2018 example is BMO (<https://www.coindesk.com/bank-of-montreal-expands-crypto-purchase-ban>, secondary) **(bank-level, not Interac)**.
6. **Legal / sanctions:** None for the rail itself. Canada separately requires virtual-currency dealers to register as an MSB with FINTRAC. A lawyer should consider whether frequent X2F sellers in Canada would fall under that **(inferred; flag only)**.
7. **Name check:** "Interac e-Transfer" is correct (official styling is "*Interac* e-Transfer®").
8. **Verdict:** `verified`. Reversal risk is low once deposited.

## US_POSTAL_MONEY_ORDER — US Postal money order

1. **Status:** Operating. USPS began selling redesigned money orders in 2025 (<https://about.usps.com/newsroom/national-releases/2025/0122-postal-service-to-sell-newly-redesigned-money-orders.htm>). Both the old and new designs are valid (<https://about.usps.com/postal-bulletin/2026/pb22697/html/frd_003.htm>).
2. **Official site:** <https://www.usps.com/shop/money-orders.htm>
3. **Where it works:** United States (domestic money orders, USD). International money orders are not offered on that page. USPS points to separate international money-transfer options (<https://www.usps.com/international/money-transfers.htm>).
4. **Transfer characteristics:**
   - **Limit and fees:** $1,000 maximum per domestic money order. The fee is $2.65 up to $500 and $3.75 up to $1,000. Buyers pay with cash or debit, not credit (USPS money-orders page).
   - **Buyer reversal:** The buyer cannot reverse it: "You cannot stop payment on postal money orders" (same page). Lost or stolen orders can be replaced only if uncashed, and only after an inquiry of up to 60 days.
   - **Main risk:** Counterfeits. Sellers should verify through the QR code, <https://tools.usps.com/money-orders.htm>, or the Money Order Verification System at 1-866-459-7822. If a bank later finds a deposited money order is fake, it reverses the credit against the depositor **(inferred; standard bank deposit practice)**. USPIS guide to spotting fakes: <https://www.uspis.gov/wp-content/uploads/2025/06/2025_How_to_Spot_a_Fake.pdf>.
   - **Arrival:** Depends on postal delivery, so days.
5. **Crypto stance:** **No clause found.** It is a bearer-style paper instrument with no user terms on crypto.
6. **Legal / sanctions:** Buying more than $3,000 of money orders in cash triggers federal record-keeping, and structuring purchases to avoid it is a crime **(inferred from general BSA rules; not checked on a USPS page)**. Mailing fraudulent instruments is mail fraud. Lawyer flag: anti-structuring guidance for users.
7. **Name check:** Suggest "USPS money order" or "U.S. Postal Service money order". USPS calls the product "Postal Money Order" / "money orders".
8. **Verdict:** `verified-with-flags`. Reversal risk from the buyer is low, but counterfeit risk is high, so overall high; the 60-day replacement window and mail delays add to it.

## ACH_TRANSFER — Bank transfer (ACH)

*Generic: no single provider to verify. The rail rules are set by Nacha, the operator of the ACH Network rules.*

1. **Status:** Operating (Nacha: <https://www.nacha.org/content/abcs-ach>).
2. **Official site:** <https://www.nacha.org> (rules body). Operators are the Federal Reserve (FedACH) and The Clearing House (EPN).
3. **Where it works:** United States, USD. Cross-border IAT entries exist but are not relevant here.
4. **Transfer characteristics:**
   - **Arrival:** Same day or next business day. Same Day ACH settles at 1:00, 5:00 and 6:00 p.m. ET and is capped at $1M per payment. Nacha has approved a $10M cap from 2027-09-17 (<https://www.nacha.org/same-day-ach>, <https://www.nacha.org/rules/increasing-same-day-ach-dollar-limit-10-million-0>).
   - **Reversals:** The originator or its bank can send a Reversal within **5 banking days** of settlement, for erroneous entries only (duplicate, wrong receiver, wrong amount, wrong date) (<https://www.nacha.org/rules/reversals-and-enforcement>). Since the 2026 risk-management rules, the receiving bank may return suspected fraud or false-pretenses credits (R17), or return them at the originating bank's request (R06). Phase 1 started 2026-03-20 and Phase 2 on 2026-06-22 (<https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-1>).
   - **Unauthorized debits:** A consumer whose account was debited without authorization can return the debit up to 60 days later (R10) **(inferred from general Nacha rules; not re-fetched)**.
   - **Seller risk:** If the buyer pushes a credit, misuse of the "error" reversal or a fraud claim can pull funds back days later. If the seller pulls a debit, the risk is even higher.
5. **Crypto stance:** n/a (generic rail). Individual US banks may restrict transfers to crypto businesses **(inferred)**.
6. **Legal / sanctions:** OFAC screening applies to all US banks. Lawyer flag: whether P2P XMR selling for USD is money transmission under FinCEN guidance (FIN-2019-G001) **(flag only)**.
7. **Name check:** "Bank transfer (ACH)" is fine. An alternative is "ACH bank transfer (US)".
8. **Verdict:** `verified-with-flags`. Reversal risk is high: the 5-banking-day reversal window plus fraud returns. Sellers should wait several business days.

## DOMESTIC_WIRE_TRANSFER — Domestic wire transfer

*Generic: no single provider to verify. The US rail is the Fedwire Funds Service (Federal Reserve) or CHIPS.*

1. **Status:** Operating (<https://www.federalreserve.gov/paymentsystems/fedfunds_about.htm>).
2. **Official site:** <https://www.frbservices.org/financial-services/wires> (Fedwire). In Canada the equivalent is Lynx (Payments Canada), which was not checked.
3. **Where it works:** US domestic, USD. The catalog name is generic, so the entry could also be read as any country's domestic wire **(inferred)**.
4. **Transfer characteristics:**
   - **Settlement:** Real-time gross settlement. Fedwire transfers are final and irrevocable once processed (Fed page above).
   - **Hours:** 9:00 p.m. ET the previous day to 7:00 p.m. ET, Monday to Friday. The third-party (customer) cut-off is 6:45 p.m. ET (<https://www.frbservices.org/resources/financial-services/wires/operating-hours.html>). Expansion to Sunday–Friday operation is planned for 2028–2029 (<https://www.federalreserve.gov/newsevents/pressreleases/other20251009a.htm>).
   - **Reversal:** There is no chargeback. The sending bank can only ask the receiving bank to return funds voluntarily, for example after a fraud recall. Banks charge roughly $15–$35 per wire **(inferred)**.
5. **Crypto stance:** n/a (generic).
6. **Legal / sanctions:** OFAC screening by banks. The same MSB / money-transmitter flag applies as for ACH.
7. **Name check:** OK. If the entry is meant to be US-only, consider "Domestic wire transfer (US)".
8. **Verdict:** `verified`. Reversal risk is low.

## CASH_APP — Cash App

1. **Status:** Operating. The operator is Block, Inc. (formerly Square, Inc.) (ToS, <https://cash.app/legal/us/en-us/tos>).
2. **Official site:** <https://cash.app>
3. **Where it works:** United States, USD. Eligibility requires being "a resident of the United States" (ToS). Secondary sources say Cash App stopped serving the UK in September 2024, but this was not confirmed from an official Block source **(unconfirmed)**. Treat Cash App as US-only.
4. **Transfer characteristics:**
   - **Arrival:** Instant between balances.
   - **Seller's main risk:**
     - **Cancellation:** Whether a payment can be cancelled "depends on how the Payment Instruction was initiated" (ToS §VII.10).
     - **Invalid P2P Payments (§VII.11):** If Cash App later decides a received payment was invalid (e.g. fraud), the recipient authorizes it to move the funds back out of their balance or linked account.
     - **Card funding:** Payments can be funded by a linked credit or debit card, so a card dispute can trigger a clawback **(inferred)**.
     - **Scams:** The ToS warns scams may cause "loss of your funds with no recourse" (§VII.12).
   - **Limits:** Unverified accounts are capped at about $1,000 per rolling 30 days. Verified accounts can send up to about $40,000 per 30 days (<https://cash.app/help/us/en-US/6543-account-limits>; figures vary between help pages).
5. **Crypto stance:** **No crypto-specific clause found** in the Acceptable Use Policy (<https://cash.app/legal/us/en-us/acceptable-use-policy>), which lists check cashing and securities brokers but not crypto. Cash App itself sells bitcoin. However, the P2P service is "for peer-to-peer personal, non-commercial purposes" (ToS §VII.1), and receiving commercial payments requires a business account or Earn in P2P.
6. **Legal / sanctions:** The AUP's OFAC clause names Iran, Cuba, North Korea, Syria and Crimea. Cash App also has a history of regulatory settlements over fraud handling. Lawyer flag: whether repeated XMR sales breach "personal, non-commercial" use.
7. **Name check:** "Cash App" is correct.
8. **Verdict:** `verified-with-flags`. Reversal risk is high (unilateral clawback, card funding) and the terms restrict P2P to non-commercial use.

## VENMO — Venmo

1. **Status:** Operating. The service is provided by PayPal, Inc. (<https://venmo.com/legal/us-user-agreement/>).
2. **Official site:** <https://venmo.com>
3. **Where it works:** United States only. Users "must be in the United States and have a U.S. bank account" (User Agreement). Currency is USD.
4. **Transfer characteristics:**
   - **Arrival:** Instant between balances.
   - **Reversals:** Venmo may reverse received payments for agreement violations or if the payment was made with "a compromised payment method or account" (User Agreement).
   - **Purchase Protection:** For payments marked as goods and services, buyers can get money back through Purchase Protection claims. Crypto and digital assets are excluded from that protection (User Agreement, Purchase Protection exclusions).
   - **Card funding:** Payments can be funded by a card, which brings issuer chargebacks **(inferred)**.
   - **Limits:** Unverified accounts can send $299.99 per week; identity-verified accounts up to $60,000 per rolling week (<https://help.venmo.com/cs/articles/personal-profile-payment-limits-vhel188>).
5. **Crypto stance:** **Yes, restrictive.**
   - The User Agreement makes users comply with PayPal's Acceptable Use Policy (<https://www.paypal.com/us/legalhub/paypal/acceptableuse-full>). The AUP prohibits transactions that "involve currency exchanges or check cashing businesses." It also lists "Cryptocurrency" among activities that need PayPal pre-approval.
   - Separately, paying or receiving for goods or services from a personal account is prohibited (User Agreement, all-caps notice).
6. **Legal / sanctions:** No sanctions issue beyond standard OFAC. Lawyer flag: X2F trades on Venmo would breach Venmo's terms in both of the ways above.
7. **Name check:** "Venmo" is correct.
8. **Verdict:** `verified-with-flags`. The flags are a crypto/currency-exchange clause, high reversal risk, and the ban on personal payments for goods and services.

## STRIKE — Strike

1. **Status:** Operating. The US operator is Zap Solutions, Inc. dba Strike (<https://strike.me/int/en/legal/us-individual-ts/>).
2. **Official site:** <https://strike.me>
3. **Where it works:**
   - About 98 countries. In the US, all 50 states, DC and Puerto Rico are covered (<https://strike.me/faq/where-is-strike-available-wr/>). Separate terms cover the US, the EEA/UK and the rest of the world (<https://strike.me/legal/>).
   - P2P transfers to a Strike username arrive in the recipient's local currency: USD in the US, GBP in the UK, EUR in the EU, USDT elsewhere, or bitcoin.
   - The US terms say "the Services only support bitcoin and U.S. dollars" (§11(a)).
4. **Transfer characteristics:**
   - **Arrival:** Instant between Strike users.
   - **Reversal:** "Except in certain circumstances for Send Globally Payments, all transactions that you authorize are final and irreversible (including all debit and credit card transactions)" (US ToS §4(h)). Unauthorized-EFT disputes still exist under Reg E (US ToS §5).
   - **Limits:** At Strike's discretion, listed in an FAQ (US ToS §4(b)).
5. **Crypto stance:** **Partial.** Strike is a bitcoin company, but its AUP (<https://strike.me/legal/acceptable-use/>, updated 2025-10-24) lists "currency exchanges or dealers" under prohibited Restricted Financial Services. The US ToS §15(e) also forbids use "on behalf of a third party on a professional or commercial basis." Monero is not supported on Strike itself.
6. **Legal / sanctions:**
   - US ToS §15(a) bars sanctioned persons and wallets and restricted jurisdictions.
   - Strike entities hold US state money-transmitter licences. A Salvadoran entity is licensed by the BCR and the CNAD (AUP page footer).
   - Lawyer flag: P2P XMR selling at volume could be read as acting as a "currency dealer" under the AUP.
7. **Name check:** "Strike" is correct.
8. **Verdict:** `verified-with-flags`. Reversal risk is low, but the AUP prohibits currency-exchange/dealer activity and the ToS prohibits commercial third-party use.

---

## Proposed catalog changes (proposals only)

- **Rename** `US_POSTAL_MONEY_ORDER` from "US Postal money order" to **"USPS money order"**.
- **Scope notes:**
  - `DOMESTIC_WIRE_TRANSFER`: decide whether it is US-only. If so, rename it to "Domestic wire transfer (US)". Otherwise mark it generic and move it out of the North America region.
  - `ACH_TRANSFER`: optionally rename to "ACH bank transfer (US)".
- **Countries:** ZELLE, ACH, VENMO, CASH_APP and USPS → `US` only. INTERAC → `CA` only. STRIKE → multi-region (US, EEA, UK, about 95 other countries; P2P currency varies by region).
- **New `legalReview` flags:**
  - VENMO: AUP currency-exchange prohibition and crypto pre-approval, plus the ban on personal payments for goods and services.
  - STRIKE: AUP bans currency exchanges/dealers; ToS §15(e) bans commercial use.
  - CASH_APP: P2P limited to personal, non-commercial purposes.
  - ZELLE: bank terms say "only people you know and trust"; scam-reimbursement clawback.
  - US_POSTAL_MONEY_ORDER: counterfeits, and BSA record-keeping and anti-structuring guidance.
  - Cross-cutting (all US entries): FinCEN money-transmitter status of P2P sellers. Canada: FINTRAC MSB registration for virtual-currency dealers.
- **Reversal-risk field** (if the catalog adds one): high for ACH, CASH_APP, VENMO and USPS money order (counterfeit); medium for ZELLE; low for INTERAC (after deposit), DOMESTIC_WIRE and STRIKE.
- **No removals proposed.** All eight are operating.
