# Re-review 6 (confirm pass): wip/lead-mod-chat @197ccfeb, 18 Nov 2026

This is an addendum to `re-review-5-lead-mod-chat-2026-11-18.md`. It covers one commit on top of 978d1b2b, read in a detached scratch worktree. I changed no code.

## Verdict: APPROVE

- **B1 is fixed.** The marker at `apps/api/src/disputes/staffRoutes.ts:638` is now `NEEDS_P5_PROOF_ENVELOPE`. The disputes/staff test passes.
- **m1 is fixed.** `now` is taken inside `locked()`, after the chat row's `select … for update`, so the stored times follow the lock order.
- **m2 is fixed.** There is a concurrent test: three rounds of two parallel v1 posts for one request, each giving exactly `[201, 400]` and one stored v1 row.
- **Moving the decision 16 check ahead of the stale-seq check opens nothing:**
  - Both checks run in the same transaction under the same row lock, and both must pass before the insert. The order only decides which refusal a failing post gets.
  - A v2 post (`v1InKeyed` false) is unaffected.
  - A v1 post that no request allows now gets 400 instead of perhaps 409. That tells the poster only whether a request for their own side is open, and they see that in their dispute view anyway.
  - Nothing is stored or budgeted differently: the budget is still taken before the lock, as before.
- **INFO, no change needed.** `proof-request` does not take the chat row lock. A re-request that commits in the moment between the post reading the clock and running the check query could still allow one extra moderator-only v1, which no trader engine opens. The window is now sub-millisecond; closing it fully would mean comparing against the database's own time or locking the chat in `proof-request`.

## Tests (nice, no lock)

| Suite | Files | Passed |
|---|---|---|
| api: chat, chatGrant, disputes/staff | 3 | 114 |

The full suite is the runner's job.
