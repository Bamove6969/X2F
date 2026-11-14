# Payment-method payee fields (10 Nov 2026)

What the seller (who receives the fiat) is asked for in the trade chat, per catalogue method
(`packages/trade/src/payFields.ts`, PAY_FIELDS). Built from the payee-field research (result-1..5)
with the lead decisions of 10 Nov 2026 applied. Every label is COPY-UNSIGNED: this page is for the
owner to sign the wording. "one of: X" means at least one box of group X must be filled.

124 methods (127 researched; SBP, MIR and YOOMONEY removed, owner 12 Nov: Russian anything is banned). Confidence: high = provider documentation, medium = several secondary sources agree, low = unclear.

Rechecked 12 Nov 2026 (the 3 low and 59 medium rows, against provider, operator or central-bank pages; comms research-payee-fields-confirm-2026-11-12, lead 12 Nov): now 98 high, 28 medium, 1 low. Each row's recheck source is in its `source` in payFields.ts. Applied: SPEI also takes a debit card number or a linked mobile (Banxico Circular 10/2026, Art. 17 Ter IV); ATM cash has an optional phone box for banks that text the code; label changes for Nequi, Alipay, Weixin Pay, Postepay; WorldRemit address and Lydia username added; notes for Monese and cash deposit; the catalogue names Esso's card "Esso and Mobil gift card". Left for the owner: Capitual (now B2B), Papara (state trusteeship), Canadian Tire (online redemption unconfirmed).

Notes:

- Mercado Pago: the boxes are the Argentina flow (CVU, alias, email or phone). Brazil pays by Pix and Mexico by CLABE: a later per-country refinement.
- Countries whose banks need a holder tax ID for a transfer (Chile RUT, Colombia cédula, Brazil CPF for TED) arrange it in the chat for now: personal tax IDs are never a box.
- Pago Móvil is the one exception: its cédula or RIF is the method's own payee identifier, so it is a required box.

## Payment apps

