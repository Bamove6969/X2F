# Re-review 4 (confirm pass): wip/lead-mod-chat @18a41386, 18 Nov 2026

This is an addendum to `re-review-3-lead-mod-chat-2026-11-18.md`. It covers one commit on top of the main merge 44f45ad5. I read it in a detached scratch worktree and changed no code.

## Verdict: APPROVE

- **M1 is fixed.** `syncDevices` no longer sorts device taps by counter across keys. The API's order (`finished_at, id`) stands. Counter order is judged per key only, against that key's pre-sync mark, its running mark, and the counters the registry took this sync.
- **The new permanent test fails without the fix.** I put the global sort back: the test "re-review 3 M1: certified with one key … revoked with another … the revocation holds" fails, and every other test passes.
- **All my rr3 probes pass**, including P4 (the cross-key case).
- **No other cross-key ordering assumption.**
  - The only other counter sort is registry step 0 (`registry.ts:169`). It sorts within one credential's list (`byCred`), so it is per key.
  - Step 2's `inOrder` orders by signed issuedAt across both owner keys (the lead's P4 call). It compares counters only for the same credential.
  - `olderThanSeen`, `noteCounter` and `takenThisSync` are all keyed by account and credential.
- Within one key, a tap whose API order disagrees with its counter is still refused `out-of-order`. That is the intended N8 behaviour, and it cannot occur in normal use, because the counter is taken when the tap's assertion is made.
- Decision 8's text matches the code.

## Tests (nice, no lock)

| Suite | Files | Passed |
|---|---|---|
| moderation: gateDevices, gate, gateDeps, grant, internal, notices | 6 | 130 |
| api: schema (the merged lists), staff/devices | 2 | 82 |
| rr3 gate probes P1-P6 (scratch, not committed) | 1 | 6 |

The full suite runs next on the runner.
