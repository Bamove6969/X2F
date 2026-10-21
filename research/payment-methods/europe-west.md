# Payment-method verification — Europe (west)

Checked: 2026-10-21. Research only; nothing in `data/payment-methods.json` was changed.
Scope: SEPA, SEPA_INSTANT, FASTER_PAYMENTS, HAL_CASH, BIZUM, SATISPAY, TIKKIE, VERSE, WERO, MB_WAY, MONEY_BEAM.

Notes on method:
- Some official sites blocked automated fetches (europeanpaymentscouncil.eu HTML pages, mbway.pt, wero-wallet.eu, the Wero help centre all returned 403/maintenance). Where that happened I used the operator's PDFs, the participating banks' terms, or reputable trade press, and I say so.
- "Reversal risk" means: once the seller sees the money, how likely is it to be taken back (sender cancels, chargeback, bank recall, fraud claim, account freeze).
- **(inferred)** = my reasoning, not stated by a source.

## Summary

| id | name | verdict | reversal risk | crypto clause | note |
|---|---|---|---|---|---|
| SEPA | SEPA | verified-with-flags | medium | unknown (bank-specific) | Generic scheme. Payer's bank can send a fraud recall for up to 13 months. |
| SEPA_INSTANT | SEPA Instant | verified-with-flags | medium | unknown (bank-specific) | 10-second rail, no scheme maximum amount. Same 13-month fraud recall as SEPA. |
| FASTER_PAYMENTS | Faster Payments (UK) | verified-with-flags | high | unknown (bank-specific) | UK mandatory APP-scam reimbursement (since 7 Oct 2024, up to £85k, 13-month claim window). The receiving bank pays 50%, so receiving accounts get frozen. |
| HAL_CASH | HalCash | verified | low (after withdrawal) | no clause found | Spain, cash at ATMs. Sender can cancel until the cash is withdrawn. €10–600 per order. |
| BIZUM | Bizum | verified | low | no clause found | Spain, plus links to Italy, Portugal and Andorra. €1,000 per operation. Cannot be cancelled once sent. |
| SATISPAY | Satispay | verified-with-flags | low | no clause found | EUR, Luxembourg e-money institution. Consumer terms are for personal use only. P2P "cannot be revoked". |
| TIKKIE | Tikkie | verified-with-flags | low | no clause found | NL payment-request app, paid via iDEAL \| Wero. "Zakelijk gebruik … niet toegestaan". Not reversible. |
| VERSE | Verse | discontinued | n/a | n/a | Block shut Verse down in 2023 and the app was deactivated in Sept 2023. |
| WERO | Wero | verified | low | no clause found | EPI. P2P live in BE, FR, DE and LU (LU replaced Payconiq on 30 Sep 2026). NL is migrating from iDEAL. Instant and final. |
| MB_WAY | MB WAY | verified | low | no clause found | SIBS, Portugal, plus links to Bizum and Bancomat. Bank caps of about €750–2,000 per transfer. |
| MONEY_BEAM | MoneyBeam (N26) | verified | low | no clause found | Still live in Oct 2026. Works only between N26 customers. €5,000 per 24h. Cannot be reversed. |

Counts: verified 5, verified-with-flags 5, discontinued 1, outdated 0, unclear 0.

---

## SEPA (SEPA Credit Transfer)