| id | boxes | confidence |
|---|---|---|
| UPHOLD | Email on the Uphold account (email, one of: reach)<br>Uphold username (account, one of: reach)<br>Name on the account (text, optional) | medium |
| MONEY_BEAM | Name (text, required)<br>Phone number (phone, one of: reach)<br>Email (email, one of: reach) | high |
| REVOLUT | Revtag (account, one of: reach)<br>Phone number (phone, one of: reach)<br>Email (email, one of: reach)<br>Name on the account (text, optional) | high |
| GCASH | GCash mobile number (phone, required)<br>Name on the account (text, optional) | high |
| SWISH | Swish mobile number (phone, required)<br>Name on the account (text, optional) | high |
| ALI_PAY | Alipay ID (phone number or email) (account, required)<br>Full name as registered on Alipay (in pinyin or Latin letters) (text, required) | medium |
| WECHAT_PAY | WeChat ID (account, one of: reach)<br>Phone number linked to WeChat (phone, one of: reach)<br>Real name as verified in Weixin Pay (pinyin) (text, optional) | medium |
| ZELLE | Email (email, one of: contact)<br>US phone number (phone, one of: contact)<br>Name on the account (text, optional) | high |
| MERCADO_PAGO | CVU / CBU (account, one of: reach)<br>Alias (account, one of: reach)<br>Email (email, one of: reach)<br>Mobile number (phone, one of: reach)<br>Name on the account (text, optional) | medium |
| MOMO | MoMo phone number (phone, required)<br>Name on the account (text, optional) | high |
| ADVANCED_CASH | Volet wallet number (account, one of: reach)<br>Email registered with Volet (email, one of: reach)<br>Name on the account (text, optional) | medium |
| TRANSFERWISE | Name on the account (text, required)<br>Wisetag (account, one of: reach)<br>Email registered with Wise (email, one of: reach)<br>Phone number registered with Wise (phone, one of: reach)<br>IBAN (EUR and other IBAN currencies) (iban, one of: reach)<br>Sort code and account number (GBP) (account, one of: reach)<br>Other bank details for the currency (text, one of: reach) | high |
| TRANSFERWISE_USD | Name on the account (text, required)<br>Wisetag (account, one of: reach)<br>Email registered with Wise (email, one of: reach)<br>ACH routing number and account number (account, one of: reach)<br>Full address (postal, optional) | high |
| PAYSERA | Name on the account (text, required)<br>Email on the Paysera account (email, one of: reach)<br>Phone number on the Paysera account (phone, one of: reach)<br>Paysera account number (IBAN) (iban, one of: reach) | high |
| PAXUM | Paxum email (email, required)<br>Name on the account (text, optional) | medium |
| PAYTM | UPI ID (account, one of: reach)<br>Mobile number (UPI-linked) (phone, one of: reach)<br>Bank account number and IFSC (account, one of: reach)<br>Name on the account (text, optional) | high |
| NEQUI | Nequi mobile number (phone, required)<br>Bre-B key (phone, email or the key your bank gave you) (account, optional)<br>Name on the account (text, optional) | medium |
| BIZUM | Spanish mobile number (phone, required)<br>Name on the account (text, optional) | high |
| CAPITUAL | Capitual account number (account, required)<br>Name on the account (text, optional) | low (status flag: site live but B2B only) |
| MONESE | Name on the account (text, required)<br>Phone number (Monese to Monese) (phone, one of: reach)<br>Sort code and account number (GBP) (account, one of: reach)<br>IBAN (EUR/RON) (iban, one of: reach)<br>Note: If the buyer pays from abroad, ask them to put your Monese ID in the payment reference. | high |
| MPESA | M-PESA phone number (phone, required)<br>Name on the account (text, optional) | high |
| SATISPAY | Mobile number on Satispay (phone, required)<br>Name on the account (text, optional) | high |
| TIKKIE | Tikkie payment link (account, required)<br>Name on the account (text, optional) | high |
| STRIKE | Strike username (account, one of: reach)<br>Lightning address (account, one of: reach) | high |
| CASH_APP | $cashtag (account, one of: reach)<br>Phone number (phone, one of: reach)<br>Email (email, one of: reach) | high |
| VENMO | Venmo username (account, one of: reach)<br>Phone number (phone, one of: reach)<br>Email (email, one of: reach)<br>Name on the account (text, optional) | high |
| PAYPAL | Email (email, one of: reach)<br>Phone number (phone, one of: reach)<br>PayPal username (account, one of: reach)<br>PayPal.Me link (account, one of: reach)<br>Name on the account (text, optional) | high |
| BLIK | Polish mobile number (phone, required)<br>Name on the account (text, optional) | high |
| VIPPS_MOBILEPAY | Vipps / MobilePay mobile number (phone, required)<br>Name on the account (text, optional) | high |
| TWINT | TWINT mobile number (phone, required)<br>Name on the account (text, optional) | high |
| PAPARA | Name on the account (text, required)<br>Papara number (account, one of: reach)<br>Turkish mobile number (phone, one of: reach)<br>Email (email, one of: reach)<br>IBAN (iban, one of: reach) | medium (status flag: under state trusteeship since 2025) |
| WERO | Mobile number registered for Wero (phone, one of: reach)<br>Email registered for Wero (email, one of: reach)<br>Name on the account (text, optional) | high |
| MB_WAY | Portuguese mobile number (phone, required)<br>Name on the account (text, optional) | high |
| PAYPAY | Japanese mobile number (phone, one of: reach)<br>PayPay ID (account, one of: reach)<br>Name on the account (text, optional) | high |
| KASPI | Kaspi phone number (phone, required)<br>Name on the account (text, optional) | high |
| SKRILL | Email on the Skrill account (email, one of: reach)<br>Phone number on the Skrill account (phone, one of: reach)<br>Name on the account (text, optional) | high |
| NETELLER | Neteller email (email, required)<br>Name on the account (text, optional) | high |
| APPLE_CASH | US phone number (phone, one of: reach)<br>Apple Account email (email, one of: reach)<br>Name (text, optional) | high |
| CHIME | $ChimeSign (account, one of: reach)<br>US phone number (phone, one of: reach)<br>Email (email, one of: reach)<br>Name on the account (text, optional) | high |
| PAYSEND | Full name (Latin letters) (text, required)<br>Card number (account, one of: reach)<br>IBAN or account number (iban, one of: reach)<br>SWIFT/BIC (account, optional)<br>Mobile wallet number (phone, one of: reach) | high |
| MTN_MOMO | MTN MoMo number (phone, required)<br>Registered name (text, required) | medium |
| MIXX_BY_YAS | Mixx by Yas mobile number (phone, required)<br>Name on the account (text, optional) | medium |
| CHIPPER_CASH | Chipper Tag (account, required)<br>Phone number on the account (phone, optional)<br>Name on the account (text, optional) | high |
| EASYPAISA | Easypaisa mobile account number (phone, required)<br>Name on the account (text, optional) | high |
| AIRTM | Email registered with Airtm (email, one of: reach)<br>Airtm username (account, one of: reach)<br>Name on the account (text, optional) | high |
| ASTROPAY | Phone number on AstroPay (phone, one of: reach)<br>AstroTag (account, one of: reach)<br>Name on the account (text, optional) | high |
| LYDIA | Mobile number (phone, one of: reach)<br>Email (email, one of: reach)<br>Lydia username (account, one of: reach)<br>Name on the account (text, optional) | medium |
| POSTEPAY | Name on the account (text, required)<br>Mobile number or Postepay alias (P2P) (account, one of: reach)<br>IBAN (Postepay Evolution) (iban, one of: reach)<br>Postepay card number (account, one of: reach) | medium |
| PAYONEER | Payoneer email (email, required)<br>Name on the account (text, optional) | high |
| ZEN | Phone number on ZEN (phone, one of: reach)<br>ZEN account IBAN (iban, one of: reach)<br>Name on the account (text, optional) | high |
| AFRIEX | Afriex $username (account, one of: reach)<br>Phone number on Afriex (phone, one of: reach)<br>Full name (text, optional) | high |
| REMITLY | Full legal name (as on ID / account) (text, required)<br>Bank details for your country (text, one of: delivery)<br>Mobile wallet number and provider (text, one of: delivery)<br>Cash pickup city or agent (text, one of: delivery)<br>Phone number (phone, optional)<br>Address (postal, optional) | medium |
| WORLDREMIT | Full name (as on ID / account) (text, required)<br>Mobile number (phone, required)<br>Bank details for your country (text, one of: delivery)<br>Mobile money number and provider (text, one of: delivery)<br>Cash pickup city (text, one of: delivery)<br>Email (email, optional)<br>Address (postal, optional) | high |
| XOOM | Full name (as on bank account / ID) (text, required)<br>Bank name and account number / IBAN (text, one of: delivery)<br>Mobile wallet number (text, one of: delivery)<br>Cash pickup city (text, one of: delivery)<br>Phone number (phone, optional)<br>Address (postal, optional) | high |

