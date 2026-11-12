# Payee boxes: confirmation pass on the 3 low and 59 medium methods (12 Nov 2026)

Research only, no code. Base: `docs/payment-fields-2026-11-10.md` on main (127 methods: 65 high, 59 medium, 3 low).

Method:
- Web search and fetch, preferring the provider's own help pages. Where those were missing, I used a bank or operator that offers the scheme, or the central bank.
- No personal details were put in any request.
- Several provider help centres refused automated fetches (403), notably Uphold and WeChat. Where that happened I used the best other source and say so.

Standing rules applied throughout:
- Never a password, PIN, CVV, expiry, login or personal tax ID as a box.
- CPF only as a Pix key.
- Pago Móvil's cédula or RIF is the one exception, as before.
- Where a scheme also accepts a national ID as a key, that key stays out of the boxes:
  - PromptPay: citizen ID
  - FPS: HKID
  - DuitNow: NRIC and passport
  - UPI: Aadhaar
  - Bre-B: cédula

Every box label is still COPY-UNSIGNED. The corrections below are proposals for the owner to sign. None is applied in code.

## Result in one view

- **Corrections proposed: 13**, listed first below.
  - 9 change or add a box or label: NEQUI, SPEI, WORLDREMIT, POSTEPAY, LYDIA, ALI_PAY, WECHAT_PAY, CASH_AT_ATM, ESSO_GIFT_CARD.
  - 3 are status flags with the boxes unchanged: CAPITUAL, PAPARA and CANADIAN_TIRE_GIFT_CARD.
  - MONESE is confirmed, and gains only an optional note.
- **Confidence after this pass (the 62 methods reviewed):**

  | Confidence | Count |
  |---|---|
  | high | 32 |
  | medium | 29 |
  | low | 1 (CAPITUAL) |

  The 29 that stay medium are mostly:
  - generic bank methods, which vary by country and so cannot be pinned to one provider page;
  - providers whose help centres would not load (Uphold, Volet, Paxum);
  - providers covered only by press or partner pages.
- **Provider status:**
  - Every provider is still operating, but two need a note.
  - **Capitual**'s site is live (dated January 2026) but now markets B2B payment infrastructure. I found no current page for a consumer account receiving money.
  - **Papara** had its licence revoked on 30 Oct 2025. It was reinstated on 27 Jan 2026 after a court suspended the revocation, and it now runs under state trusteeship (TMSF).
  - Rebrands, with the boxes unchanged:
    - Tigo Pesa became Mixx by Yas (Nov 2024).
    - Lydia now handles person-to-person payments only; its banking moved to Sumeria.
    - Esso gift cards are now "Esso and Mobil" cards.
    - Monese now belongs to Pockit and is still operating.

## Corrections (proposed; owner to sign)

