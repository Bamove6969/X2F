# RV2 review: feedback form limit (claude3), origin/wip/third-feedback-form-limit @5fee682

Reviewer: read-only helper. Diff read in full against merge base e7636c7 (GitHub main; main line a779ef9 = e7636c7 + a settings-only chore). Touched: `apps/api/src/feedback/form.ts` (+10/-8), `apps/api/test/feedbackForm.test.ts` (+38/-16). No web, docs or limits.ts changes.

## Verdict: APPROVED WITH MINOR

The change does what it says: the shared `TokenBucket` (30, 10/min, 503 `busy`) is gone and each account gets a `KeyedBuckets` bucket of capacity 1 that refills at 2/min, so one send per 30 s, refused with 429 `slow-down` `{ retryAfterSeconds }`. It is checked after the body has parsed and after the daily count, so a 400 or a daily-cap 429 never takes the 30 s token. The synchronous `take` comes before the `await`, so a parallel burst from one account gets one 202 and then 429s. This agrees with the owner removing the global daily cap on 1 Nov (e7636c7): nothing global is left on this route. None of the findings below block a merge. Two of them (M1, M2) need an owner or lead decision.

## Checks

| Check | Result |
|---|---|
| Diff vs merge base e7636c7 read in full | done (2 files) |
| Who "a person" is | `req.auth.accountId`: the account, not the session or device. All of a person's sessions and devices share one bucket, so opening a second session does not get around it. A team member's `accountId` is the team's (sessions.ts:34-37), so the whole team shares one bucket (see Q1) |
| Bypass | none found without a second account. Clearing cookies or using another device gives no fresh bucket. A restart resets it (same as the daily count, by design) |
| Locking out someone else | only within the same account: a held backup session (allowHeld) or a team member can keep the owner's 30 s gap and daily 5 used up. The daily part already existed; the gap adds nothing worse. Other accounts are never affected (tested) |
| Clock and window | at 29 s: tokens 0.9667, retry 1 s, 429. At 30 s: exactly 1.0, 202 (I checked the float math in node: values 30/29/15/1 s at 0.001/1/15/29 s). If the clock goes back, the bucket keeps `last = max(...)`, so the wait only gets longer and never goes negative. The UTC day change clears `sent` but not `gap`; the two limits are independent, which is correct |
| Memory | `KeyedBuckets` has `maxKeys` 100 000 by default, and buckets that have refilled are pruned first. Bounded at about 100k small entries. But entries are only pruned once the map goes over that cap, so every account's last send time stays in the map until restart (see M2) |
| Restart | everything is forgotten, so a restart allows one immediate send per account. Same as the daily count; acceptable for an in-memory limit. It is per process: with N API instances the limit is N sends per 30 s |
| Refusal shape | 429 `{ error: 'slow-down', retryAfterSeconds }`, the same family as the daily cap and other KeyedBuckets users. The web Feedback screen already handles 429/503 with `waitSentence` (Feedback.tsx:109) |
| UI copy | no web change. The 30 s refusal shows "Too many tries. Try again in 1 minute." (see M1) |
| Tests prove the 30 s window | yes for the edges: 29 s gives 429, 30 s gives 202, the other account is unaffected, and 40 accounts at once all get 202 (this would fail with the old 30-token shared bucket). The older tests are spaced 30 s apart. Weak spots in m3 and m4 |
| `npm ci` (npm 11.21.0) in a detached worktree | ok |
| vitest api: feedbackForm, purge, limits | 3 files, 51/51 passed |
| tsc --noEmit: apps/api | 0 errors |
| web tests and tsc | not run: this branch touches no web files (the M1 copy path is unchanged code) |

## Important

None.

## Minor

**M1. After a single send, the 30 s refusal says "Too many tries. Try again in 1 minute."** `apps/web/src/screens/Feedback.tsx:109` with `apps/web/src/screens/auth/refusals.ts:99-101`. `waitSentence` rounds up to whole minutes and words the refusal as a security throttle. Scenario: a trader sends a complaint, comes back to /feedback within 30 s to add a second point, and is told "Too many tries. Try again in 1 minute." But they tried once, and the real wait is at most 30 s. The text is COPY-UNSIGNED and comes from the login refusals, so the wording is the owner's call (Q2). The code is unchanged by this branch, but this branch is what makes the case common: before, a normal user could only reach a 429 after 5 sends.

