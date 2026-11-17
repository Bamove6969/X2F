# Second re-review (MONEY + security): wip/third-lien-recovery @ fc104f91 (17 Nov 2026)

**Verdict: APPROVE WITH MINORS** (0 blocking, 1 minor, 4 info).

B1-new is closed: the creditor's wallet picker now cuts the ending from the address the device signs, and the branch's new test is red on the old line and green on the new one (I checked both). N1 is closed as asked: the moderation service has its own switch, `MOD_LIEN_RECOVERY`, off by default. While it is off, nothing carrying a `lienRecovery` is attested and no lien statement is signed. I found no other path that signs either. N3 is closed. A hold that stopped counting is now released, by the retention job and by `complied` itself. A hold that still counts (an open trade, a closed trade inside the 30-day watch, or a trade that got coins) is not touched, and the job is idempotent. N2 is partly closed, as claimed. The new check works when the gate has already seen the appeal, and it refuses nothing legitimate I could construct. But the gate can only see a round-2 ruling through an earlier lien check that the API chose to present, so an API that hides the appeal from the start is not caught at all (M1: doc precision; the residual is the same as before).

Reviewer: independent reviewer (claude2 cloud helper), read-only on code. I used a detached worktree `/home/user/wt/rv-lien3` at fc104f91 for the full runs and a second detached copy `/home/user/wt/rv-lien3p` for the probes. Fresh `npm ci`, node 24.22.1. Nothing committed or pushed.

Scope: `git diff 6753fe29 fc104f91`, 5 commits, 19 files, +350/-58 (a fast-forward from the reviewed 6753fe29):
- 4aa47edd: web, B1-new
- eae7bb5a: moderation `MOD_LIEN_RECOVERY`, N1
- 6c437df1: API stale-hold release, N3
- c17b46d3: moderation hidden-appeal check, N2 partial
- fc104f91: one cap constant, docs

I read every changed file. I also read the code they rely on:
- gate `authorizeRuling` (`rulingsSeen`, stale-round)
- `gateCheck`, and whether it saves
- `pgGateSource.storedRulings`
- the ruling executor (`execute.ts`), to see which rounds the gate ever checks
- `settleRecovery`'s caller in `trades/store.ts`
- `HOLD_COUNTS_SQL`
- migration 650's constraints
- the watcher's free/unfree
- the moderation process entry and its refusal path

Merge note: the branch base is main 4f0afa14. origin/main is now b6f9cf0e, which is **not** an ancestor (it has 10 newer commits: the escrow harden and late-funds fixes). The branch needs a merge or rebase onto b6f9cf0e before it lands. The full runs below are on fc104f91 as it stands.

## Status of the previous findings

| ID | Claim | Status |
|---|---|---|
| B1-new | `Liens.tsx` shows `addressEnd(w.address)` | **Fixed.** Line 152 uses `ui/addressEnd.ts` on the address passed to `signRecoveryAddress`. The new test (an evil address plus a spoofed `addressEnd`) checks that the label shows `…EVILXX`, not `WWWWWW`, and that the evil address is the one signed. Red check: with the old `…{w.addressEnd}` restored in the probe copy, the test fails (1 failed, 8 passed). With the fix it passes (9 passed). No other creditor-side or signing screen uses the API's `addressEnd`. `Wallets.tsx`, `Welcome.tsx` and the dispute destination use it only for display, with nothing signed. |
| N1 | `MOD_LIEN_RECOVERY` switch, off by default | **Fixed.** See "N1 switch" below. |
| N2 | Hidden appeal | **Partly fixed, as claimed.** The old probe now fails at the hidden step (the verifier returns `null`). The residual is real (M1). |
| N3 | Hold never leaves open; complied refused for ever | **Fixed.** The old probe, adapted, now shows complied releasing the hold and going through. See "N3" below. |
| I1 | `X2F_FEE_WALLET` optional in the API | Unchanged. dev-setup now says to set it in the API before turning the switch on. Still info. |
| I2 | Creditor without the disputed trade's device record | Unchanged (owner OQ2). |
| I3 | API picks among unapplied rate approvals | Unchanged, re-proven (the probe passes). |
| I4 | Pinning per lien id | Unchanged, re-proven (the probe passes). |
| OQ1 cap | One constant | **Done.** `MAX_RECOVERY_RATE_BPS` is removed from @x2f/staff. `rateRequestRefusal` takes `maxBps`, and the API passes `LIEN_RECOVERY_MAX_BPS`. `keyTap.ts` reads the same constant. No other user of the old export remains (grep: staff-web, web, api). The SQL checks (`between 1 and 9000` in 650 and 009) are still literals (I3-new). |

