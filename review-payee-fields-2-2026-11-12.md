# Review: wip/lead-payee-fields-2 (12 Nov payee-fields recheck), 2026-11-12

Branch at `20de07e8` (green), red `e4612864`, base `8246e64b`. Independent reviewer, detached worktree at 20de07e8, fresh `npm ci`, everything run under `~/x2f-comms/check.lock`.

## Verdict

**Land it.** Nothing is blocking. All five checks the lead asked for hold. The four minor findings below are a doc-count slip, a gap in the coverage test, a UX regression for ATM cash, and one honest correction to the commit message's version-compatibility claim. None of them weakens the security rules.

## What I verified

1. **The coverage test's banned-box rules still hold.** `payFieldsCoverage.test.ts` is unchanged except for the card list.
   - `BAD_LABEL` (password, PIN, CVV/CVC, security code, expiry, tax, NRIC, SSN, login, online banking, cédula, RIF, MyKad, passport, national ID, RUT, DNI), `BAD_WORDS` on keys, and `CPF` outside PIX all still apply to every row, and pass.
   - My own sweep over the new table:
     - The only CPF mention is PIX's "Pix key (phone, email, CPF/CNPJ or random key)".
     - Card-number boxes appear only in MIR, UKRAINE_CARD, PAYSEND, POSTEPAY and SPEI.
     - The new labels for Nequi, Alipay, Weixin Pay, Postepay, Lydia, WorldRemit and SPEI contain no banned term.
   - Nequi's Bre-B label now explicitly avoids the personal ID: "phone, email or the key your bank gave you".
2. **The two changes to existing tests are justified, not weakenings.**
   - **SPEI joins `CARD_METHODS`** (red commit). The test still asserts the exact set, so a card box anywhere else still fails. I checked the legal basis against the source itself. DOF note 5790863 (Banxico, amending Circular 3/2012, Art. 17 Ter) says a transfer may identify the beneficiary account "únicamente con la CLABE asignada, los dieciséis dígitos de la tarjeta de débito … o los diez dígitos del número de línea de telefonía móvil". A card number without CVV or expiry is a receiving identifier, not a secret. The 10 Nov "SPEI is CLABE only" assertion is replaced by a stricter exact-shape test (keys, kinds and needs of all five boxes).
   - **CASH_AT_ATM exempted from "something must be filled"** (green commit, in `payFields.test.ts`). It follows the existing Amazon exemption, the commit message discloses it, and the alternative was contradictory: the red test pins ATM's only box as optional (lead 12 Nov). The exemption is by id, so any other row with only optional boxes still fails. `parsePayDetails` still refuses an empty package (`fields.length === 0` gives `bad-shape`), so an ATM package always carries the phone.
   - The red commit also removed `CASH_AT_ATM` from the "no boxes" list in that file. A stricter test replaces it (`payeeGivesNothing` is false, and the box is exactly `phone/phone/no`).
3. **Keeping PAY_DETAILS_V at 2 fails safe.**
   - An older reader opening a package with a new key (SPEI `cardNumber` or `phone`, ATM `phone`, Lydia `username`, WorldRemit `address`) fails in `checkPayDetails` with `unknown-field`. That surfaces as `ChatError('bad-message')`, and the engine stores the receipt as `refused`. Nothing malformed is ever shown.
   - A newer reader opens every older package: no key was removed or renamed, and no requirement was tightened. New boxes are optional or join an existing one-of group.
   - Bumping V would not help. Old readers would refuse on `v` anyway, and new readers would have to accept 2 as well.
   - Postepay's `phone` changes kind from phone to account. Both kinds are validated with the same `ACCOUNT_CHARS`, so an alias like `mario.rossi` passes old readers too. They just show it under their old label, "Mobile number (Postepay P2P)" (see I-2).
4. **The note text cannot carry anything the payee typed.**
   - `note` is a string literal in `PAY_FIELDS` (Monese, CASH_DEPOSIT, CASH_AT_ATM). `payNoteFor` returns `rowOf(methodId)?.note` and nothing else.
   - ChatPanel renders it as a React text child (escaped) in the payee's own `PayBoxes`.
   - It is not part of the sealed package or of `renderPayDetailsText`, so it never reaches the payer, the envelope or the server.
   - `methodId` comes from the trade, not from the payee's input. An unknown id gives `undefined` (tested).
5. **The regenerated docs table matches the code.** I wrote an independent renderer over `PAY_FIELDS` (label, kind, need, `up to N characters` for maxLength, `Note:` for notes, the confidence taken from the recheck tag, else the original) and compared it with `docs/payment-fields-2026-11-10.md`. All 127 rows match: boxes, notes and confidence. Status flags such as "low (status flag: …)" match each row's `source` too. The table's confidence totals are **98 high, 28 medium, 1 low**; see m-1 for the summary line.
6. **Others.** ESSO keeps its id `ESSO_GIFT_CARD`; only the catalogue name changes, and only `profiles.test.ts` pins it. The 62 recheck tags are well-formed (tested). Commit e4612864 is test-only and 20de07e8 contains the implementation, as the commit messages say.

