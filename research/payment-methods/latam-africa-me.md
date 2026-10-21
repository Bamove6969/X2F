# Payment-method verification — LatAm / Africa / Middle East & South Asia

Checked: 2026-10-21. Method: WebSearch + WebFetch. Several official sites refused automated fetches (HTTP 403/404: safaricom.co.ke, sbp.org.pk, papara.com, mercadopago.com.ar, banxico.org.mx, nequi.com.co). Where that happened, facts come from official pages surfaced in search results, central-bank PDFs, or reputable press. This is flagged per entry. **(inferred)** marks my own reasoning or background knowledge that I did not source in this session.

## Summary

| id | name | verdict | reversal risk | crypto clause | note |
|---|---|---|---|---|---|
| SPEI | SPEI | verified | low | unknown | Banxico interbank rail. Credits are final. CEP receipt lets the seller verify a payment independently. |
| MERCADO_PAGO | Mercado Pago | verified-with-flags | medium | yes (AR regulation) | Operates in several LatAm countries. Argentina's BCRA bars payment-account providers from facilitating crypto (Com. "A" 7759, 2023). |
| NEQUI | Nequi | verified | low–medium | unknown | Colombian wallet (COP). Interbank transfers now go over Bre-B. Some reports of mass account freezes. |
| PIX | PIX | verified-with-flags | **high** | unknown | MED lets the payer claim fraud and pull funds back up to 80 days after payment. |
| PAGO_MOVIL | Pago Móvil | verified-with-flags | low | unknown | Venezuelan interbank mobile payment (VES). Exposure to US sanctions on Venezuela, partly eased by GL 57 (Apr 2026). |
| CAPITUAL | Capitual | unclear | unknown | unknown | capitual.com now presents a B2B digital-asset/liquidity business. The consumer wallet could not be confirmed. |
| MPESA | M-Pesa | verified-with-flags | medium | no clause found (history of de-platforming crypto firms) | The sender can request a reversal through 456 if the recipient hasn't used the funds. |
| NIP | NIP (Nigeria) | verified-with-flags | medium–high | yes (regulation: banks barred from trading VCs) | NIBSS rail. Senders can reverse erroneous transfers within 14 working days. Fraud recalls and frozen accounts are common **(inferred)**. NIBSS says the National Payment Stack will replace NIP. |
| PAPARA | Papara | verified-with-flags | low–medium | yes (Turkish regulation) | TMSF trustee (2025). Licence revoked, then reinstated. Sold to Emlak Katılım Bankası (Apr 2026). Turkish rules bar e-money firms from transfers to crypto platforms. |
| RAAST | Raast | verified-with-flags | low | yes (regulation: banks cannot trade/hold VAs) | SBP-owned instant payment system (PKR). Virtual Assets Act (Mar 2026) and PVARA licensing are new. |

Counts: verified 2 · verified-with-flags 7 · outdated 0 · discontinued 0 · unclear 1.

---

## SPEI