## Verification detail

### N1 switch (eae7bb5a)
- **Parsing** (`lienRecoveryFromEnv`, main.ts:903): unset, `''` and `off` mean off, `on` means on, and anything else throws. The branch test covers `1`, `true`, `ON`, `yes` and ` on`, which all throw. The check is case- and whitespace-strict, so a typo never turns it on.
- **Refusal on start**: the throw happens while the options object for `startModeration` is built, inside the `try` at main.ts:956. The `catch` logs the message, closes the pools and calls `process.exit(1)`. So a bad value refuses the start. It does run after `migrateModeration`, which is harmless.
- **Default in code**: the check is `enabled: o.lienRecovery === true`. The option is optional, so any embedding or test that omits it gets off. The branch test checks `'unset'`, which leaves the option out.
- **Where it bites**: `checkLienRecovery` throws `LienRefused('off')` right after the "no recovery in the terms" early return. So every item carrying `terms.lienRecovery` is refused before any source, ruling or address work. Items with no recovery attest as before (tested: `plain`).
- **Other paths that could sign or emit while off**: I grepped every attest and statement signer in apps/moderation/src.
  - `attestTrade` is called only from `prepare` (main.ts:380), after `checkLienRecovery`.
  - `signLienStatement` is called only in `recordLienRecovery`, which runs only when `checkLienRecovery` returned non-null.
  - The gate, the executor and the co-signer policy pay a recovery only from **already attested** terms (`attestedRecovery(a.terms)`, `recorded.lienRecovery`).
  - The watcher's free/unfree only edits existing rows.
  - `postLienStatements` still posts rows that are already in `mod_liens`. Those can only exist if they were signed while the switch was on. That is not a new signature, but see I1-new.
- **Turning it off after it was on**: a trade whose terms were already signed with a recovery (an existing `signed_terms` row) keeps them (`prepare` returns the existing row), and its payout still pays the recovery. That is correct, because the devices already agreed and co-signed those terms. The doc does not say this (I1-new).

### N2 partial (c17b46d3)
- **The check** (`lienRecovery.ts:443-449`): when `stored.current` is not round 2, `creditors` returns null if the gate's `rulingsSeen` has any entry for the normalized code with `round >= 2`. `rulingsSeen` is written by `authorizeRuling` only on success, and `gateCheck` saves the gate after each check (`check.ts:23`), so this survives a restart.
- **Bypass attempts**:
  - Serving `current = round 1` fails.
  - Serving `current = null` with `round1` set fails.
  - A bogus `current.round` (for example 3) takes the else branch and fails.
  - Serving another trade's verified ruling as this source's round 1: `storedRulings` stamps the ruling with the requested code, and the tap intents bind `code` and the recorded `amountAtomic`, so it fails `intent-mismatch`. That part was already safe.

  None of these got through.
- **Legitimate cases**:
  - An appeal pending (round 2 row, no ruling yet) still uses round 1, because the gate has seen no round 2.
  - The honest API presents round 2 once it is published.
  - A round 2 seen on another trade does not affect this one (the branch test).
  - A later dispute on the same code with a new round 1, after a round 2 was seen, is refused. The gate's existing `stale-round` rule refuses that round 1 anyway, so the new check adds no refusal of its own.

  I found no legitimate refusal.
- **The residual** is M1 below.

### N3 (6c437df1)
- **`releaseStaleHolds`** is one `update … where status = 'open' and not HOLD_COUNTS_SQL`, so it releases exactly the holds that the reservation sum already ignores: trades closed more than `WATCH_CLOSED_DAYS` ago with `received_atomic = 0`. It also clears the address and statement.
  - A hold that still counts is not touched (probe: an open trade, a trade closed 29 days ago, and a trade closed 400 days ago with `received_atomic > 0`, which keeps blocking complied).
  - It is idempotent: a second run releases 0 and logs nothing more (probe: exactly one `lien.recovery-released` entry).
- **The retention job** runs its own transaction with a rollback on error, and is added last in `RETENTION_JOBS` (`purge.test` updated).
- **Concurrency with `settleRecovery`**:
  - Both lock the hold row. Under READ COMMITTED, whichever writes second re-checks `status = 'open'`.
  - If the job wins, `settleRecovery`'s `for update` select finds no open hold. It falls through to the late path and records what the signed terms carried.
  - Lock order is hold, then lien, in both `settleRecovery` and complied (release first, then `update liens`), so there is no inversion.
