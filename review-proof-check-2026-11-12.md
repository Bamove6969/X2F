# Privacy and security review: `wip/lead-proof-check` 61e9ad96 (P-012/P-013, "Was this proof blurred correctly?")

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. Read-only on code. Detached worktree `rv-pc` at 61e9ad96 (base main 6ebed537), fresh `npm ci`, removed afterwards; dockerd not restarted.
The branch is two commits: 88b5ca63 WIP and 61e9ad96 READY (18 files, +824/-12). It adds:
- migration 367;
- `apps/api/src/proof/blurCheck.ts` (three trader routes, the staff list, a purge job);
- the staff route in `staff/feedback.ts`;
- `packages/proof` `blurCheck.ts`;
- the web API wrapper and `BlurCheck.tsx`, neither wired yet (NEEDS_PLAN_5_TASK_15);
- the trade-terms line.

## Verdict: PASS. 0 Major, 3 Minor (PC1-PC3), 3 Info

Nothing here leaks a trade, a person or an image. Every claim in the branch holds as written.

## The questions

**Only the two parties, only for their own trade.** All three routes take a trader session (`requireSession({ kinds: ['trader'] })`), then `sideOf` reads the trade's `buyer_account_id` and `seller_account_id`.
- A stranger, or an unknown or malformed code, gets 404, the same answer either way (no oracle). The announce route takes the trade row `for update`.
- `GET` lists only `blur_check_asks` rows for the caller's own `side`.
- An answer deletes the caller's own `(trade, proof, side)` ask `returning role, blur`. No such ask (never asked, or already answered) gets 404, so each party answers at most once per proof, and only when asked.
- Tested: stranger 404 on announce and list, and answer once. Not tested: a stranger *answering*. The same `sideOf` gate covers it.
- Team members: see PC1.

**Answers carry no trade code, account or time of day.** `blur_check_answers` has only:
- a random `uuid` id;
- `answered_on` (a `date`);
- the role, Yes or No, the No's comment;
- `method_id` and the blur kind.

The insert takes `role` and `blur` from the deleted ask and `methodId` from the trade, never from the body. The body is parsed strictly (`parseBlurCheckAnswer`: only `correct` and `comment`; a comment only on a No; at most 500 code points; control and format characters refused).

Nothing else records the moment:
- no `appendLog`, no jabber trigger on these tables;
- request logging is off (`app.ts`, `disableRequestLogging: true`) and `req.body` is redacted;
- the staff list orders by `(answered_on desc, id desc)` with a random id, so insertion order does not come back through the API.

Re-identification by the *combination* of columns is PC3.

**The 20-per-trade cap.** It is counted under the trade row lock (`select ... from trades ... for update` in the same transaction). A repeat of a known proof id answers its stored decision before the cap check and changes nothing (no counter bump, no new asks). A 21st new id gets 409 `too-many-proofs`, so asks per trade are at most 40 (two per proof). Tested.

**The staff list is gated to feedback.read.** `GET /staff/v1/feedback/blur-checks` uses the file's `opts` (`requireStaff('feedback.read')`, `config.perm`). Its row is in `test/staff/routes.ts` (owner and senior by role, grantable), so `staff/matrix.test.ts` checks every role and grant. It returns 50 rows a page plus the Yes and No counts over 30 days, with the method shown by name.

**Retention and purge.**
- `purgeBlurChecks` deletes answers with `answered_on < (now - 90 days)` as a date. A row lives 90 to 91 days, which is fine. The job is in `RETENTION_JOBS` (the order is pinned in `purge.test.ts`).
- `blur_check_proofs` references `trades` `on delete cascade`, and `blur_check_asks` references the proofs `on delete cascade`, so both go with their trade.
- Answers outlive the trade by design, since they don't name it. Tested at 89 and 91 days and after a trade is deleted.

**What the server learns that is new.**
1. Per trade, how many proofs were posted and each one's id. Ids are 16 random bytes (`newProofId`, `crypto.getRandomValues`); they encode no time, unlike a ULID. The API stores proof ids nowhere else, so an id links nothing.
2. For a proof that was asked, how it was blurred (`auto`, `manual`, `both` or `none`, so also "posted unblurred"). This sits linked to the trade and the side until that party answers, or until the trade is purged if they never do. Once answered, it lives on only in the answer, unlinked.
3. A site-wide proof counter.
4. When a proof is announced, only as the moment the row is written (no column holds it).

Proofs stay sealed: the server never sees an image or its key. Point 2 is the one genuinely new trade-linked fact, and it is the minimum needed to ask both parties. Worth a line in the privacy notes.

## Minor

### PC1: team members are refused on all three routes
`requireSession` with no `member:` answers 403 to every team member session (sessions.ts: "Left out, a member's session gets 403"). The trade routes pass `member: TRADE_READ` and similar, so on a team account none of the members who run its trades can announce, see or answer an ask.

This fails closed, so it is not a leak. But team trades will never be checked, and if the uploader is a member the receiver is never asked either. Suggest:
- `member: TRADE_READ` on the list and answer routes;
- on announce, whatever ability lets a member post in the trade chat (proofs go there).

Then add a member test.

### PC2: "uploader" is self-declared (feedback quality, not privacy)
The server cannot see proofs, so whoever announces a proof id first becomes its `uploader`, with the blur kind they choose. A party can:
- announce the *other* party's proof (they see its id in the chat) with a wrong blur kind, so the real uploader's announce just returns the stored decision;
- announce up to 20 made-up ids per trade. Each bumps the site counter and so shifts which real proofs the every-Nth schedule asks about.

The harm is skewed feedback numbers. No one learns anything, and asking or not asking about a proof decides nothing in the trade. Accept it and say so in the module comment, or later bind the announce to the sealed proof message (for example, the proof's chat envelope id) so only its sender can announce it.

### PC3: the answer row is unlinked by column, but not always by combination
`answered_on + method + role + blur` names no trade. But for a rare payment method on a quiet day, someone who can also list trades by method and date can often pick the trade. The two answers about one proof (uploader and receiver, same method and blur, often the same day) also pair up. Free-text comments are the bigger risk: a person may type their trade code or payment details into "what was wrong?".

Suggest:
- (a) a hint under the comment box (COPY-UNSIGNED), along the lines of "Please don't include your trade code or payment details";
- (b) optionally, in the staff list, show the method as its group, or hide it below a small count.

Retention is already short (90 days).

## Info

- **I1. No trade-state check on announce.** A proof can be announced on a trade in any state, including closed or cancelled. That is harmless (the cap still holds), but the UI should only call it from an open trade.
- **I2. A bad schedule setting fails toward asking.** No end date means every proof is asked, and a bad N falls back to 10. Tested.
- **I3. The web side is unwired.** `api/blurCheck.ts` and `BlurCheck.tsx` are unused until the BlurEditor lands (NEEDS_PLAN_5_TASK_15). The component trims the comment and caps it at 500 to match the API. The new trade-terms line (`BLUR_CHECK_LINE`) is COPY-UNSIGNED, and `tradeTerms.test` was updated for the extra line.

## Tests run (serialised runner)
- `packages/proof` `blurCheck.test.ts`: 7/7 passed
- `apps/api` `blurCheck.test.ts`, `purge.test.ts`, `staff/matrix.test.ts`, `staff/content.test.ts`: 123/123 passed (4 files)
- web `blurCheck.test.tsx` + `tradeTerms.test.ts`: 10/10 passed (2 files)

Not run: the rest of the suites, Playwright, `npm run check`.
