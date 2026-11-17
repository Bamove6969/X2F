# Re-review (MONEY + security): wip/lead-lien-recovery @ 88ee097a (17 Nov 2026)

**Verdict: CHANGES NEEDED** (1 blocking, 2 minor). B1 to B4, M1, M2 and M6 are fixed as claimed, and M5 is handled in the docs. The fix is solid: the moderation service now signs a recovery only for a source trade it attested itself, for a side that a gate-verified ruling names as creditor, to that side's own address from the signed source terms, at most `lienRecoveryCap` (half, and the buyer always keeps `MAX_NETWORK_FEE`), and with a running total per source of at most the source trade's XMR (moderation 009). Every device and the gate now refuse a recovery above the cap or one paid to the trade's own addresses. A compromised API can no longer redirect a recovery, exceed the cap, or make a buyer's output unbuildable. I tried each of these and failed.

What is left is the gap the lead names as Q7. It is real, and wider than "capped and paid only to the real creditor":
- **Blocking.** Nothing outside the API switches it on or off. `liens_enabled` is an API row, so the Q7 path is live as soon as this moderation build is deployed, whatever the flag says (N1).
- **Minor.** "The real creditor" means "a side that some verified ruling once named". A compromised API can hide an appeal and pay the side that lost it; I proved this with a probe (N2).
- **Minor, honest API.** A new bug: a hold whose trade closed with an escrow and no coin never leaves `open`, so the lien's `complied` is refused forever (N3, proven).

Reviewer: independent reviewer (claude2 cloud helper), read-only on code. Detached worktree `/home/user/wt/rv-lien2` at 88ee097a, fresh `npm ci`, node 24.22.1. Nothing committed or pushed. I added the probe tests to the worktree only, saved them as a diff, and restored the files before the full runs.

Scope: `git log 65b3f4da..88ee097a`, 4 commits (e5346c19 RED, e3d8997d fix, d660968e docs, 88ee097a identity test), 35 files, +1235/-105. I read every changed file, plus the code they feed: gate `authorizeRuling`/`gateCheck`, `execute.ts`, the watcher's stop path, the machine's `settled`/`escalate` transitions, and `payoutsFor`/`sweepMinimums`. I also read `docs/lien-recovery.md` in full. Earlier review: `review-third-lien-recovery-2026-11-16.md`.

Threat model (unchanged): the API and DB are fully compromised. gate.bin, the MOD_* secrets, the staff-site build and honest staff/owner keys are not. Counterparties may be malicious.

Base: the task names main 9c7e7a78; origin/main is now b6f9cf0e (it merges late-funds edb028c2 onto 9c7e7a78). The branch is cut from 65b3f4da, on the dispute stack, not on main.

## Status of the earlier findings

