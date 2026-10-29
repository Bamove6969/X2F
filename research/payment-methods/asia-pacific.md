# Payment-method verification — Asia-Pacific

Checked: **2026-10-21**. Scope: 17 entries from `data/payment-methods.json`. Research only. Nothing in the catalog was changed.
Method: WebSearch / WebFetch. Official provider, scheme-operator and central-bank pages were preferred. Where only press or law-firm summaries were found, the source is named as such. **(inferred)** marks my own reasoning.

"Reversal risk" means the risk that a seller who has released XMR loses the fiat afterwards, through a chargeback, a provider or bank clawback, or a freeze of the receiving account after the sender reports fraud. In this region the main risk is usually **not** a scheme-level chargeback, because most of these rails are irrevocable push payments. It is **fraud-report account freezes**: India's 1930/cyber-cell liens, Thailand's mule-account decree, the Philippines' AFASA holds, and Japan's Furikome Fraud Relief Act. Triangulation scams (a fraud victim's money is used to pay the seller) trigger these freezes.

## Summary

| id | name | verdict | reversal risk | crypto clause | note |
|---|---|---|---|---|---|
| GCASH | GCash | verified-with-flags | medium | no | Operating (G-Xchange, BSP-regulated). Terms say transfers are final, but AFASA lets GCash hold disputed funds up to 30 days. No crypto ban; GCash sells crypto itself (GCrypto/PDAX). |
| JAPAN_BANK | Japan bank transfer (Furikomi) | verified-with-flags | medium | unknown (generic) | Generic. Zengin rail plus 24/7 "More Time". Under the Furikome Fraud Relief Act banks can freeze a recipient account on a fraud report. |
| AUSTRALIA_PAYID | PayID (Australia) | verified-with-flags | medium | no (scheme); banks vary | Operating (Australian Payments Plus, NPP/Osko). The Scams Prevention Framework is phasing in; the receiving bank is in scope for reimbursement. |
| ALI_PAY | Alipay | verified-with-flags | high | yes | Alipay says it does not serve virtual-currency transactions and limits or closes such accounts. PBOC Yinfa [2026] No. 42 makes fiat-crypto exchange illegal financial activity in mainland China. |
| WECHAT_PAY | WeChat Pay | verified-with-flags | high | yes | Tencent has barred crypto transactions since 2018–19. The same PRC legal regime applies. Foreign-card users cannot send P2P transfers. |
| MOMO | MoMo | verified-with-flags | medium | no clause found | Operating (M_Service, SBV-licensed). Vietnam Decree 284/2026 fines crypto trading outside licensed providers from 2026-09-01. |
| PROMPT_PAY | PromptPay | verified-with-flags | medium | unknown (scheme) | Operating (Bank of Thailand page). Thai SEC treats foreign P2P crypto services as unlicensed exchanges; the mule-account decree freezes accounts. |
| NEFT | NEFT (India) | verified-with-flags | high | no (scheme) | Operating 24x7, RBI. Irrevocable once credited, but India's cyber-cell freezes of P2P crypto sellers' accounts are widespread. |
| RTGS | RTGS (India) | verified-with-flags | high | no (scheme) | Operating 24x7, RBI. Minimum ₹2 lakh; final and irrevocable. Same freeze risk as NEFT. |
| IMPS | IMPS (India) | verified-with-flags | high | no (scheme) | Operating, NPCI. ₹5 lakh per transaction. Same freeze risk as NEFT. |
| UPI | UPI | verified-with-flags | high | no (scheme) | Operating, NPCI. ₹1 lakh P2P cap; a successful P2P payment cannot be disputed in UPI Help, but the freeze risk is high. |
| PAYTM | Paytm | outdated | high | unknown | Paytm Payments Bank licence cancelled 2026-04-24; bank ordered wound up July 2026. The Paytm app now works only as a UPI app (TPAP), so the entry should be merged into UPI. |
| QRIS | QRIS | verified-with-flags | low–medium | yes (BI regulation) | Operating (Bank Indonesia). Rp10m per transaction. BI regulations bar payment-system operators from processing virtual-currency transactions. |
| PAYNOW | PayNow | verified-with-flags | low–medium | unknown (scheme) | Operating (ABS, over FAST, 24/7). Banks and MPIs take part. Flag: Singapore DTSP regime (FSMA Part 9). |
| FPS | FPS (Hong Kong) | verified-with-flags | low–medium | unknown (scheme) | Operating (HKICL/HKMA), HKD and RMB, 24/7, settlement finality. Flag: HK virtual-asset dealing licence bill pending. |
| DUITNOW | DuitNow | verified | low–medium | unknown (scheme) | Operating (PayNet). Up to RM50,000 per transaction for consumers, depending on the bank. |
| PAYPAY | PayPay | verified-with-flags | medium | **yes** | PayPay terms prohibit P2P transfers mainly for crypto trading and commercial receipt via P2P. Effectively unusable for X2F. |

**Verdict counts:** verified 1 · verified-with-flags 15 · outdated 1 · discontinued 0 · unclear 0.

---

## GCASH — GCash
1. **Status:** Operating. The terms were published 2026-03-10 and take effect 2026-05-10. The operator is G-Xchange, Inc., regulated by Bangko Sentral ng Pilipinas. Sources: https://gcash.com/terms-and-conditions and https://help.gcash.com/hc/en-us/articles/47624429776025-What-is-GCrypto
2. **Official site:** https://gcash.com
3. **Where it works:** Philippines, PHP. The terms and help pages are Philippine-only. Overseas use (GCash Overseas) was not verified this session.
4. **Transfer characteristics:**
   - Wallet-to-wallet is instant; bank transfers use InstaPay/PESONet.
   - Terms §6.3: "Transactions are final once credited to the recipient's account". Disputes are between sender and recipient.
   - Errors must be reported within 15 business days (§18).
   - Under AFASA (RA 12010) and BSP Circular 1215, institutions may temporarily hold disputed funds for up to 30 days, or longer with a court order. Sources: https://lawphil.net/statutes/repacts/ra2024/ra_12010_2024.html and https://fintechnews.ph/67101/security/bsp-lets-banks-freeze-funds-fraud-activity/
   - Limits are per user and published in the Help Center; figures not captured.
   - Reversal risk: **medium**.
5. **Crypto stance:** No clause found. The terms bar illegal use and Ponzi schemes only. GCash sells crypto itself through GCrypto, powered by PDAX: https://help.gcash.com/hc/en-us/articles/47624429776025-What-is-GCrypto
6. **Legal flags:** AFASA 30-day holds. Philippine SEC 2025 rules for crypto-asset service providers serving Filipinos (secondary source) — a lawyer should check whether X2F is caught.
7. **Name check:** "GCash" is correct.
8. **Verdict:** verified-with-flags (AFASA hold risk).

## JAPAN_BANK — Japan bank transfer (Furikomi)
Generic — no single provider to verify.
1. **Status:** Operating. The rail is the Zengin System. The "More Time" system (since 2018-10-09) allows 24/7 real-time inter-bank credits between participating banks; not every bank takes part. Source: https://www.sbishinseibank.co.jp/retail/card_loan/splus/info/20181011.html (bank notice). Operator: https://www.zengin-net.jp
2. **Official site:** https://www.zengin-net.jp (operator)
3. **Where it works:** Japan, JPY.
4. **Transfer characteristics:**
   - Usually same-day or instant.
   - A transfer cannot be recalled without the recipient's consent (inferred).
   - Under the Furikome Fraud Relief Act (振り込め詐欺救済法), a bank can freeze an account suspected of receiving fraud proceeds. The Deposit Insurance Corporation then gives public notice for at least 60 days and pays the balance out to victims. Source: https://www.fsa.go.jp/policy/kyuusai/furikome/nagare.pdf
   - Reversal risk: **medium**. A triangulation victim's report can freeze the seller's whole account (inferred).
5. **Crypto stance:** Generic — bank-specific; no clause checked.
6. **Legal flags:** Japan requires FSA registration for "crypto-asset exchange business" under the Payment Services Act. Whether repeated individual P2P selling counts is unclear; no source found. Lawyer review recommended.
7. **Name check:** OK. The common rendering is "Furikomi (振込)".
8. **Verdict:** verified-with-flags.

## AUSTRALIA_PAYID — PayID (Australia)
1. **Status:** Operating. Run by Australian Payments Plus (AP+) on the NPP/Osko rail. Source: https://www.auspayplus.com.au/payid-fights-fraud-and-mistaken-payments
2. **Official site:** https://payid.com.au and https://www.auspayplus.com.au
3. **Where it works:** Australia, AUD.
4. **Transfer characteristics:**
   - Near-real-time and 24/7 through Osko. Payee-name confirmation is shown before sending.
   - Banks may claw back mistaken or misdirected payments under their own terms and the ePayments Code. Source: https://www.humebank.com.au/media/2023/02/Osko-Terms-and-Conditions-10082020_1.pdf (bank terms)
   - The Scams Prevention Framework (2025 Act) is phasing in: AFCA membership is required from 2026-09-01 and most obligations start 2027-03-31. Receiving banks are in scope for reimbursement. Source: https://www.bakermckenzie.com/en/insight/publications/2026/06/australia-scams-prevention-draft-code-and-rules-released (law firm)
   - Limits are set by each bank.
   - Reversal risk: **medium**.
5. **Crypto stance:** No scheme clause. Several big banks restrict payments to crypto exchanges; not verified this session.
6. **Legal flags:** AUSTRAC registers digital-currency exchange providers. A lawyer should check whether individual P2P sellers need to register.
7. **Name check:** OK.
8. **Verdict:** verified-with-flags.

## ALI_PAY — Alipay
1. **Status:** Operating. Ant Group, mainland China.
2. **Official site:** https://global.alipay.com and https://www.alipay.com
3. **Where it works:** Mainland China, CNY. Foreign visitors can link Visa/Mastercard, but P2P transfers and red packets are blocked for foreign-card accounts (travel guides: https://www.worldfirst.com/sasia/blog/importers-and-exporters/how-to-use-alipay-as-foreigner/). Separate wallets such as AlipayHK are not covered here.
4. **Transfer characteristics:**
   - Instant.
   - Alipay says it monitors over-the-counter trading and stops service on virtual-currency transactions. It may permanently limit withdrawals; about 3,000 accounts were closed in 2018–19. Source: https://www.pymnts.com/cryptocurrency/2019/alipay-bans-crypto-transactions/
   - Reversal risk: **high**, from account freezes.
5. **Crypto stance:** Yes. Ant Group statement: "Alipay has always adhered to the principle of not providing services to virtual currency transactions" (as reported in https://fortune.com/crypto/2018/08/24/ant-financial-alibaba-wechat-cryptocurrencies-bitcoin). I did not reach the user-agreement clause itself.
6. **Legal flags:** **Lawyer must see.**
   - PBOC and seven other departments issued Yinfa [2026] No. 42 on 2026-02-06. It continues the 2021 ban: payment institutions may not provide accounts, transfers or settlement for virtual-currency business, and fiat-crypto exchange is illegal financial activity. Sources: https://digitalpolicyalert.org/change/18236-notice-on-further-preventing-and-handling-risks-related-to-virtual-currencies-yinfa-2026-no-42 and the 2021 notice at https://www.gov.cn/zhengce/zhengceku/2021-10/08/content_5641404.htm
   - Offering this method facilitates trade the PRC classes as illegal.
7. **Name check:** "Alipay" is correct.
8. **Verdict:** verified-with-flags. Consider removal (legal plus crypto-ban clause).

## WECHAT_PAY — WeChat Pay
1. **Status:** Operating. Tencent / Tenpay.
2. **Official site:** https://pay.weixin.qq.com
3. **Where it works:** Mainland China, CNY. Foreign-card users cannot send P2P transfers or red packets. Source: Shanghai government guide https://english.shanghai.gov.cn/en-BankingServices/20231215/fe3a293d065f40e0a7f740aa88edb050.html
4. **Transfer characteristics:**
   - Instant.
   - Tencent monitors transactions in real time and blocks or terminates accounts dealing in crypto. Source: https://fintechnews.hk/9340/blockchain/wechat-crypto-bitcoin-ban-liquidity/
   - Reversal risk: **high**.
5. **Crypto stance:** Yes. The 2019 Payment Service Agreement revision bars "any initial coin offering activities or operating virtual currency trading" (reported in https://bitcoinmagazine.com/articles/wechat-plans-stop-merchants-transacting-cryptocurrencies). Tencent also bans personal sellers from crypto transactions. I did not reach the current agreement text.
6. **Legal flags:** Same PRC regime as Alipay (Yinfa [2026] No. 42). **Lawyer must see.**
7. **Name check:** OK. The mainland brand is "Weixin Pay".
8. **Verdict:** verified-with-flags. Consider removal.

## MOMO — MoMo
1. **Status:** Operating. Operator: M_Service (Online Mobile Services JSC), licensed by the State Bank of Vietnam. Source: https://www.momo.vn/help/dieukhoanweb
2. **Official site:** https://www.momo.vn
3. **Where it works:** Vietnam, VND.
4. **Transfer characteristics:**
   - Instant.
   - Limits: wallet balance up to 50m VND; 100m VND per month; 20m VND per day for mobile-to-mobile transfers (§1.8).
   - No general right to reverse a transfer.
   - In a dispute with a third party, M_Service may freeze funds until the matter is resolved (§11.8), and it may freeze or recover funds on suspected violations (§10.2).
   - Reversal risk: **medium**.
5. **Crypto stance:** No clause found. The terms ban illegal payments and transfers in general (§8.1).
6. **Legal flags:** **Lawyer must see.**
   - Vietnam's Resolution 05/2025 set up a licensed crypto pilot.
   - Decree 284/2026/NĐ-CP, effective 2026-09-01, fines individuals 30–50m VND for trading crypto outside Ministry of Finance-licensed providers. Source: https://vietnamnews.vn/economy/1785735/viet-nam-fines-crypto-traders-up-to-1-900-for-using-unlicensed-platforms.html
   - Crypto is not a lawful means of payment.
7. **Name check:** OK. "MoMo" or "Ví MoMo".
8. **Verdict:** verified-with-flags.

## PROMPT_PAY — PromptPay
1. **Status:** Operating. Launched 2016. Source: https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/promptpay.html
2. **Official site:** https://www.bot.or.th (central bank page)
3. **Where it works:** Thailand, THB. Cross-border links with PayNow and others.
4. **Transfer characteristics:**
   - Instant. Fee tiers are published by the Bank of Thailand; per-bank caps apply (Flywire cites 2m THB per transaction).
   - Under the 2023 Royal Decree on technology crime (amended 2025), banks must freeze reported transactions for 72 hours and can suspend suspected mule accounts for up to 7 days. Sources: https://www.tilleke.com/insights/thailands-new-cybercrime-measures-enlist-aid-of-banks-and-service-providers/ and https://opengovasia.com/thailand-cyber-resilience-to-safeguard-digital-transactions/
   - Reversal risk: **medium**.
5. **Crypto stance:** Generic — bank-specific; no scheme clause.
6. **Legal flags:** **Lawyer must see.** The Thai SEC treats foreign P2P crypto providers as unlicensed digital-asset exchanges and blocked Bybit, OKX and others from 2025-06-28. Source: https://www.theblock.co/post/356317/thailand-to-block-bybit-okx
7. **Name check:** OK.
8. **Verdict:** verified-with-flags.

## NEFT — NEFT (India)
1. **Status:** Operating 24x7 in half-hourly batches. Source: https://www.rbi.org.in/commonman/English/scripts/FAQs.aspx?Id=274
2. **Official site:** https://www.rbi.org.in
3. **Where it works:** India, INR.
4. **Transfer characteristics:**
   - Credit within about 2 hours of batch settlement, or the payment is returned.
   - Not reversible by the sender once credited (inferred from scheme design).
   - The main risk is a cyber-crime complaint (1930 helpline / National Cyber Crime Reporting Portal) leading to a bank lien or full-account freeze. This is common for P2P crypto sellers. Sources: https://righttoinformation.wiki/practical-guides/cyber-police-lien-p2p-crypto-trade-bank-account and https://forkast.news/headlines/india-authorities-block-bitbns-bank-account/ (secondary)
   - Reversal risk: **high**.
5. **Crypto stance:** No scheme clause. RBI's 2018 bank ban was set aside by the Supreme Court in 2020 (IAMAI v RBI). Not re-verified this session.
6. **Legal flags:**
   - India requires VASPs to register with FIU-IND under PMLA (not re-verified).
   - 30% tax plus 1% TDS on crypto transfers (not re-verified).
   - Account-freeze practice: courts are split. Kerala HC (2025) reportedly requires a magistrate order for a freeze (secondary).
7. **Name check:** OK.
8. **Verdict:** verified-with-flags.

## RTGS — RTGS (India)
1. **Status:** Operating 24x7 since 2020-12-14. Minimum ₹2 lakh, no maximum. Settlement is final and irrevocable. Source: https://www.rbi.org.in/Scripts/FAQDisplay.aspx?Id=65
2. **Official site:** https://www.rbi.org.in
3. **Where it works:** India, INR.
4. **Transfer characteristics:** Real-time and irrevocable at scheme level. Same cyber-freeze risk as NEFT. Reversal risk: **high**.
5. **Crypto stance:** As NEFT.
6. **Legal flags:** As NEFT.
7. **Name check:** OK.
8. **Verdict:** verified-with-flags. Note the ₹2 lakh minimum makes it a poor fit for small trades.

## IMPS — IMPS (India)
1. **Status:** Operating, 24x7, NPCI. Source: https://www.npci.org.in/product/imps/about-imps
2. **Official site:** https://www.npci.org.in/product/imps/about-imps
3. **Where it works:** India, INR.
4. **Transfer characteristics:** Instant. ₹5 lakh per transaction, except SMS/IVR channels. Same freeze risk as NEFT. Reversal risk: **high**.
5. **Crypto stance:** As NEFT.
6. **Legal flags:** As NEFT.
7. **Name check:** OK.
8. **Verdict:** verified-with-flags.

## UPI — UPI
1. **Status:** Operating, NPCI. Source: https://www.npci.org.in/product/upi
2. **Official site:** https://www.npci.org.in/product/upi
3. **Where it works:** India, INR. Some cross-border links, e.g. PayNow–UPI: https://www.abs.org.sg/consumer-banking/pay-now
4. **Transfer characteristics:**
   - Instant. P2P cap ₹1 lakh per transaction; banks may set lower. Source: RBI April 2025 statement as reported by https://www.businesstoday.in/amp/personal-finance/banking/story/npci-to-increase-upi-transaction-limits-for-high-value-payments-from-sept-15-check-updated-limits-493278-2025-09-09
   - NPCI UPI Help guidelines: "you cannot raise complaint on person to person successful transaction". Source: https://www.npci.org.in/uploads/UPI_Help_Brand_Guidelines_86c8c28922.pdf
   - The cyber-cell lien/freeze risk is the dominant one. Reversal risk: **high**.
5. **Crypto stance:** No scheme clause found.
6. **Legal flags:** As NEFT.
7. **Name check:** OK. Full name "UPI (India)" would match the other India entries.
8. **Verdict:** verified-with-flags.

## PAYTM — Paytm
1. **Status:**
   - RBI cancelled Paytm Payments Bank's licence effective 2026-04-24: https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR143F25E8E70241949E9A6EB75FE3C6988AB.PDF
   - The Delhi High Court ordered the bank wound up in July 2026: https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR7714B4D6DA1FD6A4A91978BF03FC519C312.PDF
   - The bank's wallets have not accepted credits since 2024-03-15.
   - The Paytm app (One97 Communications) continues as a UPI third-party app using Axis, HDFC, SBI and YES Bank as PSP banks. Sources: https://www.outlookindia.com/amp/story/national/paytm-ncpi-upi-third-party-app-provider and https://www.businesstoday.in/latest/corporate/story/rbi-cancels-paytm-payments-bank-licence-what-it-means-for-operations-upi-wallet-payments-customers-527405-2026-04-24
2. **Official site:** https://paytm.com
3. **Where it works:** India, INR.
4. **Transfer characteristics:** Today a "Paytm" payment is a UPI payment to a bank account (inferred). The UPI risk profile applies. Reversal risk: **high**.
5. **Crypto stance:** Unknown — terms not reached.
6. **Legal flags:** Bank in liquidation. Users of old wallets or bank balances may be in the winding-up process.
7. **Name check:** The name is current, but the product a seller would receive into (wallet / Payments Bank) is gone.
8. **Verdict:** **outdated**. Replace with UPI.

## QRIS — QRIS
1. **Status:** Operating, Bank Indonesia. Source: https://www.bi.go.id/en/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/QRIS/default.aspx
2. **Official site:** same as above.
3. **Where it works:** Indonesia, IDR. Cross-border QRIS with Thailand, Malaysia, Singapore and others.
4. **Transfer characteristics:**
   - Instant. Max Rp10m per transaction.
   - Mainly a merchant-payment QR standard. P2P transfer is possible via QRIS TUNTAS (since 2023): https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/qris-tuntas/default.aspx
   - Push payment; no consumer chargeback found. Reversal risk: **low–medium** (inferred).
5. **Crypto stance:** Yes, at regulator level. BI regulations 18/40/PBI/2016 and 19/12/PBI/2017 forbid payment-system operators "to process transactions using virtual currency". Source: https://www.bi.go.id/en/publikasi/ruang-media/news-release/Pages/sp_200418.aspx (2018). Whether this is still in force was not confirmed.
6. **Legal flags:** BI prohibition above. Crypto trading in Indonesia is supervised by OJK (transferred from Bappebti in 2025; not re-verified). Lawyer review recommended.
7. **Name check:** OK. Full name: "QRIS (Quick Response Code Indonesian Standard)". Note it is a QR standard, not a transfer rail. The group "Bank transfers" is debatable.
8. **Verdict:** verified-with-flags.

## PAYNOW — PayNow
1. **Status:** Operating. Run by the Association of Banks in Singapore over FAST, 24/7/365. Banks since 2017; major payment institutions (GrabPay, Wise and others) since 2021. Source: https://www.abs.org.sg/consumer-banking/pay-now
2. **Official site:** https://www.abs.org.sg/consumer-banking/pay-now
3. **Where it works:** Singapore, SGD. Links with PromptPay, UPI and DuitNow.
4. **Transfer characteristics:**
   - Instant. FAST cap S$200,000 per transaction; banks set lower defaults. Source: https://cimb.com.sg/paynow-corporate (bank)
   - Irrevocability is not stated by ABS. Push payment; no chargeback (inferred).
   - Reversal risk: **low–medium**.
5. **Crypto stance:** Generic — bank/MPI-specific; no scheme clause.
6. **Legal flags:** Singapore FSMA Part 9 (from 2025-06-30) requires a licence for Singapore-based providers of digital-token services, including overseas-only ones; MAS generally will not grant one. Source: https://www.allenandgledhill.com/sg/publication/articles/30739/ (law firm). Relevant if any X2F operator is Singapore-based. **Lawyer must see.**
7. **Name check:** OK.
8. **Verdict:** verified-with-flags.

## FPS — FPS (Hong Kong)
1. **Status:** Operating since 2018. HKICL runs it; HKMA settles HKD and Bank of China (HK) settles RMB. Settlement finality under the Payment Systems and Stored Value Facilities Ordinance (PSSVFO). Source: https://fps.hkicl.com.hk/eng/fps/about_fps/overview.php
2. **Official site:** https://fps.hkicl.com.hk
3. **Where it works:** Hong Kong, HKD and RMB. Banks and stored-value facilities take part.
4. **Transfer characteristics:**
   - Real-time, 24/7. Limits not published by HKICL; set by banks.
   - HKMA and police run a "Suspicious Proxy ID Alert": https://www.hkma.gov.hk/eng/news-and-media/insight/2024/03/20240327/
   - Reversal risk: **low–medium**.
5. **Crypto stance:** Generic — bank/SVF-specific; no scheme clause.
6. **Legal flags:** HK's virtual-asset dealing (OTC) licensing bill is targeted for LegCo by end-2026; no deemed-licence transition. Source: https://www.slaughterandmay.com/insights/new-insights/hong-kong-progresses-new-licensing-regimes-for-virtual-asset-dealing-and-custody-consults-on-regimes-for-virtual-asset-advisory-and-management/ (law firm)
7. **Name check:** OK. Note: in Haveno, "FPS" may have meant UK Faster Payments; check the id mapping (inferred).
8. **Verdict:** verified-with-flags.

## DUITNOW — DuitNow
1. **Status:** Operating. Run by PayNet (Payments Network Malaysia). duitnow.my now redirects to https://www.paynet.my
2. **Official site:** https://www.paynet.my
3. **Where it works:** Malaysia, MYR. Linked with PayNow.
4. **Transfer characteristics:**
   - Instant, 24/7. Consumers up to RM50,000 per transaction, varying by bank or e-wallet. Free up to RM5,000. Source: duitnow.my snippet via search; Maybank: https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/services/digital_banking/duitnow.page
   - Irrevocability not stated. Reversal risk: **low–medium** (inferred).
5. **Crypto stance:** Generic — bank-specific; no scheme clause.
6. **Legal flags:** None found. Malaysia licenses digital-asset exchanges through the Securities Commission (not re-verified).
7. **Name check:** OK.
8. **Verdict:** verified.

## PAYPAY — PayPay
1. **Status:** Operating. The service terms were revised 2026-04-24 and the balance terms 2026-10-21. Sources: https://about.paypay.ne.jp/terms/consumer/rule/guideline/general-rules/ and https://about.paypay.ne.jp/terms/consumer/rule/balance/
2. **Official site:** https://paypay.ne.jp
3. **Where it works:** Japan, JPY.
4. **Transfer characteristics:**
   - Instant.
   - Caps: ¥1m per transfer; ¥300k per 24 hours and ¥1m per 30 days for PayPay Money.
   - Disputes between users do not affect a transfer's validity.
   - Reversal risk: **medium** — account suspension for the prohibited use below (inferred).
5. **Crypto stance:** **Yes.** General Rules §6(1): "暗号資産または電子決済手段の取引を主な目的として、個人間での譲渡・送金を行う行為" ("P2P transfers mainly for trading crypto assets"). The rules also prohibit receiving commercial sale proceeds via P2P transfers.
6. **Legal flags:** Japan crypto-exchange registration question (see JAPAN_BANK).
7. **Name check:** OK.
8. **Verdict:** verified-with-flags. **Recommend removal**: the terms ban the use case outright.

---

## Proposed catalog changes (proposals only)

1. **Remove or merge PAYTM into UPI.** The Payments Bank licence was cancelled 2026-04-24 and the bank is being wound up. Paytm now only works as a UPI app.
2. **Remove PAYPAY.** Its terms explicitly prohibit P2P transfers mainly for crypto trading.
3. **Add `legalReview` flags:**
   - ALI_PAY, WECHAT_PAY: PRC ban (Yinfa [2026] No. 42) and provider crypto bans. Strong removal candidates.
   - MOMO: Vietnam Decree 284/2026 fines for crypto trading outside licensed providers.
   - PROMPT_PAY: Thai SEC treats foreign P2P crypto services as unlicensed exchanges.
   - QRIS: Bank Indonesia bars payment-system operators from processing virtual-currency transactions.
   - NEFT, RTGS, IMPS, UPI: India cyber-cell account-freeze risk; FIU-IND VASP registration.
   - PAYNOW: Singapore FSMA Part 9.
   - FPS: HK virtual-asset dealing licence bill.
   - JAPAN_BANK: Payment Services Act exchange-registration question.
4. **Add a seller-facing warning** for the India rails and GCash: triangulation fraud can trigger bank freezes after the trade (AFASA up to 30 days; Indian cyber-cell liens).
5. **Renames (minor):**
   - UPI → "UPI (India)".
   - QRIS → "QRIS (Indonesia)", and consider moving it out of "Bank transfers" since it is a QR standard.
   - WECHAT_PAY: optional alias "Weixin Pay".
6. **Check the FPS id mapping.** Haveno's "FPS" may have been UK Faster Payments rather than Hong Kong FPS.
7. **RTGS:** note the ₹2 lakh minimum in the catalog, or drop it as unsuited to retail P2P.