- **The late path**: a released hold is recorded on a later `completed` only when `trade_attestations.terms.lienRecovery.amountAtomic` equals the hold's figure. The branch has two tests: terms that carry the figure record it, and terms without a recovery record nothing.
  - The path also now covers moderation's "refunded, then late coins ruled for the buyer" case (`watcher.ts:483`), which the old code missed because the hold was already released at the refund.
  - A double record is impossible: one hold per trade (`trade_code unique`), and `lien_recoveries unique (lien_id, trade_code)`.
- **Complied**: it releases stale holds first and logs them, then refuses if any open hold remains. A 409 rolls the release back, and the job does it later anyway.
- **Semantics** (I2-new): a released hold can never count again, whereas `HOLD_COUNTS_SQL` alone would count it again if `received_atomic` later rose. This is consistent with the moderation service's own count, which also frees the recovery at the end of the watch and unfrees it only when a sweep pays.

## Findings

### M1 (minor, docs/security precision): N2's check only fires when the API once presented the appeal to a lien check
`apps/moderation/src/lienRecovery.ts:443-449`, `apps/moderation/src/execute.ts:117-124`. `docs/lien-recovery.md` Security: "Partly closed: the moderation service refuses when its gate has seen a round-2 ruling …".

The gate records a round-2 ruling in `rulingsSeen` only when `gateCheck` authorizes it. The ruling executor never checks round 2: it settles round 1 only, and liens come from after-refund outcomes, which it never runs. So the **only** way the gate sees an appeal is that `lienRulingVerifier` itself was once served it by the API.

Scenario: the API is compromised before the appeal is published. It never serves round 2 to the moderation reader, the gate never sees it, and round 1's creditor is named exactly as before.

Proven: probe in `gate.test.ts`. Round 2 exists but the API serves only round 1 from the start, and the verifier returns `['buyer']`: 1 passed. The new check therefore protects only against an API compromised **after** it honestly presented the appeal in a lien check on that source.

That is a real but narrow gain. The doc's "Partly closed" reads as broader than it is.

Fix (docs only): in docs/lien-recovery.md Security, add this sentence: "the gate sees an appeal only through an earlier lien check the API served it to (the executor never checks round 2), so this catches an API that changes its story, not one that hid the appeal from the start". Keep the per-(source, side) total and the debtor-key item as the real bound. No code change is needed for this branch.

### I1-new (info): the doc does not say what turning the switch off does to terms already signed
`apps/moderation/src/main.ts:371-374` (`prepare` returns the existing `signed_terms`), `postLienStatements`. After `on` then `off`, trades already attested with a recovery keep paying it, and statements already signed are still posted. That is correct, because the devices agreed. Add one line to the doc's switch paragraph: "off stops new recoveries; trades already signed with one still pay it". This way an operator does not take `off` for an emergency stop of payments in flight.

### I2-new (info): a released hold cannot count again
`apps/api/src/disputes/recovery.ts` `releaseStaleHolds`. If a trade closed more than 30 days ago with no coin later gets coins and goes back to a dispute, its hold stays released. Meanwhile another purchase by the debtor can reserve the same remainder, and the creditor may be over-paid. The ledger caps that and logs `lien.over-recovered`, and the case is already flagged as an owner question. This matches the moderation service's own count, which frees at the end of the watch and stops watching. In practice the API learns of coins after the watch only through an escalation. No change needed. Mentioned so the M2 owner question covers it.

### I3-new (info): the SQL caps are not tied to `LIEN_RECOVERY_MAX_BPS` by a test
`apps/api/migrations/650_lien_recovery.sql:23,46,118`, `apps/moderation/migrations/009_lien_recoveries.sql:16,50,52`. The removed staff/trade equality test was the only cross-check. If OQ1 lowers the constant to 5000, the SQL still allows up to 9000. That is harmless, because the code refuses first. If the constant is raised, the SQL refuses with a 500, which is loud. A one-line test reading `pg_constraint` for `between 1 and <LIEN_RECOVERY_MAX_BPS>` would keep them together. The doc already says "plus the SQL checks". Optional.

