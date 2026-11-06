# RV2 round 2: feedback form limit (claude3), origin/wip/third-feedback-form-limit @70821e98

Reviewer: read-only helper. Scope: `git diff 5fee682 70821e98`. That is one commit (70821e98) with no merges, touching 3 files: `apps/api/src/feedback/form.ts` (+71/-8), `apps/api/test/feedbackForm.test.ts` (+84/-3) and `apps/api/src/auth/sessions.ts` (+2/-1). There are no lockfile, web or limits.ts changes. Round 1: `review-form-limit-2026-11-06.md` on 5fee682.

## Verdict: APPROVED WITH MINOR

m3, m4 and m5 are fixed and proven by tests. M2 is fixed for the busy case. One gap is left (N1 below): the sweep runs only when someone sends, so when nobody sends, the last senders' exact times stay in memory. N1 does not block a merge. M1 is unchanged and is still the owner's copy call.

## Per-item status

| Item | Status | Evidence |
|---|---|---|
| M1 web refusal copy ("Too many tries. Try again in 1 minute." after one send) | OPEN, owner call (copy). Not touched | No web files in the diff. Feedback.tsx:109 still maps every 429/503 to `waitSentence`. Round 1's Q2 is still open: a feedback-specific line with seconds, plus optional `reason: 'gap' \| 'daily'` |
| M2 limiter kept exact last-send times | FIXED, with the gap in N1 | `KeyedBuckets` is replaced by `SendGap` (form.ts:99-142), a `Map<accountId, blockedUntilMs>` holding nothing else. `take` sweeps expired entries from the front first (form.ts:116-121, 125). Entries are re-inserted on each take (form.ts:129-130), so insertion order is expiry order and the sweep can stop early. Bounded by `maxKeys` (form.ts:131-134). The route uses it at form.ts:166 and 192 |
| m3 failed insert refunded the daily send but not the 30 s gap | FIXED | `take` returns `until` (form.ts:192). The catch calls `gap.give(accountId, until)` (form.ts:204). `give` deletes only if the stored value still equals that `until` (form.ts:139-141), so a stale give cannot clear a newer gap. Test feedbackForm.test.ts:181-197 (500, then an immediate retry gets 202, then the next try gets 429 with 30) **fails on 5fee682** ("expected 429 to be 202") |
| m4 loose retryAfterSeconds test, no same-account concurrency test | FIXED | Straight after a send: `toEqual({error:'slow-down', retryAfterSeconds: 30})` (test:245-248). At 29 s: `toEqual({…, retryAfterSeconds: 1})` plus the `retry-after: 1` header (test:252-253). Burst test: two parallel posts from one account give `[202, 429]` and exactly 1 row (test:263-271). These pass on 5fee682 too, which is expected (the old code was already correct), so they are regression guards. A mutant that takes the gap after the insert's await fails the burst test ("got 2" rows), so the guard works |
| m5 stale requireSession comment | FIXED | sessions.ts:281 now says "at most FEEDBACK_FORM_DAILY a day and one per FEEDBACK_FORM_MIN_GAP_S" |
| Q4 multiple instances | Documented | form.ts:16-17 |

## New findings

### N1 (Minor, privacy, lead/owner call). The sweep runs only on `take`, so when nobody sends, the last senders' exact send times stay in memory

form.ts:13-15 says "after FEEDBACK_FORM_MIN_GAP_S nothing in memory says when an account last sent", and form.ts:94 says "an entry lives at most `gapMs`". Neither is quite true. `sweep` is called only from `take` (form.ts:125), and `take` runs only after a request has parsed and passed the daily count (form.ts:177-192). A refused, malformed or daily-capped request does not sweep, and no timer sweeps. `until - 30000` is the exact send time to the millisecond.

Scenario: at launch, feedback is rare. A trader sends an anonymous complaint at 23:10, and nobody else sends anything until 09:00 the next day. For about 10 hours the heap holds `accountId -> 23:10:xx.xxx + 30 s`. Someone with a heap dump and database access (the threat model in form.ts:19-22) can match that account to the newest anonymous row. This is the same link round 1's M2 described, now limited to the last senders before a quiet spell instead of every sender. The SendGap test's own name says so: "forgets ... on the next request from anyone" (test:285).

Technical fix (cheap): in `take`, schedule `setTimeout(() => this.sweep(clock()), gapMs).unref()` (with the injected clock), or keep one unref'd timer for the earliest expiry. Either way an entry really lives at most `gapMs`, and the comment becomes true. If that is not wanted, the comments at form.ts:13-15 and 94 should be reworded to "dropped on the next send by anyone". Whether the timer is worth it is a privacy call. **Recommendation: add the timer** (a few lines). Otherwise fix the comment.

### Note (pre-existing, not from this diff, for the lead)

The daily `sent` Map (form.ts:169) keeps accounts in the order they first sent today, until UTC midnight. That is a weak ordering link to anonymous rows (and their ctid order), and round 1 did not raise it. It does not hold timestamps. It is outside this branch's scope and is recorded only so the privacy picture is complete.

### Checked, nothing found

- `give` vs. sweep or overflow while an insert is in flight: if the entry is already gone, `give` does nothing, and a newer `until` for the same key is left alone (tested at test:300-309).
- Clock steps back: entries after the step expire earlier than the head, so they linger until the head expires (at most about the step plus 30 s). Nothing is refused wrongly beyond the step. Same behavior as before.
- Overflow loop (form.ts:131-134): it deletes the oldest entry only while size > maxKeys, so normally it costs O(1).
- Order: the daily count is checked before the gap is taken, and a gap 429 throws before `sent` is increased, so a refused try never uses up a daily send.
- `KeyedBuckets` import removed. limits.ts is unchanged, and other KeyedBuckets users are untouched.

## Checks

| Check | Result |
|---|---|
| Diff 5fee682..70821e98 read in full; merges in range | done; no merges (1 commit) |
| Lockfile changed | no (`npm ci` with npm 11.21.0 run anyway in a fresh worktree: ok, 296 packages) |
| vitest api: feedbackForm, purge, limits @70821e98 | 3 files, **56/56 passed** (51 in round 1, +5 new) |
| tsc --noEmit apps/api @70821e98 | exit 0 |
| New tests against old src (5fee682 form.ts, new test file) | 4 failed / 36 passed: the m3 route test fails as it should; the 3 SendGap unit tests fail because `SendGap` does not exist. The m4 assertions and the burst test pass (the old code was already correct there) |
| Mutant: gap taken after the insert, and `sweep` removed from `take` | 2 failed / 38 passed: the burst test ("2 rows") and the SendGap "forgets" test ("size 2") catch them |
| Web | not run: there are no web changes |

## What I ran

All in my own detached worktree `~/x2f-worktrees/rv-formlimit2` @70821e98 (removed afterwards), each command under `flock ~/x2f-comms/check.lock`, one at a time, with `free -m` checked first:
- `npx -y npm@11.21.0 ci`: ok
- `(cd apps/api && npx vitest run test/feedbackForm.test.ts test/purge.test.ts test/limits.test.ts)`: 56/56
- `(cd apps/api && npx tsc -p . --noEmit)`: exit 0
- `git checkout 5fee682 -- apps/api/src/feedback/form.ts`, then `npx vitest run test/feedbackForm.test.ts`: 4 failed / 36 passed (as expected)
- I restored 70821e98 form.ts and applied 2 mutants with a script, then ran `npx vitest run test/feedbackForm.test.ts`: 2 failed / 38 passed (as expected). Restored afterwards, and the worktree was removed with `git worktree remove --force`.
