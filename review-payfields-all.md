# Review: wip/lead-payfields-all (payee fields for all 127 methods)

Reviewer: independent helper, 10 Nov 2026. Commits f70dea73, 9acf737a, eda04e8b on top of 177fa75e
(worktree .claude/worktrees/payfields-all). I did not edit any code.

## Verdict: approve with fixes

The table is a faithful build of the research plus the lead decisions. I re-ran
payfields-build/gen.py into a scratch folder: its output matches the PAY_FIELDS body and
docs/payment-fields-2026-11-10.md byte for byte. Every lead decision shows up in the right row. The
check/parse/render rules have not changed; only the lookup changed (`rowOf`, `payeeGivesNothing`). No
box asks for a password, PIN, CVV, expiry date, login or personal tax ID. Card-number boxes appear
only in MIR, UKRAINE_CARD, PAYSEND and POSTEPAY. Two things need fixing before landing: F1 (the
nothing-to-send line shows before the escrow is secured) and F2 (the QRIS box is too short for a real
QR string). F3 needs a decision from the lead.

## Findings

### F1. Medium: the nothing-to-send line shows before the escrow is secured
apps/web/src/chat/ChatPanel.tsx:302-307. The line is gated on `phase === 'ready'`, `!gone`, a `pay`
prop and `role === 'seller'`, but not on `snap.paySecured`. So a seller sees "Nothing to send: the
buyer sends the card or cash details here in the chat." while the escrow is still unsecured. The
brief asks for it never to show before the escrow is secured, and the timing matters: a seller who
reads that line early may ask the buyer for the gift-card code before the escrow is secured. PayBoxes
blocks Send until `secured`; this line has no gate at all.
Fix: add `snap.paySecured &&` to the line's condition, or show a pre-secure wording such as "...once
the escrow is secured" (the wording choice is the owner's). Add a test with
`snap({ role: 'seller', paySecured: false })` that expects no `[data-pay-nothing]`. The new test at
apps/web/test/chatPanel.test.tsx:419 only covers the secured case (the default snap has
`paySecured: true`).

### F2. Medium: the QRIS "QR code text" box is limited to 120 characters
packages/trade/src/payFields.ts:376-378 together with PAY_FIELD_MAX_CHARS.line = 120 (line 60).
QRIS strings are EMVCo merchant-presented payloads, which can be up to 512 characters. A typical
static QRIS string is about 150-250 characters (merchant account tags, the ID.CO.QRIS.WWW tag, name,
city, postcode, CRC). Most real strings would be refused with 'too-long', so the interim box the lead
chose does not work in practice. The kind is also 'text', so the hidden-character check
(ACCOUNT_CHARS) is skipped for a value that has to be copied exactly.
Fix (engineering): either a per-field max-length option (for example 512 for this box) or the
'postal' kind (400 characters, still short). Make it kind 'account' so hidden characters are refused.
The lead should pick the length.

### F3. Medium (lead decision): old packages no longer open; labels are part of the wire format
PAY_DETAILS_V stays 1, but almost every row's keys and labels changed:
- About 114 methods move from the fallback `details` key to their own keys.
- Existing rows changed labels, for example INTERAC's phone box "Phone number" -> "Mobile number", and
  TRANSFERWISE's "Email registered with the account" -> "...with Wise".
- The gift cards, ATM and F2F now have no keys at all.

A package sealed under the old table now fails parsePayDetails (unknown-field, missing or one-of). Or
renderPayDetailsText(pay) no longer equals the sealed text (chatCrypto.ts:301). In both cases
openChatMessage throws 'bad-message', and engine.ts:384-392 marks the line refused for good. The same
happens with version skew: a sender on the old build and a reader on the new one (or the other way
round) lose every package sent between them.
If J-08 has never been live with real trades, this is acceptable, but note it in the merge. Either
way it shows a design problem that predates this branch: every label is COPY-UNSIGNED and the owner
will re-word them (J-26), and each re-wording will break every package already sent. Two
recommendations for the lead: (a) bump PAY_DETAILS_V, or keep a frozen copy of the old table for
reading; and (b) before the wording pass, compare `text` against a label-free rendering, or freeze
labels per version.