### I4-new (info): with the API's flag on and the moderation switch off, every debtor purchase stalls unsigned
`apps/moderation/src/lienRecovery.ts:191`. The API cannot know about the moderation switch. So the buyer is shown a deduction, taps Trade, and the trade waits unattested (`lien-refused-off`, retried every poll) until its setup timer ends it. This fails closed, which is right, and dev-setup says to turn both on together. Consider logging the switch's state once at start so an operator sees the mismatch.

Carried, unchanged: I1 (fee wallet optional in the API), I2 (creditor device; OQ2), I3 (rate approvals), I4 (pin per lien id). Also carried from my earlier note: the picker shows the same 6-character ending as the quote and the accepted sheet. This choice routes all future recoveries, so showing more of the address here is still worth considering (design/copy, not a bug).

## Questions for the owner (via the lead)
- **OQ1** (open, unchanged): should the ceiling be 90% or the 50% default? Recommendation: 50% unless the owner explicitly wants higher. It is now one constant plus the SQL checks.
- **OQ2** (open, unchanged): what to do for a creditor without the disputed trade's device record. Recommendation: a senior-tapped address, verified by the gate.
- **OQ3** (answered by the build, needs confirming): keep `MOD_LIEN_RECOVERY` off until the owner signs the copy, the design and Q1-Q6. Recommendation: yes, and note that it stops new recoveries only, not ones already signed (I1-new).
- **N2 residual**: accept that an appeal hidden from the start is not caught until there is a long-term buyer or debtor key, or a gate-side record of appeals the API cannot hide? Recommendation: accept it for launch behind the switch, since money still needs the buyer's tap and is bounded per (source, side). Track it with the debtor-binding item.

## Tests
Setup: node 24.22.1, fresh `npm ci`, dockerd running (`docker info` OK; I did not start or restart it). The heavy runs were under `flock /tmp/claude-0/heavy.lock`. All runs are at fc104f91 in the clean worktree, with no probes.

- **Full `npx vitest run`** (every project in the root config, including the monerod regtest projects; the monerod download worked): **388 files passed (388); 7292 tests passed, 1 todo (7293); 0 failed**, exit 0.
- **Touched projects, run on their own:**

| Project | Files | Tests | Since 6753fe29 |
|---|---|---|---|
| `@x2f/staff` | 11 | 281/281 passed | unchanged; the tests changed in place |
| `@x2f/moderation` (hermetic) | 16 | 268/268 passed | +4: 2 for N1, 2 for N2 |
| `@x2f/web` | 138 | 2136/2136 passed | +1: B1-new |
| `@x2f/api` | 118 | 2802 passed, 1 todo (2803) | +3: N3 in lien.test, 2 in take.test |

- **`npm run typecheck`** (all workspaces): clean, exit 0.
- **`npm run copy-lint`**: clean (apps/web/src, apps/staff-web/src).

Not run: Playwright (not requested, and the diff touches no e2e spec). Nothing else was left out: the full run covered node-proxy, relay, tools and the regtest projects.

Probes, in the separate copy `/home/user/wt/rv-lien3p` (not committed). The diff is at `/tmp/claude-0/-home-user-X2F/bdea06da-655a-56d0-8974-5e152881a423/scratchpad/probes-third-lien3.diff`.

- **B1-new red check**: with `Liens.tsx` reverted to `…{w.addressEnd}`, the branch's B1-new test fails (1 failed, 8 passed). With the fix restored, 9 passed.
- **N2**:
  - The old probe (round 2 seen, then hidden) now **fails** with `expected null to deeply equal ['buyer']`, so the case is fixed.
  - The new residual probe (round 2 never presented) passes with `['buyer']` (M1).
  - Result: 1 failed, 1 passed, 69 skipped.
- **N3**, in `lien.test.ts` and `take.test.ts`:
  - The old probe, adapted: complied releases a stale hold and goes through.
  - A hold on a trade with `received_atomic > 0`, closed 400 days ago, still blocks complied and stays open.
  - The job leaves an open trade's hold and a 29-day-old hold alone, a second run releases 0, and exactly one log entry is written.
  - Run with the branch's N3 tests and PROBE-B2/B3: 8 passed, 112 skipped.
- **I3/I4** (attest.test probes) with the branch's 2 N1 tests: 4 passed, 17 skipped. I3 and I4 are unchanged, as described.

Counts: 0 Blocking, 1 Minor (M1), 4 new Info (I1-new to I4-new), plus the carried I1-I4. Since the previous re-review: B1-new, N1 and N3 fixed; N2 partly fixed (residual M1); the cap is one constant. Before landing, merge with origin/main b6f9cf0e, which is not an ancestor.
