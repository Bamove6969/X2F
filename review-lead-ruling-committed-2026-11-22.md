# Security review: wip/lead-ruling-committed at 317fdc3b

Reviewer: independent security reviewer (cloud helper), 22 Nov 2026.

- **Scope:** `git diff origin/main...317fdc3b`, with main at 92802042, which includes the ruling-pay fix. That is 9 commits and 16 files.
- **Worktree:** `.claude/worktrees/rev-ruling-committed`. The branch was not changed.

## Verdict: APPROVE WITH MINORS

The branch adds information only. Nothing it adds can change what a party stores, imports or signs, or what the executor pays.

The full `npm run check` belongs to the cloud runner. Approval holds only if it is green.

## 1. `peerRelease` (packages/escrow party.ts)

**Read-only.**

- The new code runs only on the existing `not-current-release` branch of `onMessage`. That branch still calls `ignored(...)` and returns before the received slot, `saveState`, `progressed` or `advance`.
- The only write is to an in-memory `Map<Role, {tag, txSet, at}>`.
- `peerRelease()` reads `state.release` and `state.received` and returns copies.
- None of the existing paths changed.
- Guard-reverts R2 and R4 fail tests.

**The signer must be the claimed trader: it is.**

- `from` is `opened.from`, the sender that `open()` verified under the trade's participants, never the frame's own field.
- A trader can only write its own entry. The executor reads only `ex.winner`'s.
- So nobody can forge "committed" for someone else.

**Spam.**

- Memory is bounded: one entry per role, overwritten each time.
- The added CPU is one regex per message that already passed signature verification and the replay guard. It is negligible next to the existing `open()` cost.
- No new message ever reaches storage.

**m1 (minor): "committed" is the winner's own claim, not a proof.**

- `txSet: true` only means the winner's identity sent a `release.txset` key under some other tag. The moderator never opens or checks that set.
- So a winner can claim to be committed when it isn't, or hop tags to look offline. The only effect is the wording staff see.
- The ModCase copy states it as fact: "the winner's app is committed to an earlier payout it built". **Suggestion:** "the winner's app reports it is committed to an earlier payout it built (it sent the moderator a built set for another outcome)".
- Option A's precondition leans on this signal. If A is ever built, it must check the set itself (`checkRelease` against the computed buyer-cancel payouts), not just the tag.

## 2. Executor (apps/moderation execute.ts)

**Pays exactly as before.**

- On the `in-flight` path, `waitPass` now runs before the same `return 'in-flight'`.
- The record, announce, `inFlight` and settle lines are unchanged.
- `waitPass` swallows report failures (`.catch(() => false)`). `peerRelease` is optional; without it, nothing is said.
- Guard-revert R15 (the in-flight path hands the set again) fails 4 tests, including "settles exactly what the gate authorised".
- The two moderation regtests pass: execute and rulingWinner.

**m2 (minor): the wait now includes a network call.** `waitPass` awaits an internal report on an in-flight pass, and the announce path already does the same. A refused report is retried on every pass until the API takes it. That's acceptable, but give `link.report` a timeout if the internal client has none.

## 3. Internal `ruling-wait` report (apps/api internal/routes.ts)

**No log injection found.** Only the moderation process can send it: the internal socket plus `MOD_INTERNAL_SECRET`, the same trust as every other report. The checks are:

- the exact keys `kind`, `trade`, `reason`;
- the reason is one of `winner-committed`, `winner-offline` or null;
- the code is normalised and must exist;
- the trade must be `disputed` (409 otherwise);
- a ruling statement must be kept for it (409 otherwise).

The log write:

- The entry is `ruling.payout-waiting`, with system actor and `{reason}` only. It is written through `appendLog` with the `LOG_ACTIONS` schema.
- It is deduped under the trade's row lock.
- No trader or staff input reaches this path. The other trades and states a compromised moderation process could name are already within its far larger powers.

Guard-reverts R8-R12 all fail tests: state, statement, enum, dedup and exact keys.

## 4. Staff case view

**Leaks nothing material.**

- `payoutWait` is the reason plus the log time, and only while the trade is `disputed` (R13 fails). `none` shows nothing (R14 fails).
- It goes on the existing case route, with no new permission.
- The log sentence is staff-only.
- The one new fact is a coarse "the winner's app has not taken part". Staff can largely infer that already from chat; acceptable.

**m3 (copy, minor): the time is misread.** The `since` time is when the reason was first logged, at least 1 h after the payout was recorded. The copy says "the payout has waited since HH:MM", which reads as the start of the wait. Use the execution's `recordedAt`, or reword to "Since HH:MM, the payout has been waiting …". COPY-UNSIGNED.