### F4. Low: the test does not enforce the card-number and personal-ID rules
packages/trade/test/payFieldsCoverage.test.ts:13-14. BAD_LABEL and BAD_WORDS do not cover:
- card numbers: nothing stops a card-number box from appearing in a fifth method;
- the ID terms the deviations removed: cédula/cedula, RIF, MyKad, passport, citizen ID, national ID,
  RUT, DNI, and CPF outside the Pix-key label.

Suggestion: add an allow-list check that any key or label matching /card number|cardNumber/ appears
only in {UKRAINE_CARD, POSTEPAY, PAYSEND, MIR}, and add the ID terms to BAD_LABEL with PIX as the one
named exception. Today's table passes both checks (I checked the research rows with a grep); the
point is to keep it that way.

### F5. Low: identifier boxes typed 'text' skip the hidden-character check
- PAYTM upiId (payFields.ts:132) is 'text', while UPI's upiId is 'account'.
- STRIKE lightningAddress (:164) is 'text'.
- TIKKIE paymentLink (:160) is 'text'.
- QRIS qris (see F2) is 'text'.

These values are copied character for character by the payer, which is exactly what M6's
ACCOUNT_CHARS exists for. checkChatText still refuses most format characters on the whole message,
but not everything ACCOUNT_CHARS refuses (tab, ZWNJ/ZWJ, LRM/RLM). Make them 'account'. This is a
mechanical change.

### F6. Low: IMPS phone route without MMID
payFields.ts:344-347. The phone box is in the one-of group with "Account number and IFSC", and MMID
is optional. Classic IMPS person-to-person by mobile needs mobile number + MMID, so a package with
only a phone number may not be enough. This follows the research (medium confidence). It is a
question for the owner's wording pass, not a blocker.

### F7. Low: the Mercado Pago country note is missing from the owner's table
The lead asked for the Brazil (Pix) and Mexico (CLABE) note "in the table". It is in the row's
`source` string (payFields.ts MERCADO_PAGO) but not in docs/payment-fields-2026-11-10.md:22, the page
the owner reads. One line to add.

### F8. Low, outside this diff: the buyer's card for gift-card and cash methods
apps/web/src/screens/trade/BuyerPay.tsx:331. For payeeGivesNothing methods the buyer's "Send
exactly" card still shows "<method> to: Ask in the chat", although the seller will never send a
package. The buyer flow is unchanged by this branch (as the brief requires). A later change could use
`payeeGivesNothing` here to say "Send the card details in the chat". That wording is the owner's
call.

### F9. Info: rendering and spoofing
- XSS: there is no XSS path. PayCard (ChatPanel.tsx:342-356) and payRowsOf render values as React
  text nodes, with labels from the table.
- Spoofing: only 'postal' values can hold a newline (CUSTOM details, addresses). So a fallback-text
  reader could see a value line like "IBAN: X" inside the plain `text`. The payee would only be
  spoofing their own package, and the structured card shows rows from the table. This predates the
  branch, with low impact.
- Size: the largest row with every box filled (TRANSFERWISE, 7 boxes) stays under
  CHAT_TEXT_MAX_BYTES (2000) for ASCII values. Long non-ASCII values in many boxes could hit
  'too-large', which the box errors then report only as a generic send error. Edge case.