## Bank transfers

| id | boxes | confidence |
|---|---|---|
| SEPA | Name on the account (text, required)<br>IBAN (iban, required)<br>BIC (account, optional)<br>Payee address (postal, optional) | high |
| SEPA_INSTANT | Name on the account (text, required)<br>IBAN (iban, required)<br>BIC (account, optional)<br>Payee address (postal, optional) | high |
| SPEI | Name on the account (text, required)<br>CLABE (18 digits) (account, required)<br>Bank (text, optional)<br>Debit card number (16 digits) (account, optional)<br>Mobile number linked to the account (10 digits) (phone, optional) | high |
| FASTER_PAYMENTS | Name on the account (text, required)<br>Sort code (account, required)<br>Account number (account, required)<br>Payment reference to use (text, optional) | high |
| NATIONAL_BANK | Name on the account (text, required)<br>Bank name (text, required)<br>Bank code / institution number (account, optional)<br>Branch code (sort code, routing, BSB, transit, agency) (account, optional)<br>Account number (or IBAN / CLABE) (account, required)<br>Account type (text, optional) | medium |
| JAPAN_BANK | Bank name (text, required)<br>Bank code (account, optional)<br>Branch name or number (text, required)<br>Account type (futsu or toza) (text, required)<br>Account number (account, required)<br>Account holder name (katakana) (text, required) | medium |
| AUSTRALIA_PAYID | PayID (phone, email, ABN or organisation ID) (account, required)<br>Name shown for the PayID (text, required) | high |
| SAME_BANK | Name on the account (text, required)<br>Bank name (text, required)<br>Account number (account, required)<br>Branch code (account, optional)<br>Account type (text, optional) | medium |
| SPECIFIC_BANKS | Name on the account (text, required)<br>Bank name (text, required)<br>Account number (account, required)<br>Branch code (sort code, routing, BSB, transit, agency) (account, optional)<br>Bank code (account, optional)<br>Account type (text, optional) | medium |
| INTERAC_E_TRANSFER | Full name (text, required)<br>Email (email, one of: contact)<br>Mobile number (phone, one of: contact) | high |
| PROMPT_PAY | PromptPay ID (mobile number or e-wallet ID) (account, required)<br>Name on the account (text, optional) | high |
| NEFT | Name on the account (text, required)<br>Account number (account, required)<br>IFSC (account, required)<br>Bank and branch name (text, optional) | high |
| RTGS | Name on the account (text, required)<br>Account number (account, required)<br>IFSC (account, required)<br>Bank and branch name (text, optional) | high |
| IMPS | Name on the account (text, required)<br>Account number and IFSC (account, one of: reach)<br>Mobile number linked to the account (phone, one of: reach)<br>MMID (account, optional)<br>Bank name (text, optional) | high |
| UPI | UPI ID (account, one of: reach)<br>Mobile number registered with UPI (phone, one of: reach)<br>Account number and IFSC (account, one of: reach)<br>Name on the account (text, optional) | high |
| PIX | Pix key (phone, email, CPF/CNPJ or random key) (account, required)<br>Name on the account (text, optional) | high |
| SWIFT | Name on the account (text, required)<br>IBAN or account number (account, required)<br>BIC (SWIFT code) (account, required)<br>Beneficiary address (postal, required)<br>Bank name (text, optional)<br>Local bank code (if your country uses one) (account, optional) | high |
| ACH_TRANSFER | Name on the account (text, required)<br>Routing number (ABA) (account, required)<br>Account number (account, required)<br>Account type (checking or savings) (text, required)<br>Bank name (text, optional) | high |
| DOMESTIC_WIRE_TRANSFER | Name on the account (text, required)<br>Beneficiary address (postal, required)<br>Bank name (text, required)<br>Wire routing number (ABA) (account, required)<br>Account number (account, required) | high |
| NIP | Bank name (text, required)<br>Account number (NUBAN) (account, required)<br>Name on the account (text, required) | high |
| PAGO_MOVIL | Mobile number affiliated to Pago Móvil (phone, required)<br>Cédula or RIF (account, required)<br>Bank (name or 4-digit code) (text, required)<br>Full name (text, optional) | medium |
| QRIS | QR code text (account, required, up to 512 characters)<br>Name shown on the QRIS (text, optional)<br>Bank or e-wallet (text, optional) | high |
| RAAST | Raast ID (mobile number) (phone, one of: reach)<br>IBAN (iban, one of: reach)<br>Name on the account (text, optional) | high |
| PAYNOW | Mobile number registered for PayNow (phone, one of: reach)<br>UEN (businesses) (account, one of: reach)<br>PayNow VPA (account, one of: reach)<br>Name shown on PayNow (text, optional) | high |
| FPS | Mobile number registered for FPS (phone, one of: reach)<br>Email registered for FPS (email, one of: reach)<br>FPS ID (account, one of: reach)<br>Bank code and account number (account, one of: reach)<br>Name on the account (text, optional) | high |
| DUITNOW | DuitNow ID (mobile number or business registration number) (account, one of: reach)<br>Account number and bank (account, one of: reach)<br>Name on the account (text, optional) | high |
| UKRAINE_CARD | Card number (16 digits) (account, one of: reach)<br>IBAN (UA..., 29 characters) (iban, one of: reach)<br>Phone number linked to the card (phone, one of: reach)<br>Name on the card or account (text, optional) | high |