| Method | Old boxes | Confirmed or corrected boxes | New conf. | Source |
|---|---|---|---|---|
| NEQUI | Nequi mobile number (phone, required); Bre-B key (if different) (account, optional); Name (optional) | **Label change:** "Bre-B key (phone, email or the bank's alphanumeric key; not your cédula)". Bre-B keys can be a cédula, which the rule bars as a box. Mobile number confirmed. | medium | https://www.bbva.com.co/personas/servicios-digitales/bre-b.html ; https://blog.bancolombia.com/educacion-financiera/escoger-llave-financiera-bre-b/ |
| SPEI | Name (required); CLABE (18 digits, required); Bank (optional) | CLABE and name confirmed. **Add two optional boxes:** "Debit card number (16 digits)" and "Mobile number linked to the account". Per press reports, Banxico Circular 10/2026 lets SPEI reach an account by card number or phone as well as by CLABE. The card number is not a secret field (no CVV or expiry). Verify against the circular itself before signing. | medium (CLABE high) | https://www.banxico.org.mx/servicios/mi-spei_-transferencias-ban.html ; https://expansion.mx/finanzas-personales/2026/09/06/clabe-no-desaparece-banco-de-mexico-cambiara-transferencias |
| WORLDREMIT | Full name (required); Mobile (required); one of: bank / mobile money / cash city; Email (optional) | All confirmed. **Add "Address (postal, optional)":** WorldRemit lists the recipient's address for both mobile money and bank transfers. Email is optional, as they say. | high | https://www.worldremit.com/en/blog/product/use-worldremit |
| POSTEPAY | Name (required); one of: mobile (P2P), IBAN (Evolution), card number | **Label change:** "Mobile number or Postepay alias (P2P)". The P2P service accepts the alias a holder sets in the app. IBAN and card confirmed. | medium | https://www.aranzulla.it/come-attivare-p2p-1536428.html (secondary); https://www.poste.it/carta-di-debito-postepay |
| LYDIA | one of: mobile, email; Name (optional) | Confirmed. **Add optional "Lydia username"**: recipients can also be found by their username. Note: Lydia now handles person-to-person payments only; its banking moved to Sumeria. | medium | https://www.presse-citron.net/applications/utilitaires/lydia-com/ ; https://lydia.me/en |
| ALI_PAY | Alipay ID (phone or email, required); Full name on the account (required) | Confirmed. **Label change:** "Full name as registered on Alipay (in pinyin / Latin letters)". Transfers fail on a name mismatch, and the name must match the Chinese ID. | medium | https://wise.com/help/articles/2kTApouGnjRj6JM1yduMIL/sending-cny-via-alipay ; https://support.orbitremit.com/hc/en-us/articles/360012806657-Paying-to-an-Alipay-ID |
| WECHAT_PAY (was low) | one of: WeChat ID, linked phone; Real name (optional) | Confirmed. **Label change:** "Real name as verified in Weixin Pay (pinyin)". Keep it optional for in-app transfers between friends. Note in the chat copy that a transfer from abroad needs the name and the linked phone to match exactly. | medium | https://www.westernunion.com/sg/en/send-to-wechat.html ; https://support.taptapsend.com/hc/en-gb/articles/44969772744083-Sending-to-WeChat-Pay-China ; https://www.maribank.sg/help-centre/article/10767-how-to-guide-my-recipient-on-their-first-weixin-wechat-pay-transfer (WeChat's own help centre returned 403) |
| CASH_AT_ATM | Nothing to send | **Add optional "Mobile number to receive the cash code"**. Several banks send a cardless-withdrawal code to the recipient's phone rather than to the buyer: Public Bank (MY), ADCB (UAE), Capitec (ZA). With others the buyer forwards the code (NatWest, Westpac, Santander ES). | medium | https://www.pbebank.com/en/digital-banking/mobile-banking/cardless-withdrawal/ ; https://www.adcb.com/en/tools-resources/cardless-cash-withdrawal/ ; https://www.capitecbank.co.za/blog/articles/best-way-to-bank/cardless-cash-withdrawals-made-easy-with-capitec/ |
| ESSO_GIFT_CARD | Nothing to send | Boxes confirmed. **Rename** to "Esso and Mobil gift card", which is the current Canadian programme. Note: resellers disagree on whether it can be used online. In-store use is by barcode, which the buyer can send. | medium | https://giftcards.esso.ca (official, not fetched); https://www.bitrefill.com/buy/esso-and-mobil-canada |
| CAPITUAL (was low) | Capitual account number (required); Name (optional) | Boxes unchanged. **Status flag:** the site is live (Jan 2026) but markets B2B payment infrastructure, and I found no current consumer instructions for receiving money. The 2021 consumer "CapConta" is the last consumer product seen. **Owner question:** retire the method, or keep it at low. | low | https://capitual.com ; https://olhardigital.com.br/2021/12/03/pro/capitual-possibilita-uma-conta-digital-bancaria-completa-e-servicos-com-criptomoedas-em-um-so-lugar/ |
| PAPARA | Name (required); one of: Papara number, TR mobile, email, IBAN | Boxes unchanged. **Status flag:** licence revoked 30 Oct 2025, reinstated 27 Jan 2026; Papara now operates under state trusteeship (TMSF) while its owner is prosecuted. **Owner question:** keep it, or show a risk note. | medium | https://thepaypers.com/fraud-and-fincrime/news/turkiye-reinstates-paparas-license-amid-money-laundering-probe ; https://www.intellinews.com/how-turkey-became-a-fintech-operator-in-spain-and-pakistan-by-seizing-unicorn-enterprise-papara-386424/ |
| CANADIAN_TIRE_GIFT_CARD | Nothing to send | Boxes unchanged. **Flag:** sources disagree on whether Canadian Tire gift cards can be redeemed online at all, and one promotional card's terms say "retail stores or Gas+ only". If they cannot, a seller who is far away cannot use a card number sent in the chat. **Owner question:** keep it, or mark it in-store only. | medium | https://thesmallsuccess.pages.dev/canadian-tire-gift-card-gas-online-purchases (secondary, conflicting) |
| MONESE | Name (required); one of: phone (Monese to Monese), sort code + account, IBAN (EUR/RON) | Confirmed: UK payments use the sort code and account number, and the multi-currency IBAN does not work for UK domestic payments. **Optional note:** a sender abroad should put the Monese ID in the payment reference. Monese is still operating, now owned by Pockit. | high | https://support.monese.com/en/articles/91-can-i-use-my-multi-currency-iban-for-local-payments ; https://ibsintelligence.com/ibsi-news/pockit-acquires-monese-to-enhance-services-for-underserved-customers |