1. **Status**: operating. EPC 2025 SCT Rulebook in force from 5 Oct 2025. Source: [EPC125-05 2025 SCT Rulebook v1.0 (PDF)](https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-11/EPC125-05%202025%20SCT%20Rulebook%20version%201.0.pdf)
2. **Official site**: European Payments Council (scheme manager), https://www.europeanpaymentscouncil.eu/ ; ECB SEPA page https://www.ecb.europa.eu/paym/retail/sepa/html/index.en.html
3. **Where it works**: EUR only. The SEPA area has 41 countries as of 22 May 2025, after Albania and Montenegro (Nov 2024), Moldova and North Macedonia (Mar 2025), and Serbia (May 2025) joined. Sources: [ECB SEPA](https://www.ecb.europa.eu/paym/retail/sepa/html/index.en.html), [European Western Balkans](https://europeanwesternbalkans.com/2025/10/08/albania-moldova-montenegro-and-north-macedonia-start-to-fully-implement-sepa/). Serbian banks were connected from about May 2026 (secondary source; not confirmed from EPC).
4. **Transfer characteristics**:
   - Arrival: the funds must reach the beneficiary's bank within one banking business day (Rulebook §4.2.3, "Maximum Execution Time").
   - Reversal: no chargeback exists. However, the payer's bank may send a **Recall** within 10 banking business days for duplicates or technical errors, and **within 13 months for "Fraudulent originated SEPA Credit Transfer"**. Separately, a "Request for Recall by the Originator" for any other reason depends on the beneficiary's consent, and the beneficiary's bank must answer within 15 banking business days (Rulebook §4.3.2.3–4.3.2.4).
   - Practical P2P risk **(inferred)**: in a "triangulation" scam, a fraud victim pays the seller. The victim's bank then sends a fraud recall, and the seller's bank may freeze or return the funds. That is a medium risk, and it lasts up to 13 months.
   - Limits: no scheme limit; banks set their own.
5. **Crypto stance**: generic. It depends on each bank's terms. Generic — no provider to verify.
6. **Legal flags**: the scheme has none. Sellers using personal accounts for frequent trades risk bank account closure (bank-specific).
7. **Name check**: "SEPA" is fine. A clearer label would be "SEPA bank transfer".
8. **Verdict**: verified-with-flags (13-month fraud recall).

## SEPA_INSTANT (SEPA Instant Credit Transfer, SCT Inst)

1. **Status**: operating. Under the EU Instant Payments Regulation (EU) 2024/886, euro-area banks have had to send SCT Inst since 9 Oct 2025, and also offer Verification of Payee (VoP). Sources: [Bird & Bird on IPR](https://twobirds.com/en/insights/2024/global/instant-payments-regulation), [EPC 2025 SCT Inst Rulebook page](https://www.europeanpaymentscouncil.eu/document-library/rulebooks/2025-sepa-instant-credit-transfer-rulebook-version-10)
2. **Official site**: https://www.europeanpaymentscouncil.eu/ (SCT Inst rulebook)
3. **Where it works**: EUR, SEPA area (same 41 countries). Non-euro EU PSPs have later deadlines (2027) (Bird & Bird).
4. **Transfer characteristics**:
   - Arrival: within 10 seconds, 24/7/365 ([EPC004-16 2025 SCT Inst Rulebook v1.0 PDF](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2024-11/EPC004-16%202025%20SCT%20Instant%20Rulebook%20v1.0.pdf)).
   - Amount: the 2025 rulebook says "There is no longer a maximum amount" at scheme level, following the amended SEPA Regulation, Art 5a(6) (same PDF, Annex IV). Banks and users may still set their own limits.
   - Reversal: same recall rules as SCT, including **13 months for fraud** (Rulebook, SCT Inst Recall section). VoP lowers the chance of misdirected payments but does not stop fraud recalls.
5. **Crypto stance**: generic, bank-specific. Generic — no provider to verify.
6. **Legal flags**: none for the scheme.
7. **Name check**: "SEPA Instant" is fine. The official name is "SEPA Instant Credit Transfer (SCT Inst)".
8. **Verdict**: verified-with-flags (13-month fraud recall).

## FASTER_PAYMENTS (UK Faster Payments)

1. **Status**: operating. Run by Pay.UK. It processed 5.55 bn payments worth £4.84 tn in 2025. Source: [Pay.UK FPS](https://www.wearepay.uk/what-we-do/payment-systems/faster-payment-system/)
2. **Official site**: https://www.wearepay.uk/what-we-do/payment-systems/faster-payment-system/
3. **Where it works**: GBP, UK accounts only.
4. **Transfer characteristics**:
   - Arrival: real time, 24/7/365. The scheme limit is £1m per payment, and bank limits vary (Pay.UK).
   - Reversal: the payment itself is final, but the **APP-scam mandatory reimbursement regime has applied since 7 Oct 2024**. It covers Faster Payments and CHAPS, with a cap of **£85,000** per claim, and claims can be made **up to 13 months** after the last payment. The sending and receiving firms split the cost 50:50. Sources: [PSR APP scams](https://www.psr.org.uk/our-work/app-scams/), [PSR decision news](https://psr.org.uk/news-and-updates/latest-news/news/psr-confirms-its-decision-on-app-scams-reimbursement), [Nationwide summary](https://nationwide.co.uk/help/fraud-and-security/payment-systems-regulator-app-scams)
   - Practical P2P risk **(inferred)**: the receiving bank now pays half of any reimbursed scam. A seller who receives money from a scammed third party (triangulation) can expect the account to be frozen or closed, and the funds clawed back. UK ombudsman decisions show banks closing accounts that receive P2P crypto sale proceeds (e.g. [FOS DRN-4757520](https://www.financial-ombudsman.org.uk/decision/DRN-4757520.pdf)). This makes the risk **high**.
5. **Crypto stance**: generic. Many UK banks restrict crypto-related payments, but that is bank-specific. Generic — no provider to verify.
6. **Legal flags**: **lawyer should review** how the APP reimbursement regime applies to P2P crypto sellers, and whether the UK FCA cryptoasset regime (financial promotions, registration) applies to X2F offers shown to UK users.
7. **Name check**: "Faster Payments (UK)" is fine. The official name is "Faster Payment System (FPS)".
8. **Verdict**: verified-with-flags (high reversal and freeze risk).

## HAL_CASH (HalCash)

1. **Status**: operating. Official site is live and banks still offer it: [Bankinter](https://www.bankinter.com/banca/en/accounts-cards/accounts/take-cash-out-without-a-card), [Cajamar](https://www.cajamar.es/en/comun/faqs/cajeros-automaticos/como-sacar-dinero-sin-tarjeta-o-libreta-en-un-cajero-del-grupo-cajamar-mediante-halcash/), [ABANCA](https://www.abanca.com/en/banca-a-distancia/hal-cash/). Operator: Helena Activos Líquidos, S.L. (Madrid, CIF B84199173), founded in 2004 by Spanish banks, with US investor Ashby Point Capital since 2017 ([aviso legal](https://www.halcash.com/es/aviso-legal), [quiénes somos](https://www.halcash.com/es/quienes-somos/)).
2. **Official site**: https://www.halcash.com/es/
3. **Where it works**: Spain in practice. The sender needs an account at a connected bank, and the recipient withdraws EUR cash at a network ATM using only a phone ([FAQ](https://www.halcash.com/es/faq)). The site claims international reach, but I found no confirmed live non-Spanish corridor (unclear).
4. **Transfer characteristics** ([FAQ](https://www.halcash.com/es/faq)):
   - Arrival: the SMS arrives in seconds, and the recipient must go to an ATM with the SMS reference plus the sender's 4-digit secret code.
   - Limits: €10–€600 per order. Each recipient phone can receive at most €3,000 per day and €6,000 per 30 days.
   - Reversal: an order that has **expired, been cancelled ("anulado") or been blocked returns to the sender**. Until the seller has physically withdrawn the cash, the buyer can pull it back. After withdrawal it is cash and final **(inferred)**.
5. **Crypto stance**: no clause found (HalCash site; bank terms not reviewed).
6. **Legal flags**: there is an unconfirmed report that Pin4 agreed to buy a controlling stake in HalCash International ([Retail Banker International](https://retailbankerinternational.com/tag/pin4), undated). Patents are listed in countries including Russia and Belarus. These are patents only, with no evidence of operations there, but they are noted for completeness. No sanctions issue found.
7. **Name check**: brand is written "HalCash" on its own site, and also "Hal Cash" or "Hal-Cash". "HalCash" is fine.
8. **Verdict**: verified. The UI must tell sellers to release only after withdrawing the cash.

## BIZUM

1. **Status**: operating. About 31.5 m active users ([bizum.com](https://bizum.com/es/)). Operator: Bizum, S.L., Madrid, NIF B-87599478 ([aviso legal](https://bizum.com/es/aviso-legal/)).
2. **Official site**: https://bizum.com/es/
3. **Where it works**: Spain, EUR, through participating Spanish banks' apps. Cross-border P2P with Italy (Bancomat), Portugal (MB WAY) and Andorra since March 2025. A Feb 2026 MoU with EPI/Wero, SIBS, Bancomat and Vipps MobilePay targets 13 countries, starting with P2P in 2026 ([AEB press release](https://aebanca.es/en/actualidad/notas-de-prensa/banking-associations-aeb-ceca-and-unacc-welcome-the-launch-of-bizums-interconnection-with-13-european-countries/), [EMPSA](https://empsa.org/en/news/2026-02-02-bancomat-bizum-epi-sibs-and-vipps-mobilepay-sign-mou)). I could not confirm that the 13-country P2P link is live.
4. **Transfer characteristics**:
   - Arrival: "en menos de 10 segundos" ([bizum.com](https://bizum.com/es/)).
   - Limits: banks report €1,000 per operation, €2,000 per day, and about €5,000 per month sent. Bankinter also lists 60 received operations per month ([Bankinter](https://www.bankinter.com/blog/finanzas-personales/limite-bizum-maximo), [BBVA](https://www.bbva.es/finanzas-vistazo/ef/banca-digital/limites-de-bizum-y-otros-aspectos-que-pueden-interesarte.html)). Individual banks may set lower caps.
   - Reversal: a sent Bizum cannot be cancelled from the app. Only the recipient can return it ([BBVA](https://www.bbva.es/finanzas-vistazo/tu-guia-bbva/transferencias/reclamar-bizum.html)). There is no chargeback. A bank told an OCU complainant that Bizum payments cannot be charged back ([OCU](https://www.ocu.org/reclamar/lista-reclamaciones-publicas/problema-con-el-reembolso/a4fe45b42f166dcebb)).
5. **Crypto stance**: no clause found. Bizum publishes no public user terms; the terms sit with each bank.
6. **Legal flags**: since 2025 Spanish tax authority reporting covers Bizum receipts. A seller with frequent receipts may draw tax attention ([Público](https://www.publico.es/economia/limite-bizums-diarios-control-hacienda.html), secondary). The 60-receipts-per-month cap limits active sellers.
7. **Name check**: "Bizum" is correct.
8. **Verdict**: verified.

## SATISPAY

1. **Status**: operating. Consumer terms are at Version 3.0, dated 7 July 2026 ([consumer T&C](https://satispay.com/en-it/legal-hub/terms-and-conditions/consumer-new/)).
2. **Official site**: https://www.satispay.com/
3. **Where it works**: EUR only. The terms are open to residents of EEA countries in the EBA PSD2 register who hold a SEPA bank account (T&C). The site's country selector lists Italy, France and Luxembourg ([satispay.com legal](https://www.satispay.com/en-it/legal/)). Italy is the core market. Germany appears in older press but not on the current selector, so it is likely no longer marketed **(inferred)**.
4. **Transfer characteristics** (T&C):
   - P2P is instant within Satispay.
   - Reversal: cl. 1.5.1, "Once a Payment is approved, it cannot be revoked". Satispay can reverse P2P payments within 10 days only where the payer's funds were unauthorised, such as after a failed top-up (cl. 1.6). This is a small window but a real one.
   - Limits: set by Satispay and shown in the app, not published (cl. 3).
5. **Crypto stance**: no clause found in consumer terms (they only bar "unlawful" use, cl. 1.3.1). Stripe's Satispay integration bars crypto merchants, but that is Stripe's own merchant rule ([Stripe docs](https://docs.stripe.com/payments/satispay)) and does not cover P2P.
6. **Legal flags**: the consumer service is limited to natural persons "acting outside any trade, business… or profession" (cl. 1). A frequent P2P seller could be treated as commercial use. Issuer: Satispay Europe S.A., an e-money institution regulated by the CSSF (Luxembourg), W00000010.
7. **Name check**: "Satispay" is correct.
8. **Verdict**: verified-with-flags (personal-use-only terms; 10-day reversal for unauthorised funds).

## TIKKIE

1. **Status**: operating, run by ABN AMRO. Ten years old in 2026, with more than 10 m users and 170 m requests in 2025 ([Banken.nl](https://www.banken.nl/nieuws/27225/tien-jaar-tikkie-een-miljard-betaalverzoeken-als-spiegel-van-nederland), [ABN AMRO](https://www.abnamro.com/nl/nieuws/tikkie-beleeft-nieuw-recordjaar-en-doorbreekt-grens-van-een-miljard)).
2. **Official site**: https://www.tikkie.me/
3. **Where it works**: a payment-request app. The requester needs a supported Dutch 06 phone number and an IBAN. The payer pays through their own bank via **iDEAL | Wero**, so any bank supporting iDEAL | Wero works, including some foreign banks ([Tikkie FAQ](https://www.tikkie.me/nl/hulp/veelgestelde-vragen)). Currency is EUR. A 2019-era German launch exists ([ABN AMRO](https://www.abnamro.com/nl/nieuws/tikkie-nu-ook-in-duitsland)), but the current site is NL-only and I could not confirm Germany today.
4. **Transfer characteristics** (FAQ; [payment terms, updated 17 Apr 2026](https://www.tikkie.me/nl/alle-voorwaarden/gebruiksvoorwaarden-betaling)):
   - Arrival: the payer pays ABN AMRO, which credits the requester "uiterlijk op de volgende werkdag" (next working day at the latest). Usually it is the same day.
   - Limits: €950 per request, €2,500 received per request, 30 payments per request, and €2,500 received per 24h.
   - Reversal: "een Tikkie is niet terug te boeken. Ook niet door ons" (cannot be reversed, not even by Tikkie). Underlying bank fraud recalls are still possible **(inferred)**.
   - Note: the payment shows an ABN AMRO intermediary IBAN, not the seller's own. The seller's name and IBAN appear in the description field.
5. **Crypto stance**: no clause found.
6. **Legal flags**: user terms (updated 17 Apr 2026) say "Zakelijk gebruik van de app is niet toegestaan" (business use of the app is not allowed) ([gebruikersvoorwaarden](https://www.tikkie.me/nl/alle-voorwaarden/gebruikersvoorwaarden)). The FAQ says the limits exist so Tikkie isn't used "voor fraude of zaken" (for fraud or business).
7. **Name check**: "Tikkie" is correct.
8. **Verdict**: verified-with-flags (no business use allowed; low limits).

## VERSE

1. **Status**: **discontinued**. Block announced the wind-down of Verse with its Q2 2023 results (Aug 2023). The app was deactivated and removed from app stores around 13 Sept 2023. Sources: [The Paypers, 8 Aug 2023](https://thepaypers.com/payments/news/block-winds-down-certain-european-operations), [Finextra](https://finextra.com/newsarticle/42741/block-shuts-european-p2p-payments-brand-verse), [Axios](https://www.axios.com/pro/fintech-deals/2023/08/07/block-shutters-european-p2p-business-verse). verse.me now serves an empty placeholder page (checked 2026-10-21).
2. **Official site**: verse.me (defunct).
3. **Where it worked**: EU (Spain-founded), EUR.
4. **Transfer characteristics**: n/a.
5. **Crypto stance**: n/a.
6. **Legal flags**: in 2023 the Bank of Lithuania fined Verse $250k over AML deficiencies (The Paypers). This is historical.
7. **Name check**: n/a.
8. **Verdict**: discontinued. Remove it.

## WERO

1. **Status**: operating. Run by EPI Company SE (European Payments Initiative). P2P launched in Belgium, France and Germany in 2024 ([epicompany.eu](https://epicompany.eu/)). It replaced Paylib in France and **Payconiq in Luxembourg, where Payconiq shut down on 30 Sep 2026** ([EPI, 2 Sep 2026](https://epicompany.eu/media-insights/epi-initiates-wero-in-luxembourg/)). In the Netherlands, iDEAL is being rebranded "iDEAL | Wero", with full migration expected by 2027 ([ABN AMRO](https://www.abnamro.nl/nl/prive/betalen/geld-overmaken/ideal-wordt-wero.html)). E-commerce is live in Germany (late 2025) and Belgium (Mar 2026) ([IT Finanzmagazin](https://www.it-finanzmagazin.de/wero-e-commerce-zahlungsloesung-startet-auch-in-belgien-240889/)). About 50 m users.
2. **Official site**: https://wero-wallet.eu/ (it showed a maintenance page on 2026-10-21) ; operator https://epicompany.eu/
3. **Where it works**: EUR. P2P is live in BE, FR, DE and LU. NL is migrating, and I could not confirm Dutch P2P is live. Wero is used through participating bank apps (e.g. Sparkassen, Volksbanken, ING, KBC, BNP Paribas Fortis, N26 for FR/DE accounts, Revolut) or the standalone Wero app.
4. **Transfer characteristics**:
   - Arrival: seconds. It runs on SCT Inst ([Revolut Wero terms](https://www.revolut.com/en-BE/legal/wero/)).
   - Limits: Wero-level maximum of €100,000 per payment and 100 payments plus 100 requests per 7 days. Banks add their own caps, e.g. Keytrade €1,000 and N26 €2,500/day ([Revolut terms](https://www.revolut.com/en-BE/legal/wero/), [Keytrade](https://www.keytradebank.be/en/support/wero), [N26](https://support.n26.com/en-de/payments-transfers-and-withdrawals/cards-and-online-payments/what-is-wero-and-how-do-i-use-it)).
   - Reversal: N26 says "Wero payments are instant and cannot be canceled"; only the recipient can refund ([N26](https://support.n26.com/en-de/payments-transfers-and-withdrawals/cards-and-online-payments/what-is-wero-and-how-do-i-use-it), [BNP Paribas Fortis](https://www.bnpparibasfortis.be/en/public/faq/puis-je-annuler-un-paiement-wero)). The SCT Inst fraud recall (13 months) still applies underneath **(inferred)**.
5. **Crypto stance**: no clause found (Revolut's Wero terms and EPI pages reviewed; EPI's own consumer terms were not reachable).
6. **Legal flags**: none found.
7. **Name check**: "Wero" is correct. Consider a note that it replaces Payconiq (LU), Paylib (FR) and, from 2027, iDEAL (NL).
8. **Verdict**: verified.

## MB_WAY (MB WAY)

1. **Status**: operating. Run by SIBS Forward Payment Solutions, S.A. (Portugal) ([Millennium BCP MB WAY terms](https://ind.millenniumbcp.pt/pt/Particulares/Cards/Documents/cg/CG_MBWAY.pdf), [Revolut MB WAY terms PT](https://cdn.revolut.com/terms_and_conditions/pdf/termos_e_condi_es_mb_way_d84021e9_1.0.2_1772717297_pt.pdf)).
2. **Official site**: https://www.mbway.pt/ (returned 403 to automated fetch) ; https://www.sibs.com/
3. **Where it works**: Portugal, EUR, through Portuguese banks and Revolut PT. Since 2025 users can send and receive with Bizum (Spain) and Bancomat Pay (Italy) users ([Sábado](https://www.sabado.pt/dinheiro/detalhe/utilizadores-do-mb-way-ja-podem-transferir-dinheiro-para-espanha-e-italia), [SIBS PR Dec 2023](https://www.sibs.com/wp-content/uploads/sites/13/2023/12/231214_Leading-European-mobile-payment-solutions-MB-WAY-BANCOMAT-Pay-and-BIZUM-establish-a-partnership-for-interoperability_VF.pdf)). The plan is 13 countries by end of 2026 ([RTP, Apr 2026](https://www.rtp.pt/noticias/economia/transferencias-mb-way-para-13-paises-europeus-vao-ser-possiveis-ate-final-do-ano_n1734358)).
4. **Transfer characteristics**:
   - Arrival: immediate. Transfers are "transferências instantâneas MB SPOT" (bank terms).
   - Limits: bank-specific. Revolut caps at €2,000 per transaction; BPI caps at €750 per operation and €2,500 per month, with 20 received per month ([BPI](https://bancobpi.pt/nocachecontent/conn/UCM/uuid/dDocName:PR_WCS01_UCM01014068)).
   - Fees: transfers up to €30 are free within monthly caps; above that, at most 0.2% ([DECO PROteste](https://www.deco.proteste.pt/dinheiro/contas-ordem/noticias/comissoes-transferencias-mbway-limitadas-02-por-cento)).
   - Reversal: no cancel or chargeback mechanism found for P2P transfers. Pending requests can be cancelled. Low risk **(inferred)**.
5. **Crypto stance**: no clause found (Revolut and Millennium BCP MB WAY terms reviewed).
6. **Legal flags**: none found.
7. **Name check**: "MB WAY" is correct (SIBS styling; also written "MB Way").
8. **Verdict**: verified.

## MONEY_BEAM (MoneyBeam, N26)

1. **Status**: operating. N26's help page (© 2026) still documents it ([N26 support](https://support.n26.com/en-eu/payments-and-transfers/moneybeam/how-to-use-moneybeam)). On 11 Aug 2026 N26 added Wero alongside MoneyBeam for FR and DE accounts; it did not replace MoneyBeam ([N26 press](https://n26.com/en-eu/press/press-release/n26-expands-instant-payment-offer-with-introduction-of-european-digital-payment-solution-wero)).
2. **Official site**: https://n26.com/
3. **Where it works**: EUR, **N26-to-N26 only**. Both parties must be visible N26 users. N26 operates in its EU markets; the 2019 UK version ended when N26 left the UK in 2020 **(inferred from N26 market exit; not re-checked)**.
4. **Transfer characteristics** (N26 support):
   - Arrival: real time.
   - Limit: €5,000 per 24h.
   - Reversal: once confirmed, "we can't reverse it or change the recipient's details".
5. **Crypto stance**: no clause found. N26 itself sells crypto via Bitpanda ([N26 Crypto](https://n26.com/en-be/crypto)), and I found no N26 term that bans receiving P2P crypto proceeds.
6. **Legal flags**: N26 has a history of BaFin anti-money-laundering (AML) enforcement: a €4.25 m fine and growth cap in 2021, and a €9.2 m fine for late suspicious-activity reports ([FinTech Futures](https://www.fintechfutures.com/regulatory-actions/n26-fined-9-2m-by-bafin-over-late-submission-of-suspected-money-laundering-reports-in-2022)). This is not a blocker but implies strict monitoring and account closures for P2P traders **(inferred)**.
7. **Name check**: "MoneyBeam (N26)" is fine.
8. **Verdict**: verified. It is niche because both sides need N26.

---

## Proposed catalog changes (proposals only)

1. **Remove `VERSE`**: discontinued in Sept 2023.
2. **Add `legalReview` on `FASTER_PAYMENTS`**: "UK APP-scam mandatory reimbursement (PSR, since 7 Oct 2024, 13-month claims, receiving bank pays 50%): high freeze/clawback risk for sellers; check FCA crypto regime for UK users."
3. **Add a reversal note on `SEPA` and `SEPA_INSTANT`**: "Payer bank can recall for fraud up to 13 months (EPC rulebook)."
4. **Add notes on `TIKKIE` and `SATISPAY`**: "Provider terms are for personal, non-business use only. Frequent sellers risk account closure." Lawyer to decide whether that needs a `legalReview` flag.
5. **Add a UI note on `HAL_CASH`**: "Sender can cancel until cash is withdrawn; release only after withdrawal. €10–600 per order."
6. **Add a description on `MONEY_BEAM`**: "Only between N26 customers."
7. **Add a description on `WERO`**: "Replaces Payconiq (LU, 30 Sep 2026), Paylib (FR); iDEAL (NL) migrating to iDEAL | Wero through 2027." If the catalog elsewhere has PAYCONIQ, PAYLIB or iDEAL entries (none found in this file's grep), mark them outdated in favour of WERO.
8. Optional name tweaks: `SEPA` → "SEPA bank transfer"; `FASTER_PAYMENTS` → "Faster Payments (UK)" (keep as is).