## Cash & money orders

| id | boxes | confidence |
|---|---|---|
| US_POSTAL_MONEY_ORDER | Full name (Pay to) (text, required)<br>Mailing address (postal, required) | medium |
| CASH_DEPOSIT | Name on the account (text, required)<br>Bank name (text, required)<br>Account number (account, required)<br>Branch / routing code (if your bank needs it) (account, optional)<br>Note: Some banks no longer take cash deposits into an account the depositor does not own. Check yours before the buyer goes. | medium |
| MONEY_GRAM | Full name as on your ID (text, required)<br>Country (text, required)<br>City and state/province (text, optional)<br>Phone number (phone, optional) | high |
| WESTERN_UNION | Full name as on your ID (text, required)<br>Country (text, required)<br>City and state/province (text, optional)<br>Phone number (phone, optional) | high |
| HAL_CASH | Mobile number to receive the HalCash SMS (phone, required) | high |
| F2F | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| PAY_BY_MAIL | Full name (text, required)<br>Mailing address (postal, required) | high |
| CASH_AT_ATM | Mobile number to receive the cash code (if the bank texts it to you) (phone, optional)<br>Note: Some banks text the cash code to your phone, others give it to the buyer to send you here. | medium |
| RIA | Full name as on your ID (text, required)<br>Country (text, required)<br>City and state/province (text, optional)<br>Phone number (phone, optional) | high |

## Gift cards & vouchers

| id | boxes | confidence |
|---|---|---|
| AMAZON_GIFT_CARD | Email to deliver the eGift card to (email, optional) | high |
| APPLE_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | medium |
| GOOGLE_PLAY_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| UBER_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| UBER_EATS_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| DOORDASH_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| WALMART_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| BEST_BUY_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| HOME_DEPOT_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| STEAM_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| PLAYSTATION_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| XBOX_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| IKEA_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| SEPHORA_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| STARBUCKS_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| AIRBNB_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | medium |
| ROBLOX_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| NINTENDO_ESHOP_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| VISA_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| MASTERCARD_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| INSTACART_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | medium |
| AIR_CANADA_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| PETRO_CANADA_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| ESSO_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | medium |
| SKIPTHEDISHES_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| SOBEYS_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| WINNERS_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| LULULEMON_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | medium |
| TIM_HORTONS_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| TARGET_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| HOME_HARDWARE_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |
| CANADIAN_TIRE_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | medium (owner question: online redemption unconfirmed) |
| OTHER_GIFT_CARD | Nothing to send (the buyer sends the card or cash details in the chat) | high |

## Other

| id | boxes | confidence |
|---|---|---|
| CUSTOM | Payment details (postal, required) | high |