1. **Status:** Operating. SPEI is Banco de México's interbank electronic payment system. In 2026 Banxico issued Circulars 9/2026 and 10/2026, which set 14 Dec 2026 as the deadline for banks to simplify SPEI transfers in their apps ([ruptura360](https://ruptura360.mx/periodismo-de-servicio/banxico-nuevas-reglas-transferencias-bancarias-apps-2026/), secondary).
2. **Official site:** https://www.banxico.org.mx (SPEI pages; the fetch was redirected to anterior.banxico.org.mx and returned 404). CEP lookup: https://www.banxico.org.mx/cep/
3. **Where:** Mexico only, MXN.
4. **Transfer characteristics:** Settles in seconds and runs 24/7 through app channels. Some bank web channels keep business hours ([xataka](https://www.xataka.com.mx/otros-1/pocos-saben-mexico-se-puede-saber-estado-transferencia-asi-funciona-cep)). The receiver can download a Banxico-issued CEP (Comprobante Electrónico de Pago) to verify a payment independently, which is very useful for sellers (same source). SPEI has no consumer chargeback. Reversal happens only through bank fraud or court processes **(inferred)**. Since 2025, a per-user transfer limit (MTU) applies, with a bank default of about MXN 12,500 unless the user changes it ([aztecajalisco](https://www.aztecajalisco.com/noticias-local/cual-es-el-monto-limite-para-las-transferencias-bancarias-agosto-2026/), secondary; figures vary by source).
5. **Crypto stance:** No SPEI-level clause found. Background: Banxico has restricted banks' own crypto operations since 2019 **(inferred, not re-sourced this session)**.
6. **Legal flags:** Transfer concepts are visible to SAT (tax authority) reporting, per press ([idconline](https://idconline.mx/fiscal-contable/2026/06/25/conceptos-de-transferencia-que-debes-evitar-para-no-tener-problemas-con-el-sat)). A lawyer should look at Mexican AML/"actividades vulnerables" rules for virtual assets **(inferred)**.
7. **Name check:** "SPEI" is correct. The full name is Sistema de Pagos Electrónicos Interbancarios.
8. **Verdict:** verified. The primary-site fetch failed, but operation is beyond doubt.

## MERCADO_PAGO

1. **Status:** Operating (MercadoLibre group). Official developer docs are live on .com.mx/.com.br/.com.co/.com.ar ([MP chargebacks doc](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro-preferences/chargebacks/introduction)).
2. **Official site:** https://www.mercadopago.com (country sites: .com.ar, .com.br, .com.mx, .com.co, .cl, .com.pe, .com.uy).
3. **Where:** Argentina, Brazil, Mexico, Colombia, Chile, Peru and Uruguay, each in its local currency **(inferred from the country domains)**. Accounts are country-specific, so cross-border P2P does not work **(inferred)**.
4. **Transfer characteristics:** Transfers between MP accounts and to bank accounts (CVU/Pix/SPEI rails) are instant. Formal chargebacks apply to card payments ([MP docs](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/chargebacks)). The risk is medium: a buyer who pays through a card-funded "payment" rather than a balance transfer can open a card dispute, and the funds stay held during it (same doc). MP also suspends accounts for disallowed activity ([iProfesional](https://www.iprofesional.com/economia/421009-atencion-mercado-pago-suspende-tu-cuenta-si-haces-alguno-de-estos-movimientos)). In Brazil, Pix via MP inherits Pix MED risk (see PIX).
5. **Crypto stance:** The ToS text could not be fetched (403). In Argentina, BCRA Com. "A" 7759 (May 2023) bars payment-account providers from facilitating crypto: "no podrán realizar ni facilitar a sus clientes las operaciones con activos digitales" ([criptonoticias](https://www.criptonoticias.com/regulacion/billeteras-virtuales-argentinas-no-podran-ofrecer-bitcoin-criptomonedas)). Per the BCRA, "facilitar" means in-app buy buttons. Whether the rule reaches P2P sale proceeds is unclear. MP itself sells crypto in BR, MX and CL ([iProUP](https://www.iproup.com/economia-digital/41766-por-que-mercado-pago-no-tiene-cripto-en-peronia-esta-prohibido)). Current (2026) status of A 7759 not confirmed.
6. **Legal flags:** A 7759 in Argentina. Account suspension for P2P commercial use.
7. **Name check:** "Mercado Pago" is correct.
8. **Verdict:** verified-with-flags (Argentine crypto restriction; card-dispute exposure).

## NEQUI

1. **Status:** Operating. In 2026 press, Nequi publishes limits and changes. Transfiya was replaced by Bre-B for interbank transfers from 6 Oct 2025 ([Noticias RCN](https://www.noticiasrcn.com/economia/nequi-anuncio-cambio-en-transfiya-por-llegada-de-bre-b-943861); [Vanguardia, Jan 2026](https://www.vanguardia.com/economia/2026/01/07/nequi-ajusta-topes-y-reglas-en-2026-asi-seran-los-limites-y-el-4x1000/)). Press refers to the entity as "Corporación Financiera Nequi" (a Bancolombia-group spin-off) ([las2orillas](https://www.las2orillas.co/?p=720548)).
2. **Official site:** https://www.nequi.com.co (the reglamento URL returned 404).
3. **Where:** Colombia, COP only.
4. **Transfer characteristics:** Nequi-to-Nequi and Bre-B transfers are instant. Low-amount deposit accounts have a monthly cap of about COP 11.0M (2026) ([Vanguardia](https://www.vanguardia.com/economia/2026/01/07/nequi-ajusta-topes-y-reglas-en-2026-asi-seran-los-limites-y-el-4x1000/)). Bre-B has a per-transaction ceiling of about COP 11.5–12.1M, depending on the source ([descubre.vc](https://www.descubre.vc/noticia/bre-b-establece-l-mites-de-transferencia-para-2026-en-colombia-2026-04-03)). There is no published consumer chargeback, so reversal comes through fraud complaints **(inferred)**. Nequi has closed accounts for "malas prácticas de uso, gestión y/o recepción de dinero" ([Portafolio](https://www.portafolio.co/economia/finanzas/nequi-cierra-cuentas-que-presentaban-malas-practicas-de-uso-gestion-y-o-recepcion-de-dinero-569188)). Press also reports thousands of accounts frozen for about 2 weeks ([las2orillas](https://www.las2orillas.co/?p=720548)).
5. **Crypto stance:** No clause found (the reglamento could not be retrieved).
6. **Legal flags:** None found. Note that receiving many third-party payments can trigger account closure.
7. **Name check:** "Nequi" is correct.
8. **Verdict:** verified (operation confirmed via multiple 2026 sources; the official site could not be fetched).

## PIX

1. **Status:** Operating. Run by Banco Central do Brasil. The MED rules were updated in 2025–2026 ([BCB Guia MED](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Guia_MED.pdf); [MED v4.1 for MED 2.0, effective 23/11/2025](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/versoes_futuras/Guia_MED-versao-4-1.pdf)).
2. **Official site:** https://www.bcb.gov.br/estabilidadefinanceira/pix
3. **Where:** Brazil, BRL only.
4. **Transfer characteristics:** Instant and 24/7. **Main P2P risk:** under the MED (Mecanismo Especial de Devolução, in force since Nov 2021), a payer who claims fraud gets the receiving account's funds blocked and returned. The payer has **80 days from the transaction** to claim ([meutudo, Sep 2026](https://meutudo.com.br/blog/noticias/2026/09/02/prazo-para-contestacao-de-pix-devolvido-pelo-med-passa-de-30-para-80-dias-entenda/)). MED 2.0 traces funds through onward accounts ([Finsiders](https://finsidersbrasil.com.br/pagamentos/pix/com-med-2-0-bc-quer-diminuir-falsos-positivos-e-rastrear-laranjas/)). From 1 Sep 2026 (IN BCB 766), a legitimate receiver has 80 days to contest a MED return (same source, secondary). This matches the classic P2P "triangulation" scam: a fraudster pays the seller with a victim's or stolen account, and the MED claws the money back **(inferred)**. Limits are set per bank, with lower night-time limits **(inferred)**.
5. **Crypto stance:** No scheme-level clause found. Individual banks' terms vary.
6. **Legal flags:** Brazil regulates VASPs under Law 14.478/2022 with BCB rules **(inferred, not re-sourced)**. Lawyer check needed for P2P XMR sellers receiving Pix at volume.
7. **Name check:** The official styling is "Pix" (not all caps), per BCB usage. Suggest renaming to "Pix".
8. **Verdict:** verified-with-flags (high reversal risk via MED).

## PAGO_MOVIL

1. **Status:** Operating. The BCV sets maximum fees for "Pago Móvil Interbancario" (Gaceta Extraordinaria 7.073, Sep 2026) ([Finanzas Digital](https://finanzasdigital.com/bcv-limites-comisiones-bancarias-septiembre-2026/)). Banks publish daily caps, e.g. BDV and Banesco ([Finanzas Digital](https://finanzasdigital.com/banesco-nuevos-limites-transacciones/)).
2. **Official site:** No single operator. The service is offered by Venezuelan banks under Banco Central de Venezuela rules: https://www.bcv.org.ve (not fetched).
3. **Where:** Venezuela, VES only.
4. **Transfer characteristics:** Near-instant, phone + national-ID + bank-code addressing. Per-bank daily caps vary widely (e.g. PagomóvilBDV Bs 150,000/day; Banesco several million Bs/day; figures change often). There is no consumer chargeback, so reversal risk is low **(inferred)**.
5. **Crypto stance:** No clause found.
6. **Legal flags — needs lawyer:** US sanctions on the Government of Venezuela. BCV and Banco de Venezuela are blocked parties. On 14 Apr 2026, OFAC General License 57 authorized financial services involving BCV, Banco de Venezuela, Banco Digital de los Trabajadores and Banco del Tesoro, but sanctions were not lifted ([King & Spalding](https://www.kslaw.com/insights/articles/ofac-eases-sanctions-on-financial-services-and-commercial-related-transactions-in-venezuela); [Thompson Hine](https://www.thompsonhinesmartrade.com/2026/04/ofac-issues-general-licenses-authorizing-venezuelan-certain-commercial-and-banking-transactions/)). Venezuela also has its own crypto regulator (SUNACRIP), which has been restructured since 2023 **(inferred)**.
7. **Name check:** "Pago Móvil" is correct as the generic name. Bank brands vary (e.g. "PagomóvilBDV").
8. **Verdict:** verified-with-flags (sanctions exposure).

## CAPITUAL

1. **Status:** Unclear. capitual.com is live (page dated 21 Jan 2026) but now presents digital-asset integration, structuring/intermediation, "payment and liquidity solutions" and consulting. It does not present a consumer wallet, and it shows no shutdown or rebrand notice ([capitual.com](https://capitual.com), fetched 2026-10-21). In 2021 it operated as a Brazilian crypto + fiat digital account with Pix and boletos ([Seu Dinheiro, 2021](https://www.seudinheiro.com/2021/economia/uma-conta-bancaria-que-faz-pix-e-paga-boletos-integrada-com-criptomoedas-este-servico-pode-ser-uma-revolucao-financeira-no-brasil/)).
2. **Official site:** https://capitual.com
3. **Where:** Brazil (BRL) historically. The current site names no countries.
4. **Transfer characteristics:** Unknown. Fiat legs historically ran over Pix, so Pix MED risk applies **(inferred)**.
5. **Crypto stance:** Crypto-native, so no ban expected **(inferred)**.
6. **Legal flags:** Brazil's VASP authorization regime under BCB applies **(inferred)**.
7. **Name check:** The name still matches the site.
8. **Verdict:** unclear. The site's pivot suggests the retail P2P account may no longer be offered. Needs a check by someone who can log in, or by asking the company.

## MPESA

1. **Status:** Operating. Safaricom publishes current Fuliza and reversal FAQs ([Safaricom FAQ](https://www.safaricom.co.ke/faqs-footer/fuliza)), and there is 2026 tariff coverage ([paybillke](https://paybillke.com/guides/mpesa-limits-2026), secondary).
2. **Official site:** https://www.safaricom.co.ke (Kenya) and https://m-pesa.safaricom.et (Ethiopia); Vodacom group for other markets.
3. **Where:** Kenya (KES) and Ethiopia (ETB), via Safaricom ([Ethiopia T&Cs](https://m-pesa.safaricom.et/terms-and-conditions)). Also Tanzania, DRC, Mozambique, Lesotho and Ghana via Vodacom/Vodafone affiliates **(inferred, not re-sourced)**. Each market is a separate, single-currency wallet.
4. **Transfer characteristics:** Instant. **Reversal:** the sender forwards the confirmation SMS to 456, and the reversal proceeds "as long as the recipient has not utilized the funds" ([Safaricom FAQ](https://www.safaricom.co.ke/faqs-footer/fuliza)). Incoming funds may also be auto-swept to repay a recipient's Fuliza overdraft. The risk is medium: a buyer can request a reversal immediately after sending, so a seller should move or check funds before releasing **(inferred)**. Limits are reportedly KES 250,000 per transaction, KES 500,000 per day and KES 500,000 maximum balance ([paybillke](https://paybillke.com/guides/mpesa-transaction-limits-2026), third-party; this conflicts with older Safaricom FAQ figures).
5. **Crypto stance:** No explicit clause found (the customer T&Cs page returned 403). History: Safaricom cut M-Pesa links for the bitcoin firms Kipochi and BitPesa, and a Kenyan court upheld its power to suspend ([Business Daily](https://www.businessdailyafrica.com/bd/corporate/companies/safaricom-cuts-m-pesa-link-for-bitcoin-dealer-kipochi--2104574)). In Ethiopia, the NBE broadened its virtual-asset ban in July 2026, covering exchanging VAs for fiat ([Capital Ethiopia](https://capitalethiopia.com/2026/07/26/nbe-tightens-virtual-asset-ban/)).
6. **Legal flags — needs lawyer:** The Ethiopian NBE ban makes M-Pesa Ethiopia unsuitable. Kenyan authorities froze Binance user accounts in an April 2026 crypto-fraud crackdown ([TechCabal](https://techcabal.com/es/2026/04/21/%C2%BFPor-qu%C3%A9-las-autoridades-kenianas-congelaron-las-cuentas-de-usuario-de-Binance/)).
7. **Name check:** The official styling is "M-PESA". "M-Pesa" is acceptable.
8. **Verdict:** verified-with-flags (sender reversal path; Ethiopia ban; history of de-platforming crypto firms).

## NIP

1. **Status:** Operating. NIBSS describes NIP as a 24/7 account-number-based instant system, with about 11.2bn transactions in 2024. NIBSS has also unveiled a **National Payment Stack (NPS) that will ultimately replace NIP** ([NIBSS](https://nibss-plc.com.ng/nibss-unveils-the-national-payment-stack-to-power-the-future-of-instant-payments-in-nigeria/); [NIBSS NIP article](https://nibss-plc.com.ng/from-3-day-wait-to-per-second-transaction-how-bank-transfers-work/)).
2. **Official site:** https://nibss-plc.com.ng (NIP FAQ: https://contactcentre.nibss-plc.com.ng/support/solutions/articles/47001265113-what-is-nip-service-)
3. **Where:** Nigeria, NGN only. Participants are commercial banks, MFBs and mobile money operators.
4. **Transfer characteristics:** Most transfers settle in under 1 second. Under the CBN 2018 circular, a sender can request in writing, within 14 working days, a reversal of an erroneous transfer (wrong account or amount). The receiving bank must comply within one business day if funds are available ([ThisDay](https://thisdaylive.com/index.php/2018/09/18/cbn-announces-fines-for-failed-transaction-reversals-others); [BusinessDay](https://archive.businessday.ng/banking-finance/article/banks-pay-n10000-per-item-failed-nip-transaction/)). Limits: individuals were historically capped at N1M instant / N5M daily, and later "highly secured" online limits rose to N25M ([brandcom](https://brandcom.ng/2022/06/07/cbn-increases-online-transfer-limit-to-n25-million/)). Risk is medium–high: fraud claims commonly lead to post-no-debit freezes on recipient accounts **(inferred)**.
5. **Crypto stance:** Regulatory, not a ToS clause. CBN's 22 Dec 2023 VASP guidelines let banks open accounts for SEC-licensed VASPs, but banks remain "prohibited from holding, trading and/or transacting in virtual currencies" on their own accounts ([BusinessDay](https://businessday.ng/technology/cryptocurrency/article/cbn-lifts-restrictions-on-crypto-exchanges-issues-guidelines/)). In 2024, the CBN restricted onboarding at some MMOs over crypto/FX abuse ([Nairametrics](https://nairametrics.com/?p=392724)).
6. **Legal flags — needs lawyer:** Nigeria's SEC VASP licensing regime, and P2P crypto trading under FX-abuse enforcement **(inferred)**.
7. **Name check:** The official name is "NIBSS Instant Payment (NIP)". Suggest "NIBSS Instant Payment (NIP, Nigeria)".
8. **Verdict:** verified-with-flags (reversal path; crypto regulatory posture; replacement by NPS is pending).

## PAPARA

1. **Status:** Operating, after turmoil. TMSF was appointed trustee in May 2025 in an illegal-betting probe ([Forbes TR](https://www.forbes.com.tr/haberler/tmsf-kayyumu-papara-yonetimini-devraldi-iste-atanan-isimler)). The CBRT revoked the operating licence on 30 Oct 2025 ([Turkish Minute](https://turkishminute.com/2025/10/31/turkeys-central-bank-revokes-fintech-company-paparas-license-amid-illegal-betting-probe/)). Ankara 25th Administrative Court suspended the revocation on 9 Dec 2025 ([tech.az](https://tech.az/en/posts/papara-announces-resumption-of-operations-following-court-ruling-on-license-revocation-6333)). The CBRT lifted the suspension on 21 Jan 2026 (per search summary; secondary). TMSF sold the Papara companies to **Türkiye Emlak Katılım Bankası**, approved in Apr 2026 ([Webrazzi](https://webrazzi.com/2026/04/16/papara-tmsf-ihalesiyle-emlak-katilim-bankasi-na-devrediliyor/); [Evrensel](https://www.evrensel.net/haber/5980084/paparanin-yeni-sahibi-belli-oldu-100-milyon-dolarlik-satista-imzalar-atildi)).
2. **Official site:** https://www.papara.com (fetch returned 403).
3. **Where:** Turkey, TRY primarily. Multi-currency balances existed historically **(inferred)**.
4. **Transfer characteristics:** Papara-to-Papara transfers are instant, with FAST for bank transfers **(inferred)**. Accounts were blocked during the trustee period ([Cumhuriyet](https://www.cumhuriyet.com.tr/ekonomi/papara-dan-bloke-hesaplara-iliskin-aciklama-2407034)). Account freeze risk is significant. Payer reversal risk is low–medium **(inferred)**.
5. **Crypto stance:** Regulatory. Under the CBRT 2021 regulation, payment and e-money institutions cannot intermediate fund transfers to or from crypto-asset platforms ([Habertürk](https://www.haberturk.com/merkez-in-duzenlemesi-odeme-kuruluslarina-yonelik-3041993-ekonomi); [NTV](https://www.ntv.com.tr/ekonomi/kripto-duzenlemesi-yururlukte-bugunden-itibaren-odemelerde-kullanilamayacak,O7SsubV9NUKu5im95lm14g)). Papara's own ToS was not retrieved.
6. **Legal flags — needs lawyer:** The criminal probe of the former owners (money laundering via illegal betting) ([sol.org.tr](https://haber.sol.org.tr/haber/falyalidan-paparaya-yasadisi-bahisten-gelen-55-milyar-lira-kripto-borsalarinda-aklanmis)). The licence history. The new state-bank owner. The CBRT crypto-intermediation ban.
7. **Name check:** "Papara" is correct.
8. **Verdict:** verified-with-flags.

## RAAST

1. **Status:** Operating. Pakistan's national instant payment system is run by Raast Payments Pakistan (Pvt) Ltd, a wholly owned SBP subsidiary. Bulk payments have run since 11 Jan 2021 and P2P since 2022 ([SBP Raast](https://www.sbp.org.pk/raast); [SBP circular DISD 1/2022](https://www.sbp.org.pk/circulars/disd-circular-no-1-of-2022)).
2. **Official site:** https://www.sbp.org.pk/raast
3. **Where:** Pakistan, PKR only.
4. **Transfer characteristics:** Instant, 24/7. Addressing is by IBAN or Raast ID (mobile number). P2P is free. Since 1 Apr 2022 there is no system-level transaction cap; banks set limits of at least Rs 200,000 per transaction, and the Raast limit must be ≥ the IBFT limit ([Business Recorder](https://www.brecorder.com/news/amp/40161305)). No consumer chargeback, so reversal risk is low **(inferred)**.
5. **Crypto stance:** Regulatory. An SBP circular of 14 Apr 2026 allows banks to bank PVARA-licensed VASPs, but banks may not trade, invest in or hold digital assets ([Finance Magnates](https://www.financemagnates.com/cryptocurrency/pakistan-ends-seven-year-crypto-banking-ban-but-bars-trading-by-banks/); [Cointelegraph](https://cointelegraph.com/news/pakistan-allows-banks-to-serve-licensed-crypto-firms?rand=351)).
6. **Legal flags — needs lawyer:** Virtual Assets Act (Mar 2026). PVARA required existing VASPs to seek NOCs by 5 Sep 2026 or cease operations ([ARY News](https://arynews.tv/cryptocurrency-operators-given-deadline-to-seek-nocs)). Whether a non-custodial P2P venue counts as a VASP is a lawyer's question.
7. **Name check:** "Raast" is correct.
8. **Verdict:** verified-with-flags (new VASP regime).

---

## Proposed catalog changes (proposals only)

- **PIX:** rename to "Pix" (BCB styling). Add `legalReview`/risk flag: high reversal risk (MED, 80 days).
- **NIP:** rename to "NIBSS Instant Payment (NIP, Nigeria)". Add a note that NIBSS plans to replace NIP with the National Payment Stack, so watch for renaming.
- **MPESA:** optionally restyle as "M-PESA". Add risk flag: sender reversal via 456. Consider excluding Ethiopia (NBE virtual-asset ban, Jul 2026).
- **PAGO_MOVIL:** add `legalReview: true` (OFAC Venezuela sanctions; GL 57 relaxations).
- **PAPARA:** add `legalReview: true` (trustee/licence history, Turkish crypto-intermediation ban, new owner Emlak Katılım).
- **MERCADO_PAGO:** add `legalReview: true` for Argentina (BCRA Com. "A" 7759).
- **NIP**, **RAAST**: add `legalReview: true` (Nigerian SEC VASP regime; Pakistan Virtual Assets Act / PVARA).
- **CAPITUAL:** candidate for removal unless the consumer account is confirmed. The site now presents a B2B digital-asset business.
- **SPEI**, **NEQUI**: no change.