| ID | Status | How I checked |
|---|---|---|
| B1 (inject or inflate on any buyer) | **Fixed, with residual Q7 (see N1, N2)** | `apps/moderation/src/lienRecovery.ts` checks 1-5 before `attestTrade`, and `recordLienRecovery` runs in the same transaction as `signed_terms`, under a per-source advisory lock. The source must be attested and posted here. The creditor sides come from `lienRulingVerifier`, which runs `gateCheck` with `verifyOnly` and stored taps rooted in the owner's keys, so the API cannot forge a ruling. The tap's `amountAtomic` must equal the recorded source amount, so the API also cannot inflate the source XMR through the desk shadow. The address must be that side's `buyerPayout`/`sellerRefund` in the moderation service's own signed source terms, and not this trade's addresses or the fee wallet. The amount must be ≤ `lienRecoveryCap(buyerProceeds(deal))`, and the sum per (source, side) ≤ source XMR. The buyer and seller devices and the gate's `payoutsFor`/`sweepMinimums` refuse anything above the cap or paid to an own address. Tests: attest.test (signs/refuses/over-owed/restart), gate.test (verifier, authorizeRuling pays only on dispute-buyer), attestation.test, payouts.test. Without a gate (`lienRulings` null) nothing is signed. |
| B2 (creditor registers the debtor's address) | **Fixed** | The attack no longer applies: the address is `liens.creditor_address`, taken from the source trade at placement and frozen by 650's guard, not the creditor's newest wallet. `reserveRecovery` skips it when it is one of the trade's own addresses (`ownAddresses`). The wallet route releases a poster's hold that matches (`releaseHoldAt`). The moderation service refuses `wrong-address`, including the fee wallet. Devices refuse own addresses. The source trade's addresses can never be the fee wallet (`payoutsFor` duplicate check). The branch's tests cover the debtor-payout and poster-buyer cases. |
| B3 (rate near 100% makes the release unbuildable) | **Fixed** | `lienRecoveryCap` = min(half, proceeds − `MAX_NETWORK_FEE`) and 0 at or below `MAX_NETWORK_FEE`. It is applied in `recoveryOf` (every co-signer and the gate), `reserveRecovery`, the moderation check and `verifyAttestation`. Rate requests, taps and the applied rate are capped at 5000 (`MAX_RECOVERY_RATE_BPS`). My adapted probe (rate 10000) now reserves exactly half (the branch's own test asserts the same). See I1 for a theoretical edge. |
| B4 (4 red tests) | **Fixed** (in 65b3f4da) | frontDoor, jabber-paths and tradeRoom-tripwires pass in the full API (2787 passed, 0 failed) and web (2129/2129) runs. |
| M1 (migration 560 collision) | **Fixed** | API `650_lien_recovery.sql`: 650 is unique across origin/main b6f9cf0e, 9c7e7a78 and every origin branch (500-701 in use: 500, 520, 540, 550, 560 ×2 (account_bans, plus the old third-lien-recovery's 560), 570-640, 650, 701). Moderation `009_lien_recoveries.sql`: unique. main and 9c7e7a78 end at 008, and no other branch has a 009. |
| M2 (paid unrecorded / double pay) | **Fixed for the cases raised, with a new bug (N3)** | A cancel with an escrow keeps the hold. A refund seen on chain releases it. A late dispute-buyer records it (tested). A payment past the remainder is capped in the ledger and logged `lien.over-recovered`. `complied` refuses while a hold is open. The moderation service frees a signed recovery only when its watcher sees a refund-kind sweep or a coinless end, and its count matches the API's `HOLD_COUNTS_SQL`. But see N3. |
| M3 (seller sees the lien and creditor address) | Open (owner, as stated) | Unchanged: the same terms go to both parties. |
| M4 (creditor reconstructs purchases) | Open (owner, as stated) | Unchanged. |
| M5 (netfee split) | **Docs only, as stated; the advice holds** | Trial merge with origin/wip/second-netfee-books 26a6c77b (which contains second-netfee-fixes 6790d98d): the same 7 conflicts as before, and `payouts.ts` conflicts exactly on the two release lists. I computed `networkFeeShares` from netfee-books: with the creditor output **unmarked**, the fee output's share is unchanged ([true,true,false(,false)] gives [51,50,0,(0)] for fee 101, the same as [true,true]), so `feeWalletNetworkFee`'s hard-coded `[true,true][1]` stays right. If the creditor is **marked**, the shares become [34,33,34] and X2F's books would record 50 instead of 33. Recommend: decide "not marked" in the doc now (it also avoids wallet2 refusing a 1-atomic-unit bearer) and pin it with a test at the merge. |
| M6 (no moderation tests) | **Fixed** | attest.test (4), gate.test (5), watcher.test (4); API poster-buyer and escalate/late-funds tests. |
| I2 (released hold shown) | Fixed | `reservedAtomic` filters `released`; tested. |

## New findings

### N1 (blocking, MONEY/security): the Q7 path is live on deploy; nothing outside the API can switch lien recovery off
`apps/moderation/src/main.ts:288,368` (`lienRulingsDep` is set whenever a gate runs, and `checkLienRecovery` has no switch). `liens_enabled` is a row in `site_flags` in the API's database.

The doc says "Lead security review needed before liens are switched on (`site_flags.liens_enabled`)". Under the threat model, though, that flag is the attacker's to set, and the moderation service checks no setting of its own. So once this moderation build is deployed with a gate, Q7 is open at once, even if the owner never turns liens on:
1. The API puts a `lienRecovery` and a `lienSource` naming any trade with a published restitution or overturned ruling (`seller-sends-xmr`, or an escrow ruling overturned on appeal) into an innocent buyer's work item.
2. The moderation service signs it (every check passes: the source, a verified ruling, that side's own address, ≤ half).
3. The API sends the same figure as the buyer's "confirmed" `lienRecoveryAtomic`. The buyer's device accepts it and shows nothing (NEEDS_DESIGN_LIEN_NOTICE).
4. On release, half of the buyer's proceeds go to that side.

This repeats on every purchase by every buyer until each (source, side) total reaches the source trade's XMR. Before this branch, a compromised API could not touch a buyer's proceeds at all (see Q7 below for the limits and what an attacker gains).

Fix (small): an off switch the API cannot reach, off by default, for example `MOD_LIEN_RECOVERY=on` in the moderation env, or a gate-held flag. Until it is set, `checkLienRecovery` refuses every `lienRecovery` (`lien-refused-off`). Turn it on only together with `liens_enabled`, and only after the owner accepts Q7 or NEEDS_DESIGN_LIEN_NOTICE (the buyer sees the amount and accepts it on their own device) is built. Add a test. The doc's status line should then name both switches.

### N2 (minor, security/doc): "the real creditor" is "a side some verified ruling once named"; a compromised API can hide the appeal
`apps/moderation/src/lienRecovery.ts:176-194` (`lienRulingVerifier` reads `storedRulings` from the API) and `packages/staff/src/lien.ts` `lienCreditorsOf` (no round 2: round 1 decides).

The verifier gets the dispute's rulings from the API's rows. Each ruling's taps are verified, but whether a later round exists is not. A compromised API can serve round 1 alone. Round 1 is in the gate's `rulingsSeen`, so it is not `stale-round`, and it passes even after the gate verified round 2. `lienCreditorsOf(round1, null)` then names round 1's creditor, even though the appeal overruled that order.

Proven (probe in `apps/moderation/test/gate.test.ts`, not committed): `seller-sends-xmr` overruled on appeal (`no-action`, a senior's tap). With both rounds served, the verifier returns `['seller']`. With the API then serving round 1 only, it returns `['buyer']`. Result: 1 passed.

Two consequences:
- The money can go to the side that lost the appeal, a side whose lien was never placed (liens off at the ruling, `liensOn` false), or a creditor already paid in full by `complied`. The doc and comments say the money "still goes only to that lien's real creditor"; that is not accurate.
- The per-source total is per side (`source_code, creditor`). Serving the source both ways, the API can use **both** sides of one source, so up to 2 × the source trade's XMR.

Fix:
- **Doc.** Correct the Q7 text in `docs/lien-recovery.md` and the `lienRecovery.ts` header to say this.
- **Code, cheap partial fix.** Make the verifier refuse (null) when the gate's `rulingsSeen` has a round 2 for the code but no round 2 is presented. Optionally cap the total per source rather than per side.
- **Full fix.** It is the same as Q7's: the buyer accepts it on their own device, or a buyer key binds the lien.

### N3 (minor, MONEY/liveness, honest API): a hold whose trade closed with an escrow and no coin never closes; `complied` is then refused forever
`apps/api/src/disputes/recovery.ts:176-178` (`closed` with an escrow returns without touching the hold), `HOLD_COUNTS_SQL` (only stops *counting* it after `WATCH_CLOSED_DAYS`), and `apps/api/src/disputes/lien.ts:169-172` (`repaid` refused while any hold has `status = 'open'`). No code ever moves such a hold out of `open`.

Scenario: seller S owes buyer B a restitution lien and buys something. That trade gets an escrow but the buyer cancels before funding. The hold stays `open` for good: the reserve stops counting it after 30 days, but its status never changes. When S later pays B directly and `complied` arrives, the dispute change throws 409 `lien-recovery-in-flight`, today and for good. The dispute cannot move to compliance, and the lien stays `active`. Today `complied` is a system event only (NEEDS_TASK_12_TX_PROOF), so this hits as soon as that route ships. Side effect: the creditor's address stays in the hold row indefinitely, though 650's header says it is kept "only while open".

Proven (probes, not committed):
- `take.test.ts`: buyer-cancel in funding, closed 31 days ago. A new take reserves again, and the old hold is still `open` next to the new one.
- `lien.test.ts`: an open hold on a trade cancelled 400 days ago with an escrow and no coin makes `complied` reject with 409.

Result: 2 passed.

Fix: when the moderation watch would have ended, release the hold (status `released`, clear the address). Do it in the timer loop, or lazily in `reserveRecovery`/`complied`, using the same `HOLD_COUNTS_SQL` test. Make the `complied` check use `HOLD_COUNTS_SQL` instead of `status = 'open'`.

### I1 (info): the buyer can keep exactly `MAX_NETWORK_FEE`
`lienRecoveryCap` leaves the buyer `proceeds − cap` ≥ `MAX_NETWORK_FEE`, equal to it when proceeds are in (0.01, 0.02] XMR. wallet2 needs the output to be strictly larger than the fee it pays, so a tx whose fee is exactly `MAX_NETWORK_FEE` would be refused. Real fees are about 100× smaller, and with netfee-books the buyer bears only a share, so this is theoretical. Keeping `MAX_NETWORK_FEE + 1` would close it.

### I2 (info): an honest-API mismatch blocks the trade rather than failing it
When the moderation service refuses (`lien-refused-*`), the work is skipped on every pass, and the trade stays unattested until it times out. The debtor's next take reserves again, so a lasting mismatch would stop the debtor buying at all. I found no lasting mismatch with an honest API:
- 30 days in `HOLD_COUNTS_SQL` and the watch end are close, so any gap is transient.
- Closed trades stay on the watch list for 30 days, so the watcher sees every close.

The gate's emergency stop does produce this effect (`no-authority`), which is arguably right. Worth one line in the doc.

## Q7, answered honestly
The claim is: "a compromised API can attach a real lien to the wrong buyer, capped and paid only to the real creditor".

**What holds:**
- Each purchase loses at most half its proceeds, and the buyer keeps ≥ 0.01 XMR.
- The money goes only to an address that one side of an attested source trade used there, and only for a side some gate-verified ruling made a creditor.
- Per (source, side), the moderation service's total never exceeds the source trade's XMR, and rule 5 counts every recovery it ever signed that was not seen to end unpaid.
- The API cannot invent a ruling, a source, an address or an amount above the cap.

**What does not hold, or is wider than stated:**
- **"The real creditor".** It may be the side that lost the appeal (N2, proven), a side whose lien was never placed (liens off), or a creditor already paid by `complied`.
- **"The lien's total".** It is the source XMR per side, and both sides of one source can be used (N2), so up to 2×.
- **Who is exposed.** Every buyer on the platform. The aggregate is bounded only by the sum of all restitution and overturned sources' XMR (×2), and nobody sees it (no lien notice yet).
- **When.** On deploy, whatever `liens_enabled` says (N1).

**What a compromised API gains:**
- Nothing directly unless it controls a creditor side. If it does, a **staged dispute** works: two sock-puppet accounts trade, a moderator is led to rule `seller-sends-xmr`, or to overturn an escrow ruling on appeal. That needs real staff taps, and a senior's second tap above the gate limit. The attacker then draws up to the source XMR (×2 with N2) from innocent buyers, half of each purchase, while the staged debtor pays nothing. Each staged dispute repeats it, limited by the launch trade cap per source.
- Without a creditor of its own, it can still do harm: move innocent buyers' XMR to real former disputants.

**Recommendation to the owner (via the lead):**
- Merge only with N1's moderation-side switch off.
- Switch it on only when the buyer's own device shows the deduction and the buyer accepts it before the take (NEEDS_DESIGN_LIEN_NOTICE), so the device's "confirmed" figure is what the person accepted rather than what the API sent.
- Better still, bind the lien to a buyer key the moderation service knows.

## Questions for the owner (via the lead)
- Q7 (above): accept the residual with liens on, or wait for the buyer-acceptance notice? Recommend: wait. Keep the moderation switch (N1) off until then.
- Q3, Q4 (earlier M3, M4) and Q5, Q6: still open, recommendations unchanged.

## Tests
Node 24.22.1, fresh `npm ci`, dockerd running (`docker info`: server 29.9.2; I did not restart it). Full and API/web runs under `flock /tmp/claude-0/heavy.lock`.

All at 88ee097a, probe files restored:
- `@x2f/trade`: 20 files, 517/517 passed
- `@x2f/staff`: 11 files, 281/281 passed
- `@x2f/moderation` (hermetic): 16 files, 256/256 passed
- `@x2f/moderation-regtest`: 1 file, 2/2 passed (monerod v0.18.5.3 fetched and run)
- `@x2f/escrow` (monerod regtest; the download worked): 16 files, 104/104 passed
- `@x2f/api` (full): 118 files, 2787 passed | 1 todo (2788), 0 failed. The B4 tests frontDoor and jabber-paths are green.
- `@x2f/web` (full): 138 files, 2129/2129 passed. B4's tradeRoom-tripwires is green.
- `@x2f/staff-web`: 10 files, 95/95 passed
- `npm run typecheck` (all workspaces): clean. `npm run copy-lint`: clean.

Not run: Playwright (not requested, and no lien e2e spec exists); node-proxy/relay/tools projects (not touched by the diff).

Probes (added, then restored before the full runs; diff kept at `/tmp/claude-0/-home-user-X2F/bdea06da-655a-56d0-8974-5e152881a423/scratchpad/probes.diff`):
- PROBE-N2 `apps/moderation/test/gate.test.ts` "a compromised API can hide the appeal": 1 passed | 64 skipped. The bug is real.
- PROBE-N3 `apps/api/test/take.test.ts` "after the watch the old hold stops counting but is never closed" and `apps/api/test/disputes/lien.test.ts` "a hold that stopped counting still blocks complied": 2 passed | 106 skipped. The bug is real. With the branch's lien and complied tests: 20 passed | 88 skipped.
- B2/B3 adapted: the old B2 probe (creditor wallet = debtor payout) cannot be set up any more (no wallet lookup). Its successor (bound address = debtor payout, or the poster's later wallet) is the branch's own tests, and they pass. B3 at rate 10000 now reserves `XMR / 2` (branch test).
- Netfee shares: `networkFeeShares` from origin/wip/second-netfee-books run directly (numbers in M5 above).

Counts: 1 Blocking (N1), 2 Minor (N2, N3), 2 Info (I1, I2). Earlier: B1-B4, M1, M2, M6 and I2 fixed (B1 with residual Q7), M5 docs only, M3/M4 open for the owner.