## Confirmed as they are

Payment apps:

| Method | Boxes (unchanged) | Conf. (was) | Source |
|---|---|---|---|
| GCASH | GCash number (required); Name (optional) | high (medium) | https://help.gcash.com/hc/en-us/articles/47623669730073-What-is-Express-Send |
| BIZUM | Spanish mobile (required); Name (optional) | high (medium); BBVA and CaixaBank are banks that offer Bizum | https://www.bbva.es/finanzas-vistazo/ef/banca-digital/enviar-dinero-bizum.html ; https://www.caixabank.es/bizum |
| TIKKIE | Tikkie payment link (required); Name (optional) | high (medium); a genuine link contains tikkie.me/pay/, which is worth checking in the field | https://www.abnamro.nl/nl/prive/internet-en-mobiel/slim-bankieren/tikkie.html ; https://www.consumentenbond.nl/betaalrekening/tikkie |
| BLIK | Polish mobile (required); Name (optional) | high (medium); since 26 Sep 2023 the recipient must have registered the number with BLIK | https://www.mbank.pl/indywidualny/aplikacja-i-serwis/platnosci/przelewy-na-numer-telefonu/ ; https://www.pkobp.pl/klient-indywidualny/aplikacja-iko-ipko/przelew-na-numer-telefonu |
| WERO | one of: mobile, email; Name (optional) | high (medium) | https://support.wero-wallet.eu/hc/en-us/articles/46163263600017-How-do-I-send-money-to-friends-and-family |
| MB_WAY | Portuguese mobile (required); Name (optional) | high (medium) | https://www.cgd.pt/Particulares/Cartoes/Pages/App-MBWay.aspx |
| APPLE_CASH | one of: US phone, Apple Account email; Name (optional) | high (medium) | https://support.apple.com/105013 |
| PAYSEND | Full name in Latin letters (required); one of: card number, IBAN or account number, wallet number; SWIFT/BIC (optional) | high for card and bank, medium for wallet (was medium); I found no Paysend page on wallets | https://help.paysend.com/hc/en-us/articles/21058675269533-What-details-do-I-need-to-send-a-bank-transfer ; https://paysend.com/en/blog/article-what-is-a-card-to-card-money-transfer |
| EASYPAISA | Easypaisa mobile account (required); Name (optional) | high (medium) | https://telenorbank.pk/wp-content/uploads/2020/03/Press_release_Easypaisa_money_transfer_to_any_mobile_number_October_27_2016.pdf ; https://www.westernunion.com/gb/en/providers/easypaisa.html |
| XOOM | Full name (required); one of: bank, wallet, pickup city; phone and address (optional) | high (medium) | https://help.xoom.com/s/article/what-information-about-my-contact-is-needed-to-send-a-transaction ; https://help.xoom.com/s/article/how-can-i-send-money |
| MTN_MOMO | MoMo number (required); Registered name (required) | medium (medium); MTN's pages vary by country | https://www.mtn.com.af/?p=6995 ; https://www.momo.ng/internationaltransfers/ |
| MIXX_BY_YAS | Mixx mobile number (required); Name (optional) | medium (medium); the rebrand from Tigo Pesa is confirmed and numbers are unchanged | https://yas.co.tz/?p=27235 ; https://www.remitly.com/us/en/providers-tanzania/send-money-to-tigo-pesa |
| REMITLY | Full legal name (required); one of: bank, wallet + provider, pickup; phone and address (optional) | medium (medium); only secondary sources | https://wise.com/ph/blog/receive-money-remitly ; https://www.remitly.com/blog/money-transfer/send-money-with-remitly-how-to/ |
| MERCADO_PAGO | one of: CVU/CBU, alias, email, mobile; Name (optional) | medium (medium); confirmed by press, not by Mercado Pago's own help | https://www.iprofesional.com/finanzas/468413-como-transferir-dinero-por-mercado-pago-sin-escribir-el-alias-ni-cbu.amp ; https://www.global66.com/blog/enviar-dinero-por-mercado-pago/ |
| UPHOLD | one of: email, username; Name (optional) | medium (medium); Uphold's help centre returned 403, so this rests on a third-party guide | https://gts.ai/defi/how-to-send-crypto-on-uphold |
| ADVANCED_CASH (Volet) | one of: wallet number, email; Name (optional) | medium (medium); found no Volet transfer page | https://volet.gitbook.io/volet |
| PAXUM | Paxum email (required); Name (optional) | medium (medium); Paxum's API has a P2P transfer endpoint, but I found no help page | https://api.paxum.com |

