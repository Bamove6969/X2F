# Security review: recovery S-109 / S-110 / S-111 (wip/lead-recovery 780f2539), 12 Nov 2026

Independent security review for the lead. LOGINS. Branch 780f2539 on main 6ebed537 (9 files,
+552/-33). Worktree /home/user/X2F/.claude/worktrees/recovery. No code edits.

## Verdict

**NOT READY: one must-fix (M1).** The code-check mechanics are sound: the throttle cannot be used
to brute-force or enumerate in practice, the code is spent atomically, the change fails closed
during a hold, and other sessions are ended. But the builder's open gap is real and severe. A
thief's *submitted* waiting changes survive the owner's S-110 recovery and apply 24 h later. That
undoes the recovery: the thief's password comes back, and so does any payout wallet the thief
staged. S-110 exists for exactly the case where the password is compromised.

## Checks run

- Runner, API: recoveryRulings, recovery, password, holdV3, security-review, throttle: 6 files,
  146 passed, 0 failed.
- Runner, web: recoveryBurned.test.tsx: 1 file, 4 passed, 0 failed.
- semgrep (p/typescript, p/nodejs, p/secrets, tools/semgrep) on the 8 changed source and test
  files: 0 findings.
- dockerd was not touched.

## S-109: a correct code gets in while throttled (recovery.ts `matchRecoveryCode`)

- **Entropy.** `newRecoveryCode` = `newTradeCode`: 16 Crockford base32 characters from
  `getRandomValues`, `b & 0x1f` on uniform bytes, which is 80 uniform bits.
- **Comparison.** The typed code is normalized and HMAC'd per key (SHA-256 for a legacy key) and
  compared in SQL on `(key_id, code_hash)`. No plaintext comparison happens in JS, and a timing leak
  in hash equality reveals nothing about the code. Every path computes the same hashes and runs
  one query, including a missing account (accountId '') and a malformed code (normalized '').
- **Brute force.** This is the real change: a wrong code while throttled is now *looked up* and
  then answered 429, and still no failure is counted. So 429 vs 200 is a live oracle at full
  request rate. The per-key throttle no longer limits guessing; it only delays honest
  wrong-typers. What limits guessing now is the per-process START bucket (120/min), shared by
  every login route. At 2 guesses/s, 2^80 takes about 1.9e16 years per account, and attacking N
  accounts at once only divides that by N. **Not exploitable.** The owner's rationale ("80 bits,
  the throttle adds nothing against guessing") holds.
- **Side effects of uncounted throttled misses (L1).** Refused tries never extend
  `last_failure_at`, so the streak ends 15 min after the last *counted* miss. An attacker can loop:
  10 counted misses, then unlimited uncounted ones, then repeat. The account gets one
  `login-locked` alert per streak, not per wave. Recommendation: now that counting can no longer
  block the correct code, count the throttled wrong tries (`throttleFail` before rethrowing).
  The streak then stays live and the alert keeps reflecting a real attack. Should-fix, not a
  blocker.
- **Enumeration.** A known and an unknown name run the same code and the same queries
  (`throttleKey`'s trusted-device lookup always runs). Both get 429 while throttled and 401
  otherwise. A difference appears only after a correct code (`assertNotDisabled`, the session). The
  lock alert's extra writes on the 10th miss for a real account were already on main. Nothing
  new here.
- **Old test edit (recovery.test.ts).** The edit only changes the S-109 rule: it adds a 5th wrong
  code that asserts 429 slow-down (wrong codes are still throttled), and the correct code now
  expects 200 instead of 429. Nothing else in the test was weakened. OK.

## S-110: password + new password + code applies at once (password.ts)

- **Thief with a stolen weak session plus the password, but no code.** The thief cannot reach the
  immediate path. Without `recoveryCode` the request goes through `gateChange` (staged). With any
  code the request must match the account's one unused code (80 bits; a wrong one is 401 and
  counted). `null` and non-strings are 400, and `""` matches nothing. Team-member sessions are
  refused before this (`requireSession` without `member`, 403 owner-only). A recovery session
  cannot hold a usable code: the code it logged in with is spent, and the replacement is
  revealable only to a strong login or after that session's own 24 h. **OK.**
- **A wrong code leaves the confirm token usable.** This is by design (`checkChangeCode` runs before
  `requireConfirm`), and it is tested. Is it safe? The token is bound to the session and the
  `set-password` action and has its own lifetime. Retries cost a try from the per-session
  `securityChange` bucket and count on the recovery-code key. What the holder gains is the ability
  to test codes against one token. With 80 bits that is the same oracle as above, so it is
  acceptable. One more thing: a session with no token at all can also test codes, because the
  check runs before `requireConfirm` (a correct code then fails confirm-required, a wrong one
  fails credentials-invalid, which is an oracle). The same 80-bit argument makes it acceptable.
  Noted as I1.
- **Spent and replaced atomically under the account lock.** Yes. `requireLiveSessionInTx` takes the
  account lock and re-checks the session. Then `holdInTx` runs. The code is spent with `update ...
  where id and account_id and used_at is null`, and rowCount 0 gives 401, so a parallel backup login
  or a second change loses. Then `applyPassword` and `renewRecoveryCode` run, all in one
  transaction, and any throw rolls everything back. The throttle reset happens after the commit.
  **OK.** No test races two uses (T1).
