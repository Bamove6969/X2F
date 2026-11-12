# Security review: instr-hash (origin/wip/lead-instr-hash 069c0d23, base 6ebed537)

Reviewer: independent adversarial review helper, 2026-11-12. Not committed.

Scope: packages/trade/src/attestation.ts + index.ts; apps/api/src/internal/routes.ts;
apps/web/src/escrow/{adapters,runtime,useEscrow,worker}.ts; apps/web/src/api/trade.ts; the tests
that the two commits (b16123d5 RED, 069c0d23 GREEN) touch. Threat model: the API (or the trade view
it serves) is malicious after moderation has signed an honest attestation.

## Verdict

**Approve to merge, with no blocking findings.** The money paths hold. Against a lying view,
web escrow settles nothing and refuses the buyer's "I've paid" tap. It never passes on instructions
that do not hash to the attested value. Two minor gaps should be fixed or ruled on (M1, M2). Neither
lets a lying API move coins or get a mismatched tap accepted. Both are gaps between what the brief
claims and what the code does.

## What holds (attacks tried and refused)

- **Other instructions to the buyer.** `instructionsAttested` (runtime.ts ~934) hashes the view's text
  and compares it with the attested `instructionsSha256`. `EscrowStatus.paymentInstructions` is set
  only from `this.instructions.ok === true`, so status never carries text that failed the hash.
  Near copies all fail closed: a trailing space, a changed character, an NFD form, a trailing
  newline. Tested in attestation-flow and packages/trade/test/attestation.test.ts.
- **Different text to the two sides.** Each device checks its own view against the same signed hash,
  so any text that does pass is the attested text on both sides. The API stores one attestation per
  trade (`on conflict (code) do nothing`), and the device keeps the first attestation it verified.
  A one-sided lie is a one-sided `view-mismatch` (the test "a lying API can tell one side other
  instructions"). Splitting the sides would need moderation to sign a second attestation with
  another mod identity, and the participants would then differ. That is outside this change.
- **"I've paid" on a mismatch.** `act('paid')` reloads the view and calls `instructionsAttested(v)`
  after `viewMatches`. On a mismatch it throws before `fixAmount` / `paidSeen` / save /
  `signals.send('trade.paid')`. A null `v` is refused further down (`!v || amount === null`).
  "Finish marking as paid" goes through the same `markPaid -> act('paid')` path.
- **Settle on a mismatch.** In `tick()` the instructions check runs after `viewMatches` and before
  every intent, growth or `settle()` step, and it returns with `refusal = 'view-mismatch'`. Release,
  refund and cancel taps only set an intent, and `tick` is what settles it, so they are gated too.
  The two exceptions match the existing `viewMatches` design: the after-close branch, and the
  resumed stored outcome at start (I2).
- **Malformed, uppercase or non-string hash.** `isAttestedTerms` requires `/^[0-9a-f]{64}$/` and a
  method of 1–64 characters, with exact keys. `wellFormed` applies it, so `verifyAttestation` fails
  with `bad-signature`, which becomes `participants-mismatch` (a stop). `instructionsMatch` checks
  `typeof` and the format again. The moderation `checkWork` and the API listener use the same
  predicate, so the listener answers 400 `bad-attestation` for a missing or uppercase hash (tested).
- **methodId dropped from the view.** `parseTradeView` maps a missing or empty `methodId` to null. At
  start that is `deal-mismatch` before `verifyAttestation`. Mid-trade, null !== attested gives
  `view-mismatch`. A changed method gives `wrong-terms` -> `deal-mismatch` at start and
  `view-mismatch` with `instructionsMismatch` mid-trade (tested).
- **API listener.** 409 `terms-mismatch` when the method or hash differs from the trade record, and
  400 `bad-attestation` when it is malformed (identity.test.ts). The hash is
  `createHash('sha256').update(t.method_instructions,'utf8')` over the column that migration 490's
  `trades_deal_fixed` trigger freezes (`new.method_instructions is distinct from old...` raises).
  The view serves the same column verbatim (trades/routes.ts:111, view.ts:141: null before
  `securedAt`, otherwise the text). The work item carries only the hash (tested: the text is not in
  the JSON).
- **Unsigned TradeView instructions.** No screen in apps/web/src or apps/staff-web/src reads
  `TradeView.paymentInstructions`. Its only reader is `parseTradeView` in the escrow runtime. No
  screen reads `EscrowStatus.paymentInstructions` yet either, so today the protection that counts
  is the tap and settle gate (see I1).
- **Browser SHA-256.** `crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))` with
  lower-case hex. It matches Node's `createHash(...,'utf8')`, including how lone surrogates become
  U+FFFD (Postgres cannot store lone surrogates anyway). The escrow runtime and worker already
  depend on `crypto.subtle` (`channelFor` HKDF, `escrowCheckWords`). Any runtime without it (an
  insecure context) already fails before an attestation is verified, so this adds no new runtime
  dependency. The worker gets the same code.
- **Tests not weakened.** Every changed line in an existing test only adds `methodId`,
  `instructionsSha256`, `paymentInstructions: null` or `instructionsMismatch: false` to fixtures
  and expected objects. No assertion was removed or loosened, nothing was skipped, and the 400 and
  409 loops gained cases.

## Findings

### M1 (minor): absent or non-string instructions on a secured trade are accepted silently

`instructionsAttested` treats `v.paymentInstructions === null` as "nothing to check" and returns
`methodOk`. `parseTradeView` maps any non-string value to null: a number, an object, `false`, or a
missing key. So once the escrow is secured, a lying API can serve `paymentInstructions: 42` or drop
the field. The device then shows no mismatch (`refusal` null, `instructionsMismatch` false). It
settles normally and accepts "I've paid". Probe result: PROBE_RESULT_PLACEHOLDER.

Scenario: the API strips `paymentInstructions` from the buyer's view after `secured`. A future
screen that renders `escrow.paymentInstructions` sees null. If it reads that as "the seller gave no
instructions, ask in the chat" (as for ''), the buyer is pushed to the chat. The chat's sealed pay
details are out of the API's reach, so there is no direct theft, but the gate's
guarantee ("the shown text is the signed text, or a warning") falls back to "nothing shown, no
warning". The rest of the escrow handles a dropped field fail-closed (payWindowMin, launch-rules F2:
"the web and the API ship together, so a view without one fails closed"). This field is the
exception.

