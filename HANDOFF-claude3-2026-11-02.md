# HANDOFF — claude3 (claudethird), 2026-11-02 ~07:40

Fresh session: read this file, then the tail of `~/x2f-comms/to-third.log`, then ack in `to-lead.log` and re-arm a Monitor on `to-third.log` (15 s poll, re-arm every 30 min — it lapsed once on 11-01 and lines were missed).
Rules: `~/x2f-comms/helper-common.md`; report ONLY to the lead (to-lead.log); owner rule: NO product/privacy/copy/limits choice without the owner (ask the lead with options); finish before starting new; push after every commit; flock every test run. Main line = `origin/claude/compassionate-johnson-k95ssr` (b6835ee at handoff). Memory: WSL ~6 GB shared, max 3 helpers.

## Branches I own

| Branch | Head | State | Worktree (~/x2f-worktrees/) | Next step |
|---|---|---|---|---|
| wip/third-p5-reviews-api (C4 → C12/C12b → P3) | 0ca49284 | IN LEAD REVIEW for C12/C12b (8cb4ea2c); P3 commit on top is **WIP, untested** | third-p5-reviews | P3: run checks on 0ca49284 (tsc api; vitest reviews*, disputes*, schema; full @x2f/api alone), fix, final commit `feat(api): reviews of an overturned trade are erased (owner)`, report |
| wip/third-p5-proof-core (C5 → P1) | 1ddbeedc | approved (b5e85cf) + P1 owner answers **WIP, check status** | third-p5-proof | P1: confirm tsc + vitest @x2f/proof green on 1ddbeedc (helper may have reported; see below), final commit, report; then C7/C8 need this merged in |
| wip/third-p5-past-rep (C9 → P2) | c341b324 | approved round 2 (8ddbd4d) + P2 **WIP "implementation (untested)"** | third-p5-pastrep | P2: run checks (tsc accounts/api/web; pastrep, pgp, coolingOff, schema; semgrep; copy-lint; full api alone), fix, final commit, report |
| wip/third-feedback-form-limit (NEW) | 171b38ad | **WIP**: owner's 1-send-per-30-s per person replaces the shared bucket; tsc api clean; vitest feedbackForm/feedback was still queued on the lock | third-form-limit | run `vitest feedbackForm.test.ts feedback.test.ts` under flock; fix; final commit; report to lead (branch from main b6835ee; land via lead) |
| wip/third-p5-proof-envelope (C7) | a8d9dabb | APPROVED; waits on owner items (lead) | third-p5-envelope | merge P1's proof-core head when the lead calls it |
| wip/third-p5-smart-check (C8) | d85f859a | APPROVED; card items 62-64 on hold with the lead | third-p5-check | same as C7 |
| wip/landing-p5-feedback (lead's landing branch; my C13) | 04a45156 | C13 done (no shared cap on /v1/feedback); in lead review | third-feedback-land (detached) | none unless the review asks; ff pushes only |
| wip/third-design-fixes-a (C11) | aacb2fd2 | LANDED (main b6835ee) | third-design-a | none |
| wip/third-fix-attestation-flake (C10) | ae3a8772 | LANDED | third-flake | none |
| wip/third-p5-feedback (C6) | b01186c6 | superseded by the lead's landing-p5-feedback | third-p5-feedback | none |

All worktrees were clean (nothing uncommitted) at handoff.

## Helpers possibly still running at handoff (told at ~07:20 to commit + push + report and STOP)
- P1 proof core: agent ae8cdc8487a3606b4 (worktree third-p5-proof)
- P2 past-rep: agent a16992c1234c0b236 (worktree third-p5-pastrep)
- P3 C12 overturn erase: agent a8ac086f6efd1373e (worktree third-p5-reviews)
After the clear these are gone; check `git log -3` in each worktree and `git status` before resuming. Their final reports (if any arrived) are in to-lead.log.

## What each WIP must contain (owner answers, lead-reviewed 07:04-07:10)
- **P1 (proof)**: item 35 detector = safety net (note); item 34+36 UPI IDs blurred in PROOFS and REFUSED in review NOTES (owner clarified 07:10: notes refuse ALL personal details incl. UPI; chat untouched); item 37 catch 15/16-digit dash-separated and '+'-led numbers (rest best effort); item 29 notes allow thousands-separated numbers up to ~9 digits, 15-16-digit card-length still refused; item 30 foreign name labels as a DATA FILE (+ coordination note: "did the auto-blur get it right?" prompt with a comment box for every uploader belongs to Task 15/Design).
- **P2 (past-rep)**: 70 owner-only (as built); 71 ACCEPT signatures with an email (Signer's User ID) and store them ENCRYPTED (own AAD), keep header stripping; 72 same key allowed for two sites of the SAME account, still refused cross-account (race-safe); 74 a revoked key may file a fresh claim (back to a moderator); 75 strict (no future allowance) + 4-point help COPY-UNSIGNED: key format (dashes/spacing, top and bottom alike), check computer date/time, SIGN don't encrypt, up-to-date PGP software; 76 keep 10/h.
- **P3 (reviews)**: an OVERTURNED trade's reviews (and skips) are ERASED; a trade that finishes normally after a dispute keeps them. Open question: subtract an overturned trade from account_traded_totals?
- **Form limit**: 1 send / 30 s PER PERSON (owner + lead 07:08); FEEDBACK_FORM_DAILY 5/account kept — **question for the lead**: the owner also said "still unlimited", so should the daily 5 go too?

## On HOLD with the lead/owner (not built)
- Item 62 (any-amount green card), 63/64 (owner wants POP-UPS to the proof POSTER, not seller-card lines; screens later), 65 (disclaimer + mods trained + video evidence).
- C12/C12b questions (lead has them, to-lead.log ~02:5x): GET …/review shape; volume line wording ("over $X" vs "$X+"); toggle = vendor setting "Would you like to display total amount of trades to date (min $10,000)" (owner); imported verified volume needs a USD field from Task 10/11; buyer cancel counted at settled refund.
- C11 questions (lead): "goes to" twice on shot 59; appeal lien lines; send appealWindowH from the API.
- C10 question: runtime.ts keeps r.intent in memory after a failed persist.

## Owner answers record
`~/x2f-comms/owner-answers-2026-11-01-claude3.md` (sessions 1 and 2 + addenda; the owner asked the lead to review every answer and ask him about anything unclear). Lead reviewed and settled most of them 07:04-07:10 (see to-third.log).

## Test caveats
- P1, P2, P3 and the form-limit WIP commits were pushed BEFORE their final checks (handoff deadline). Run the checks above before reporting any of them as done.
- C12b (8cb4ea2c): full api 1480 + 1 todo and web 1146 green (rerun by me 02:3x).

## Addendum (07:4x): helper final reports (full text in my session; key points here)

**Form limit (wip/third-feedback-form-limit @171b38ad):** vitest feedbackForm + feedback ran: 32 passed, **3 failed**: older tests that send twice from the SAME person within 30 s (the new rule refuses that, as intended): "takes a tab, ZWNJ (Persian) and ZWJ (emoji sequences): review M5", "a failed insert does not use up a send (review M3)", "a named row holds the account id and the refusal code, so staff can reach out". Fix: advance the clock by FEEDBACK_FORM_MIN_GAP_S between a person's sends in those tests (behaviour is right). Then rerun, final commit, report. Question for the lead: drop FEEDBACK_FORM_DAILY (5/day) too, since the owner said "still unlimited"?

**P1 proof (@1ddbeedc), red run before implementation was 5 failing / 159 passing; implementation unchecked.**
- Next: tsc + vitest @x2f/proof under flock. One existing test WILL fail: the per-country phone table's notes check for ES `612 345 678` and PT `912 345 678`, which item 29 (grouped numbers <= 9 digits allowed in notes) now lets through in notes (still masked in images). Update that test after the lead answers Q1.
- Questions: (1) accept that bare 9-digit space/dot-grouped phones pass in NOTES (+34/(0) forms still refused)? (2) comma-grouped numbers over 9 digits were never refused in notes: refuse them? (3) apostrophe thousands separator (1'250'000) in the item-29 rule? (4) item 30 label lists (es de fr nl it pt in packages/proof/src/nameLabels.ts; colon-only short prepositions; `para` counts at line start) need review.
- After landing-ready: merge into C7 (envelope) and C8 (smart check).

**P2 past-rep (@c341b324), main b6835ee merged (c4f35a25, 206/206 then); implementation unchecked.**
- 71: `signature_enc bytea` (304 edited), sealed with PAST_REP_SIG_AAD 'x2f/pastrep-sig/' + claim id. 72: partial unique index -> plain index + trigger `past_reputation_one_account_per_key` (advisory xact lock on the fingerprint, 23505 'past_reputation_fingerprint_account' -> 409 fingerprint-claimed). 74: works (revoked not live). 75: `help: string[]` on refusal bodies from apps/api/src/pastrep/help.ts PAST_REP_SIGNING_HELP (COPY-UNSIGNED), web untouched.
- Next: tsc accounts/api/web; vitest pastrep, accounts pgp, coolingOff, schema; semgrep; copy-lint; full api alone; final commit. Likely breakers: race test expects exactly [201, 409]; db update test expects 23505.
- Questions: (1) after A's claim is REVOKED, account B can claim that key (only live rows are checked) — should one-key-one-account also consider revoked rows? (2) help on which refusals (all start key refusals incl. key-private/too-large/multiple)? (3) item 75 wording COPY-UNSIGNED, presentation = Claude Design.

**P3 reviews (@0ca49284), main b6835ee merged (c0aaca9d, reviews 36/36 then); overturn code unchecked.**
- "Overturned" = Plan 4 appeal round-2 ruling differing from round 1, read from dispute_rulings (108) via overturnedSql; reviewableSinceSql returns null for it (gate/pending/POSTs refuse). Erase: `eraseOverturnedReviews(client, code)` (trade row FOR UPDATE, then `set local role x2f_purge`, delete reviews + review_skips, restore role). New migration 308_overturned_reviews.sql (grants x2f_purge on review_skips; 308 free). Tripwire NEEDS_PLAN_4_OVERTURN_ERASES_REVIEWS. 5 new tests at the end of reviews.test.ts.
- Next: typecheck api (watch the Queryable import / ruling() helper in reviews.test.ts); vitest reviews, reviews-gate, reviews-tripwire, disputes, schema (308 may need adding to schema lists); copy-lint; full api alone; final commit.
- Questions (owner via lead): (1) does "overturned" also cover a later non-appeal dispute (late-funds escalation ruled the other way; dispute after refund)? (2) an overturned trade is never reviewable again — confirm; (3) subtract an overturned trade from account_traded_totals? (4) scope: erase only bites on later disputes (seq >= 2), since a first dispute blocks reviewing until final; (5) Plan 4's round-2 transaction must lock the trade row before/with the erase.
