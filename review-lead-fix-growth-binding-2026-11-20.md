# Security review: wip/lead-fix-growth-binding at 3bf0b254 (20 Nov 2026)

Reviewer: independent helper (cloud). Base: origin/main 0c5dc3d3. Scope: the upward-only rebind of the
buyer device's release bound (`mayRebindUp`, `rebindRefused` in `apps/web/src/escrow/runtime.ts`, the
`releaseRebound` / `releaseRebindRefused` record fields in `apps/web/src/escrow/store.ts`), the fake
party's `committedBuilder` (`apps/web/test/escrow-helpers.ts`), and the design note
`docs/security/growth-before-paid-2026-11-20.md`. Read against `packages/escrow/src/party.ts` (the
commit lock), the ruling-compliance review and re-review (B1, `deviceAcceptedAmount` as the
restitution amount).

## Verdict: CHANGES NEEDED (no blocker; M1 and M2 should be fixed before landing, M3 is a lead/owner question)

The core of option A is sound. I found no path that moves the bound down, no path that moves it
after paid, no way for a lying API alone to bind the buyer above real coins in the escrow, and no
way for the buyer to end up with two co-signs (the party's commit lock holds). Persist-before-party
(I8) holds at every kill point I walked. Restitution (B1) is untouched: it is seller-only and the
rebind is buyer-only.

Two gaps are in the race the note calls residual, and the note understates both. They need a
modified seller client that builds a release before paid (self-harm for an honest seller), so
neither is a blocker. Both have small fixes:

- **M1:** a tap in the window between the rebind and the party's refusal underpays the buyer, with
  no signal. The device then shows "paid, grown sum" while the party completes the lower release.
- **M2:** after a refused rebind, a restart never hands the committed release back to the party.
  The release that "goes on in the party" goes on only until the page reloads. Then the escrow is
  stuck for good.

## Findings

### M1. A tap between the rebind and the refusal: the buyer pays the grown sum and gets the take amount, silently

`apps/web/src/escrow/runtime.ts:980` (`rebindRefused` returns early on `r.paidSeen`),
`runtime.ts:1380-1383` (the tap asks nothing of the party).

Sequence: the bound moves A to A' and is saved (`runtime.ts:1179`, `:1195`). `settle(A')` is queued
behind the party's `run()` chain (`runtime.ts:1196`). `refresh()` emits the status with A' at once.
If the party is already working through the seller's set for A (import, `daemon.sync`,
`checkRelease`, `signRelease`, `submit`), it refuses the switch only once that work ends
(`party.ts:1287`). That can be several seconds on a browser wallet. During that time the page shows
A', the confirm sheet (which re-ticks on a new total, good) offers fiat(A'), and the tap passes:
amount A' is in range, it equals the bound, and the flag is not set yet. `acceptedAtomic = A'` and
`trade.paid {A'}` leave. The refusal then arrives. `rebindRefused` returns early because `paidSeen`
is true, so the flag is never set. The status stays `{ amountAtomic: A', refusal: null,
paidRecorded: true }`, and the party completes the release at A.

I confirmed this with a scratch test (not committed). Its output after the refusal and 3 ticks:
`{"flag":null,"accepted":"1300000000000","bound":"1300000000000","paidSeen":true,"amount":"1300000000000","refusal":null,"paidRecorded":true}`.

