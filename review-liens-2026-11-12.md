# Security review (MONEY): `wip/lead-liens` f97740c4, liens and owed fees (J-06 part, Plan 4 Task 25 plus Task 12's `fees_owed`)

Reviewer: independent security reviewer (cloud helper), 12 Nov 2026. Read-only on code. Detached worktree `rv-liens` at f97740c4, base main 6ebed537.
The branch is a single commit, f97740c4 (22 files, +1104/-48). There is no separate red-tests commit, so red-first cannot be shown from history (process note only).
Register rows: D-006, D-008, D-009, D-062, D-063, and owner g63 for who pays the 1%.

## Verdict: CHANGES REQUIRED. Two must-fix items, plus owner questions; the trading guard itself is sound.

Counts: 2 Must-fix (L1, L2), 4 Minor (L3-L6), 4 Owner questions (O1-O4), 3 Info (L7-L9).

What holds:
- **Every place that can start trading checks the lien, and checks it under the right lock.** An active lien refuses post, relist (single and bulk, through `accountRefusal`), take (taker) and set-up (poster), each with 409 `lien`. The debtor's offers drop out of `LISTED` in `offers/routes.ts` and `chat/routes.ts`, and out of take's `poster_ok`, and come back by themselves when the lien lifts. A grep for `trading_holds` shows the lien check sits next to every trading-hold check, so nothing was missed. Each check reads after the route's `accounts ... for update`:
  - take: line 308 locks both accounts, then re-reads `poster_ok` (line 314) and the taker's flags (line 334);
  - set-up: line 477;
  - offers: `lockAccountLive` before `accountRefusal`.

  The lien insert's foreign keys take `FOR KEY SHARE` on the debtor and creditor rows, which conflicts with `FOR UPDATE`. So a lien and a take serialise, and there is no window where the lien commits between a take's check and its trade insert (question 1, the race). If the take wins, its trade exists before the lien, as for any open trade.
- **Who a lien is placed on, and for how much, follows the owner's rules.** Checked against `@x2f/trade` `payoutsFor`:
  - Round-1 `seller-sends-xmr` after a refund liens the seller at publish for the trade XMR (D-008, D-009).
  - The 1% is in the lien only when the debtor posted the ad (D-063). Otherwise the poster owes it from future trades, once the ruling is final (D-062, g63).
  - An overturned escrow ruling liens whoever received the coins, for the trade XMR (D-006).
  - Fee arithmetic on an overturn: a release had already paid the 1% to X2F, so no fee goes in the lien. A refund paid none, so the poster owes it (g63: an overturn of moved coins is `poster-pays`).
  - On a buyer's ad, a release paid the buyer `amount - fee`, while the seller funded `amount`. A lien of `amount` makes the seller whole, and the buyer bears their own poster fee. The amounts are consistent; see O2 for the wording.
- **Appeals suspend only the debtor's own lien.** Only the debtor's own appeal suspends their own round-1 lien (`appealBy === debtor`). The creditor's appeal leaves it in force. Nobody can suspend a lien by appealing a different case: steps only touch liens of the same `(from_code, dispute_seq)`.
- **The lien rules cannot be skipped.** They run inside `withDispute`, so every dispute path goes through them: rulings, the appeal route and the timers. A throw writes nothing, and `on conflict do nothing` makes a replay place nothing twice.
- **The database guards are right as far as they go.** Migration 400's row triggers refuse DELETE, refuse any change to a lien's parties, amounts or origin, and refuse reviving a lien that is `repaid` or `void`. `fees_owed` only collects upwards and is never deleted. Both triggers set `search_path = pg_catalog`. Both tables are account records with no foreign key to trades, so they survive the 90-day purge (tested). One gap, though: no TRUNCATE guard (L3).

## Must-fix