Bank transfers:

| Method | Boxes (unchanged) | Conf. (was) | Source |
|---|---|---|---|
| PROMPT_PAY | PromptPay ID (mobile or e-wallet ID, required); Name (optional) | high (medium) | https://www.bangkokbank.com/en/personal/digital-banking/promptpay |
| IMPS | Name (required); one of: account + IFSC, mobile; MMID and bank (optional) | high (medium) | https://www.npci.org.in/PDF/npci/imps/Product-Booklet.pdf |
| UPI | one of: UPI ID, mobile, account + IFSC; Name (optional) | high (medium) | https://npci.org.in/what-we-do/upi/faqs |
| SWIFT | Name, IBAN/account, BIC, beneficiary address (required); bank and local code (optional) | high (medium); the address must be a street address, not a PO box | https://www.natwest.com/support-centre/banking-from-home/make-payments/what-payee-details-are-required-to-send-money-abroad.html ; https://jpmorgan.com/insights/payments/cross-border-payments/global-payments-guide |
| DOMESTIC_WIRE_TRANSFER | Name, address, bank, ABA, account (required) | high (medium); Fedwire moved to ISO 20022 on 14 Jul 2025 and the fields are the same | https://www.adviacu.org/resources/banking-tools/wire-transfers/outgoing-domestic-transfers ; https://www.firstbank.com/iso20022/ |
| QRIS | QR code text (required, up to 512); Name and bank (optional) | high (medium); QRIS TUNTAS allows transfers between users by scanning the recipient's QRIS | https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/qris-tuntas/default.aspx |
| RAAST | one of: Raast ID (mobile), IBAN; Name (optional) | high (medium) | https://www.sbp.org.pk/circulars/disd-circular-no-1-of-2022 ; https://www.bankalfalah.com/islamic/digital-banking/raast |
| FPS | one of: mobile, email, FPS ID, bank code + account; Name (optional) | high (medium) | https://www.hkma.gov.hk/eng/smart-consumers/faster-payment-system/ ; https://www.hangseng.com/en-hk/e-services/fps |
| DUITNOW | one of: DuitNow ID (mobile or business registration number), account + bank; Name (optional) | high (medium) | https://docs.developer.paynet.my/docs/duitnow-transfer/introduction/overview ; https://www.pbebank.com/en/digital-banking/pbe-online-banking/faq/mypb/duitnow-id/ |
| SBP | Phone (required); Bank (required); Name (optional) | high (medium) | https://www.cbr.ru/eng/PSystem/sfp |
| UKRAINE_CARD | one of: card number, IBAN (UA, 29 characters), linked phone; Name (optional) | high (medium); phone transfers work only where the recipient's bank supports Visa+ | https://en.privatbank.ua/transfers-to-card-by-phone-number ; https://wise.com/help/articles/2932349/guide-to-uah-transfers |
| JAPAN_BANK | Bank, branch, account type, account number, katakana holder name (required); bank code (optional) | medium (medium); sources are Wise, Stripe and Flywire guides; the name must match the bank's record exactly | https://www.wise.com/help/articles/2932156/guide-to-jpy-transfers ; https://stripe.com/us/resources/more/furikomi-an-in-depth-guide |
| PAGO_MOVIL | Mobile, cédula/RIF, bank (name or 4-digit code) (required); Full name (optional) | medium (medium); confirmed by a Banco de Venezuela guide in the press; no BCV document found | https://finanzasdigital.com/como-hacer-un-pago-movil-pasos-y-comisiones/ ; https://www.riamoneytransfer.com/es-us/pago-movil/ |
| MIR | Mir card number (required); holder and bank (optional) | medium (medium); payouts by card number only are confirmed; one direct-payout service also asks for date of birth, which stays out as personal data | https://finance.mail.ru/card/natsionalnaya-sistema-platezhnyih-kart-747/ |
| NATIONAL_BANK, SAME_BANK, SPECIFIC_BANKS | as listed | medium (medium); these are generic and the fields vary by country (the SWIFT and wire sources above cover the core); no single provider page applies | (see SWIFT and DOMESTIC_WIRE_TRANSFER) |

