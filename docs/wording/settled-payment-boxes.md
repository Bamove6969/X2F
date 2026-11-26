# Payment boxes: settled wording (design, 12 Nov 2026)

Design settles these lines under the owner's 10 Nov rule. The team treats them as signed. Two items go to the owner (Part B Q4 and Q5, marked OWNER). Source: the Wording Room "Payment boxes" tab (w13-1 to w13-101, live page from origin/comms 2a278064), checked against `packages/trade/src/payFields.ts` on origin/main 6ebed537. All 93 method lines match the code's labels exactly.

## Counts

- **101 lines**: 8 shared + 93 methods. All 101 are settled.
- **Shared lines (8):** 1 kept (w13-3) and 7 changed. w13-1 and the "sent" line are the owner's approved w10-1 words.
- **Method lines (93):** 11 kept as is, 82 with at least one label changed.
- **Boxes (fields) in the 93 lines: 312.** 135 labels changed and 177 kept, including IMPS "Bank name", where the label stays and the rule changes (see Q1).
- **Hints:** 139 boxes get a short hint and 173 need none. The code has no hint today, so add `hint?: string` to `PayFieldSpec` (payFields.ts:35) and render it under the label, muted, 14px. `{buyer}` in a hint is the other trader's name.
- **No label contains a colon.** The generator asserted this for every final label.
- **OWNER items: 2** (Part B Q4 Russian methods, Q5 Capitual). The method lines for SBP, MIR, YOOMONEY and CAPITUAL are settled anyway, in case they stay.

## Rules applied

1. **The title names the method, so labels drop the brand.** For example "GCash mobile number" becomes "Mobile number". Brand words stay only when they are the identifier itself: Revtag, Wisetag, $Cashtag, Venmo username, PayPay ID, Pix key, PromptPay ID, Raast ID, DuitNow ID.
2. **Brackets move out of labels and into hints.** A label is the term itself. The hint gives the format, an example or when the box applies: "(18 digits)", "(GBP)", "(as on ID / account)", "(if your bank needs it)".
3. **Each label uses the country's own banking term:** IFSC, sort code, CLABE, BSB (in hints), IBAN, routing number, PayID, Pix key, CVU or CBU, Cédula or RIF, UEN, FPS ID, MoMo number, M-PESA number. Jargon goes where users would not say it: "(ABA)", "NUBAN" (moved to "10 digits"), "Beneficiary", "Payee".
4. **One wording for repeated boxes:** "Name on the account", "Email", "Phone number" or "Mobile number" (whichever the app uses), "Address", "Bank name", "Card number".
5. **Hints are short, plain and optional.** No hint repeats its label.

### T. Short method name for the title and card ("Your {method} details")

Take the catalogue name and drop any trailing bracket ("IMPS (India)" becomes "IMPS", "Wise (USD)" becomes "Wise", "Volet (formerly Advcash)" becomes "Volet"). Then apply these overrides: MONEY_BEAM "MoneyBeam"; SEPA "SEPA"; FASTER_PAYMENTS "Faster Payments"; NATIONAL_BANK, SAME_BANK, SPECIFIC_BANKS, CASH_DEPOSIT, NIP "bank"; JAPAN_BANK "bank transfer"; AUSTRALIA_PAYID "PayID"; US_POSTAL_MONEY_ORDER "money order"; PAY_BY_MAIL "mailing"; SWIFT "SWIFT"; ACH_TRANSFER "ACH"; DOMESTIC_WIRE_TRANSFER "wire"; SBP "SBP"; MIR "Mir"; UKRAINE_CARD "card"; KASPI "Kaspi"; RIA "Ria"; CUSTOM "payment". Any method outside the table uses "payment".

### N1. Show only the boxes for the trade's currency (Wise, Monese)

Wise offers 7 boxes and Monese 4, each tagged by currency. The trade's currency is known, so show only the boxes for that currency: EUR gets IBAN, GBP gets sort code and account number, any other currency gets "Other bank details". The username, email and phone boxes always show. This is the owner's "show each reader only what applies" rule. It is a builder change, not a wording change, so it is a follow-up for the lead and the wording above works either way.

### N2. Branch and bank-code terms by currency (National bank, Specific banks, Cash deposit)

Until the boxes follow the trade's currency, these labels stay generic: "Branch code" and "Bank code", with the local names in the hint. When the builder knows the currency, use the local term as the label:

| currency | "Branch code" becomes | "Bank code" becomes | "Account number" note |
|---|---|---|---|
| GBP | Sort code | (hide) | 8 digits |
| AUD | BSB | (hide) |  |
| USD | Routing number | (hide) |  |
| CAD | Transit number | Institution number |  |
| INR | IFSC | (hide) |  |
| MXN | (hide) | (hide) | label "CLABE" |
| EUR | (hide) | (hide) | label "IBAN", plus optional "BIC" |
| BRL | Agência | Bank code |  |
| ZAR | Branch code | (hide) |  |
| HKD | Branch code | Bank code |  |

## Shared lines (8)

| id | method | field | current | final label / line | final hint | kept/changed | code file:line | reason |
|---|---|---|---|---|---|---|---|---|
| w13-1 | all | title + lead | "Your payment details" / "Fill these in and send them to mira.k here, encrypted." | "Your {method} details" / "{buyer} needs these to pay you. They go into this chat as one message." | — | changed | apps/web/src/chat/ChatPanel.tsx:460, :462, :463 | Owner-approved wording (w10-1). {method} is the short name (table T below). The aria-label at :460 follows the title. |
| w13-2 | all | Send + closed-reason + sent line | "Send payment details" / "You can send these once the escrow is secured." | "Send details" / "You can send these once the escrow is secured." / after Send: "Your details were sent to {buyer}." | — | changed | apps/web/src/chat/ChatPanel.tsx:491, :382 (sent line is new, after onSent :451) | The title already says details; reason line kept (disabled-button rule). Sent line is owner-approved (w10-1) and not built yet. |
| w13-3 | all | optional suffix | "(optional)" | "(optional)" | — | kept | apps/web/src/chat/ChatPanel.tsx:479 | Clear. Every optional box now has a short hint that says when to fill it, where one helps. |
| w13-4 | all | one-of hint + error | "Fill in at least one of: Email, Phone number." | Hint: "One of Email or Mobile number is enough." (3 or more: "One of Revtag, Phone number or Email is enough.") Error when none is filled: "Fill in Email or Mobile number." | — | changed | apps/web/src/chat/ChatPanel.tsx:384, :385, :396 | Reads as a hint, not a form error. joinLabels becomes "A, B or C" (commas, "or" before the last). |
| w13-5 | all | box errors | "Fill in Full name." / "Full name is too long." / "Email can't have line breaks." / "Mailing address has too many lines." | "{label} is needed." / "{label} is too long." / "{label} must be on one line." / "{label} can have up to 8 lines." | — | changed | apps/web/src/chat/ChatPanel.tsx:394, :398, :401 | "Fill in Full name" reads oddly with the label mid-sentence; the address error now says the limit (PAY_POSTAL_MAX_LINES). |
| w13-6 | all | fallback + hidden characters | "Check the details and try again." / "Leave out hidden characters." | "Check the details and try again." / "These details have hidden characters, often from copying formatted text. Retype the part you pasted." / per box (:405): "{label} has hidden characters, often from copying. Retype it." | — | changed | apps/web/src/chat/ChatPanel.tsx:71, :410, :405 | Says what happened and what to do; same pattern as the offer form (offerForm.ts:541). |
| w13-7 | all | card heading + rows | "Payment details" / "Email: name@example.com" | Visible heading "{method} details" / rows "{label}: {value}". Methods outside the table keep "Payment details". | — | changed | packages/trade/src/payFields.ts:610; card render in apps/web/src/chat | Matches the PaymentDetails board. Keep the SEALED text title PAY_DETAILS_TITLE = "Payment details" as is: payTextMatches (:651) requires it. Change only the heading the card draws. |
| w13-8 | all | nothing-to-send line | "Nothing to send: the buyer sends the card or cash details here in the chat." | Gift cards: "Nothing to fill in. {buyer} sends the gift card code here in the chat." / F2F: "Nothing to fill in. Agree with {buyer} here in the chat where and when to meet." / CASH_AT_ATM: "Nothing to fill in. {buyer} sends the cash withdrawal code here in the chat." | — | changed | apps/web/src/chat/ChatPanel.tsx:309 | Show each seller only the line for their method. Uses the buyer's name like the other lines. |