**M2. The gap store keeps each account's exact last-send time in memory until restart.** `apps/api/src/feedback/form.ts:110,134` (via `KeyedBuckets`, limits.ts:96-136; it prunes only above 100k keys). The module's privacy note (form.ts:8-9) says the in-memory count "links no row to anyone". The old daily Map held only a count and was cleared at UTC midnight. The new map holds `accountId -> last` to the millisecond for every account that ever sent, across days. Scenario: someone with a heap dump and database access (the residual M1 threat model in form.ts:14-17) can match an anonymous row's insertion order (xmin/ctid) to the account whose `last` matches it. That is a tighter link than the documented residual. Technical fix (cheap): use a small `Map<accountId, untilMs>` and delete expired entries on each request (or at least clear it with `sent` at the day change), or keep only `ceil(now/30s)`. An entry is then useless after 30 s. Whether this is worth doing is a privacy call (Q3).

**m3. A failed insert still uses up the 30 s gap.** form.ts:134 vs 146-147. The daily count is given back on a database error, but `gap.take` is not. Scenario: a database blip makes Send fail with 500 ("That did not send. Try again in a moment."). The trader clicks Send again at once and gets M1's "Too many tries…" after one failed try. The test "a failed insert does not use up a send" (feedbackForm.test.ts:158-178) spaces every try 30 s apart, so it hides this. Fix: refund the token in the catch (KeyedBuckets has no `give`; a plain Map as in M2 makes this trivial), A refund is cleaner than taking the gap only after the insert: taking it first is what stops a parallel burst.

**m4. The test does not pin `retryAfterSeconds` for the gap.** feedbackForm.test.ts:230 checks only `>= 1`. At 29 s the value must be exactly 1, and right after a send it must be 30. Scenario: a regression that returned the daily value (hours) or a wrong rate (for example `perMinute: FEEDBACK_FORM_MIN_GAP_S / 60`, which gives a 15-minute gap) would still pass this assertion, although the 30 s → 202 check would catch the second case. Suggest `toBe(1)` at 29 s, plus one refusal at t0 that expects `toBe(FEEDBACK_FORM_MIN_GAP_S)`. Also add a parallel burst from one account (two posts in `Promise.all`, expect one 202 and one 429), because that ordering guarantee is what keeps double clicks out.

**m5. Stale wording elsewhere.** The `requireSession` comment (sessions.ts:278-281) still says only "at most FEEDBACK_FORM_DAILY a day". Add "one per FEEDBACK_FORM_MIN_GAP_S". The removed `FEEDBACK_FORM_BUCKET` has no other references (checked with grep), so nothing else is left over.

## Open questions (owner or lead, with a recommendation)

- **Q1. Is "a person" the account or the team member?** Today a team member and the team owner share one 30 s gap and one daily 5 (the key is the team's `accountId`). The key could be `memberId ?? accountId`, but then a team of N gets N×5 a day, and a member key is tied to the member, not to the row. Recommendation: keep the account key for the daily 5 (it is the existing rule). For the 30 s gap, a per-member key is harmless, but it is not needed for v1. Ask the owner only if teams are expected to send a lot of feedback.
- **Q2. Copy for the 30 s refusal (COPY-UNSIGNED).** Recommendation: a feedback-specific line with seconds, for example "You just sent feedback. You can send more in 30 seconds." for waits of 60 s or less, and keep the daily-cap text separate ("You've sent 5 today. You can send more tomorrow."). To tell the two apart, the API could add `reason: 'gap' | 'daily'`, as approvals does with `reason: 'approvals'`. Owner signs the copy.
- **Q3. Privacy of the in-memory last-send time (M2).** Recommendation: yes, keep only "blocked until" and drop it once it expires. It costs a few lines and keeps the module's "links no row to anyone" note true.
- **Q4. Multiple API instances.** The limit is per process. Recommendation: fine for launch (one instance); note it in the module comment if the deploy ever scales out.

## What I ran

All runs in my own detached worktree `~/x2f-worktrees/rv-formlimit` @5fee682, removed afterwards, each one under `flock ~/x2f-comms/check.lock`, one at a time:
- `npx -y npm@11.21.0 ci`: ok
- `(cd apps/api && npx vitest run test/feedbackForm.test.ts test/purge.test.ts test/limits.test.ts)`: 3 files, 51/51 passed. A first try with `--project api` from the root failed while resolving projects (it did not run any tests), so I ran it from the workspace instead
- `(cd apps/api && npx tsc -p . --noEmit)`: exit 0, no output
- The float check on the bucket's retry values was done in plain node, no lock needed.