## Correctness check by row (summary)
- UKRAINE_CARD: one-of card / IBAN / phone; name optional; tax ID dropped. OK.
- POSTEPAY: card number as one option; codice fiscale dropped. OK.
- PAYSEND: card number as one option. OK.
- KASPI: phone only. OK.
- MIR: card number required. OK.
- SBP: phone + bank. OK.
- SPEI: CLABE only (debit card and phone dropped). OK.
- AMAZON_GIFT_CARD: one optional email box. OK.
- Other gift cards, F2F and CASH_AT_ATM: payeeGivesNothing with fields []. OK.
- WU / MoneyGram / Ria: full name + country required; city and phone optional. OK.
- SWIFT: beneficiary address required. OK.
- XOOM: no card payout box. OK.
- TRANSFERWISE_USD: address optional. OK.
- CUSTOM: postal kind (multi-line, 400 characters, 8 lines). OK.
- QRIS: label "QR code text". See F2.
- IMPS and DUITNOW: combined boxes inside the one-of group. OK.
- PAYNOW: NRIC dropped. OK.
- CAPITUAL: low confidence plus p11-145, in the source string. OK.
- PAPARA: licence episode in the source string. OK.
- MERCADO_PAGO: Argentina one-of. See F7.
- One-of groups: every group has at least two boxes (tested). Groups are sensible: "reach" means
  ways to reach the same account; "delivery" means remittance routes.
- Required vs optional: sensible throughout. Names are optional on phone or handle apps and required
  where the provider or bank checks them (Interac, SEPA, Faster Payments, ACH, wires).
- Unknown ids: the single-line `details` fallback, tested. payeeGivesNothing(unknown) is false.
- Wire checks for payeeGivesNothing methods: checkPayDetails refuses any key (unknown-field), and
  parsePayDetails refuses an empty `fields` array, so no package can be sent for those methods.

## The builder's four deviations
1. PAGO_MOVIL drops Cédula/RIF. This is consistent with the lead's general rule (personal ID numbers
   are never a box), and the source string flags it honestly. But Pago Móvil person-to-person
   genuinely needs the payee's cédula/RIF as a routing key next to phone and bank, so without it the
   package is incomplete and the seller will type the number in plain chat anyway (the same exposure,
   less structure). My view: right not to decide it alone. Raise it as an owner question, with my
   recommendation for an exception like the card-number one: a cédula on its own cannot move money,
   and it is the method's own identifier.
2. PROMPT_PAY drops citizen ID and tax ID from the label. Agree. It matches the PAYNOW NRIC decision,
   and mobile number or e-wallet ID covers individuals. Note that only the label changed: the box is
   free 'account' text, so nothing stops someone typing a 13-digit citizen ID. Acceptable.
3. DUITNOW drops MyKad and passport and merges the bank into the account box. Agree. The merge is
   exactly the lead's "Account number and bank" pattern, and dropping the ID types follows the PAYNOW
   rule. Mobile number, business registration number and account + bank remain, which is enough.
4. NATIONAL_BANK / SAME_BANK / SPECIFIC_BANKS drop the holder tax ID. Agree. The research had it as
   optional only, and the general tax-ID rule applies. Countries whose banks need a holder ID for a
   transfer (for example Chile RUT, Colombia cédula, Brazil CPF for TED) will put it in chat. This is
   the same "later per-country refinement" the lead already accepted. Worth one line in the owner's
   table.

## Tests and tools run
- semgrep --config auto on the 6 changed source and test files: 0 findings.
- tsc -p packages/trade --noEmit: clean.
- Tests, all through run-tests.sh:
  - packages/trade/test/payFields.test.ts and payFieldsCoverage.test.ts: 20/20 passed.
  - apps/web/test/chatPanel.test.tsx: 29/29 passed.
  - apps/web/test/chatPay.test.ts and pay-tripwires.test.ts: 12/12 passed.
- Not run: tsc for apps/web, and any other web or API suites.
- Were the existing tests weakened? No.
  - The removed RESEARCHED list is replaced by the stronger catalogue-wide coverage test.
  - The label assertions changed from "Phone number" to "Mobile number" only to follow INTERAC's new
    researched label.
  - The SWISH fallback case moved to NOT_A_METHOD, since SWISH now has its own row.
  - AMAZON_GIFT_CARD is exempted from "something must be filled", per the lead's decision of one
    optional box.