## Findings

### Blocking

None.

### Minor

**m-1. The docs summary line and the commit message give the wrong confidence counts.** `docs/payment-fields-2026-11-10.md` line 10 and the commit message both say "now 97 high, 29 medium, 1 low". The table itself, and the code it was rendered from, give 98 high, 28 medium, 1 low (grep the `| high` cells; my renderer agrees). Scenario: the owner signs the wording page using the summary and believes one more row is unverified than really is, or a later recheck brief targets the wrong set. Fix: correct the line to 98/28/1.

**m-2. The banned-term rules do not cover the new `note` field.** The coverage test checks `f.label` and `f.key` only. Scenario: a later recheck adds a note such as "Ask the buyer for the PIN sent by your bank", or "Give your CPF so the transfer clears". It ships green, and it is the one piece of payee-facing text that invites a secret or a tax ID. Today's three notes are clean (I swept them with `BAD_LABEL` plus CPF). Fix: in `payFieldsCoverage.test.ts`, run `BAD_LABEL` and `CPF` over `row.note` as well, with the same `ID_EXEMPT` and PIX logic.

**m-3. ATM cash: a payee with nothing to give now meets a Send button that fails with a vague error.** Before this branch, ATM showed "Nothing to send: the buyer sends the card or cash details here in the chat." Now it shows one optional phone box, the note and "Send payment details". If the payee's bank gives the code to the buyer (the note's second case), they have nothing to fill in. Pressing Send gives an empty package, the worker's `parsePayDetails` refuses it (`bad-shape`), and the payee sees "Check the details and try again.". Amazon (one optional email box) has always behaved this way; this branch extends it to ATM. Scenario: an ATM payee taps Send to "confirm", gets an error that suggests something is wrong with their details, and the trade stalls on confused chat. Fix (design and lead): when every box is optional and none is filled, either hide or disable Send with a line like "Nothing else to send if your bank gives the code to the buyer". Or extend the note to say so.

**m-4. The commit message overstates version compatibility, and a refused package is silent and permanent.** The commit says "no existing key changed". That is true of the payload, but Postepay `phone` changed kind and label (harmless, see point 3). More importantly, on an older reader a refused package is stored as `refused` ("Decided for good", engine.ts) and is never re-opened, even after that tab updates. The payer sees nothing at all: no "a message couldn't be read" line. Scenario: the buyer has a tab open from before the deploy, and the seller (on the new build) sends SPEI details including the debit-card box. The buyer never sees them, even after reloading, and the seller believes they were delivered. The skew window is short (index.html is `no-cache` and the service worker caches nothing), and this fails closed. But the fallback is silence. Fix (later; not this branch's to solve): show refused receipts as a neutral line, such as "A message from <name> couldn't be shown. Ask them to send it again." A resent package gets a fresh seq and opens. Until then, the commit message should say "older readers refuse packages that use the new keys (unknown-field); the package then does not appear for them".

### Info

**I-1. SPEI routing by card or phone needs the receiving bank, and the circular is not in force yet.** The same Art. 17 Ter IV text requires the card or phone digits to be "adjuntados a los tres dígitos o cualquiera de las denominaciones de identificación de la Institución receptora" (sent together with the receiving bank's identifier). `bankName` stays optional. That is fine while CLABE is required: its first three digits are the bank code, and the payer can always pay to the CLABE. The source also says the circular applies "by 14 Dec 2026", so until then some banks may not route a card or phone. No change needed; the labels already make both optional.

**I-2. Old readers mislabel a Postepay alias.** An older reader renders a Postepay alias under its own label "Mobile number (Postepay P2P)". By design, a reader never shows the sender's labels (review R1). This is cosmetic and goes away when the reader updates.

**I-3. Monese's note asks the payee to share a "Monese ID", but there is no box for it.** The payee would type it in the chat. That is consistent with "a later per-country refinement", but design may want a box later.

**I-4. The ESSO rename is display-only.** The id `ESSO_GIFT_CARD` is unchanged, so stored offers and trades are unaffected.

## Tests run

All under `flock ~/x2f-comms/check.lock timeout 1700 …`, in a detached worktree at 20de07e8 with a fresh `npm ci`:
- vitest on 9 files: `packages/trade/test/payFields.test.ts`, `payFieldsCoverage.test.ts`; `apps/web/test/chatPanel.test.tsx`, `chatPay.test.ts`, `payDetailsFeed.test.tsx`, `pay-tripwires.test.ts`, `buyerPay.test.tsx`, `payModel.test.ts`; `apps/api/test/profiles.test.ts`. **9 files, 246 tests, all passed.**
- `tsc --noEmit` for packages/trade and apps/web: clean. `npm run copy-lint`: clean.
- Independent checks:
  - The docs-versus-code renderer: 127 rows, no differences.
  - The sweep of notes, CPF and card boxes.
  - The Banxico source, fetched from sidof.segob.gob.mx (note 5790863); the Art. 17 Ter IV wording is quoted above.
- Not run: Playwright. No e2e file changed.