Impact: the buyer paid fiat(A') and receives A. The device gives no hint, so the buyer has no reason
to dispute. Preconditions: a seller client that builds a release before paid, and a buyer tap inside
the window. Unlikely, but the note's line "the buyer's XMR is already on its way" (note line 71) is
true only for the lower amount.

Fix (engineering, no behaviour choice beyond fail closed):
1. In `rebindRefused`, drop the `r.paidSeen` condition, so a refusal after a tap still sets the flag
   and shows `amount-changed` with no sum. The buyer can then see something is wrong and dispute.
2. At the tap, when `r.releaseRebound === true`, refuse unless the party reports no commit
   (`committedBuilder?.() === null`), as `mayRebindUp` does. That narrows the window to a commit
   still queued in `run()`.
3. Better: show the rebound sum only once the party has taken `settle(A')`. That needs a small
   `PartyHandle` addition, for example a promise or callback that settles when `settle()`'s queued
   job has either switched the outcome or refused it. With that, the window closes.

Test: add the tap-in-window case (my probe is about 10 lines on top of `boundThenGrown`).

### M2. After a refused rebind, a restart never resumes the committed release (permanent stall)

`runtime.ts:1192` (the intent's outcome is overwritten with A' at the rebind), `runtime.ts:863`
(`acceptedAmount` is null under the flag, so `context()` is null and no release outcome is ever
built again), `packages/escrow/src/party.ts:447,1174-1176` (the party advances a release only while
`settleOutcome` is set, and only `settle()` sets it; it is in memory only).

The note says the earlier release "goes on in the party". That holds only while this run's original
`settle(A)` promise is alive. After any restart (reload, `retry()`, a browser restart), the runtime
hands the party nothing: no `settle(A)`, because A is forgotten, and no `settle(A')`, because ctx is
null. The party restores `state.release` (A, committed, phase `cosigning` or `signed`) but never
advances it. A co-sign that was checked but not signed, or signed but not submitted, never finishes.
Every other outcome is refused by the commit lock (`party.ts:1094-1097`, `:1287`). That covers
buyer-cancel, lapse-refund and mutual-cancel, and the seller's builder party is committed too.
Nothing recovers it on the device. My probe showed no release `settle` after the reload
(`[]`), and buyer-cancel is handed to the party and would be refused there.

Main has a weaker form of this. With a bound A and an API that shows another amount, `o = null`,
so a committed co-sign is not resumed after a restart either. But that stall ends as soon as the API
shows A again. On this branch the flag is persisted, so the stall is permanent whatever the API
does.

Fix: before the rebind, keep the outcome handed over before it, for example as
`releasePriorOutcome` in the record, saved in the same persist. When the party refuses with "already
signed", re-hand that prior outcome to the party on every run (it is an outcome this device already
approved at the earlier bound, and the only one the party can be committed to). Keep everything
else fail closed: no sum, no tap. That needs a narrow exception in `settle()`'s `cosignPolicy` call
for exactly that saved outcome, so the lead should look at it. The alternative is in
`packages/escrow`: let a party with a committed release resume it without a `settle()` call. That
is a wider change.

Test: refused rebind, reload, and assert the party gets `settle(prior)` again.

### M3. The upper limit is the node proxy's word: a compromised app host can raise the sum after payment details are shown

`runtime.ts:850` (`next > r.sizeAtomic`), `apps/web/src/escrow/policy.ts:74` (`deviceAmount`), and
`apps/web/src/escrow/worker.ts:128` (the daemon is `VITE_NODE_PROXY_URL`, on the app host with the
API, per plan 6 D3).

