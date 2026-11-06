# Review round 2: Plan 3 Task 42 design (member escrow keys), docs review (GG)

Reviewer: claude3 (main session, read-only), 2026-10-30.
Target: `wip/lead-docs-task42-design` @827c03c, `docs/superpowers/specs/2026-10-30-task42-member-escrow-keys.md` (line numbers below are in that file at 827c03c).
Round 1: `~/x2f-comms/review-task42-design-2026-10-30.md` (claude2, @d5484d3).
Checked against: `apps/moderation/src/attest.ts`, `packages/escrow/src/party.ts` (`PartyState`), `apps/web/src/escrow/runtime.ts` (`ConfirmedTrade`), spec 6.1/6.3 (display names), R26, and q14 a–j in `~/x2f-comms/owner-questions-open-2026-10-29.md:17-27`. All on main 5c4d35b.

## Verdict: CHANGES REQUIRED (0 Critical, 2 Important, 9 Minor)

Every round-1 finding is addressed, and most are addressed well. I3's device-side nonce rule is the right fix. The comparison code holds up against a server that is in the middle of both legs. But the new pin machinery has two holes. In both, a compromised API keeps an account in today's unbound state, or pins its own key under the victim's name, without the owner's veto ever applying. Both are spec-text fixes.

## Round-1 findings

| Finding | Status | Where |
|---|---|---|
| I1 account slots unbound | Fixed: bindings for every slot, plus the account name in the attestation. New holes in I-A and I-B below. | `:175-192`, `:194-214`, `:301` |
| I2 TOFU pin | Fixed: 72 h hold, nonce-bound signed `KeyStatus`, veto, fail-closed check. Contested-state hole in I-B. | `:107-146`, `:302` |
| I3 lease as the only nonce guard | Fixed on the devices: discard on import, never-import, `handedOver`. Wallet-level wording in M-4. | `:249-260` |
| I4 q14b/f overpromise | Fixed: the toggle is dropped and `sides` is the control; Q6/q14f say "X2F's server keeps". Spec 8 and 4.1 edits are listed. | `:272-275`, `:454`, `:477-478` |
| M1 walletSet | Fixed: the list of hashes, checked by membership. | `:162`, `:166`, `:211` |
| M2 owner device lost | Fixed: K on every owner device, check 11, "backup can't be opened". See M-6. | `:97`, `:212`, `:305` |
| M3 caps on never-funded trades | Fixed, and the bound on the API lying is stated. | `:216-221` |
| M4 silent renewal | Fixed: scope never widens, skips removed/revoked members. | `:168-172` |
| M5 above-cap after launch | Fixed. | `:278`, `:452` |
| M6 section 5 notes | Fixed: R44, spec 3.3/8/4.1/6.3, R26, and the review scope. | `:465-482` |

## Important

**I-A. The pin, the veto check and the slot lookup are not keyed on the same identifier, so a hostile pin can sit under the victim's display name where their veto never sees it.** (`:112`, `:117`, `:196`)
- `AccountKeyRegistration` carries both `account` and `displayName` (`:112`).
- `KeyStatus` is `{account, …}`, which reads as the account id (`:117`).
- `checkWork` resolves "the slot's account **by the display name** in the work item" (`:196`).
- The moderation service has no authority of its own over which id owns which name: it learns both from the API.

*Failure scenario:* a compromised API sends `AccountKeyRegistration {account: <fresh id Z>, displayName: "Calcium", accountKey: K_api}`. Calcium is a reputable account that has no pin yet. Calcium's owner devices ask `KeyStatus` for Calcium's own id, see nothing pending, and raise no alert. After 72 h, the name "Calcium" resolves to a pin under K_api. The API can then attest bound slots "by Calcium" with its own key, and Calcium's genuine registration conflicts (refused or contested). The veto, which is the whole of I2's fix, is bypassed.

The same class covers renames. If a display name can ever change, the name→pin map goes stale, and whoever tells the moderation service about the rename moves the pin.

*Fix:* key the pin, the hold, the veto, `KeyStatus` and slot resolution on one identifier, the normalized display key (`display_key`: the public name the counterparty checks).
- The moderation service refuses a registration for a display key that is pinned, pending or contested under another account id. Better: drop the account id from the moderation side entirely.
- `KeyStatus` reports every registration naming the device's display key.
- Renames (if they ever exist) are signed by the pinned K.
- `buyerAccount` and `sellerAccount` are compared as display keys (case).

Add this to the 42a-0 security-review checklist (`:373-376`).

**I-B. "Contested" leaves owner slots unbound, so a compromised API can keep every account out of the pin forever, with nothing worse than a support ticket.** (`:120-121`, `:125-128`, `:197`, `:302`)
- Two registrations during a hold, or a "This wasn't me" with no pin, sets the account contested.
- A contested account runs owner slots unbound "as today" (`:127`, `:197`).
- The design calls this "a denial of service at worst" (`:128`). It is not: an unbound slot is exactly the 1.1 impersonation residual.