Cash and money orders:

| Method | Boxes (unchanged) | Conf. (was) | Source |
|---|---|---|---|
| MONEY_GRAM | Full name as on ID, country (required); city and phone (optional) | high (medium) | https://www.moneygram.com/us/en/receive-money-with-moneygram ; https://www.moneygram.com/ca/en/help-center/faq/send-receive/receive-money-at-location |
| US_POSTAL_MONEY_ORDER | Full name (Pay to), mailing address (required) | medium (medium); usps.com did not load, so this rests on guides citing USPS's FAQ | https://eco.com/support/en/articles/17345348-how-to-fill-out-a-money-order-step-by-step-with-examples ; https://www.bankrate.com/banking/how-to-fill-out-a-money-order |
| CASH_DEPOSIT (was low) | Name, bank, account number (required); branch or routing code (optional) | medium (low). The boxes are right. Add to the chat copy: many large US banks no longer accept cash deposits into an account you don't own (Wells Fargo, Bank of America), so the buyer should check before going. | https://www.bankrate.com/banking/checking/deposit-cash-into-someone-elses-account-these-are-your-options/ ; https://www.mybanktracker.com/news/well-fargo-no-cash-deposit-rule |

Gift cards (all "nothing to send", except Amazon's optional delivery email). For these, I checked that a code sent in the chat can be redeemed remotely:

| Method | Conf. (was) | Source |
|---|---|---|
| AMAZON_GIFT_CARD (email optional) | high (medium); some eGift deliveries are redeemed by link and carry no visible code | https://digprjsurvey.amazon.com/csad/help/node/G5D4TA7NBKQT7GW2 |
| GOOGLE_PLAY_GIFT_CARD | high (medium); redeemable only in the country of purchase | https://support.google.com/googleplay/answer/3422659 |
| DOORDASH_GIFT_CARD | high (medium) | https://help.doordash.com/consumers/s/article/doordash-gift-cards |
| BEST_BUY_GIFT_CARD | high (medium); online use needs the card number and PIN | https://www.bestbuy.ca/en-ca/help/bltc6e4ac9d6a7f34c4/blt5f505a77ab8458ec |
| HOME_DEPOT_GIFT_CARD | high (medium); older cards without a PIN are in-store only, and Canadian cards don't work on homedepot.com | https://www.homedepot.com/giftcard ; https://homedepot.ca/giftcards |
| IKEA_GIFT_CARD | high (medium); cards without a PIN are in-store only | https://www.ikea.com/us/en/customer-service/knowledge/articles/c9058a6c-b980-449b-8855-63b5ef55152a.html |
| AIR_CANADA_GIFT_CARD | high (medium) | https://www.aircanada.com/us/en/aco/home/book/air-canada-gift-cards.html |
| HOME_HARDWARE_GIFT_CARD | high (medium) | https://homehardware.ca/en/home-egift-cards |
| APPLE_GIFT_CARD | medium (medium); Apple's page did not load; third-party guides only | https://www.pocketgamer.com/how-tos/how-to-redeem-google-play-card (context) |
| AIRBNB_GIFT_CARD | medium (medium); the only Airbnb source is an archived Airbnb page | https://webcf.waybackmachine.org/web/20210421061637/https://www.airbnb.com/gift-cards |
| INSTACART_GIFT_CARD | medium (medium) | https://www.bitrefill.com/buy/instacart-usa/ |
| LULULEMON_GIFT_CARD | medium (medium) | https://www.giftronaut.com/blog/lululemon-gift-cards |

## Owner questions arising
1. **CAPITUAL:** retire the method, or keep it at low? It appears to have moved to B2B.
2. **PAPARA:** keep it, or show a risk note while it runs under state trusteeship?
3. **CANADIAN_TIRE_GIFT_CARD:** keep it, or mark it in-store only? Whether it can be redeemed online is unconfirmed.
4. **SPEI:** add the card-number and phone boxes now, or wait until the Banxico circular is checked?
5. Sign the label changes: NEQUI, POSTEPAY, LYDIA, ALI_PAY, WECHAT_PAY, ESSO.
6. Sign the added optional boxes: WORLDREMIT address, CASH_AT_ATM phone, LYDIA username.