### L1 (Must-fix, MONEY): a seller who pays and then loses on appeal gets nothing back
`complied` (the seller's accepted proof of `seller-sends-xmr`) is allowed while round 1 is `published`, and also while an appeal is pending: `outcomeInForce` falls back to `round1.outcome`. It marks the restitution lien `repaid`.

If round 2 then overrules (to `no-action`, or to `seller-returns-fiat`), `lienSteps` only voids round-1 liens that are still active or suspended. It places a round-2 lien only for a new `seller-sends-xmr`. The escrow-overturn branch (`isEscrow(first)`) is the only one that liens the receiver. The XMR the seller sent the buyer under the ruling is therefore never owed back.

Proved with the pure function, in a scratch probe outside the worktree:
- publish `seller-sends-xmr`, then `complied`: `[repaid l1]`
- the seller appeals: `[]`
- round 2 decides `no-action`: status `closed`, steps `[]`

So no lien is placed on the buyer.

The order is realistic. The comply window (`complyBy`) starts at publish, and the 48 h appeal window runs at the same time. A seller who pays at once and appeals, or a buyer who appeals "too little" after being paid, both hit it.

Fix: in the overruled branch, treat a round-1 restitution lien that is `repaid` (compliance accepted) like moved escrow coins. Place a round-2 `overturned` lien on the creditor (the buyer) for the amount paid, with the fee split by D-063 and g63. Add the scenario to `packages/staff/test/lien.test.ts` and to `apps/api/test/disputes/lien.test.ts`.

If the owner would rather that a payment made during the appeal window waits (no `complied` until the ruling is final), that also closes the gap, but it changes D-009's "at once". I recommend the lien.

### L2 (Must-fix before liens are turned on, owner/lead): most liens can never end
Of the four ways a lien can end, only one is built: `repaid` by `complied`, and only for a restitution lien with `fee_atomic = 0`.
- A restitution lien that carries the debtor's own 1% (the seller posted) stays **active forever** after the seller pays the buyer (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY). An honest seller who complied is locked out of trading for good.
- Every `overturned` lien needs the repayment trade (NEEDS_REPAYMENT_TRADE), which is not built.
- No staff route can lift or void a lien, and the guard trigger plus the "no revival" rule make a manual fix a database-owner action.

`complied` itself has no route yet (NEEDS_TASK_12_TX_PROOF). So, as built, **every** lien placed in production is permanent. It is not wrongly lifted (question 3: nothing lifts one wrongly), but it is never lifted.

Before this reaches users, decide one of the following:
- (a) **Recommended:** split the fee from the XMR. A paid-XMR proof repays the XMR part, and the 1% becomes a `fees_owed` row (D-062's "from future trades"). The person can then trade again.
- (b) Build the repayment trade and the tx-proof route first, and keep liens dark until then.
- (c) Add a senior-plus-key-tap "lien settled" action, logged, as the owner-confirmed manual way out.

## Minor

### L3 (Minor): `liens` and `fees_owed` have no TRUNCATE guard
Row triggers do not fire on TRUNCATE. `activity_log` (201) and `revenue_ledger` (430) each have a `before truncate` trigger for this reason. Add `liens_no_truncate` and `fees_owed_no_truncate` the same way.

The codebase's known caveat applies too (015, review M4): the API role owns the tables, so it can disable or drop the triggers. The guards stop code bugs, not a compromised API role. That is the same as every other append-only table here (question 4).

### L4 (Minor): a lien that is over can still have some columns edited
`liens_guard` freezes the parties, amounts, origin and status of a lien that is over. It still lets `changed_at`, `lifted_at` (while it stays non-null) and `repayment_code` change on a `repaid` or `void` row. `fees_owed_guard` likewise lets `settled_at` be rewritten. Freeze every column once a row is over, so the record of when and how it ended cannot be rewritten.

### L5 (Minor): the lien rules take contended locks while holding the site-wide log lock
In `withDispute`, `fn` appends first and takes the site-wide `pg_advisory_xact_lock(LOG_LOCK_KEY)`. Only then does `applyLienRules` run: `select ... from liens ... for update`, then inserts whose foreign keys need `FOR KEY SHARE` on both parties' `accounts` rows. A concurrent take or offer write holds `accounts ... for update`, so the dispute transaction can wait on it *while holding the log lock*, which stalls every append on the site. That breaks the N3 rule in `log/append.ts` ("never wait on anything slow while the lock is held").

I found no deadlock. The transactions that lock `accounts for update` (take, offers, wallets, methods, inactivity) do not append. Owner set-up does append, but it locks only the owner's row, and the owner is never a party to a lien. Advisory and row locks are both heavyweight, so a real cycle would also be detected and aborted rather than hang.

**Reputation branch (question 7).** `wip/lead-reputation` dd7668c2 changes `withDispute` to take trade, then dispute (`loadDisputeRecord lock`), then `lockPartyTotals`, all *before* `fn`, precisely so that nothing after the append waits (its review M1/N3). The lien hook breaks that discipline.

Fix, which should also be the merge resolution: right after the trade, dispute and totals locks (before `fn`), add
- `select 1 from accounts where id = any($1) order by id for key share` on both parties, and
- `select 1 from liens where from_code = $1 and dispute_seq = $2 for update`.

The lien inserts after the append then wait on nothing new. The order trade, dispute, totals, accounts (key share) is compatible with take, which locks accounts and then only inserts a new trade.

### L6 (Minor): test gaps for the guard and the repayment
- Set-up refused with 409 `lien` (`take.ts:477`) has no test. Only the taker side (`lien.test.ts:278`) and post or relist (`offers.test.ts:301`) do.
- Bulk relist (`POST /v1/account/offers/status`) with a lien is not tested.
- `complied` setting the lien `repaid` is tested only in the pure package, not through `withDispute`.
- Nothing pins L1.

## Owner questions (with recommendations)

### O1: an appeal that never gets decided keeps the lien suspended indefinitely
D-008 lifts the lien while the debtor's appeal is pending. D-011 says an appeal with no eligible reviewer waits. Together they let a debtor appeal and then trade freely for as long as no eligible senior is free.

Recommendation: keep D-008, but cap the suspension. If round 2 has not ruled by `rulingDueAt` plus a grace period (say 48 h), the lien binds again until the ruling. Alternatively, the D-011 owner alert could ask the owner to decide.

### O2: "pay the XMR back" on a buyer's ad pays back more than was received
The lien is `amount`, as D-006 says ("the trade's XMR"), and that makes the seller whole. But on the buyer's own ad, the buyer received `amount - 1%` (the escrow paid their own fee). The web line says only "until you pay the XMR back". The retired web tripwire had asked for "the payout, not the trade amount, on a buyer's ad".

Recommendation: keep `amount` (it is correct under g63's poster-pays), and have design word the line as "the trade's XMR". See L8 on the tripwire.

### O3: the person owed pays a 1% they did not cause
After a refund with `seller-sends-xmr` on a **buyer's** ad, the buyer (the creditor, who was wronged) is written a `fees_owed` row for the 1% from future trades once the ruling is final. That happens even if the seller never pays. It follows g63 ("a lien completes the trade and the poster pays") as the lead read it.

Recommendation: confirm with the owner. Alternatively, write the buyer's owed fee only when the lien is actually repaid.

### O4: `seller-returns-fiat` places no lien (NEEDS_OWNER_FIAT_LIEN, declared)
An overrule from `seller-sends-xmr` to `seller-returns-fiat` voids the XMR lien and places nothing. The seller who must return fiat is then free to trade. This is already declared in the code. I list it so it stays visible alongside L1.

## Info

### L7: Jabber notices leak nothing (question 5)
`liens` and `fees_owed` fire `jabber_note_change` on the debtor (`debtor_account_id`, `account_id`), with the fixed sentence "An account change was made on your X2F account." (p5-7): no amount, no trade, no counterparty. `liens.creditor_account_id` is classified as silent in `NOT_ACCOUNT_CHANGES` ("the dispute tells the creditor"), and the jabber-paths completeness test covers it.

The activity-log details (`lien.placed`: lienId, accountId, amount, cause) are staff-only and carry no address or reason text.

Merge note: with `wip/lead-jabber-settings` (W-021) a user can mute `account-change`, which mutes lien notices too (see that review's F1).

### L8: the two retired tripwires (question 6)
- **API, `NEEDS_TASK_25_LIEN_ON_APPEAL`** (`existsSync('disputes/lien.ts')`): legitimately obsolete. The suspension it guarded is now tested through the real appeal route (`lien.test.ts:133`), and the creditor-appeal case at `:145`.
- **Web, `NEEDS_TASK_25_LIENS`** (no migration mentions "lien"): it asked for three checks.
  1. An overturn places a lien on the receiver: met by `lien.test.ts:189` and `:200`.
  2. The lien blocks trading as the line says: met by `:278` and `offers.test`.
  3. The amount named is "the payout, not the trade amount, on a buyer's ad": **not** met. The implementation uses the trade amount, which I think is right (O2). The web line names no amount, so nothing user-visible is wrong.

  Retiring it was reasonable, but the third point should be recorded as answered (O2) rather than silently dropped.

Neither retirement weakens a check that still has a job. The remaining Task 27 seam tripwires (`feeOwed` in the dispute view, `NEEDS_TASK_12_TX_PROOF`) are kept.

### L9: dodges that are out of scope
- **Team membership.** Trades are recorded on the team account, so a lien binds the whole team and every member's session acts as that account. A debtor's *member* login on someone else's team would trade that team's coins, not their own, so it is not a way around the lien.
- **A new account (Sybil)** escapes any per-account lien. That is the same as for bans, and belongs to the identity work (banned identifiers), not here.
- **Open trades** a debtor already has go on (Task 25: "trades already funded still finish"). An unfunded trade whose set-up the debtor still owes is refused at set-up and times out as usual.

## Tests run (serialised runner, `rv-liens` at f97740c4, fresh `npm ci`, dockerd up, not restarted)
- `packages/staff` `dispute.test.ts` + `rulingFee.test.ts` + `lien.test.ts`: 100/100 passed (3 files)
- `apps/api/test/disputes/lien.test.ts`: 16/16 passed
- `apps/api/test/offers.test.ts`: 42/42 passed
- `apps/api/test/take.test.ts`: 57/57 passed
- `apps/api/test/disputes.test.ts`: 27/27 passed
- `apps/api/test/disputes/trader.test.ts`: 17/17 passed
- `apps/api/test/disputes/staff.test.ts`: 27 passed, 1 todo
- `apps/api/test/staff/revenue.test.ts`: 30/30 passed
- `apps/api/test/jabber-paths.test.ts`: 28/28 passed
- web `dispute.test.tsx` + `dispute-tripwires.test.ts`: 54/54 passed (2 files)
- `npx tsc -p apps/api --noEmit`: clean
- L1 probe: a scratch script run with tsx against `packages/staff/src`, outside the worktree, output quoted under L1.

Not run: `offersBulk.test.ts`, Playwright, `npm run check`, anything Monero.

semgrep (`/root/.local/semgrep-venv/bin/semgrep --no-git-ignore`) on the 14 changed source files:
- p/typescript, p/javascript and p/sql-injection: 74 rules, 0 findings
- the repo's `tools/semgrep`: 0 matching targets

The SQL fragments built by string interpolation (`ACTIVE_LIEN_SQL(p)`) only ever interpolate constant column or parameter names.

## Must-fix list
1. **L1:** an overrule after the seller complied must lien the buyer for the XMR paid, with tests.
2. **L2:** before liens go live, give every lien a way to end. Recommend (a): the XMR part is repaid by the proof, and the 1% moves to `fees_owed`. Plus the repayment trade or a staff "settled" action for overturn liens.

Should-fix in the same pass: L3 (TRUNCATE guards), L4 (freeze rows that are over), L5 (pre-lock the accounts and liens before `fn`, which is also the merge resolution with `wip/lead-reputation`), L6 (tests).

## Re-verify: `wip/lead-liens` 274ad0c1 (fixes 7472994f, 274ad0c1), 12 Nov 2026

Detached worktree `rv-liens2` at 274ad0c1, fresh `npm ci`, removed afterwards. dockerd was already up and was not restarted.

### Verdict: CHANGES REQUIRED. Two MONEY gaps remain (R1, R2). Everything else checked passes.

| Item | Result |
|---|---|
| L1 overturned lien after the seller paid | **Partly fixed**: still open when the seller posted the ad (R1) |
| L2 `liens_enabled` | Blocks nothing while off, old rows included; no route can turn it on. **But** a 1% that rides in the lien is not recorded while off (R2) |
| L3 TRUNCATE guards | Fixed |
| L4 a row that is over is frozen | Fixed |
| L5 lock order | Fixed; merges cleanly with reputation |
| L6 tests | Fixed for what they cover; the R1 and R2 cases are missing |
| schema.test list | Right |

### R1 (MONEY, must-fix): L1 is still open when the seller posted the ad
The new branch in `lienSteps` (packages/staff/src/lien.ts, round 2 overruled) places the buyer's `overturned` lien only for a round-1 restitution lien whose **status is `repaid`**. But `complied` repays only a lien with `fee_atomic = 0`. When the seller posted the ad, the round-1 lien carries the seller's own 1% (D-063), so it stays `active` after the seller pays (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY).

If round 2 then overrules, that lien is voided and nothing is placed on the buyer, who keeps the XMR. Proved with the pure function (a scratch test, deleted afterwards), using `sellerPosted` facts and the lien as it is really stored (fee F):
- publish `seller-sends-xmr`: place round 1, seller, amount A, fee F
- `complied`: `[]` (`compliedAt` set; the lien stays `active`)
- appeal by the seller: `[suspend l1]`; round 2 `no-action`: `[void l1]` only
- appeal by the buyer: `[]`; round 2 `no-action` or `seller-returns-fiat`: `[void l1]` only

The new pure test "overruled to seller-returns-fiat" passes `sellerPosted` with a lien at fee 0 and status `repaid`. No stored row can look like that, so the test does not cover this case.

Fix: key the branch on the dispute's own record that the seller paid (`next.compliedAt !== null`; it is kept through the appeal, checked), not on the lien's status. Place a round-2 `overturned` lien on the buyer for `facts.amountAtomic`, fee 0. Add the seller-posted case to both test files, with the stored lien carrying F, for both `active` (buyer appealed) and `suspended` (seller appealed).

### R2 (MONEY, must-fix now: the flag is off in production): with liens off, a 1% that rides in the lien is lost
`applyLienRules` drops every `place` step while `liens_enabled` is false. `feeSplit` puts the 1% *inside* the lien whenever the debtor is the poster: a seller's ad with `seller-sends-xmr`, or a refund overturned against the seller who posted. In those cases there is no separate `fee-owed` step, at publish or at finality, so the 1% is recorded nowhere.

The L2 API test only covers a buyer's ad, where the fee is already its own `fees_owed` row for the buyer. So "owed fees are still recorded" holds there but not on a seller's ad.

Fix: tell `lienSteps` whether liens are on (for example in `LienFacts`). While off, `feeSplit` should send the debtor-poster's 1% to `owed` at finality (round 1 final with no appeal, round 2 "stands", the round-2 places), never at publish, since a `fees_owed` row can't be undone if an appeal overrules. Add an API test: a seller's ad, flag off, `seller-sends-xmr`, then final; expect one `fees_owed` row on the seller for F.

### Checks that pass
- **L2, nothing blocks while off.** `ACTIVE_LIEN_SQL` now begins with `LIENS_ON_SQL` (no row counts as off). Every place that checks a lien (take's `poster_ok`, the taker check and set-up via `hasActiveLien`; offers' LISTED and relist; chat's LISTED) goes through it. A grep finds no lien read outside it.
  - The suspend, reactivate, void and repaid steps still follow the dispute while off, so liens placed before a switch-off stay correct, and they bind again when it is switched back on (tested).
- **L2, no route can turn the flag on.** `liens_enabled` is written only by migration 400 (default false) and by the test template. Every `update site_flags` in `apps/api/src` names fixed columns. None is built from input, and none touches this column. `site_flags` is single-row (`id boolean primary key check (id)`; startup refuses anything else).
  - Note: disputes ruled while off never gain a lien when it is switched on. That is acceptable, but the operator should know before switching.
- **L3.** `before truncate ... for each statement` triggers on both tables reuse the guard functions, which raise on `TRUNCATE` before they touch NEW or OLD. A cascaded truncate from `accounts` is refused too. Tested.
- **L4.** For a `repaid` or `void` lien, and for an owed fee with `settled_at` set, `to_jsonb(new) is distinct from to_jsonb(old)` refuses any change to any column. The transition into those states is still allowed, because the check is on OLD. Tested for `changed_at`, `lifted_at`, `repayment_code` and `settled_at`.
- **L5.** In `withDispute`, before `fn`, in this order: the dispute (`for update of d`), then both parties' `accounts` rows `for key share` in id order, then the dispute's liens `for update`. `applyLienRules` is called only from `withDispute`. Its inserts are serialised by the dispute lock, and its foreign-key share locks are already held, so nothing after the append waits.
  - On `wip/lead-reputation`, `withDispute` locks the trade, then the dispute (`loadDisputeRecord lock`), then `lockPartyTotals`. Placing these two queries right after `lockPartyTotals` gives the asked order trade → dispute → totals → accounts → liens. Accounts in key-share mode cannot conflict with the totals locks.
- **L6.** New tests: set-up refused with 409 `lien` and nothing set up (take); bulk turn-all-on refused `lien` per offer (offersBulk); `complied` through `withDispute` repays and logs; L1 through the API for both appealers (buyer's ad only, see R1); the flag-off test (buyer's ad only, see R2); TRUNCATE; frozen rows.
- **schema.test.** `400_liens.sql` is added between `361_trader_notes.sql` and `430_revenue_ledger.sql` in all three migration lists, matching the migrations folder.
- **O2.** The web lines now say "the trade's XMR". 274ad0c1 only moves the not-a-refusal marker for copy-lint.

### Tests run (serialised runner)
- `packages/staff` `lien.test.ts` + `dispute.test.ts`: 97/97 passed (2 files)
- `apps/api` `disputes/lien.test.ts`, `take.test.ts`, `offersBulk.test.ts`, `schema.test.ts`, `disputes/staff.test.ts`: 204 passed, 1 todo (5 files)

Not run: the rest of the suites, Playwright, `npm run check`.