## Method lines (93 lines, 312 boxes)

"current" is the label on main. Labels are COPY-SIGNED by design once wired. The field column gives the key and its rule (required, optional, or "one of" a group).

| id | method | field | current | final label | final hint | kept/changed | code file:line | reason |
|---|---|---|---|---|---|---|---|---|
| w13-9 | UPHOLD | email (one of reach) | Email on the Uphold account | Email | The one you sign in to Uphold with | changed | packages/trade/src/payFields.ts:79 | The title already names Uphold; "on the Uphold account" moves to the hint |
| w13-9 | UPHOLD | username (one of reach) | Uphold username | Uphold username | — | kept | packages/trade/src/payFields.ts:79 | Clear; already the term this method uses |
| w13-9 | UPHOLD | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:79 | Same wording as every method |
| w13-10 | MONEY_BEAM | name (required) | Name | Name on the account | — | changed | packages/trade/src/payFields.ts:83 | Same wording as every other method; bare "Name" is vague |
| w13-10 | MONEY_BEAM | phone (one of reach) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:83 | Clear; already the term this method uses |
| w13-10 | MONEY_BEAM | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:83 | Clear; already the term this method uses |
| w13-11 | REVOLUT | revtag (one of reach) | Revtag | Revtag | Your @name in Revolut | kept | packages/trade/src/payFields.ts:87 | Revolut's own term; hint says where to find it |
| w13-11 | REVOLUT | phone (one of reach) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:87 | Clear; already the term this method uses |
| w13-11 | REVOLUT | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:87 | Clear; already the term this method uses |
| w13-11 | REVOLUT | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:87 | Same wording as every method |
| w13-12 | GCASH | phone (required) | GCash mobile number | Mobile number | The number your GCash is on | changed | packages/trade/src/payFields.ts:91 | Title names GCash; brand dropped from the label |
| w13-12 | GCASH | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:91 | Same wording as every method |
| w13-13 | SWISH | phone (required) | Swish mobile number | Mobile number | The number Swish is set up on | changed | packages/trade/src/payFields.ts:95 | Title names Swish; brand dropped |
| w13-13 | SWISH | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:95 | Same wording as every method |
| w13-14 | ALI_PAY | alipayId (required) | Alipay ID (phone number or email) | Alipay account | The phone number or email on your Alipay | changed | packages/trade/src/payFields.ts:99 | "Alipay account" is the app's own term (支付宝账号); the bracket moves to the hint |
| w13-14 | ALI_PAY | name (required) | Full name on the Alipay account | Name on the account | Your real name, as verified in Alipay | changed | packages/trade/src/payFields.ts:99 | Shorter, same as other methods; the verified-name point moves to the hint |
| w13-15 | WECHAT_PAY | weChatId (one of reach) | WeChat ID | WeChat ID | — | kept | packages/trade/src/payFields.ts:103 | Clear; already the term this method uses |
| w13-15 | WECHAT_PAY | phone (one of reach) | Phone number linked to WeChat | Mobile number | The number linked to your WeChat | changed | packages/trade/src/payFields.ts:103 | Shorter; "linked to WeChat" moves to the hint |
| w13-15 | WECHAT_PAY | name (optional) | Real name (as verified in WeChat Pay) | Real name | As verified in WeChat Pay | changed | packages/trade/src/payFields.ts:103 | WeChat Pay's own term; bracket moves to the hint |
| w13-16 | ZELLE | email (one of contact) | Email | Email | — | kept | packages/trade/src/payFields.ts:107 | Clear; already the term this method uses |
| w13-16 | ZELLE | phone (one of contact) | US phone number | US mobile number | — | changed | packages/trade/src/payFields.ts:107 | Zelle's own wording is "email or U.S. mobile number" |
| w13-16 | ZELLE | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:107 | Same wording as every method |
| w13-17 | MERCADO_PAGO | cvu (one of reach) | CVU / CBU | CVU or CBU | 22 digits | changed | packages/trade/src/payFields.ts:111 | Argentine apps say CVU (and CBU for banks); "or" reads better than a slash |
| w13-17 | MERCADO_PAGO | alias (one of reach) | Alias | Alias | Like nombre.apellido.mp | kept | packages/trade/src/payFields.ts:111 | Mercado Pago's own term; example shows the shape |
| w13-17 | MERCADO_PAGO | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:111 | Clear; already the term this method uses |
| w13-17 | MERCADO_PAGO | phone (one of reach) | Mobile number | Mobile number | — | kept | packages/trade/src/payFields.ts:111 | Clear; already the term this method uses |
| w13-17 | MERCADO_PAGO | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:111 | Same wording as every method |
| w13-18 | MOMO | phone (required) | MoMo phone number | Mobile number | The number your MoMo is on | changed | packages/trade/src/payFields.ts:115 | Title names MoMo; brand dropped |
| w13-18 | MOMO | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:115 | Same wording as every method |
| w13-19 | ADVANCED_CASH | walletId (one of reach) | Volet wallet number | Volet wallet number | In the Volet app | kept | packages/trade/src/payFields.ts:119 | Volet's own term (the brand Advcash became) |
| w13-19 | ADVANCED_CASH | email (one of reach) | Email registered with Volet | Email | The one you use for Volet | changed | packages/trade/src/payFields.ts:119 | Title names Volet; "registered with Volet" moves to the hint |
| w13-19 | ADVANCED_CASH | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:119 | Same wording as every method |
| w13-20 | TRANSFERWISE | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:123 | Same wording as every method |
| w13-20 | TRANSFERWISE | wisetag (one of reach) | Wisetag | Wisetag | Your @name in Wise | kept | packages/trade/src/payFields.ts:123 | Wise's own term |
| w13-20 | TRANSFERWISE | email (one of reach) | Email registered with Wise | Email | The one on your Wise account | changed | packages/trade/src/payFields.ts:123 | Shorter |
| w13-20 | TRANSFERWISE | phone (one of reach) | Phone number registered with Wise | Phone number | The one on your Wise account | changed | packages/trade/src/payFields.ts:123 | Shorter |
| w13-20 | TRANSFERWISE | iban (one of reach) | IBAN (EUR and other IBAN currencies) | IBAN | For euro and other IBAN currencies | changed | packages/trade/src/payFields.ts:123 | Bracket moves to the hint. Better still: show only the box for the trade's currency (see note N1) |
| w13-20 | TRANSFERWISE | ukAccount (one of reach) | Sort code and account number (GBP) | Sort code and account number | For pounds, like 04-00-04 12345678 | changed | packages/trade/src/payFields.ts:123 | UK term kept; currency moves to the hint (N1) |
| w13-20 | TRANSFERWISE | otherBank (one of reach) | Other bank details for the currency | Other bank details | For any other currency, as Wise shows them | changed | packages/trade/src/payFields.ts:123 | Shorter (N1) |
| w13-21 | TRANSFERWISE_USD | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:127 | Same wording as every method |
| w13-21 | TRANSFERWISE_USD | wisetag (one of reach) | Wisetag | Wisetag | Your @name in Wise | kept | packages/trade/src/payFields.ts:127 | Wise's own term |
| w13-21 | TRANSFERWISE_USD | email (one of reach) | Email registered with Wise | Email | The one on your Wise account | changed | packages/trade/src/payFields.ts:127 | Shorter |
| w13-21 | TRANSFERWISE_USD | usAccount (one of reach) | ACH routing number and account number | Routing number and account number | From your Wise USD account details | changed | packages/trade/src/payFields.ts:127 | US apps say "routing number"; "ACH" is jargon here |
| w13-21 | TRANSFERWISE_USD | address (optional) | Full address | Address | Only if the payer's bank asks for it | changed | packages/trade/src/payFields.ts:127 | Plain; the hint says when it matters |
| w13-22 | PAYSERA | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:131 | Same wording as every method |
| w13-22 | PAYSERA | email (one of reach) | Email on the Paysera account | Email | — | changed | packages/trade/src/payFields.ts:131 | Title names Paysera |
| w13-22 | PAYSERA | phone (one of reach) | Phone number on the Paysera account | Phone number | — | changed | packages/trade/src/payFields.ts:131 | Title names Paysera |
| w13-22 | PAYSERA | iban (one of reach) | Paysera account number (IBAN) | IBAN | Your Paysera account number | changed | packages/trade/src/payFields.ts:131 | Paysera account numbers are IBANs; the term people copy is IBAN |
| w13-23 | PAXUM | email (required) | Paxum email | Email | — | changed | packages/trade/src/payFields.ts:135 | Title names Paxum |
| w13-23 | PAXUM | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:135 | Same wording as every method |
| w13-24 | PAYTM | upiId (one of reach) | UPI ID | UPI ID | Like name@ptyes | kept | packages/trade/src/payFields.ts:139 | The UPI term; Paytm handles end in @pt… |
| w13-24 | PAYTM | phone (one of reach) | Mobile number (UPI-linked) | Mobile number | Linked to your UPI | changed | packages/trade/src/payFields.ts:139 | Bracket moves to the hint |
| w13-24 | PAYTM | bankAccount (one of reach) | Bank account number and IFSC | Account number and IFSC | Like 12345678901, SBIN0001234 | changed | packages/trade/src/payFields.ts:139 | Same words as IMPS and UPI |
| w13-24 | PAYTM | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:139 | Same wording as every method |
| w13-25 | NEQUI | phone (required) | Nequi mobile number | Mobile number | The number your Nequi is on | changed | packages/trade/src/payFields.ts:143 | Title names Nequi |
| w13-25 | NEQUI | breBKey (optional) | Bre-B key (if different) | Bre-B key | Only if it isn't your mobile number | changed | packages/trade/src/payFields.ts:143 | Colombia's own term (llave Bre-B); bracket moves to the hint |
| w13-25 | NEQUI | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:143 | Same wording as every method |
| w13-26 | BIZUM | phone (required) | Spanish mobile number | Mobile number | Your Spanish number on Bizum | changed | packages/trade/src/payFields.ts:147 | Shorter; country moves to the hint |
| w13-26 | BIZUM | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:147 | Same wording as every method |
| w13-27 | CAPITUAL | accountNr (required) | Capitual account number | Account number | — | changed | packages/trade/src/payFields.ts:151 | Title names Capitual. Method itself is Part B Q5 (OWNER) |
| w13-27 | CAPITUAL | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:151 | Same wording as every method |
| w13-28 | MONESE | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:155 | Same wording as every method |
| w13-28 | MONESE | phone (one of reach) | Phone number (Monese to Monese) | Phone number | For Monese-to-Monese payments | changed | packages/trade/src/payFields.ts:155 | Bracket moves to the hint |
| w13-28 | MONESE | ukAccount (one of reach) | Sort code and account number (GBP) | Sort code and account number | For pounds | changed | packages/trade/src/payFields.ts:155 | UK term kept; currency moves to the hint (N1) |
| w13-28 | MONESE | iban (one of reach) | IBAN (EUR/RON) | IBAN | For euro or lei | changed | packages/trade/src/payFields.ts:155 | Currency moves to the hint (N1) |
| w13-29 | MPESA | phone (required) | M-PESA phone number | M-PESA number | Like 0712 345 678 | changed | packages/trade/src/payFields.ts:159 | What Kenyans call it ("my M-PESA number") |
| w13-29 | MPESA | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:159 | Same wording as every method |
| w13-30 | SATISPAY | phone (required) | Mobile number on Satispay | Mobile number | The number on your Satispay | changed | packages/trade/src/payFields.ts:163 | Shorter |
| w13-30 | SATISPAY | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:163 | Same wording as every method |
| w13-31 | TIKKIE | paymentLink (required) | Tikkie payment link | Payment link | Make a Tikkie for this amount and paste the link | changed | packages/trade/src/payFields.ts:167 | Title names Tikkie; hint says how to get one |
| w13-31 | TIKKIE | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:167 | Same wording as every method |
| w13-32 | STRIKE | username (one of reach) | Strike username | Strike username | — | kept | packages/trade/src/payFields.ts:171 | Clear; already the term this method uses |
| w13-32 | STRIKE | lightningAddress (one of reach) | Lightning address | Lightning address | Like you@strike.me | kept | packages/trade/src/payFields.ts:171 | Example shows the shape |
| w13-33 | CASH_APP | cashtag (one of reach) | $cashtag | $Cashtag | Starts with $ | changed | packages/trade/src/payFields.ts:175 | Cash App's own spelling |
| w13-33 | CASH_APP | phone (one of reach) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:175 | Clear; already the term this method uses |
| w13-33 | CASH_APP | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:175 | Clear; already the term this method uses |
| w13-34 | VENMO | username (one of reach) | Venmo username | Venmo username | Your @name in Venmo | kept | packages/trade/src/payFields.ts:179 | Clear |
| w13-34 | VENMO | phone (one of reach) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:179 | Clear; already the term this method uses |
| w13-34 | VENMO | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:179 | Clear; already the term this method uses |
| w13-34 | VENMO | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:179 | Same wording as every method |
| w13-35 | PAYPAL | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:183 | Clear; already the term this method uses |
| w13-35 | PAYPAL | phone (one of reach) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:183 | Clear; already the term this method uses |
| w13-35 | PAYPAL | username (one of reach) | PayPal username | PayPal username | — | kept | packages/trade/src/payFields.ts:183 | Clear; already the term this method uses |
| w13-35 | PAYPAL | link (one of reach) | PayPal.Me link | PayPal.Me link | Like paypal.me/yourname | kept | packages/trade/src/payFields.ts:183 | Example shows the shape |
| w13-35 | PAYPAL | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:183 | Same wording as every method |
| w13-36 | BLIK | phone (required) | Polish mobile number | Mobile number | The number linked to BLIK in your bank app | changed | packages/trade/src/payFields.ts:187 | Shorter; country implied by BLIK |
| w13-36 | BLIK | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:187 | Same wording as every method |
| w13-37 | VIPPS_MOBILEPAY | phone (required) | Vipps / MobilePay mobile number | Mobile number | — | changed | packages/trade/src/payFields.ts:191 | Title names Vipps MobilePay |
| w13-37 | VIPPS_MOBILEPAY | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:191 | Same wording as every method |
| w13-38 | TWINT | phone (required) | TWINT mobile number | Mobile number | — | changed | packages/trade/src/payFields.ts:195 | Title names TWINT |
| w13-38 | TWINT | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:195 | Same wording as every method |
| w13-39 | PAPARA | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:199 | Same wording as every method |
| w13-39 | PAPARA | paparaNo (one of reach) | Papara number | Papara number | 10 digits, in the Papara app | kept | packages/trade/src/payFields.ts:199 | Papara's own term |
| w13-39 | PAPARA | phone (one of reach) | Turkish mobile number | Mobile number | — | changed | packages/trade/src/payFields.ts:199 | Country implied by Papara |
| w13-39 | PAPARA | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:199 | Clear; already the term this method uses |
| w13-39 | PAPARA | iban (one of reach) | IBAN | IBAN | Starts with TR | kept | packages/trade/src/payFields.ts:199 | Clear |
| w13-40 | WERO | phone (one of reach) | Mobile number registered for Wero | Mobile number | The one set up for Wero | changed | packages/trade/src/payFields.ts:203 | Shorter |
| w13-40 | WERO | email (one of reach) | Email registered for Wero | Email | The one set up for Wero | changed | packages/trade/src/payFields.ts:203 | Shorter |
| w13-40 | WERO | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:203 | Same wording as every method |
| w13-41 | MB_WAY | phone (required) | Portuguese mobile number | Mobile number | The number MB WAY is on | changed | packages/trade/src/payFields.ts:207 | Shorter; country implied |
| w13-41 | MB_WAY | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:207 | Same wording as every method |
| w13-42 | PAYPAY | phone (one of reach) | Japanese mobile number | Mobile number | — | changed | packages/trade/src/payFields.ts:211 | Country implied by PayPay |
| w13-42 | PAYPAY | paypayId (one of reach) | PayPay ID | PayPay ID | — | kept | packages/trade/src/payFields.ts:211 | Clear; already the term this method uses |
| w13-42 | PAYPAY | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:211 | Same wording as every method |
| w13-43 | YOOMONEY | walletNumber (one of reach) | YooMoney wallet number | Wallet number | In the YooMoney app | changed | packages/trade/src/payFields.ts:215 | Title names YooMoney. Method itself is Part B Q4 (OWNER) |
| w13-43 | YOOMONEY | phone (one of reach) | Phone number linked to the wallet | Phone number | Linked to your wallet | changed | packages/trade/src/payFields.ts:215 | Shorter |
| w13-43 | YOOMONEY | email (one of reach) | Email linked to the wallet | Email | Linked to your wallet | changed | packages/trade/src/payFields.ts:215 | Shorter |
| w13-44 | KASPI | phone (required) | Kaspi phone number | Phone number | The number your Kaspi is on | changed | packages/trade/src/payFields.ts:219 | Title names Kaspi |
| w13-44 | KASPI | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:219 | Same wording as every method |
| w13-45 | SKRILL | email (one of reach) | Email on the Skrill account | Email | — | changed | packages/trade/src/payFields.ts:223 | Title names Skrill |
| w13-45 | SKRILL | phone (one of reach) | Phone number on the Skrill account | Phone number | — | changed | packages/trade/src/payFields.ts:223 | Title names Skrill |
| w13-45 | SKRILL | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:223 | Same wording as every method |
| w13-46 | NETELLER | email (required) | Neteller email | Email | — | changed | packages/trade/src/payFields.ts:227 | Title names Neteller |
| w13-46 | NETELLER | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:227 | Same wording as every method |
| w13-47 | APPLE_CASH | phone (one of reach) | US phone number | Phone number | — | changed | packages/trade/src/payFields.ts:231 | Apple says "phone number or email" |
| w13-47 | APPLE_CASH | email (one of reach) | Apple Account email | Apple Account email | — | kept | packages/trade/src/payFields.ts:231 | Clear; already the term this method uses |
| w13-47 | APPLE_CASH | name (optional) | Name | Name on the account | — | changed | packages/trade/src/payFields.ts:231 | Same as other methods |
| w13-48 | CHIME | chimesign (one of reach) | $ChimeSign | $ChimeSign | Starts with $ | kept | packages/trade/src/payFields.ts:235 | Chime's own term |
| w13-48 | CHIME | phone (one of reach) | US phone number | Phone number | — | changed | packages/trade/src/payFields.ts:235 | Country implied by Chime |
| w13-48 | CHIME | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:235 | Clear; already the term this method uses |
| w13-48 | CHIME | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:235 | Same wording as every method |
| w13-49 | PAYSEND | name (required) | Full name (Latin letters) | Full name | In Latin letters, as on your card or account | changed | packages/trade/src/payFields.ts:239 | Bracket moves to the hint |
| w13-49 | PAYSEND | cardNumber (one of reach) | Card number | Card number | The card you get paid to | kept | packages/trade/src/payFields.ts:239 | Clear |
| w13-49 | PAYSEND | iban (one of reach) | IBAN or account number | IBAN or account number | — | kept | packages/trade/src/payFields.ts:239 | Clear; already the term this method uses |
| w13-49 | PAYSEND | bic (optional) | SWIFT/BIC | BIC | Also called SWIFT code | changed | packages/trade/src/payFields.ts:239 | One term across methods; the other name goes in the hint |
| w13-49 | PAYSEND | wallet (one of reach) | Mobile wallet number | Mobile wallet number | — | kept | packages/trade/src/payFields.ts:239 | Clear; already the term this method uses |
| w13-50 | MTN_MOMO | phone (required) | MTN MoMo number | MoMo number | — | changed | packages/trade/src/payFields.ts:243 | What MTN users call it |
| w13-50 | MTN_MOMO | name (required) | Registered name | Name on the account | As MoMo shows it to the payer | changed | packages/trade/src/payFields.ts:243 | Same as other methods; still required |
| w13-51 | MIXX_BY_YAS | phone (required) | Mixx by Yas mobile number | Mobile number | — | changed | packages/trade/src/payFields.ts:247 | Title names Mixx by Yas |
| w13-51 | MIXX_BY_YAS | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:247 | Same wording as every method |
| w13-52 | CHIPPER_CASH | chipperTag (required) | Chipper Tag | Chipper Tag | Your @tag in Chipper | kept | packages/trade/src/payFields.ts:251 | Chipper's own term |
| w13-52 | CHIPPER_CASH | phone (optional) | Phone number on the account | Phone number | — | changed | packages/trade/src/payFields.ts:251 | Shorter |
| w13-52 | CHIPPER_CASH | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:251 | Same wording as every method |
| w13-53 | EASYPAISA | phone (required) | Easypaisa mobile account number | Mobile number | This is your Easypaisa account number | changed | packages/trade/src/payFields.ts:255 | Shorter; Easypaisa accounts are the mobile number |
| w13-53 | EASYPAISA | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:255 | Same wording as every method |
| w13-54 | AIRTM | email (one of reach) | Email registered with Airtm | Email | The one on your Airtm account | changed | packages/trade/src/payFields.ts:259 | Shorter |
| w13-54 | AIRTM | username (one of reach) | Airtm username | Airtm username | — | kept | packages/trade/src/payFields.ts:259 | Clear; already the term this method uses |
| w13-54 | AIRTM | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:259 | Same wording as every method |
| w13-55 | ASTROPAY | phone (one of reach) | Phone number on AstroPay | Phone number | — | changed | packages/trade/src/payFields.ts:263 | Shorter |
| w13-55 | ASTROPAY | astroTag (one of reach) | AstroTag | AstroTag | — | kept | packages/trade/src/payFields.ts:263 | Clear; already the term this method uses |
| w13-55 | ASTROPAY | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:263 | Same wording as every method |
| w13-56 | LYDIA | phone (one of reach) | Mobile number | Mobile number | — | kept | packages/trade/src/payFields.ts:267 | Clear; already the term this method uses |
| w13-56 | LYDIA | email (one of reach) | Email | Email | — | kept | packages/trade/src/payFields.ts:267 | Clear; already the term this method uses |
| w13-56 | LYDIA | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:267 | Same wording as every method |
| w13-57 | POSTEPAY | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:271 | Same wording as every method |
| w13-57 | POSTEPAY | phone (one of reach) | Mobile number (Postepay P2P) | Mobile number | — | changed | packages/trade/src/payFields.ts:271 | Bracket dropped; P2P is implied |
| w13-57 | POSTEPAY | iban (one of reach) | IBAN (Postepay Evolution) | IBAN | Postepay Evolution cards have one | changed | packages/trade/src/payFields.ts:271 | Bracket moves to the hint |
| w13-57 | POSTEPAY | cardNumber (one of reach) | Postepay card number | Card number | 16 digits on the front | changed | packages/trade/src/payFields.ts:271 | Title names Postepay |
| w13-58 | PAYONEER | email (required) | Payoneer email | Email | — | changed | packages/trade/src/payFields.ts:275 | Title names Payoneer |
| w13-58 | PAYONEER | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:275 | Same wording as every method |
| w13-59 | ZEN | phone (one of reach) | Phone number on ZEN | Phone number | — | changed | packages/trade/src/payFields.ts:279 | Shorter |
| w13-59 | ZEN | iban (one of reach) | ZEN account IBAN | IBAN | — | changed | packages/trade/src/payFields.ts:279 | Shorter |
| w13-59 | ZEN | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:279 | Same wording as every method |
| w13-60 | AFRIEX | username (one of reach) | Afriex $username | Afriex username | Starts with $ | changed | packages/trade/src/payFields.ts:283 | Plainer; $ moves to the hint |
| w13-60 | AFRIEX | phone (one of reach) | Phone number on Afriex | Phone number | — | changed | packages/trade/src/payFields.ts:283 | Shorter |
| w13-60 | AFRIEX | name (optional) | Full name | Name on the account | — | changed | packages/trade/src/payFields.ts:283 | Same as other methods |
| w13-61 | REMITLY | name (required) | Full legal name (as on ID / account) | Full name | As on your ID | changed | packages/trade/src/payFields.ts:287 | Bracket moves to the hint |
| w13-61 | REMITLY | bankDetails (one of delivery) | Bank details for your country | Bank details | As banks in your country use them | changed | packages/trade/src/payFields.ts:287 | Shorter |
| w13-61 | REMITLY | mobileWallet (one of delivery) | Mobile wallet number and provider | Mobile wallet | Number and provider, like M-PESA 0712 345 678 | changed | packages/trade/src/payFields.ts:287 | Shorter; example in the hint |
| w13-61 | REMITLY | cashPickup (one of delivery) | Cash pickup city or agent | Cash pickup | City or agent | changed | packages/trade/src/payFields.ts:287 | Shorter |
| w13-61 | REMITLY | phone (optional) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:287 | Clear; already the term this method uses |
| w13-61 | REMITLY | address (optional) | Address | Address | — | kept | packages/trade/src/payFields.ts:287 | Clear; already the term this method uses |
| w13-62 | WORLDREMIT | name (required) | Full name (as on ID / account) | Full name | As on your ID | changed | packages/trade/src/payFields.ts:291 | Bracket moves to the hint |
| w13-62 | WORLDREMIT | phone (required) | Mobile number | Mobile number | — | kept | packages/trade/src/payFields.ts:291 | Clear; already the term this method uses |
| w13-62 | WORLDREMIT | bankDetails (one of delivery) | Bank details for your country | Bank details | As banks in your country use them | changed | packages/trade/src/payFields.ts:291 | Shorter |
| w13-62 | WORLDREMIT | mobileWallet (one of delivery) | Mobile money number and provider | Mobile money | Number and provider | changed | packages/trade/src/payFields.ts:291 | Shorter |
| w13-62 | WORLDREMIT | cashPickup (one of delivery) | Cash pickup city | Cash pickup city | — | kept | packages/trade/src/payFields.ts:291 | Clear; already the term this method uses |
| w13-62 | WORLDREMIT | email (optional) | Email | Email | — | kept | packages/trade/src/payFields.ts:291 | Clear; already the term this method uses |
| w13-63 | XOOM | name (required) | Full name (as on bank account / ID) | Full name | As on your ID or bank account | changed | packages/trade/src/payFields.ts:295 | Bracket moves to the hint |
| w13-63 | XOOM | bankDetails (one of delivery) | Bank name and account number / IBAN | Bank details | Bank name and account number or IBAN | changed | packages/trade/src/payFields.ts:295 | Slash list moves to the hint |
| w13-63 | XOOM | mobileWallet (one of delivery) | Mobile wallet number | Mobile wallet number | — | kept | packages/trade/src/payFields.ts:295 | Clear; already the term this method uses |
| w13-63 | XOOM | cashPickup (one of delivery) | Cash pickup city | Cash pickup city | — | kept | packages/trade/src/payFields.ts:295 | Clear; already the term this method uses |
| w13-63 | XOOM | phone (optional) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:295 | Clear; already the term this method uses |
| w13-63 | XOOM | address (optional) | Address | Address | — | kept | packages/trade/src/payFields.ts:295 | Clear; already the term this method uses |
| w13-64 | SEPA | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:300 | Same wording as every method |
| w13-64 | SEPA | iban (required) | IBAN | IBAN | — | kept | packages/trade/src/payFields.ts:300 | Clear; already the term this method uses |
| w13-64 | SEPA | bic (optional) | BIC | BIC | — | kept | packages/trade/src/payFields.ts:300 | Clear; already the term this method uses |
| w13-64 | SEPA | address (optional) | Payee address | Address | Only if the payer's bank asks for it | changed | packages/trade/src/payFields.ts:300 | "Payee" is jargon |
| w13-65 | SEPA_INSTANT | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:304 | Same wording as every method |
| w13-65 | SEPA_INSTANT | iban (required) | IBAN | IBAN | — | kept | packages/trade/src/payFields.ts:304 | Clear; already the term this method uses |
| w13-65 | SEPA_INSTANT | bic (optional) | BIC | BIC | — | kept | packages/trade/src/payFields.ts:304 | Clear; already the term this method uses |
| w13-65 | SEPA_INSTANT | address (optional) | Payee address | Address | Only if the payer's bank asks for it | changed | packages/trade/src/payFields.ts:304 | "Payee" is jargon |
| w13-66 | SPEI | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:308 | Same wording as every method |
| w13-66 | SPEI | clabe (required) | CLABE (18 digits) | CLABE | 18 digits | changed | packages/trade/src/payFields.ts:308 | Mexican apps say CLABE; length moves to the hint |
| w13-66 | SPEI | bankName (optional) | Bank | Bank name | — | changed | packages/trade/src/payFields.ts:308 | Same as other methods |
| w13-67 | FASTER_PAYMENTS | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:312 | Same wording as every method |
| w13-67 | FASTER_PAYMENTS | sortCode (required) | Sort code | Sort code | 6 digits, like 04-00-04 | kept | packages/trade/src/payFields.ts:312 | UK term |
| w13-67 | FASTER_PAYMENTS | account (required) | Account number | Account number | 8 digits | kept | packages/trade/src/payFields.ts:312 | Clear |
| w13-67 | FASTER_PAYMENTS | reference (optional) | Payment reference to use | Reference | Only if you want one on the payment | changed | packages/trade/src/payFields.ts:312 | UK apps say "reference" |
| w13-68 | NATIONAL_BANK | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:316 | Same wording as every method |
| w13-68 | NATIONAL_BANK | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:316 | Clear; already the term this method uses |
| w13-68 | NATIONAL_BANK | bankCode (optional) | Bank code / institution number | Bank code | Like an institution number, if your country uses one | changed | packages/trade/src/payFields.ts:316 | Slash list moves to the hint (N2: per-currency terms) |
| w13-68 | NATIONAL_BANK | branchCode (optional) | Branch code (sort code, routing, BSB, transit, agency) | Branch code | Like a sort code, BSB, routing or transit number | changed | packages/trade/src/payFields.ts:316 | Long bracket moves to the hint (N2) |
| w13-68 | NATIONAL_BANK | account (required) | Account number (or IBAN / CLABE) | Account number | Or IBAN or CLABE, if your bank uses one | changed | packages/trade/src/payFields.ts:316 | Bracket moves to the hint (N2) |
| w13-68 | NATIONAL_BANK | accountType (optional) | Account type | Account type | Like checking or savings | kept | packages/trade/src/payFields.ts:316 | Clear |
| w13-69 | JAPAN_BANK | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:320 | Clear; already the term this method uses |
| w13-69 | JAPAN_BANK | bankCode (optional) | Bank code | Bank code | 4 digits | kept | packages/trade/src/payFields.ts:320 | Clear |
| w13-69 | JAPAN_BANK | branch (required) | Branch name or number | Branch | Name or 3-digit number | changed | packages/trade/src/payFields.ts:320 | Shorter |
| w13-69 | JAPAN_BANK | accountType (required) | Account type (futsu or toza) | Account type (futsu or toza) | Futsu (ordinary) or toza (current) | kept | packages/trade/src/payFields.ts:320 | Bracket moves to the hint |
| w13-69 | JAPAN_BANK | account (required) | Account number | Account number | 7 digits | kept | packages/trade/src/payFields.ts:320 | Clear |
| w13-69 | JAPAN_BANK | name (required) | Account holder name (katakana) | Account holder name | In katakana, as the bank shows it | changed | packages/trade/src/payFields.ts:320 | Japanese apps ask 口座名義（カナ）; katakana moves to the hint |
| w13-70 | AUSTRALIA_PAYID | payId (required) | PayID (phone, email, ABN or organisation ID) | PayID | Your mobile number, email or ABN | changed | packages/trade/src/payFields.ts:324 | Australian apps say PayID; list moves to the hint |
| w13-70 | AUSTRALIA_PAYID | name (required) | Name shown for the PayID | PayID name | The name the payer's bank shows | changed | packages/trade/src/payFields.ts:324 | Shorter |
| w13-71 | SAME_BANK | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:328 | Same wording as every method |
| w13-71 | SAME_BANK | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:328 | Clear; already the term this method uses |
| w13-71 | SAME_BANK | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:328 | Clear; already the term this method uses |
| w13-71 | SAME_BANK | branchCode (optional) | Branch code | Branch code | Only if your bank needs it | kept | packages/trade/src/payFields.ts:328 | Clear |
| w13-71 | SAME_BANK | accountType (optional) | Account type | Account type | — | kept | packages/trade/src/payFields.ts:328 | Clear; already the term this method uses |
| w13-72 | SPECIFIC_BANKS | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:332 | Same wording as every method |
| w13-72 | SPECIFIC_BANKS | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:332 | Clear; already the term this method uses |
| w13-72 | SPECIFIC_BANKS | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:332 | Clear; already the term this method uses |
| w13-72 | SPECIFIC_BANKS | branchCode (optional) | Branch code (sort code, routing, BSB, transit, agency) | Branch code | Like a sort code, BSB, routing or transit number | changed | packages/trade/src/payFields.ts:332 | Long bracket moves to the hint (N2) |
| w13-72 | SPECIFIC_BANKS | bankCode (optional) | Bank code | Bank code | — | kept | packages/trade/src/payFields.ts:332 | Clear; already the term this method uses |
| w13-72 | SPECIFIC_BANKS | accountType (optional) | Account type | Account type | — | kept | packages/trade/src/payFields.ts:332 | Clear; already the term this method uses |
| w13-73 | INTERAC_E_TRANSFER | name (required) | Full name | Full name | — | kept | packages/trade/src/payFields.ts:336 | Clear; already the term this method uses |
| w13-73 | INTERAC_E_TRANSFER | email (one of contact) | Email | Email | — | kept | packages/trade/src/payFields.ts:336 | Clear; already the term this method uses |
| w13-73 | INTERAC_E_TRANSFER | phone (one of contact) | Mobile number | Mobile number | — | kept | packages/trade/src/payFields.ts:336 | Clear; already the term this method uses |
| w13-74 | PROMPT_PAY | promptPayId (required) | PromptPay ID (mobile number or e-wallet ID) | PromptPay ID | Your mobile number or e-Wallet ID | changed | packages/trade/src/payFields.ts:340 | Thai apps say PromptPay; list moves to the hint (no national ID, per the lead's ID rule) |
| w13-74 | PROMPT_PAY | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:340 | Same wording as every method |
| w13-75 | NEFT | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:344 | Same wording as every method |
| w13-75 | NEFT | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:344 | Clear; already the term this method uses |
| w13-75 | NEFT | ifsc (required) | IFSC | IFSC | 11 characters, like SBIN0001234 | kept | packages/trade/src/payFields.ts:344 | Indian term |
| w13-75 | NEFT | bankName (optional) | Bank and branch name | Bank and branch name | — | kept | packages/trade/src/payFields.ts:344 | Clear; already the term this method uses |
| w13-76 | RTGS | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:348 | Same wording as every method |
| w13-76 | RTGS | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:348 | Clear; already the term this method uses |
| w13-76 | RTGS | ifsc (required) | IFSC | IFSC | 11 characters, like SBIN0001234 | kept | packages/trade/src/payFields.ts:348 | Indian term |
| w13-76 | RTGS | bankName (optional) | Bank and branch name | Bank and branch name | — | kept | packages/trade/src/payFields.ts:348 | Clear; already the term this method uses |
| w13-77 | IMPS | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:352 | Same wording as every method |
| w13-77 | IMPS | accountIfsc (one of reach) | Account number and IFSC | Account number and IFSC | Like 12345678901, SBIN0001234 | kept | packages/trade/src/payFields.ts:352 | Indian terms |
| w13-77 | IMPS | phone (one of reach) | Mobile number linked to the account | Mobile number | Linked to your bank account | changed | packages/trade/src/payFields.ts:352 | Shorter |
| w13-77 | IMPS | mmid (optional) | MMID | MMID | 7 digits from your bank. Only if you have one | kept | packages/trade/src/payFields.ts:352 | Part B Q1: optional; mobile number plus bank name is enough |
| w13-77 | IMPS | bankName (optional) | Bank name | Bank name | — | kept (rule change) | packages/trade/src/payFields.ts:352 | Part B Q1: make it required (need yes), so the mobile route works without MMID |
| w13-78 | UPI | upiId (one of reach) | UPI ID | UPI ID | Like name@okhdfcbank | kept | packages/trade/src/payFields.ts:356 | Indian term |
| w13-78 | UPI | phone (one of reach) | Mobile number registered with UPI | Mobile number | Linked to your UPI | changed | packages/trade/src/payFields.ts:356 | Shorter |
| w13-78 | UPI | accountIfsc (one of reach) | Account number and IFSC | Account number and IFSC | Like 12345678901, SBIN0001234 | kept | packages/trade/src/payFields.ts:356 | Indian terms |
| w13-78 | UPI | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:356 | Same wording as every method |
| w13-79 | PIX | pixKey (required) | Pix key (phone, email, CPF/CNPJ or random key) | Pix key | Phone, email, CPF/CNPJ or random key | changed | packages/trade/src/payFields.ts:360 | Brazilian apps say "chave Pix"; list moves to the hint |
| w13-79 | PIX | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:360 | Same wording as every method |
| w13-80 | SWIFT | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:364 | Same wording as every method |
| w13-80 | SWIFT | account (required) | IBAN or account number | IBAN or account number | — | kept | packages/trade/src/payFields.ts:364 | Clear |
| w13-80 | SWIFT | bic (required) | BIC (SWIFT code) | SWIFT code | 8 or 11 characters, also called BIC | changed | packages/trade/src/payFields.ts:364 | For international wires banks say SWIFT code |
| w13-80 | SWIFT | address (required) | Beneficiary address | Address | Your address, as your bank has it | changed | packages/trade/src/payFields.ts:364 | "Beneficiary" is jargon |
| w13-80 | SWIFT | bankName (optional) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:364 | Clear; already the term this method uses |
| w13-80 | SWIFT | localCode (optional) | Local bank code (if your country uses one) | Local bank code | Only if your country uses one, like a routing number or IFSC | changed | packages/trade/src/payFields.ts:364 | Bracket moves to the hint |
| w13-81 | ACH_TRANSFER | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:368 | Same wording as every method |
| w13-81 | ACH_TRANSFER | routing (required) | Routing number (ABA) | Routing number | 9 digits | changed | packages/trade/src/payFields.ts:368 | US apps say routing number; (ABA) is jargon |
| w13-81 | ACH_TRANSFER | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:368 | Clear; already the term this method uses |
| w13-81 | ACH_TRANSFER | accountType (required) | Account type (checking or savings) | Account type | Checking or savings | changed | packages/trade/src/payFields.ts:368 | Bracket moves to the hint |
| w13-81 | ACH_TRANSFER | bankName (optional) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:368 | Clear; already the term this method uses |
| w13-82 | DOMESTIC_WIRE_TRANSFER | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:372 | Same wording as every method |
| w13-82 | DOMESTIC_WIRE_TRANSFER | address (required) | Beneficiary address | Address | Your address, as your bank has it | changed | packages/trade/src/payFields.ts:372 | "Beneficiary" is jargon |
| w13-82 | DOMESTIC_WIRE_TRANSFER | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:372 | Clear; already the term this method uses |
| w13-82 | DOMESTIC_WIRE_TRANSFER | routing (required) | Wire routing number (ABA) | Wire routing number | 9 digits. It can differ from your ACH number | changed | packages/trade/src/payFields.ts:372 | US term; (ABA) is jargon |
| w13-82 | DOMESTIC_WIRE_TRANSFER | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:372 | Clear; already the term this method uses |
| w13-83 | NIP | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:376 | Clear; already the term this method uses |
| w13-83 | NIP | account (required) | Account number (NUBAN) | Account number | 10 digits | changed | packages/trade/src/payFields.ts:376 | Nigerian apps say account number; NUBAN is the format, moved to the hint |
| w13-83 | NIP | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:376 | Same wording as every method |
| w13-84 | PAGO_MOVIL | phone (required) | Mobile number affiliated to Pago Móvil | Mobile number | The one signed up for Pago Móvil | changed | packages/trade/src/payFields.ts:380 | Shorter |
| w13-84 | PAGO_MOVIL | idNumber (required) | Cédula or RIF | Cédula or RIF | As registered for Pago Móvil | kept | packages/trade/src/payFields.ts:380 | Venezuelan terms |
| w13-84 | PAGO_MOVIL | bank (required) | Bank (name or 4-digit code) | Bank (name or 4-digit code) | Name or 4-digit code, like 0102 | kept | packages/trade/src/payFields.ts:380 | Bracket moves to the hint |
| w13-84 | PAGO_MOVIL | name (optional) | Full name | Name on the account | — | changed | packages/trade/src/payFields.ts:380 | Same as other methods |
| w13-85 | QRIS | qris (required) | QR code text | QRIS code text | Read your QRIS with a QR scanner and paste the text | changed | packages/trade/src/payFields.ts:384 | Names the thing; hint says how |
| w13-85 | QRIS | name (optional) | Name shown on the QRIS | Name on the QRIS | — | changed | packages/trade/src/payFields.ts:384 | Shorter |
| w13-85 | QRIS | provider (optional) | Bank or e-wallet | Bank or e-wallet | — | kept | packages/trade/src/payFields.ts:384 | Clear; already the term this method uses |
| w13-86 | RAAST | raastId (one of reach) | Raast ID (mobile number) | Raast ID | Your mobile number | changed | packages/trade/src/payFields.ts:388 | Pakistani apps say Raast ID; bracket moves to the hint |
| w13-86 | RAAST | iban (one of reach) | IBAN | IBAN | Starts with PK | kept | packages/trade/src/payFields.ts:388 | Clear |
| w13-86 | RAAST | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:388 | Same wording as every method |
| w13-87 | PAYNOW | phone (one of reach) | Mobile number registered for PayNow | Mobile number | The one registered for PayNow | changed | packages/trade/src/payFields.ts:392 | Shorter |
| w13-87 | PAYNOW | uen (one of reach) | UEN (businesses) | UEN | For businesses | changed | packages/trade/src/payFields.ts:392 | Bracket moves to the hint |
| w13-87 | PAYNOW | vpa (one of reach) | PayNow VPA | PayNow VPA | Your PayNow virtual address | kept | packages/trade/src/payFields.ts:392 | Clear |
| w13-87 | PAYNOW | name (optional) | Name shown on PayNow | Name shown on PayNow | — | kept | packages/trade/src/payFields.ts:392 | Clear; already the term this method uses |
| w13-88 | FPS | phone (one of reach) | Mobile number registered for FPS | Mobile number | The one registered for FPS | changed | packages/trade/src/payFields.ts:396 | Shorter |
| w13-88 | FPS | email (one of reach) | Email registered for FPS | Email | The one registered for FPS | changed | packages/trade/src/payFields.ts:396 | Shorter |
| w13-88 | FPS | fpsId (one of reach) | FPS ID | FPS ID | In your bank app | kept | packages/trade/src/payFields.ts:396 | Hong Kong term |
| w13-88 | FPS | account (one of reach) | Bank code and account number | Bank code and account number | Like 004 123-456789-001 | kept | packages/trade/src/payFields.ts:396 | Clear |
| w13-88 | FPS | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:396 | Same wording as every method |
| w13-89 | DUITNOW | duitnowId (one of reach) | DuitNow ID (mobile number or business registration number) | DuitNow ID | Your mobile number, or a business registration number | changed | packages/trade/src/payFields.ts:400 | Malaysian term; long bracket moves to the hint |
| w13-89 | DUITNOW | accountBank (one of reach) | Account number and bank | Account number and bank | — | kept | packages/trade/src/payFields.ts:400 | Clear; already the term this method uses |
| w13-89 | DUITNOW | name (optional) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:400 | Same wording as every method |
| w13-90 | SBP | phone (required) | Phone number linked to SBP | Phone number | Linked to SBP | changed | packages/trade/src/payFields.ts:404 | Shorter. Method itself is Part B Q4 (OWNER) |
| w13-90 | SBP | bankName (required) | Bank to receive in | Bank | The bank you want to be paid in | changed | packages/trade/src/payFields.ts:404 | Shorter |
| w13-90 | SBP | name (optional) | Name (as the bank shows it) | Name on the account | As your bank shows it | changed | packages/trade/src/payFields.ts:404 | Same as other methods |
| w13-91 | MIR | cardNumber (required) | Mir card number | Card number | 16 digits | changed | packages/trade/src/payFields.ts:408 | Title names Mir. Method itself is Part B Q4 (OWNER) |
| w13-91 | MIR | name (optional) | Cardholder name | Cardholder name | — | kept | packages/trade/src/payFields.ts:408 | Clear; already the term this method uses |
| w13-91 | MIR | bankName (optional) | Issuing bank | Bank | — | changed | packages/trade/src/payFields.ts:408 | Shorter |
| w13-92 | UKRAINE_CARD | cardNumber (one of reach) | Card number (16 digits) | Card number | 16 digits | changed | packages/trade/src/payFields.ts:412 | Length moves to the hint |
| w13-92 | UKRAINE_CARD | iban (one of reach) | IBAN (UA..., 29 characters) | IBAN | Starts with UA, 29 characters | changed | packages/trade/src/payFields.ts:412 | Bracket moves to the hint |
| w13-92 | UKRAINE_CARD | phone (one of reach) | Phone number linked to the card | Phone number | Linked to your card | changed | packages/trade/src/payFields.ts:412 | Shorter |
| w13-92 | UKRAINE_CARD | name (optional) | Name on the card or account | Name on the card or account | — | kept | packages/trade/src/payFields.ts:412 | Clear; already the term this method uses |
| w13-93 | US_POSTAL_MONEY_ORDER | name (required) | Full name (Pay to) | Full name | Goes on the "Pay to" line | changed | packages/trade/src/payFields.ts:417 | Bracket moves to the hint |
| w13-93 | US_POSTAL_MONEY_ORDER | address (required) | Mailing address | Mailing address | — | kept | packages/trade/src/payFields.ts:417 | Clear; already the term this method uses |
| w13-94 | CASH_DEPOSIT | name (required) | Name on the account | Name on the account | — | kept | packages/trade/src/payFields.ts:421 | Same wording as every method |
| w13-94 | CASH_DEPOSIT | bankName (required) | Bank name | Bank name | — | kept | packages/trade/src/payFields.ts:421 | Clear; already the term this method uses |
| w13-94 | CASH_DEPOSIT | account (required) | Account number | Account number | — | kept | packages/trade/src/payFields.ts:421 | Clear; already the term this method uses |
| w13-94 | CASH_DEPOSIT | branchCode (optional) | Branch / routing code (if your bank needs it) | Branch code | Only if your bank needs it, like a routing or sort code | changed | packages/trade/src/payFields.ts:421 | Bracket moves to the hint |
| w13-95 | MONEY_GRAM | fullName (required) | Full name as on your ID | Full name | Exactly as on your ID | changed | packages/trade/src/payFields.ts:425 | Shorter; the ID point stays in the hint |
| w13-95 | MONEY_GRAM | country (required) | Country | Country | — | kept | packages/trade/src/payFields.ts:425 | Clear; already the term this method uses |
| w13-95 | MONEY_GRAM | city (optional) | City and state/province | City | And state or province | changed | packages/trade/src/payFields.ts:425 | Shorter |
| w13-95 | MONEY_GRAM | phone (optional) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:425 | Clear; already the term this method uses |
| w13-96 | WESTERN_UNION | fullName (required) | Full name as on your ID | Full name | Exactly as on your ID | changed | packages/trade/src/payFields.ts:429 | Shorter; the ID point stays in the hint |
| w13-96 | WESTERN_UNION | country (required) | Country | Country | — | kept | packages/trade/src/payFields.ts:429 | Clear; already the term this method uses |
| w13-96 | WESTERN_UNION | city (optional) | City and state/province | City | And state or province | changed | packages/trade/src/payFields.ts:429 | Shorter |
| w13-96 | WESTERN_UNION | phone (optional) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:429 | Clear; already the term this method uses |
| w13-97 | HAL_CASH | phone (required) | Mobile number to receive the HalCash SMS | Mobile number | Your HalCash code comes here by SMS | changed | packages/trade/src/payFields.ts:433 | Shorter; the SMS point moves to the hint |
| w13-98 | PAY_BY_MAIL | name (required) | Full name | Full name | — | kept | packages/trade/src/payFields.ts:438 | Clear; already the term this method uses |
| w13-98 | PAY_BY_MAIL | address (required) | Mailing address | Mailing address | — | kept | packages/trade/src/payFields.ts:438 | Clear; already the term this method uses |
| w13-99 | RIA | fullName (required) | Full name as on your ID | Full name | Exactly as on your ID | changed | packages/trade/src/payFields.ts:443 | Shorter; the ID point stays in the hint |
| w13-99 | RIA | country (required) | Country | Country | — | kept | packages/trade/src/payFields.ts:443 | Clear; already the term this method uses |
| w13-99 | RIA | city (optional) | City and state/province | City | And state or province | changed | packages/trade/src/payFields.ts:443 | Shorter |
| w13-99 | RIA | phone (optional) | Phone number | Phone number | — | kept | packages/trade/src/payFields.ts:443 | Clear; already the term this method uses |
| w13-100 | AMAZON_GIFT_CARD | email (optional) | Email to deliver the eGift card to | Email | Where Amazon sends the eGift card | changed | packages/trade/src/payFields.ts:448 | Shorter |
| w13-101 | CUSTOM | details (required) | Payment details | Payment details | Everything {buyer} needs to pay you | kept | packages/trade/src/payFields.ts:485 | Clear |

## Part B: design's answers to the lead's five questions (10 Nov)

### Q1. IMPS: is the MMID required when paying by phone? Design: a fourth option. Keep the phone route, keep the MMID optional, and make **Bank name** required. SIGNED.

- **Facts.** NPCI's circular of 31 Oct 2023 added "Mobile Number + Bank Name" IMPS. Member banks had to support it on all IMPS channels by 31 Jan 2024, and it went live around 1 Feb 2024. The bank name maps to the payee bank's default MMID behind the scenes, so the payer does not need the payee's MMID. The older routes, account number and IFSC, or mobile number and MMID, still work. Sources: [TeamLease RegTech summary of the NPCI notice](https://www.teamleaseregtech.com/updates/article/27713/npci-issued-a-notification-regarding-the-enablement-of-simplified-imps/), [Business Standard](https://www.business-standard.com/finance/news/here-are-details-of-new-imps-money-transfer-rule-how-will-it-work-123101900272_1.html), [NPCI IMPS FAQ](https://npci.org.in/what-we-do/imps/faqs) ("MMID is a 7 digit number issued by banks"). I did not read the circular itself.
- **Why not (a).** Requiring the MMID asks for a code most people have never seen. The bank name does the same job, and payers already know it.
- **The change.**
  - In payFields.ts:352, `bankName` goes from `no(...)` to `yes('bankName', 'Bank name')`. It costs nothing on the account-and-IFSC route.
  - The MMID stays optional, with the hint "7 digits from your bank. Only if you have one."
  - The rest is in the IMPS rows above.
- **Small residual.** If a phone number is linked to several accounts, IMPS credits the primary one. That is the payee's own choice, so no copy is needed.

### Q2. The buyer's card for nothing-to-send methods. SIGNED. Exact strings follow.

Today the card shows one row, `{method} to` / `Ask in the chat` (BuyerPay.tsx:331, TradeGlance.tsx:218). Replace that row as follows. `{seller}` is the seller's name.

| method | row label | row value | own-name note (BuyerPay.tsx:323, :362) |
|---|---|---|---|
| Gift cards (every payeeGivesNothing gift card) | How to pay | Send the gift card code to {seller} here in the chat. | Replace with: "Send the code only in this chat, never by email or text." (gift-card rules, 7 Nov) |
| F2F, cash in person | How to pay | Meet {seller} and hand over the cash. Agree where and when here in the chat. | Replace with: "Meet somewhere public and count the cash together." |
| CASH_AT_ATM | How to pay | Make a cardless cash code in your bank app and send it to {seller} here in the chat. | Keep the own-name note, since the code comes from the buyer's own bank account. |

The bank-account note is dropped for gift cards and in-person cash, because no account is involved. Showing it would break the owner's "only what applies" rule.

Also, **for methods with boxes, before the seller has sent them** (same fallback row): label "{method} details", value "{seller} hasn't sent them yet. They show here once sent." This replaces "Ask in the chat", which suggests the buyer must chase. Once details arrive, the card shows the seller's rows as now. No label contains a colon.

These replace the lead's suggestions, "You send the card details here in the chat" and "Arrange the meeting or cash details in the chat". They keep the same meaning but split ATM from in-person cash and name the thing to send.

### Q3. M-PESA till and paybill. Design: **no for launch**, person-to-person phone only. SIGNED.

- Till ("Buy Goods") and Paybill are Lipa na M-PESA business accounts. They need a registered business, and a paybill also needs an account-number reference.
- X2F sellers are individuals receiving person-to-person payments.
- Adding them would show every M-PESA seller a three-way choice they don't need.
- The research row is high confidence for the person-to-person flow ([Safaricom](https://safaricom.co.ke/main-mpesa/m-pesa-services/lipa-na-m-pesa/pay-online)).
- Revisit if sellers ask for it in the demo. The labels would then be "Till number", and "Paybill number" plus "Account number".

### Q4. Russian methods (MIR, SBP, YooMoney), p11-144. **OWNER.** Design recommends removing them from the launch catalogue.

This is a sanctions-risk call, so it goes to the owner. The facts below come from research/payment-methods/REPORT.md section 6 and europe-north-east.md, and none of them is legal advice.

- **SBP.**
  - EU: the 19th package (23 Oct 2025) bars EU operators from engaging with SBP. Secondary sources say this applies from 25 Jan 2026 under Reg. (EU) 2025/2033 (Art. 5ac of Reg. 833/2014). Not yet confirmed on EUR-Lex.
  - US: the operator is the Central Bank of Russia (OFAC Directive 4, E.O. 14024). NSPK, the operational centre, has been an SDN since 23 Feb 2024.
  - UK: NSPK was designated on 15 Oct 2025.
- **MIR.** The operator NSPK is an OFAC SDN (23 Feb 2024) and UK-designated (15 Oct 2025, RUS3076). The EU 19th package bars EU operators.
- **YooMoney.**
  - US: fully blocked by OFAC on 6 Apr 2022 as a Sberbank subsidiary.
  - UK and EU: no separate listing found, but the parent Sberbank is designated.
  - The wallet's own terms forbid using it to buy, sell or exchange crypto.
- **Russian law, all three.** CBR 16-MR (2021) tells banks to detect P2P transfers made for crypto. 282-FZ, in force 1 Sep 2026, allows crypto activity only through licensed intermediaries, and crypto payments stay banned.
- **Reversal risk.** Under CBR rules, banks hold transfers to accounts in the fraud database for 2 days, and they must refund within 30 days if they failed to. Mir's reversal risk is rated high.

**Recommendation.** Remove all three at launch. Leave their payFields rows in the code, unlisted, so restoring them later is a catalogue flag. Users could still pick CUSTOM, so a lawyer should also say whether CUSTOM needs a Russia warning. Design is confident about the user-facing harm (sanctions, frozen funds, the wallet's own crypto ban). The legal exposure is the owner's and the lawyer's to judge.

### Q5. Capitual, p11-145. **OWNER**, because removing a method changes what the app offers. Design recommends removing it.

Checked 12 Nov 2026:
- [capitual.com](https://capitual.com) is live, published 21 Jan 2026. It presents only B2B services: "Soluções sob medida para instituições e organizações globais", digital-asset structuring, liquidity and consulting, for "clientes institucionais". There is no consumer account, no app links and no shutdown notice.
- The App Store listing for the old consumer app ([apps.apple.com … id1458793819](https://apps.apple.com/ai/app/capitual/id1458793819)) returned HTTP 404 from this session. That may only be the storefront, so it is weak evidence on its own.
- The last consumer-facing news found is from 2021 to 2022: a Pix and crypto digital account ([Seu Dinheiro 2021](https://www.seudinheiro.com/2021/economia/uma-conta-bancaria-que-faz-pix-e-paga-boletos-integrada-com-criptomoedas-este-servico-pode-ser-uma-revolucao-financeira-no-brasil/), [Olhar Digital 2021](https://olhardigital.com.br/2021/12/03/pro/capitual-possibilita-uma-conta-digital-bancaria-completa-e-servicos-com-criptomoedas-em-um-so-lugar/)), and the Azimut partnership ([Blockworks](https://blockworks.co/news/brazil-crypto-company-moves-into-europe)). A 2023 report covers its June 2022 break with Binance and a court freeze of about R$450 million ([Seu Dinheiro 2023](https://www.seudinheiro.com/2023/colunistas/transferi-r-5-mil-para-comprar-criptomoedas-pela-binance-mas-dinheiro-ficou-preso-julw/)).
- No source shows a Brazilian VASP authorisation for it under the BCB regime, which took effect 2 Feb 2026 with a 30 Oct 2026 deadline.

**Recommendation.** Remove it at launch, which agrees with the lead. Brazilian users have Pix, which is already in the catalogue. Re-add it only if a user shows a live consumer account. The confidence is medium to high that the retail account is gone. Only a login or the company can confirm it, hence OWNER.
