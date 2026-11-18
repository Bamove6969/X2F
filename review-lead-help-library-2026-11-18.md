# Review: wip/lead-help-library 0f07623a (help library / FAQ, 89 questions at /help, /help/faq, /help/<topic>)

Reviewer: independent helper (rev-help), 18 Nov 2026, about 11:00 BC time.
Diff: 001959cc (wip/lead-land-tw at branch point)..0f07623a, 4 commits, 9 files, +1592/-9.
Worktree: .claude/worktrees/rev-help (detached at 0f07623a).

## Verdict: CHANGES REQUESTED

The page itself is well built (real disclosure buttons, labelled search, live count, deep links, static
content only on the front door) and the facts check genuinely catches a drifted constant. But three
privacy and money answers say something the code does not do (B1, B2), one answer is already wrong
on main 8e7e63d5 (B3), and the branch's own test goes red as soon as train-1 lands (B4). Every fix
is a wording or source-note change. None needs new code.

## Tests run (outside the lock, nice -n 10, per the 14:11 UTC lock rule)

- At 0f07623a, `@x2f/web`: helpLibrary.test.tsx, frontDoor.test.tsx, cantDoThat-lint.test.ts,
  moderator-badge-scope.test.ts, copy-lint.test.ts: 5 files, 141 passed, 0 failed.
- `npm run copy-lint` at 0f07623a: clean. Probe: putting "Unable to change it." into an answer is
  flagged at helpLibrary.ts:162, so copy-lint does scan the library's answers.
- On a scratch trial merge of 0f07623a onto origin/wip/lead-train-1 ef50b6e0 (a local commit, not
  pushed), the same 5 files: 1 failed, 155 passed. helpLibrary.test.tsx "each note still points at
  the words it names" fails (see B4).
- Not run: the full `npm run check` (the brief said not to), Playwright (apps/web/e2e/help.spec.ts).

## Facts test: proven

- I changed only `NUDGE_GAP_MS` from 15 to 20 minutes (apps/api/src/nudge/routes.ts:16, a constant
  the web app does not import and whose source note holds no number). Result: 1 failed, 13 passed,
  with `nudge: says "every 20 minutes" (nudgeMinutes): expected false to be true`. Reverted.
- I changed `TIMERS.extendMin` from 30 to 31 (packages/trade/src/timers.ts:14). The source-note
  test, the facts test and the self-check all went red. Reverted.
- So drift is caught, both through imported constants and through `constIn`. The weak spots are m4
  and M4.

## Trial merge onto train-1

- `git merge-tree --write-tree origin/wip/lead-train-1 0f07623a`: clean, no textual conflicts. The
  same holds onto origin/main 8e7e63d5.
- Semantic breakage: 5 source notes stop matching (B4).

## Blocking

**B1. Privacy: "X2F asks for and keeps no name" is false while sign-up asks you to sign your name.**
helpLibrary.ts:87 (personal-details), :603 (never-asks: "your real name") and :651 (what-is-stored:
"X2F keeps no name, email or phone number, because it never asks for them"). But the Terms step says
"tick the box, sign your name" (apps/web/src/screens/setup/Terms.tsx:250). The pad offers "Type your
name to sign" (SignaturePad.tsx:163, 205). The server stores that signature with the account, and
termsSignature.ts:29-30 says it "identifies a person". what-is-stored also contradicts the library's
own pgp-key-name (:688): X2F keeps v4 PGP keys whole, with user IDs "which often hold a real name and
email" (docs/public/x2f-crypto-spec.md:34, 211). Suggested fix:
- Say the Terms signature may be a scribble or an X (SignaturePad.tsx:205 already does), and that it
  is stored sealed and erased when the account closes.
- Add the PGP user-ID caveat and the Terms signature to what-is-stored.
- Drop "your real name" from never-asks, or qualify it.
This is copy, so it is an owner question. My recommendation is the qualified wording.

**B2. Money: who pays the Monero network fee.**
helpLibrary.ts:720 (fee-vendor-sells) says "The buyer receives the full trade amount". In the code,
output 0, the party receiving the trade's XMR, "bears the network fee": payouts.ts:6-8, and the
spec at x2f-crypto-spec.md:103 says "output 0 short by exactly the fee". So on a release the buyer
receives the amount minus the network fee (up to 0.01 XMR, spec:101).
- :736 (fee-when) says a refund sends "everything in the escrow" back to the seller. That is also
  minus the network fee.
- :443 (network-fee) only says the fee "is paid from the escrow". It should say it comes out of what
  the receiver gets.

