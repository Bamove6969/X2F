# Re-review: wip/lead-help-library 2b379fd1 (help library fixes on train-1)

Reviewer: independent helper (rev-help), 18 Nov 2026, about 11:40 BC time.
Range: 33c84d9a (train-1 ef50b6e0 merged in)..2b379fd1, 1 fix commit, 4 files, +573/-175.
There are now 91 questions; the new ones are trade-kept and who-sees-profile.
First review: review-lead-help-library-2026-11-18.md.

## Verdict: APPROVE WITH MINORS

Every B and M item from the first round is fixed in a way that is true of the merged code. Four small
items remain (m1-m4) and one note (n1). None of them blocks landing.

Separately, the sign-up gap the fixer noted is real: the code does not follow the owner's 16 Nov
rule (see that section). It is not a fault in the help library, but it decides whether login-methods
stays true.

## Tests run (outside the lock, nice -n 10)

- **At 2b379fd1**, `@x2f/web` helpLibrary, frontDoor, cantDoThat-lint, moderator-badge-scope and
  copy-lint: 5 files, 169 passed, 0 failed. `npm run copy-lint` is clean.
- **Trial merge of 2b379fd1 onto train-1 fabda40d.** fabda40d is ef50b6e0 plus one commit: badge_prefs
  as a Jabber account-change path. `git merge-tree` was clean. I ran the same 5 files on that tree,
  as a local scratch commit that I did not push: 169 passed, 0 failed.
- **Not run:** the full `npm run check`, and Playwright (apps/web/e2e/help.spec.ts).

## The drift test (buildFacts): proven red

- **The test's own cases** (apps/web/test/helpLibrary.test.tsx:238-252) are no longer tautological.
  - They hand `buildFacts` a changed constant: an imported value, or a source file read with one
    edit.
  - They then check that only the answers naming that constant go red, and that the unchanged code
    is still green.
- **My own edits of real files**, each reverted afterwards:
  - `CHAT_AFTER_CLOSE_DAYS` 30 to 31 (packages/trade/src/chat.ts). The facts check went red for both
    flag variants, along with the self-check cases: 9 failed.
  - `RECOVERY_HOLD_MS` 24 h to 48 h (apps/api/src/auth/recovery.ts:56). The check reads this one from
    source, not through an import. The facts check went red for both variants: 7 failed.

## First-round items

| Item | What was wrong | Status, with evidence |
|---|---|---|
| B1 | Name and signature | **Fixed.** personal-details, never-asks and what-is-stored now name the Terms signature ("a scribble or an X is fine", sealed, never shown) and the PGP user IDs. |
| B2 | Network fee | **Fixed.** network-fee, fee-vendor-sells, fee-vendor-buys and fee-when say the receiver of the trade's XMR pays it. That matches payouts.ts:7, 80 and 92, and escrow/verify.ts:177 (`i === 0 ? p.amountAtomic - fee`). |
| B3 | Retention | **Fixed.** addresses-kept follows the 30-day whole-trade delete (retention.ts:6-10, tradePurge.ts:24-26), and what-is-stored says "until the trade self-destructs". The new trade-kept is true, including "reviews stay" (tradePurge.ts:25, "detached (they are permanent)"). |
| B4 | Source notes | **Fixed.** All notes are re-pointed. They hold at 2b379fd1 and on the fabda40d merge. |
| M1 | device-copy | **Fixed.** No message text is kept on the device (engine.ts:35-36, store.ts:3-5). The record is erased if the device checks within a year (chat/retention.ts:20, 23). |
| M2 | new-device-alone | **Fixed.** It states what a recovery-code login costs (hold.ts:16-21). |
| M3 | paid-late | **Fixed.** "usually goes back to the seller within seconds" (machine.ts:484-488). |
| M4 | Owner-changeable numbers | **Fixed.** "normally" before the offer caps, the device limit and the appeal window; the drift test covers appealWindowH. |
| m1 | Strong login | **Fixed.** cancel-waiting-changes now includes a password with an authenticator code. |
| m2 | who-signs source | **Fixed.** It cites escrow/policy.ts:107-110 and moderation/rulings.ts. |
| m3 | Untied claims | **Fixed.** "usually sooner" and "For most trades" are gone. |
| m4 | Tautological self-check | **Fixed** (see the drift test above). |
| m5 | Facts read from prose | **Fixed.** SIGNERS from escrow/monero.ts; the range card from giftCardCopy.ts. |
| m6 | Question cap | **Fixed.** The cap is now 100. |
| m7 | Accessibility | **Fixed.** Answers are `role=group`, labelled by their question. Each answer link has a unique accessible name that starts with its visible text. Anchors are `#faq-<id>`. |
| m8 | Security key PIN | **Fixed.** "needs its PIN"; webauthn.ts:63 KEY_NEEDS_PIN. |

## Proof-flag answer sets: OK

- payment-proof and moderator-sees each carry an `off` and an `on` answer.
- `libraryQuestions(proofUploadOn())` picks one, using the same flag that BuyerPay.tsx:382 and
  seams.tsx:99 use.