- **Fails closed during a hold.** Yes, twice. `requireNotHeld` as a preHandler (tested), and
  `holdInTx` under the lock in the transaction (not tested on its own; T2). A recovery session
  inside its hold is refused earlier by `requireSession`.
- **Other sessions ended.** Yes. `applyPassword` revokes every other session (recovery sessions
  included) and adds the alert, and the route closes their live streams. Drafts die with their
  sessions through migration 016's trigger. Tested with a thief session.

## M1 (MUST-FIX, high): a waiting change the thief already submitted survives S-110

A submitted `hold_changes` row does not die with its session ("a submitted change does not",
holdChanges.ts header). `settleChangesInTx` applies it at `due_at` whatever has happened since.
The S-110 path neither cancels waiting changes nor supersedes them.

Attack: the thief has the password, logs in weakly, stages and *submits* a password change to P_t,
and can also add a payout wallet or remove a method. The owner notices and uses S-110: their
password changes now, the thief's session ends, the code is spent. 24 h after the thief's submission,
P_t applies, which also ends the owner's sessions (applyPassword with keep = the thief's dead
session). The thief logs in with P_t. Any staged wallet also applies, which is money.

Mitigations that exist today are partial. The owner was alerted (`hold-changes-submitted`, push)
and any of the owner's sessions may cancel the waiting changes, but the owner must notice and do
it, and nothing in the S-110 flow points them there.

Severity: **high**. It defeats S-110's purpose and puts payout wallets at risk; it is not a 24-h
nuisance.

Fix, in two parts:
- (a) Pure correctness, no product call: in the S-110 transaction, drop every waiting
  `password` change of the account. A password change that was submitted before an immediate
  password change and applies after it is superseded, and must never overwrite a newer password.
  Add an alert or an entry in `hold-changes-applied`'s dropped list.
- (b) Owner question, with a recommendation: should S-110 (proof by recovery code) cancel **all**
  waiting changes of the account (wallets, methods, login name, team), the way an owner proof
  would? G58 says a strong login keeps them for review rather than discarding them. But S-110 is
  the owner's "my password is compromised" path, so I recommend cancelling them all in the same
  transaction and telling the person what was cancelled. At minimum, the S-110 success screen must
  list the waiting changes with a one-tap cancel.
- Add a test: the thief submits a password change and a wallet, the owner does S-110, then the
  clock advances 24 h. Neither change may apply.

## Other findings

- **F2 (medium, owner/design question): after S-110 a username-and-password-only owner has no
  usable recovery code for at least 24 h.** `renewRecoveryCode` creates the replacement but seals
  it for `revealDue`, which allows only a strong full login, or the recovery session after its
  24 h, and only one opened after the replacement. The S-110 caller's session predates it and is
  weak, so it can never reveal it. The S-111 copy says "Go to Security settings for a new recovery
  code". For a weak session, `POST /v1/account/recovery-codes` is staged and waits 24 h. So a
  password-only owner who just recovered with S-110 is left with no code they know until a staged
  new code applies. Security-wise that fails closed, which is good. But the copy promises more than
  happens, and an owner who needs the code again within 24 h is stuck. Recommendation: ask the owner
  whether the S-110 caller, having just proven the code, may see its replacement once. I lean yes:
  they just proved possession of the code, the session is the one that did it, and every other
  session has been ended. If not, make the copy say the new code arrives in 24 h. COPY-UNSIGNED
  already.
- **L1 (low, should-fix):** count throttled wrong codes (see S-109 above).
- **I1 (info):** code testing without a confirm token (see S-110 above). Acceptable at 80 bits. If
  the lead prefers, move `checkChangeCode` after the token's validity check but before the token
  is spent. That needs a check-then-consume split in `requireConfirm`. Not required.
- **I2 (info): the throttle key is per device-trust.** A thief's misses through S-110 on an
  untrusted device count on `recovery-code:<id>:anon`, the same key as the owner's backup login
  from an untrusted device. Thanks to S-109 that no longer locks the owner out. Good as is.

## Tests: are they meaningful?

- Yes for the S-109 rules (slow-down and lock both pass the correct code, wrong codes are still
  429 and uncounted, an unknown name behaves as before) and for S-110's main contract (staged
  without a code; with it: 200, nothing staged, code spent and replaced, thief logged out, no
  hold; wrong code: 401, counted, token reusable; no token: 403 and code unused; non-string 400;
  running hold 403 and code unused; strong session burns it too).
- Gaps:
  - T1: no concurrent-use test (backup login and S-110 with the same code at once; exactly one
    may win).
  - T2: the in-transaction `holdInTx` refusal is never reached by a test. The preHandler always
    refuses first; a hold starting between the preHandler and the transaction is untested.
  - T3: M1's scenario (submitted waiting changes) is untested.
  - The web test (recoveryBurned, 4 tests) covers the burned notices and the wrong-code text.

## Must-fix list

1. **M1:** a thief's waiting changes must not survive S-110. At minimum (a), superseded waiting
   password changes are dropped in the S-110 transaction. Plus the owner ruling on (b), cancel
   all, with my recommendation yes. Plus the T3 test.

Should-fix: L1 (count throttled misses), tests T1 and T2. Owner question: F2 (show the replacement
code to the S-110 caller once, or fix the copy).