**B3. Already stale on main 8e7e63d5: payout address retention.**
:673 (addresses-kept) says "Until 90 days after the trade closes". Main's retention promise
(packages/trade/src/retention.ts:5-8 and apps/api/src/retention/tradePurge.ts:22-29, merged after
this branch's base) deletes an undisputed trade whole 30 days after it closed, addresses included.
Only a trade that had a dispute lasts 90 days, counted from the dispute closing.
- what-is-stored (:651, "your trades with their payout addresses") also needs the self-destruct.
- The library has no question for "how long is my trade kept?". The trade room now shows "This trade
  self-destructs on ..." (SelfDestruct.tsx).
- Rebase onto main and re-check the privacy topic against retention.ts.

**B4. Red after train-1 lands: 5 source notes stop matching (helpLibrary.test.tsx:138-153).**
On the trial merge:
- payment-details: apps/web/src/chat/ChatPanel.tsx:366 PAY_DETAILS_TITLE (it is now at 365).
- payment-proof: BuyerPay.tsx:374 "The upload itself is Plan 5" (gone).
- payment-proof: apps/web/src/api/blurCheck.ts:8 NEEDS_PLAN_5_TASK_15 (gone).
- chat-kept: apps/api/src/chat/retention.ts:8 (now at 9; this one has moved on main already).
- device-copy: apps/api/src/chat/retention.ts:18-19 "is told 410" (now at 20).

Whichever branch lands second has to fix these. The facts test passed on the merge, so no stated
number drifts.

## Major

**M1. device-copy over-promises the device erase.** :666 says "your device erases its copy the next
time it connects". The API answers 410 `chat-purged` only for CHAT_PURGED_MARK_DAYS = 365
(apps/api/src/chat/retention.ts:17-22). After that it answers 404, and a 404 keeps the device's
record (apps/web/src/chat/engine.ts:48-50). The cited spec line also says the opposite of the answer
(x2f-crypto-spec.md:168: "Erasing that local record when a chat is purged is not wired yet"). The
spec is stale, but a source note should not contradict its answer. Fix: "if it connects within a
year", and cite engine.ts.

**M2. new-device-alone sends people to the recovery code with no warning of the cost.** :560 ends
"use your recovery code instead". A recovery-code login logs out every session, holds the account for
24 h, cancels unfunded trades and pauses funded ones (auth/hold.ts:16-21). Add one sentence, or link
#recovery-login.

**M3. paid-late implies a dispute protects a late payer.** :264 says "you can open a dispute straight
away". That is true, but machine.ts:483-488 says the refund "usually lands anyway": the moderator
co-signs within about 5 s, and the case continues as an after-refund dispute. The answer should not
suggest the XMR stays in escrow.

**M4. Numbers the owner can change at run time are stated as fixed, and the facts check reads only the
defaults.**
- who-can-post :194 says "3 buy offers and 3 sell offers". apps/api/src/offers/routes.ts:261 says
  "Owner settings override these defaults".
- appeal :496 says "within 48 hours". That number is `appealWindowH`, a staff setting
  (settingsDefaults.ts:15, 27).
- device-limit :552 hedges ("unless X2F sets another number"). The other two should do the same, or
  read the live setting.

## Minor

- **m1.** cancel-waiting-changes :521 says only a PGP key, passkey or security key login can apply
  waiting changes now. "A strong login may approve them now" (hold.ts:13-14), and a password with an
  authenticator code is a strong login (strength.ts:25). The answer under-states who can do it.
- **m2.** who-signs :354 cites the spec table row "Dispute ruling (planned)" (spec:68). Spec:49 says
  rulings are refused. The code has built them (apps/moderation/src/rulings.ts:1-10). Cite the code,
  not the stale spec.
- **m3.** These claims are not tied to code:
  - moderator-time :467 "it is usually sooner".
  - second-approver :489 "For most trades, yes". Also, any account action needs a second person
    (packages/staff/src/dispute.ts:212-213).
- **m4.** The self-check "a changed constant turns the facts check red" (helpLibrary.test.tsx:171-175)
  changes no constant: it edits the answer string, so it is tautological. My manual edit above proves
  what it claims to.
- **m5.** Two facts are read from prose, not code: escrowKeys from the spec text, and
  giftCardRangeExample from a comment (helpLibrary.test.tsx:103-104).
- **m6.** The `<= 90` cap (helpLibrary.test.tsx:129) leaves room for one more question.
- **m7.** Accessibility:
  - Every answer panel is `role="region"` (HelpLibrary.tsx:72). With many open, that is up to 89
    landmarks. The APG advises against region for more than about 6 panels; drop the role and keep
    `aria-labelledby` on a plain div.
  - "Link to this answer" is the same link text 89 times (HelpLibrary.tsx:76). It is fine in
    context, but `aria-describedby` pointing at the question would help.
  - Question ids are bare global ids such as `price`, `bans` or `nudge` (HelpLibrary.tsx:63), so they
    could collide with other ids on the page. They are published deep links, so decide before
    landing.
  - Otherwise good:
    - Buttons carry `aria-expanded` and `aria-controls`.
    - The search box has a label and sits in `role=search`.
    - The count is a polite live region.
    - The heading levels are correct.
    - `:focus-visible` outlines are present.
    - Reduced motion is honoured.
    - A deep link moves the focus.
- **m8.** passkey-or-security-key :124. After train-1 (4ce2d024, 6b66f651) every security key needs
  its PIN (user verification), and a key without one is refused with KEY_NEEDS_PIN. Add "with its
  PIN".

## Front-door exposure: OK

- Logged-out visitors can open `/help(/[a-z-]+)?` (frontDoor.tsx:22).
- HelpLibrary.tsx renders only static strings from helpLibrary.ts and fetches nothing.
- HelpTopic reads the session only to pick the back link and the Settings link.
- No user or marketplace data reaches the page.
- The answers hold no anti-abuse thresholds: the large-trade limit for a second approver is not
  stated.
- The test at helpLibrary.test.tsx:316-323 checks that the library is the same signed in and out.

## Copy rules: OK

- copy-lint is clean and covers the answers (probe above).
- No "half" anywhere, enforced by the test at helpLibrary.test.tsx:185-187.
- COPY-UNSIGNED is on helpLibrary.ts:6, HelpLibrary.tsx:12 and every new string in HelpTopic.tsx.
- No moderator-tag words (moderator-badge-scope passes).
- The "not in the app yet" phrasing avoids refusal wording.

## Truth sample

I checked 60 answers against their cited lines. These match the code: every getting-started answer
except personal-details (B1); every trading answer except paid-late (M3); every escrow answer
except network-fee (B2); every disputes answer; every safety answer except new-device-alone (M2),
cancel-waiting-changes (m1) and never-asks (B1); every teams answer; privacy chat-kept,
who-reads-chat, pgp-key-name, terms-signature and closed-account-data; and fees who-pays-fee,
fee-vendor-buys and fee-dispute. who-reads-chat is good: it says honestly that "staff read only
disputed chats" is today a rule, not a lock.

## Answers that go wrong or incomplete once train-1 (ef50b6e0) lands

1. **payment-proof (:322)**, "not in the app yet". The upload, the blur and the moderator-only
   unblurred copy are built, but behind `VITE_X2F_PROOF_UPLOAD=1`, which is off by default
   (apps/web/src/proof/flag.ts:8-13). So the sentence stays true for a default build, but its two
   sources vanish (B4) and it becomes false the day the flag flips. Owner or lead decision: either
   make the answer depend on `proofUploadOn()`, or reword it now and re-cite flag.ts.
2. **passkey-or-security-key (:124)**: every security key now needs its PIN (m8).
3. **personal-details (:87), username-display-name (:94), what-is-stored (:651) and
   pgp-key-name (:688)**: these become incomplete.
   - Public profiles at /u/:name (logged-in only) show completed trades, disputes won and lost,
     reviews (month and year, never the author), badges, and "Account protected with PGP".
   - The optional public signed record can carry the PGP fingerprint.
   - Source: 2a1212ee and 67f0c34f, Profile.tsx:1-16.
   - The library has no "who can see my profile?" question and no badge or record questions.
4. **moderator-sees (:475)**: still true, but train-1 adds "Request unblurred proof" on the
   moderator's case (ModCase.tsx:343-349, flag-gated). Worth one sentence once the flag is on.
5. **login-methods (:101)**: still true. Train-1 adds that Settings refuses a removal that leaves a
   password alone, and that the password cannot be removed while an authenticator app is on
   (4ce2d024, 30bbdf30). Consider adding this.
6. **payment-details, chat-kept, device-copy**: these are line drift only (B4).

Already wrong on main, independent of train-1: addresses-kept and what-is-stored (B3).

## Owner questions (recommendations)

- B1 wording on names and the signature. Recommendation: "X2F asks for no email or phone. To sign
  the Terms you draw or type a signature (a scribble or an X is fine); it is stored sealed and never
  shown to anyone."
- The payment-proof answer while the upload flag is off. Recommendation: make it depend on the flag.
- Whether the answers should name owner-changeable numbers at all (M4). Recommendation: say
  "normally" and read the live setting later.