"This device's own funds()" is the browser wallet's reading through our node proxy. A wallet does
not check proof of work, so a malicious daemon can serve made-up incoming outputs, unlocked and
with 10 or more confirmations. With main's I1, the sum on the screen froze when the standing co-sign
was handed over. That is at `secured`, the moment the payment details appear. With the rebind, an
attacker who holds the API and the node proxy can raise the sum after the buyer has the payment
details, up to the offer maximum. The buyer sees "Trade grew to ..." and pays fiat for coins that
are not there. The trade then cannot settle, and only a dispute (the mod's own monerod) shows the
truth.

The API alone cannot do this: the size comes from real coins as the wallet sees them, and the API
chooses only a value in [take, size], which is honest-growth bounded. The weakness comes from the
owner's own rule (growth before "I've paid"). Growth before `secured` already had it. The rebind
widens the window into the time when the buyer is paying.

Question for the lead/owner (no change made): is the node proxy in the same trust domain as the API
for this threat model? If so, this belongs with p11-63 and the proposed option B (no growth after
`secured`), which removes it entirely. I found no ruling that states the node proxy's trust level.

### m1. Two guards are unreachable through the runtime (mutation survivors), defence in depth only

`runtime.ts:850` `next > r.sizeAtomic` and `runtime.ts:848` `r.paidSeen || v.paidAt !== null`.
Reverting either leaves all 130 attestation-flow tests green. That is expected:
`ctx.deal.amountAtomic` comes from `acceptedAmount`, which already caps at `r.sizeAtomic` and returns
null for a buyer with `paidSeen`. `paidSeen` is also set earlier in the same tick from `v.paidAt`.
Keep both guards. Add a line to the comment saying `acceptedAmount` is the primary check, so a later
refactor of `acceptedAmount` knows it carries the rebind's limits.

### m2. `rebindRefused`'s save is fire and forget

`runtime.ts:985`. A kill before that write lands leaves `releaseRebound` without
`releaseRebindRefused`. On reload, `settle(A')` is handed over again and the real party refuses it
again, so the flag comes back. Until then the status shows A' and takes a tap. That reopens M1's
window once after each such crash. The M1 fixes (2 or 3) cover it. Otherwise await the save before
`emit()`.

### m3. `releaseRebound` is never cleared, so a later "already signed" on a same-amount release also trips the flag

`runtime.ts:980-981`. After a successful rebind to A', a balance change (dust) re-derives A' at a new
balance. If the party is committed to A' at the old balance (again a seller building early), the
refusal sets `releaseRebindRefused`, although the committed amount is known (A'). That fails closed
(no sum, no tap) while a release of an amount this device approved completes. It is harmless, but
the record cannot tell "committed to the take amount" from "committed to the rebound amount". The M2
fix (saving the prior outcome) can tell them apart.

### m4. Dispute co-sign, when it is wired, will be blocked by the flag

The buyer's `dispute-buyer` co-sign is not wired in the runtime yet (`context()` passes no `ruling`;
DisputeSlot says NEEDS_PLAN_4_MOD_COSIGN). When it is, it will go through `context()` without
`refundOnly`, so through `acceptedAmount`, which is null under `releaseRebindRefused` (and
`paidRefused`). A buyer-favoring ruling's co-sign would then be refused on this device. Today the
party's commit lock would refuse it anyway, but the M2 fix may change that. Leave a TODO at
`acceptedAmount` so whoever wires the ruling decides this on purpose.

### m5. Copy: `amount-changed` before paid says "after you paid"

The note lists this already (Left open). It is now reachable before paid in two new ways: a
downward lie after a rebind, and a refused rebind. Owner/design question (COPY-UNSIGNED); I made no
change.

### m6. A reorg below the rebound amount leaves the trade stuck before paid

The note covers this. After a rebind to A', if the extra coins vanish (deep reorg), `sizeAtomic`
drops, the tap for A' fails `inRange`, and A fails the bound. The status still shows A' (the bound)
with `amount-out-of-range`, which invites a tap that then fails. The buyer can still cancel. If the
tap already happened, it is the same as main for any growth: stuck until a dispute. No change
needed. Consider showing no sum when bound > own size.

## Questions answered

- **A lying API binding the buyer above what they intended:** no. The new bound is
  `acceptedAmount(v)`, which lies in [take, own size]. The status shows it before any tap. The sheet
  re-ticks on a new total, and the tap checks the confirmed fiat against the amount at the locked
  rate. An API can pick any value up to real coins (honest-growth bounded). Spoofing the size needs
  the node proxy (M3). Reorg: m6.
- **The bound moving down, or after paid:** no path. `next <= bound` refuses down (tested). After a
  tap, `acceptedAtomic` blocks it; after an API paid, `paidSeen` makes ctx null; outside `secured`
  the state guard blocks it (tested).
- **Two co-signs / a release that underpays:** two co-signs, no. The party's `committed` lock
  (`party.ts:1094`, `:1287`) allows one checked set per outcome, and a replaced outcome's set is
  keyed to the old digest and ignored. Underpay: yes, in the M1 window only.
- **Persist before the party sees the new outcome:** holds. Bound and intent are saved in one
  `await this.persist()` (`runtime.ts:1195`) before `settle()` (`:1196`). On a failed save the tick
  throws, the run fails (retryable), and the existing test "a save that fails in a tick stops the
  trade" catches a reordering (mutation g12). Kill points: before the save, the party still has A
  and reload re-derives. After the save and before `settle`, reload settles A'. The refused-flag
  save is m2.
- **Fail closed after `rebindRefused`:** status sum null, refusal `amount-changed`, tap refused,
  release ctx null, across a reload (tested). Refunds stay unbound (`refundOnly` ignores the flag),
  but the party's commit lock refuses them while the earlier release is committed. Dispute: m4.
  Gaps: M1 (flag not set after a tap) and M2 (the committed release is not resumed after a restart).
- **Ruling-compliance restitution (B1):** no interaction. `restitution` is built only for
  `role === 'seller'`. The rebind and both new flags are buyer-only (`mayRebindUp` and
  `rebindRefused` check `role`). The seller's `deviceAcceptedAmount` is unchanged: bound (set only
  after it fixed the buyer's signed amount), else fixed, else in range.

## Guard reverts (mutation runs, `apps/web/test/attestation-flow.test.ts`, 130 tests)

| # | Guard reverted | Result |
|---|---|---|
| g1 | `next <= bound` to `next === bound` (allow downward) | caught: 3 failed ("upward only", I3 status, I1 flips) |
| g2 | drop `next > r.sizeAtomic` | survived (m1: `acceptedAmount` caps it) |
| g3 | drop `v.state !== 'secured'` | caught: 1 failed ("no rebind outside secured: settling") |
| g4 | `mayRebindUp` ignores `committedBuilder` (`return true`) | caught: 2 failed (both "no rebind when") |
| g5 | a party without `committedBuilder` counts as uncommitted | caught: 1 failed (the no-method case) |
| g6 | drop `r.paidSeen \|\| v.paidAt !== null` | survived (m1: ctx is null when paidSeen) |
| g7 | `rebindRefused` does not set the flag | caught: 1 failed ("a rebind the party refuses") |
| g8 | `deviceAcceptedAmount` ignores the flag | caught: same test |
| g9 | the tap ignores the flag | caught: same test |
| g10 | `rebindRefused` does not save | caught: same test (the reload part) |
| g11 | `acceptedAmount` ignores the flag | caught: same test |
| g12 | `settle()` before `persist()` in tick (I8 order) | caught: 2 failed (the save-fails test, the attested-deal test) |

Ten of 12 reverts are caught. The two survivors are guarded upstream (m1).

## Tests run

- Targeted vitest, branch head 3bf0b254, outside the lock with `nice -n 10` (apps/web):
  attestation-flow, escrow-store, useEscrow, tradeRoomEscrow, escrowView, policy, dispute,
  disputeSlot: **8 files, 273 tests, all passed.**
- `npx tsc -p apps/web --noEmit`: clean.
- Scratch probes for M1 and M2 (a temporary copy of attestation-flow with 2 extra tests, deleted
  afterwards): both reproduced as described.
- Regtest e2e `-g "surplus"` (`trade.e2e.spec.ts`), under the lock, in a scratch worktree with
  3bf0b254 + origin/wip/lead-p3t31-regtest-e2e (0dc70076) merged, not pushed: **4 passed** (surplus at funding and surplus after secured, at phone 390x844 and desktop 1280x800; 7.2 min). The rebind works end to end on a real party: the grown amount is swept to the buyer less 1% and the network fee.
- Full `npm run check`: not run (the verdict is not APPROVED).

---

# Addendum: re-review at c5d260da (20 Nov 2026)

c5d260da is one commit on top of 3bf0b254. It adds `PartyHandle.acceptedOutcome()`, the
`releasePrior` field, `effectiveBound` / `priorTaken` / `resumePrior`, an awaited refused flag, m6
and the m4 tripwire.

## Verdict: APPROVE (M1 and M2 fixed; three minor follow-ups, none blocking; M3 and m5 stay owner questions)

### M1: fixed

- The status sum and the tap use `effectiveBound()` (`runtime.ts:876-881`). That is the prior bound
  until `acceptedOutcome()` names the rebound outcome (`priorTaken`, `runtime.ts:884-891`).
- After any rebind, the tap also needs `committedBuilder() === null` (`runtime.ts:1460-1461`).
- `rebindRefused` no longer depends on `paidSeen` (`runtime.ts:1037-1055`).

Why the window is closed: in `party.ts`, `settleOutcome` is set inside the `run()` job only after
the switch check passes (`party.ts:1301`). Every later `advance()` calls
`beginRelease(settleOutcome)` before `advanceRelease()`. So once `acceptedOutcome()` names A', the
party can no longer commit to the prior outcome. Until then, the page offers only A. A tap at A
while the party is committed is refused. A tap at A while the party's commit is still queued pays
A, which is exactly what a committed release pays.

I re-ran my probe against the real code path:
- Party held (A' not taken), then committed to A.
- Status sum A. The tap at A' was refused, and the tap at A was refused (committed).
- Then came the refusal: flag set, sum null, `amount-changed`, and the prior A handed back.
- Second probe (API back at A, uncommitted): the tap at A, then the party takes A'. Bound A,
  accepted A, prior cleared, and the next settle re-derives at A. There is no underpay path.

### M2: fixed

After the refusal, `resumePrior` hands `releasePrior.outcome` to the party once per run. My probe
showed `["1250000000000/buyer"]` after a reload. Once that release resolves and the trade closes:
phase `done`, no error.

### The cosignPolicy bypass (`settle(o, approvedPrior = true)`, `runtime.ts:991-1001`, only from `resumePrior`, `runtime.ts:900-906`)

- **Reachability.** The only caller is `resumePrior`. It needs `releaseRebindRefused === true`, and
  that is set only in `rebindRefused`, after a party "already signed for another outcome" refusal
  while `releasePrior` is set. So the bypass runs only against a party that has just said it is
  committed. A committed party switches to nothing but its own committed digest
  (`party.ts:1094-1097`, `:1287`). Handing it anything else gets "already signed" again: refused,
  added to `refused`, no effect.
- **What it can hand.** `releasePrior.outcome` is `r.intent.outcome` at the moment of the rebind
  (`runtime.ts:1251`). That is written only at `runtime.ts:1266`, from `outcomeFor` (which runs
  `cosignPolicy` against this device's own funds, attested addresses and deal), or at
  `runtime.ts:1006` from a settle that had itself passed the policy. `mayRebindUp` requires
  `intent.kind === 'release'`, a non-null outcome and no pending prior. Before paid, I1 keeps every
  release outcome at the bound amount. So the outcome is a release this device approved at the
  bound A: seller builds, buyer co-signs, the buyer's own signed payout address. `resumePrior` also
  forces `kind: 'release'` and copies only `to/builder/cosigner`.
- **Worst case.** The party's commit was lifted by `nextAttempt` (a co-sign failed before signing),
  and the handed-back A becomes the party's target again. That pays the buyer A, an amount this
  device approved. Only a seller who builds it can make it happen, and an honest seller builds a
  release only from the buyer's signed `trade.paid`. Nothing in this path can pay the buyer less
  than a sum it showed or let the buyer tap.
- **Planting, staleness, cross-trade.** The whole `EscrowRecord` is AES-GCM encrypted with the
  device key, and the AAD binds `x2f-escrow/v1\0store\0code` (`store.ts:299,343,352`). Neither the
  API nor the relay can write it. A record moved to another trade code fails to decrypt. Planting
  needs script in the origin, which already owns the wallet keys. Staleness: a prior is set only at
  a rebind, only one is pending at a time, and it is cleared once taken. After a refusal it is kept,
  on purpose, as the outcome the party is committed to.

### `acceptedOutcome()` is read-only

`party.ts:1311-1314` returns a copy of the in-memory `settleOutcome` (spread, with `to` copied
element by element). It mutates nothing, saves nothing and sends nothing. It is null after a
restart until a `settle()` is taken. That only delays `priorTaken`, which fails closed: the sum
stays at the prior amount. `incoming.test.ts` (regtest) checks it on the real party, including that
a refused switch leaves it unchanged.

### New minor items (none blocking)

- **m7. Nothing tests the one-rebind-at-a-time guard** (`runtime.ts:860-861`). Reverting it leaves all
  137 attestation-flow tests green. Without it, a second growth before the party took the first
  rebind would overwrite `releasePrior` with an outcome the party never took. After a refusal, the
  device would then hand back the wrong outcome (refused again, so M2 stalls), and the status would
  show the untaken sum. Add a test: two growths with the party held, and assert the prior and the
  sum stay at A.
- **m8. `releasePrior.outcome` is the intent's outcome, not necessarily the one the party took.**
  If `settle()` skipped the last re-derived outcome (in flight, refused, policy at hand-over), the
  prior can differ from the party's committed digest. It is still policy-approved at the bound, so
  this is safe, but the M2 hand-back would then be refused and the stall returns in that sub-case.
  The note's wording "approved exactly that outcome ... when it first handed it over" is slightly
  stronger than the code. Suggestion: rebind only when `key(acceptedOutcome()) ===
  key(intent.outcome)`, which costs one more tick. Another narrow case is a malicious seller plus a
  reload plus a balance change (committed to A' at the old balance, prior not yet cleared). The same
  check covers it.
- **m9. `rebindRefused` now trips on any refused seller-built, buyer-co-signed outcome while a
  prior is pending** (the key match was dropped, `runtime.ts:1040-1042`), for example a
  lapse-refund. That fails closed (no sum, no tap, prior handed back). I note it so it stays
  deliberate.

### Guard reverts on the new code (attestation-flow, 137 tests)

| # | Guard reverted | Result |
|---|---|---|
| n1 | `resumePrior` without the refused-flag condition | caught (M1+M2) |
| n2 | `priorTaken` clears on any taken outcome (no key match) | caught (2) |
| n3 | the tap without `partyUncommitted()` after a rebind | caught |
| n4 | `effectiveBound` ignores the prior | caught (2) |
| n5 | one rebind at a time | **survived** (m7) |
| n6 | `resumePrior` hands nothing | caught (2: M1+M2, M2 reload) |
| n7 | the hand-back goes through `cosignPolicy` (bypass off) | caught (2) |
| n8 | a tap at the prior amount does not bind back | caught |

### Tests run at c5d260da

- Targeted vitest outside the lock with nice (apps/web): attestation-flow, escrow-store,
  useEscrow, tradeRoomEscrow, escrowView, policy, dispute, disputeSlot, dispute-tripwires:
  **9 files, 287 tests, all passed.**
- `tsc --noEmit` for apps/web and packages/escrow: clean.
- Probes (temporary test copy, deleted): as above.
- Under the lock, scratch worktree c5d260da + origin/wip/lead-p3t31-regtest-e2e merged, not pushed:
  - `packages/escrow/test/incoming.test.ts` (regtest): **1 file, 4 tests, all passed** (it includes the new acceptedOutcome checks on the real party).
  - e2e `trade.e2e -g "surplus"`: **4 passed** (surplus at funding and surplus after secured, phone and desktop; 6.8 min).
- Full `npm run check`: not run. The common brief asks a reviewer to run it before APPROVED, and
  this job named only the suites above. The lead should run it (or have it run) before landing.