Fix (engineering, recommended): in `parseTradeView`, keep a non-string, non-null value distinct (as
invalid) rather than null. In `instructionsAttested`, treat null as a mismatch once the view state
is past `securing` (the API sends null only while `securedAt` is null). Add a test for each.
Owner/lead call only if an older API without the field must still be served, which the F2
precedent says not.

### M2 (minor): the method shown on screen is not the one checked

Screens show the method from their own `getTrade` fetch: `methodOf(view)` / `payMethodOf(view)` in
BuyerPay, TradeFund, TradeRoom chat (`methodId={view.methodId}` -> PayBoxes field schema), Refunded,
SellerRefund and the dispute screens. The name comes from the unsigned `view.profile.name`. The
runtime checks the methodId of a separate fetch in the worker. The brief says "web escrow checks the
shown method", but the shown method is not checked.

Scenario: the API serves the runtime `methodId: 'zelle'` (which matches) and serves the TradeRoom
fetch `methodId: 'paypal'`, or keeps 'zelle' with `profile.name: 'PayPal'`. The buyer sees "Pay
with PayPal", the runtime reports no refusal, and "I've paid" is accepted. Coins are not at risk:
the seller's chat PayBoxes would ask for PayPal fields and the seller would notice. But a buyer can
be steered to the wrong rail, which leads to a payment the seller never receives and a dispute.
The id-to-name mapping is API-controlled everywhere, the take screen included, so a full fix needs
a signed or bundled method catalogue.

Fix (recommended): expose the attested `methodId` in `EscrowStatus`. On the trade screens, take the
method name from the bundled method list keyed by that id, or show `view-mismatch` when
`view.methodId` differs from it. The owner rules on whether the method name must be taken from the
signed id (it changes what users see).

### I1 (info): nothing renders the verified instructions yet

`EscrowStatus.paymentInstructions` and `instructionsMismatch` reach `useEscrow`, but no screen reads
them. The buyer gets no instructions text from the app, only the generic `view-mismatch` refusal
copy. When the UI lands, it must read only `escrow.paymentInstructions`, and it should distinguish
null ("not yet / not verified") from '' ("the offer gave none"). The doc comment on
`TradeView.paymentInstructions` says "never show this field", but nothing enforces it. Suggestion:
drop the field from the `TradeView` type (the runtime parses `unknown`), so a screen cannot read it
by accident.

### I2 (info): two settle paths skip the instructions check, by design

At start, a stored unfinished outcome is handed to `settle()` (runtime.ts ~692) before any tick.
The after-close branch also runs before the check. Both match how `viewMatches` already works: the
stored outcome passed every gate when it was chosen, and after close only the keep rules run. Noted
so the brief's "settles nothing on a mismatch" is read as "chooses and starts nothing new".

### I3 (info): tick/tap race on `this.instructions`

`act('paid')` does not run on the `ticking` chain, so a tap and a tick can each be inside
`instructionsAttested` with different views. The later-resolving call writes `this.instructions`.
The result can briefly be `instructionsMismatch: false` together with `paymentInstructions` set to
the (attested) text while `refusal` is `view-mismatch` from the tick, or the reverse. Every text
that reaches status still passed the hash, and the tap decides on its own `v`, which it checks
itself. So neither a mismatched tap nor unverified text can result. The flag is cosmetic. A fix, if
wanted: compute the result into a local and assign it only when `v === this.view`.

### I4 (info): deploy skew

Records and attestations signed before this change lack the two keys. `wellFormed` refuses them,
and the device stops with `participants-mismatch` (kept). This is the accepted pre-launch pattern
(shadow.ts "Deploy note", payWindowMin), but that note does not mention the new keys. Update the
comment if it is meant to stay the reference.

### I5 (info): the moderator trusts the API's hash

Moderation signs the hash the API's work item gives. It never sees the text, by design. An API
compromised before signing can have a hash of attacker text signed, and every check here then
passes. This is out of this review's threat model and unchanged from the original Task 34 I1
design. The defence there is the seller seeing their own locked text, which also needs I1's UI.

## Tests run (detached worktree at 069c0d23, fresh npm ci, each under flock ~/x2f-comms/check.lock)

TESTS_PLACEHOLDER