*Failure scenario:* the compromised API watches for first registrations and sends a second one for each (or pre-registers a hostile K before the owner's first open after the update). The owner's device then shows the alert and its "This wasn't me" contests the account (`:121`). Every account whose owner opens the app ends up contested, so unbound. Every account whose owner doesn't open the app gets the hostile pin (the stated residual). After staff clear an account, the API sends another registration and contests it again. Net effect: I1's fix protects no account against an API that is compromised during the rollout, which is when the pins are first set.

*Fix:*
- A contested account (and an account whose pending registration is not the one its owner device made) gets **no attested trader slots at all**: owner and member slots are both refused. That is a real denial of service, consistent with "the API can already deny service" (`:123`).
- Specify how staff clear it: out of band, never on the API's word. For example, the owner reads a 6-digit comparison code from an owner device to a moderator on a call, and two moderators sign the clear (`:127`). Also say how the moderation console reaches a service that "has no inbound surface" (`:60`).
- Rate-limit re-contesting a cleared account, or require the clearing moderators to pin the key the owner's device showed, so a second registration after the clear is refused rather than contesting again.
- Update the "Compromised API at key registration" row (`:302`) and recommendation point 2 (`:433-434`).

## Minor

- **M-1. Attack on the comparison code: holds.** (`:136-146`) A server that relays both legs must commit its own key to the approver before it sees the approver's `n`, and must pick the new device's `n'` before the new device reveals `r`. Either way the honest side's randomness comes after the other side's commitment, so each try matches with probability 10⁻⁶. The server cannot fake a match. Three things the build must keep, which the text should state:
  - (a) the new device refuses to reveal before it has `n`, and the approver picks a fresh `n` only after it holds the commitment, and never reuses it;
  - (b) a mismatch or abort ends the approval, with an alert and a limit on retries, so the API can't spin many sessions hoping for a hurried tap;
  - (c) domain-separate the hash with purpose, account and member id (`H("x2f/sas/v1" ‖ purpose ‖ displayKey ‖ memberId ‖ key ‖ r ‖ n)`), so a genuine member's commitment can't be replayed into an owner-device approval (sealing K to it), or the reverse.
- **M-2. "Number matching for ordinary logins is unchanged"** (`:146`) conflicts with "every approved owner device holds a copy" of K (`:97`). Every owner login that is approved as a device would then need the 6-digit code. Say which logins receive K (all owner devices, or only ones the owner marks), and use the 2-digit matching only for the rest.
- **M-3. Takeover blob authenticity.** (`:239`, `:248`) `crypto_box_seal` is anonymous: anyone with K's public half (the API) can make a blob. The import checks that the blob's identity matches the attested slot. Also require it to check that the blob's **secret** keys derive the attested public keys, and have the member device sign the sealed blob with its member key or the trade identity. Then a forged or swapped blob is refused before import, not only when signing fails later.
- **M-4. "Discard the exported multisig state" must happen at the wallet level, not only in `PartyState`'s fields.** (`:250`) `PartyState.session` (`packages/escrow/src/party.ts:58-69`) is the saved wallet session. Monero keeps the exported signing nonces inside the wallet's own state. Write that the import regenerates them, through the fresh `exportState` of step 3, before **any** sign call. Also say that the existing "one signature per export" rule applies to the new export too, so a co-sign request arriving between the import and the fresh round is refused, not signed. 42b's nonce test (`:363`) should feed exactly that early request.
- **M-5. A stolen K can rotate at once and lock the owner out.** (`:309`) Rotation "takes effect at once", signed by the old key. Whoever holds a copy of K (an owner device taken while unlocked, or a malicious bundle) can rotate to their own key. After that, the owner's reset can be vetoed by "the old key", which is now the attacker's (`:312`). Either put rotation under the same 72 h hold with a veto from any holder of the old K, or state the lockout and send it to the I-B support path.
- **M-6. Check 11 ties two numbers together.** (`:212`) The "owner last seen" limit is `notAfter − notBefore`, so an owner who signs 90-day delegations also gets a 90-day "backup nobody can open" window. Use a constant of its own (`OWNER_SEEN_MAX_D = 30`).
- **M-7. `ConfirmedTrade` has no counterpart name today** (`apps/web/src/escrow/runtime.ts:54-58`: role, ownAddress, deal). 2.1.3 (`:190`) relies on it. Name the new field, and say where the poster's side captures the taker's name. The poster confirms nothing at take, so its name comes from the API at the wallet step: say that this is accepted.
- **M-8. The binding protects a name, not a reputation.** (`:72`, `:301`, `:434`) The counterparty's reputation figures come from the API. A compromised API can still trade as a fresh or look-alike name (names are ASCII 5–20 characters, spec 6.1, so `Calclum` for `Calcium`) and show it any stats. State this residual next to 1.1's, and leave signed reputation, or a look-alike-name check at sign-up, to Plan 6.
- **M-9. q14 preamble overpromises.** (`owner-questions-open-2026-10-29.md:17`) "So a hacked X2F server can't trade as you" holds only once the key is pinned (72 h after the first open, and not for a contested account, see I-B). Add "once your key is set up". Also, q14h says "activity log" where the design says "team audit log" (`:283`, Q8); use one name.

## q14 a–j against the design
a = Q1 (`:444`), b = Q2 (`:445`), c = Q3 (`:446`), d = Q4 (`:447-452`), e = Q5 (`:453`), f = Q6 (`:454`), g = Q7 (`:455`), h = Q8 (`:456`), i = Q9 (`:457`), j = Q10 (`:458-463`). All ten match in substance and lead default. The only text issues are the preamble and the log name (M-9). "Until a-f and j are answered" matches section 5's "Q1–Q6 and Q10" (`:467`).

## Checked and fine
- The commit-then-reveal comparison against a server in the middle of both legs (M-1): no fake match beyond 10⁻⁶ per try.
- The nonce-bound `KeyStatus` signed by the moderation key: no replay of an old "all fine", and the check fails closed when the statement is withheld (`:117-123`).
- I3's argument (`:249-260`): with never-import on the member side and discard-and-fresh-round on the owner side, each nonce set lives on one device. Two devices running at once can produce two transactions, of which at most one confirms, but never two signatures from one nonce set. A stale or replayed genuine blob is harmless, because the import discards the round anyway.
- Revocation is add-only via the API. A re-added member gets a new `memberId`. "What revocation cannot do" is honest (`:263-267`).
- The 3.1 table is unchanged (the moderation service still only attests), and the rejections in 2.4 still stand.