**m4 (minor): RULING_WINNER_WAIT_MS = 1 h.** This is marked as a lead default and an owner question. That's fine.

## Guard-revert table

Each revert was applied alone, against peer-release, execute, rulingWait, moderator and logTraining. The baseline is 64/64.

| # | Guard reverted | Result |
|---|---|---|
| R1 | record messages for the current tag too | 64 pass (harmless: the executor reads only the winner, the current release's counterpart) |
| R2 | any release message counts as a tx set | 1 fail |
| R3 | `txSet` kept across a tag change | 64 pass (gap; wording only) |
| R4 | `current`: any sender counts | 1 fail |
| R5 | no wait time | 1 fail |
| R6 | `current` ignored | 1 fail |
| R7 | unchanged reasons reported again | 3 fail |
| R8 | no disputed check (internal) | 1 fail |
| R9 | no kept-statement check | 1 fail |
| R10 | no reason enum | 1 fail |
| R11 | no dedup | 1 fail |
| R12 | extra keys accepted | 1 fail |
| R13 | `payoutWait` outside disputed | 1 fail |
| R14 | `none` shown as a reason | 1 fail |
| R15 | executor in-flight hands the set again | 4 fail |

## Option B: scoping opinion

**Safety of the idea.** The moderator would never sign anything but the ruling's payout. That is the property that matters, so B is the right shape if anything is built.

**But the proposal's mechanism doesn't work as written.**

- When the builder sees the co-signer's export for attempt+1 (`counterpartNext`), it follows with `nextAttempt`: `committed = false`, `waiting-funds`.
- In the same `advance()`, it then exports again. It already holds the moderator's attempt+1 export, so it imports it and **builds again**: committed again.
- So the very export that "declines" also lets the buyer rebuild the cancel at once. The buyer's runtime never sees an uncommitted window to switch to the ruling.
- `advance()` also runs only while the buyer's device still hands the buyer-cancel, which the M2 fix (committedHold) now guarantees.

**Two workable shapes.**

- **B1, exhaustion.** The moderator declines every attempt until the buyer's party hits `MAX_ATTEMPT` and goes `exhausted`. The party then rejects with "used up", `committed` is false, and the runtime's `committedElsewhere()` clears, so the ruling is saved and handed.
  - **Buyer side:** no protocol change.
  - **Moderator side:** a new party step that sends exports for an outcome it never takes as its release.
  - **Costs:** one export per attempt, and a fresh export for its own ruling release afterwards (R26: every export carries new nonces, never reused).
  - **Drawback:** it's slow and depends on timing.
- **B2, explicit decline.** A new signed `release.decline:<tag>.<attempt>` message. On it, the builder drops its commitment and does not rebuild that outcome unless its app hands it again.
  - **What it changes:** a protocol change on both sides, plus the web runtime (treat a declined outcome as exhausted) and the party tests.
  - **Upside:** it's cleaner and deterministic.

**What either touches.**

- packages/escrow party.ts: the attempt state machine, export and nonce hygiene, and the per-message `ignored` paths.
- The moderation executor: a trigger on its own `winner-committed`, after a set time, or a staff tap.
- The web runtime's handling of an exhausted or declined committed intent.
- A new escrow regtest.
- Its own security review of the multisig nonce handling. That review is the expensive part.

**Is it worth building? Not now; I recommend option C.**

- The case needs a dispute before "I've paid" that the buyer wins, plus a committed buyer-cancel. That is rare, and a pre-paid buyer winning is itself unusual.
- The coins are not at risk: the cancel needs the moderator's signature, which it withholds. They are only delayed.
- Staff now see `ruling-winner-committed`.

**Recommendation:**

- Revisit B2 if the case is ever seen in production, or if a broader "decline" is wanted for other cases.
- Don't build A: it carries out the opposite of the ruling and widens what the moderator key signs.
- If A is ever chosen, its precondition must check the buyer's set itself, not the self-reported tag (see m1).

## Tests run

- **Targeted vitest** (nice -n 10, no lock), packages/escrow peer-release, apps/moderation execute, apps/api disputes/rulingWait, apps/staff-web moderator and logTraining: **64/64 passed**.
- **Moderation regtests** (`@x2f/moderation-regtest`: execute.regtest, rulingWinner.regtest) under ~/x2f-comms/check.lock: **4/4 passed**, 170 s, on a clean tree. A first run overlapped my guard-revert edits and was discarded, although it also passed.
- **Full `npm run check`:** not run; the cloud runner owns it.