- Every content, source and facts test runs for both variants (`VARIANTS`).
- The `off` texts are the old answers, which are still true for a default build.
- The `on` payment-proof answer is true: proofSlot.tsx:9 and 48; upload.ts:15-16 and 359.

## Anchors: OK except m3

- Questions are at `#faq-<id>` (`FAQ_ANCHOR_PREFIX`), so they cannot collide with other ids.
- An old link `#<id>` is rewritten in place with `replace` (HelpLibrary.tsx:135-138). Tests cover:
  - /help/trading#price going to #faq-price;
  - /help#bans;
  - a link to another topic's question opening nothing;
  - a hash that does not decode.

## Spot check: 32 answers against the merged code

I weighted the check toward privacy, fees, retention and login. All 32 are true, apart from the gaps
listed under m1, m2 and m4.

- **Privacy:**
  - personal-details, what-is-stored, never-asks, terms-signature, pgp-key-name
  - who-sees-profile (m1)
  - trade-kept, addresses-kept, chat-kept, device-copy
  - closed-account-data (m4)
- **Fees:** who-pays-fee, fee-vendor-sells, fee-vendor-buys, fee-when, fee-dispute, network-fee.
- **Login:**
  - login-methods (methods.ts:426 and 436, totp.ts:176), passkey-or-security-key
  - new-device-alone, recovery-login, changes-wait, cancel-waiting-changes
  - session-length, pgp-login, password-rules, security-rating
- **Other:**
  - payment-proof, both variants
  - moderator-sees, both variants (m2)
  - paid-late, appeal, who-can-post, device-limit, who-signs

## Remaining minors

- **m1. who-sees-profile leaves out two things the profile shows** (helpLibrary.ts:837).
  - "Typical payment time" (Profile.tsx:116) and the opt-in rounded "traded over N XMR" line
    (Profile.tsx:121; reputation/profile.ts:23) are both shown and not listed.
  - "Anyone signed in" is wider than the code's "a set-up trader (or a member of one)"
    (profile.ts:16-17). It matches the app's own showNote copy (profileCopy.ts:91), so this is
    only a nit.
- **m2. moderator-sees with the flag on suggests the moderator sees the unblurred copy**
  (helpLibrary.ts:563). The moderator can request it, but the staff case still says "The proof can't
  be viewed here yet" (staff-web ModCase.tsx:343-345, NEEDS_P4_CHAT_MEMBERSHIP). Add "it can't be
  viewed on the moderator's screens yet", or say it once the staff chat keys land.
- **m3. OLD_ANCHOR_REDIRECTS answers inherited object keys** (HelpLibrary.tsx:43 and 135).
  - It is a plain object, so a lookup of `constructor`, `toString` or `__proto__` finds the
    Object prototype's members.
  - `/help#constructor` therefore "redirects" to `#function Object() { [native code] }`.
  - Proof: in node, `Object.freeze(Object.fromEntries(...))['constructor']` is the Object function.
  - The effect is harmless, but it is wrong. Fix it with `Object.hasOwn(...)` or a `Map`.
- **m4. closed-account-data does not say the Terms signature is erased** (helpLibrary.ts:861). Now
  that the library says the signature is kept, add that it is erased on close
  (accountInactivity.ts:82 sets `terms_signature = null`).
- **n1.** OLD_ANCHOR_REDIRECTS also maps the two new ids, and no `#<id>` link was ever published on
  main, since the library has not landed. The redirect is a precaution that costs nothing; keep it
  or drop it.

## Sign-up with a password alone: a real gap, not intended

- **The owner's rule** (comms to-lead.log:426, 2026-11-16 17:50:46 UTC, about 10:50 BC time): "Password
  does NOT stand alone: it needs TOTP (or another method); TOTP is only ever the 2nd factor of a
  password."
- **The code follows it only on removal.**
  - `removable` refuses `password-alone` (apps/api/src/auth/methods.ts:427-436).
  - `POST /v1/register/password` (apps/api/src/auth/password.ts:477) creates a password-only
    account with no such check.
  - Main's /setup has no authenticator step (SetupFlow.tsx:5-9).
- **This is a known deferral, not a design choice.**
  - The port commit 4ce2d024 left out confirm.ts endOnboarding's 409 password-alone, and the sign-up
    screen changes, because main has neither. Its message says: "the sign-up half of the rule is an
    open question in the report".
  - review-lead-signup-rules-main-2026-11-18.md:97-100 (m4) records the same gap.
  - The owner question already raised (to-lead.log:482, 17 Nov) is "legacy password-only accounts
    at login".
- **The full rule exists on another branch.** wip/second-signup-r3-fixes (05d7c7ab) enforces it at
  sign-up, with the v2 setup screens.
- **What this means for the help library.**
  - login-methods (helpLibrary.ts:130) and security-rating ("weak with a password alone") describe
    the code as it is today, so they are true now.
  - They become stale when sign-up enforcement lands. They should then say a password needs an
    authenticator app from the start.
- **Owner question:** whether sign-up must enforce password-plus-TOTP, and what happens to existing
  password-only accounts. My recommendation is to enforce it at sign-up, and to ask existing
  password-only accounts to add a second method at their next login.
