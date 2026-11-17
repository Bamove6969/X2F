# Re-review (MONEY + security): wip/third-lien-recovery @ 6753fe29 (17 Nov 2026)

**Verdict: CHANGES NEEDED** (1 blocking, 3 minor, 4 info). claude3's B1, B2 and B3 hold as claimed in the moderation service and on the buyer's device, and this version closes the worst part of N1: a compromised API can no longer take a buyer's money silently. The buyer's own device now shows the figure on the quote, keeps the figure the person tapped Trade on, and refuses any signed terms or co-sign set that carries a different figure (`verifyAttestation` and `cosignPolicy`).

What blocks is new, and the fix is one line. The creditor's wallet picker in `Liens.tsx` shows the API's `addressEnd`, not the end of the address the device signs. A compromised API can therefore get the honest creditor's device to sign "pay my recoveries to <attacker>" while the screen shows the creditor's own wallet. The moderation service then pays the attacker, because the signature is genuine (B1-new, proven). The quote and the accepted sheet already avoid this bug class (Task 19 re-review, gap 2); the new screen brings it back.

The other findings:
- **N1, downgraded to minor.** There is still no switch outside the API: `liens_enabled` is the attacker's row. The device can show a deduction, but it cannot tell an innocent buyer from a debtor.
- **N2, minor, unchanged.** The appeal can still be hidden (re-proven).
- **N3, minor, unchanged.** A hold on a trade closed with an escrow and no coin never leaves `open` (re-proven).

Reviewer: independent reviewer (claude2 cloud helper), read-only on code. I used a detached worktree `/home/user/wt/rv-third-lien2` at 6753fe29 for the full runs, plus a second detached copy `/home/user/wt/rv-third-lien2p` for the probes. Fresh `npm ci`, node 24.22.1. Nothing committed or pushed. The probe diff is at `/tmp/claude-0/-home-user-X2F/bdea06da-655a-56d0-8974-5e152881a423/scratchpad/probes-third-lien2.diff`.

Scope: `git log 88ee097a..6753fe29`, 6 commits on top of the lead's wip/lead-lien-recovery 88ee097a (the lead's head is an ancestor):
- 16bc3514 trade limits + signed statements
- 69472898 moderation authority
- 64faa4a5 API
- 5528684f web
- 56900547 docs
- 6753fe29 e2e

In total, 63 files, +2365/-478. I read every changed source file, `docs/lien-recovery.md` in full, and the code they feed: gate `verifyTap`/`gateCheck`/`noteCounter`, the watcher stop path, runtime `verifyAttestation`/policy wiring, `confirmed.ts`, the trade room's confirmed read, and `ui/addressEnd.ts`. Earlier reviews: `review-third-lien-recovery-2026-11-16.md` (B1-B4, M1-M6) and `re-review-lead-lien-recovery-2026-11-17.md` (N1-N3, I1, I2).

Threat model (unchanged): the API and DB are fully compromised. gate.bin, the MOD_* secrets, the web and staff-site builds and honest staff/owner keys are not. Counterparties may be malicious.

## Key questions from the task

**(1) N1: can a compromised API switch recovery on and take money with nothing outside the API stopping it?**
Not silently any more. Something outside the API stops it: the buyer's device and the buyer's eyes.

Here is the path I traced:
1. `Quote.tsx` reads `GET /v1/account/liens/preview`.
2. It shows the row "Paid to the person you owe" and the note "... Tapping Trade agrees to this.".
3. It puts that same figure into the `ConfirmedTrade` (`lienRecoveryAtomic`) and into the take body.
4. `useTake` refuses a take answer with any other figure (`LienRecoveryMismatchError`).
5. The runtime stores the figure in the device record.
6. `verifyAttestation` refuses signed terms whose recovery differs (none accepted means none).
7. `cosignPolicy` (`policy.ts:167`) refuses any co-sign whose signed recovery differs.

The poster-buyer path does the same from `AcceptedSheet`. The only take caller is `Quote.tsx`, and a missing or malformed record fails closed (`readConfirmed` drops it). So the figure the device co-signs is bound to what the person saw. An API that lies to the screen is caught at attestation, because the screen shows the API's preview figure, the device binds that same figure, and the moderation service signs only its own `expectedRecovery`.

What still holds for a compromised API (see N1 below):
- It can turn the feature on (`site_flags.liens_enabled`), with no moderation-side switch.
- It can show any buyer "You owe another trader after a dispute", because the device cannot know whether the buyer owes. The money moves only if that buyer taps Trade.
- The **address** is not shown or bound on the buyer's device. It is bound by the moderation service to a creditor-signed statement, which B1-new undermines on the creditor's side.

**(2) N2 and N3 on this version.** Both are unchanged and re-proven (below). N2 is somewhat harder to use now, because the losing side's own device must sign a recovery address.

**(3) The 90% cap and the owner's "option b".** The default is 50% (`LIEN_DEFAULT_RATE_BPS` = 5000, the SQL default 5000, and the moderation default). Any other rate needs a reason (the API) and a senior's `lien-rate` key tap, which the moderation gate verifies (`lienRateTaps`: role senior or owner, a WebAuthn assertion, a nonce bound to `lien-rate:<lien>:<rate>`). 90% is only the ceiling (Q1, provisional). Not a bug: it is an owner question (OQ1 below).

**(4) Migration numbers.**
- API `650_lien_recovery.sql` and moderation `009_lien_recoveries.sql` are the same numbers as wip/lead-lien-recovery 88ee097a, edited in place. That is correct, because the two branches are alternatives and neither is merged. Pick one.
- main b6f9cf0e has API migrations up to 540 and moderation migrations up to 008.
- wip/third-trade-wallet has 620/630/640.
- No other origin branch has an API 650 or a moderation 009 (third-lien-recovery-wip aside). API `009_login_names` is in the other directory.
- Merge note: 650 reads `wallets.address/account_id/removed_at`, which all exist on main. With trade-wallet's one-time wallets, the address stays in `wallets` while the wallet is removed, so B2's "another account's wallet" check still sees it. `take.ts` will conflict textually with trade-wallet's take changes; keep both `ownAddresses`/`feeWallet`/`accepted` and the one-time use-up.

**(5) Probes.** See Tests: B1-new, N2 and N3 were rerun (adapted) and are real. B2 and B3 are covered by the branch's own adapted PROBE-B2/PROBE-B3 tests, which pass. Two new moderation probes: I3 and I4.

## Status of the earlier findings (claude3's claims)

| ID | Claim | Status |
|---|---|---|
| B1 | Moderation is the authority: creditor-signed address, exact amount, signed sum per lien, senior tap verified, replay/rollback refused, buyer accepts before take | **Holds in moderation and on the buyer's device, with two caveats.** `checkLienRecovery`/`recordLienRecovery`: the source is attested, the ruling is gate-verified, the address is `recoveryAddressValid` against the creditor side's identity in its **own** attestation of the source and is not this trade's addresses or the fee wallet, the lien's parties are pinned on first sight, the rate is pinned or tap-verified (an applied tap is spent, the 24 h grace is for the replaced rate only), the figure is exactly `expectedRecovery` on what is left, and the per-(source, side) total is ≤ source XMR under an advisory lock. Rollback: proven refused by the branch test after the grace period. Caveats: the creditor-side address binding is defeated by B1-new, and the API picks among unapplied approvals (I3). |
| B2 | Recovery addresses equal to the trade's own addresses, another account's wallet or the fee wallet are refused | **Holds.** It is refused in four places: (1) the `recovery-address` route (another account's wallet, the fee wallet); (2) `pickRecovery` (own addresses, the fee wallet, another account's wallet, re-checked at every reserve); (3) the internal work route (a clash is not served); (4) moderation (`wrong-address`). Every device refuses own addresses. The branch's PROBE-B2 passes. Note I1: `X2F_FEE_WALLET` is optional in the API. |
| B3 | 90% cap, buyer keeps MAX_NETWORK_FEE + 0.01, 0.01 minimum recovery | **Holds.** It is applied in `lienRecoveryCap`, `expectedRecovery`, `recoveryOf` (every co-signer and the gate), `verifyAttestation`, moderation and SQL (`between 1 and 9000` on the lien, the holds, the requests and moderation 009). The lead's I1 (the buyer keeps exactly `MAX_NETWORK_FEE`) is closed, because the buyer now keeps 0.02 XMR. The branch's PROBE-B3 passes. M5 (the creditor output marked as a bearer at the netfee merge) is now safe because a recovery is never under 0.01 XMR, which is more than any bearer's share. |
| B4 | (old) red tests | Still fixed: full API and web runs are green (Tests). |
| M1 | Migration collision | Fixed (650 / 009, see (4)). |
| M2 | Paid unrecorded / double pay | Fixed as in 88ee097a, and the moderation watcher now also **un**-frees a recovery when a later sweep pays it (late coins). N3 remains. |
| M3 | Seller sees the lien and the creditor's address | **Not fixed; disclosed only** (NEEDS_PRIVACY_LIEN_DISCLOSURE, owner Q3). Honest about it. |
| M4 | Creditor reconstructs purchases | Fixed: totals only, no per-trade rows, no times, no rate (`GET /v1/account/liens`, web parser). |
| M5 | Netfee split | Docs only (the creditor marked a bearer; `feeWalletNetworkFee` must take the real bearer list). Consistent with my 88ee097a advice, now safe because of Q5. |
| M6 | Moderation tests | Fixed: attest.test (lien recovery at attestation: exact, injected/inflated/redirected, rates, pinning, partial, restart, co-signers), gate.test (`lienRateApproved`/`lienRateTaps`), watcher.test. |
| N1 | Nothing outside the API switches it | **Partly addressed** (the buyer's on-device acceptance). The switch is still missing (N1 below, now minor). |
| N2 | Hidden appeal | **Open**, re-proven. |
| N3 | Hold never leaves `open`; complied refused forever | **Open**, re-proven. |
| I1 (lead) | Buyer keeps exactly MAX_NETWORK_FEE | Fixed (0.02 XMR kept). |
| I2 (lead) | Refusal stalls rather than fails | Unchanged; the doc still has no line for it. |

## Findings

### B1-new (blocking, MONEY/security): the creditor's wallet picker shows the API's `addressEnd`, so a compromised API can redirect the honest creditor's recoveries with a genuine signature
`apps/web/src/screens/liens/Liens.tsx` `RecoveryAddress` (`{w.label} …{w.addressEnd}`, then `signRecoveryAddress(lien.fromCode, w.address, …)`).

`PickWallet` carries the full `address` and a separate `addressEnd`, and both come from the API. The quote and the accepted sheet cut the ending from the full address on purpose (`ui/addressEnd.ts`: "rather than trusting the API's separate `addressEnd` … Task 19 re-review, gap 2"). The new creditor screen uses `w.addressEnd`.

Attack under the threat model:
1. The API serves the creditor's wallet list with `address = attacker`, `addressEnd = <the creditor's real wallet's last 6>`.
2. The creditor sees their own wallet and taps "Send these payments to this wallet".
3. The device signs a `RecoveryAddressStatement` for the attacker's address with its trade identity from the disputed trade.
4. The API's route accepts it (`recoveryAddressValid`; the attacker's address is in no other account's wallet).
5. The moderation service checks it against its own attestation of that identity. It is genuine, so the service signs recoveries to the attacker on every purchase by the debtor, until the lien is paid.

This is the only place in Q2's design where the creditor's choice is turned into a signature, so this bug defeats Q2 for every honest creditor. The lead's 88ee097a had no such surface: it bound the source trade's own address automatically.

Proven (probe in `apps/web/test/liens.test.tsx`, not committed): with `address = '4…AAAEVILXX'` and `addressEnd = 'WWWWWW'`, the screen shows `…WWWWWW` and never `EVILXX`, and `signRecoveryAddress` is called with the EVILXX address. 1 passed.

Fix: `…{addressEnd(w.address)}` from `ui/addressEnd.ts`, plus a test that the shown ending is the end of the address the device signs. Consider showing more of the address here, as the accepted sheet does, because this choice routes all future recoveries.

### N1 (minor, was blocking): there is still no switch outside the API, and the device cannot tell an innocent buyer from a debtor
`apps/moderation/src/main.ts:289,372` (`checkLienRecovery` runs whenever a gate runs; no setting of its own). `site_flags.liens_enabled` is an API row.

On deploy, a compromised API can turn recovery on. It can then show every buyer "You owe another trader after a dispute. This purchase pays 0.5 XMR … Tapping Trade agrees to this." The moderation service signs it if the API has any (source, side) that a gate-verified ruling made a creditor, with that side's signed address: a staged dispute between two sock-puppet accounts, or an honest creditor whose device signed (or was tricked under B1-new). Per buyer, the residual now needs the person to tap Trade on a deduction they know is wrong, so it is no longer a silent take. That is why I downgraded it.

But the owner has not confirmed any of Q1-Q6, the copy is COPY-UNSIGNED, the notice is not designed (NEEDS_DESIGN_LIEN_NOTICE), and the doc still says "lead security review needed before liens are switched on". The only switch for all of that is one the attacker holds.

Fix (unchanged, small): a moderation-side `MOD_LIEN_RECOVERY=on` (or a gate-held flag), off by default. While it is off, `checkLienRecovery` refuses every `lienRecovery` (`lien-refused-off`), with a test. The doc's status line should name both switches.

### N2 (minor, unchanged): the appeal can still be hidden
`apps/moderation/src/lienRecovery.ts:422-438` (`lienRulingVerifier` is byte-for-byte as in 88ee097a). The API serves round 1 alone after the gate verified round 2. It is not `stale-round`, so `lienCreditorsOf(round1, null)` names round 1's creditor. Re-proven: 1 passed.

What changed on this version:
- To use it, the API now also needs a `RecoveryAddressStatement` signed by the appeal-loser's device. That is trivial for a staged dispute, or for a loser shown a fake "owed to you" lien on the screen.
- Pinning (`mod_liens`) does not help: it is per lien id, and the API can mint a fresh id (I4).
- The per-source total is still per side, so up to 2× the source XMR across both sides.

Fix as before: refuse (null) when the gate's `rulingsSeen` has a round 2 for the code but none is presented, and/or cap per source rather than per (source, side). Correct the doc: its Security section still says the money "still goes only to that lien's real creditor's own address".

### N3 (minor, honest API, unchanged): a hold on a trade closed with an escrow and no coin never closes; `complied` is refused forever
`apps/api/src/disputes/recovery.ts` `settleRecovery` (`closed` with an escrow returns `[]`), `apps/api/src/disputes/lien.ts:163` (`repaid` refused while any hold is `status = 'open'`). Nothing moves such a hold out of `open`. `applyLienVoid` (new, Q6) releases only holds of trades **not attested**, so it does not help either. Re-proven (adapted for `rate_bps`): take.test and lien.test probes, 2 passed. Fix as before: release the hold when `HOLD_COUNTS_SQL` stops counting it, and make `complied` test `HOLD_COUNTS_SQL` instead of `status = 'open'`.

### I1 (info): `X2F_FEE_WALLET` is optional in the API
`apps/api/src/config.ts` `feeWallet?`. When it is unset, the API reserves and accepts the fee wallet as a recovery address, and only the moderation service refuses it (`wrong-address`). The trade then stalls unattested (lead I2) instead of being skipped at reserve. Make it required whenever liens can be on, or derive it from the same build config the apps ship with.

### I2 (info): a creditor whose device no longer holds the disputed trade can never be paid
`apps/web/src/escrow/runtime.ts` `signRecoveryAddress` returns null without the trade's record (another device, or past the 30-day keep). The lien stays `active` with nothing reserved, forever. The doc names this (NEEDS_OWNER_RECOVERY_ADDRESS_DEVICE). It is a money outcome for the owner (OQ2): the lead's version paid the source trade's own address with no step for the creditor.

### I3 (info, compromised API): the API chooses among unapplied rate approvals, and applying one spends them all
`lienRecovery.ts:249` (`spends = rateTaps.map(…)` when any unapplied tap matches). With two verified approvals not yet applied, for example 70% and then a later 20%, the API names 70%. Both nonces are spent, and 20% can never be applied without a new tap. Proven: attest.test probe, 1 passed. Within the doc's stated residual ("delay a rate change a senior approved … by withholding the tap"), since the API can withhold the newer tap anyway. Cheap hardening: apply only the newest verified approval (by the tap's or request's time), or spend only the nonce applied.

### I4 (info, compromised API): pinning is per lien id
`lienRecovery.ts:226-238`. A fresh UUID as `lienId`, for the same source and side, names any buyer as debtor and is signed (proven: attest.test probe, 1 passed). The doc says this ("account ids are its word"). Only the per-(source, side) total bounds it. This is the "debtor binding needs a long-term buyer key" open item. I agree it is open.

## Comparison: lead-lien-recovery 88ee097a vs third-lien-recovery 6753fe29

6753fe29 is built **on** 88ee097a, so picking third means taking the lead's fix plus claude3's layer.

| Topic | lead 88ee097a | third 6753fe29 | Safer |
|---|---|---|---|
| Recovery address | The source trade's own payout/refund, bound at placement, frozen; no UI | The creditor device's signed statement; moderation checks it against its own attested identity | lead today (no UI surface); third once B1-new is fixed (the creditor chooses, and an old one-time wallet is not reused) |
| B1-new (addressEnd spoof) | n/a | **open, blocking** | lead |
| Buyer sees and accepts the figure (N1 core) | No: the device "confirms" the API's take figure silently | Yes: quote row + note, the take carries it, the device binds it in `verifyAttestation` and `cosignPolicy` | **third** |
| N1 switch outside the API | missing | missing | equal |
| Rate | Capped at 50% everywhere; no rate change can apply (NEEDS_GATE_LIEN_RATE) | 50% default; up to 90% only with a senior tap the gate verifies; spent taps; 24 h grace | lead is stricter per purchase (50% max); third does option b as the owner described, with real verification |
| Per-purchase device cap | 50%, buyer keeps ≥ 0.01 | 90%, buyer keeps ≥ 0.02 | lead (cap); third (buyer floor) |
| Exact figure in moderation | ≤ cap, sum per source | exactly `expectedRecovery`, sum per lien and per source | **third** |
| Tiny recoveries (Q5/M5) | Any size ≥ 1 atomic unit (M5 wallet2 risk if marked) | ≥ 0.01 XMR or nothing | **third** |
| N2 hidden appeal | open | open (needs the loser's device signature now) | third, slightly |
| N3 hold never closes | open | open | equal |
| M4 creditor sees purchases | per-trade rows, times, rate | totals only | **third** |
| M3 seller sees lien | open | disclosed (still open) | equal |
| Q6 void in flight | not handled | unsigned holds released, signed ones recorded and flagged | **third** |
| Creditor paid without action | yes | only after signing on the disputed trade's device (I2) | lead |
| Surface added | small | preview route, recovery-address route, worker signing, lien statements | lead |

**Recommendation for the lead:** pick **third 6753fe29**, conditional on B1-new being fixed (one line plus a test). It is the only version where the buyer actually agrees on their own device, which my 88ee097a review asked for as the condition for switching on. It also enforces the exact figure, the owner's option b with a gate-verified rate change, and totals-only for the creditor. In the same round add the moderation-side switch (N1) and fix N3. N2's cheap partial fix is optional. If the owner wants the 50% hard cap rather than 90% (OQ1), it is one constant (`LIEN_RECOVERY_MAX_BPS`) plus the SQL checks.

## Questions for the owner (via the lead)
- **OQ1 (Q1, provisional 90%).** The owner's option b says: 50% default, a change needs a reason and a senior's approval. That is built. Should the ceiling be 90%, as the provisional answer says, or should no rate go above the 50% default? Recommend: allow lowering freely with a senior tap, and allow raising above 50% only if the owner explicitly wants it. 90% leaves a buyer 10% of a purchase.
- **OQ2 (Q2 / I2).** A creditor who no longer has the disputed trade's device record can never set an address, so the lien can never recover. Accept this, or add a staff-assisted path (a senior's key tap binding an address)? Recommend: a senior-tapped path, verified by the gate like the rate.
- **OQ3 (N1).** Keep the moderation-side switch off until the owner signs the copy, the design and Q1-Q6. Recommend: yes.
- Q3 (seller sees, M3) and Q4-Q6: provisional answers are as in the doc; confirm them.

## Tests
Node 24.22.1, fresh `npm ci`, dockerd running (`docker info` OK; I did not start or restart it). The escrow, API and web runs were under `flock /tmp/claude-0/heavy.lock`.

All at 6753fe29, in the clean worktree (no probes):
- `@x2f/trade`: 21 files, 525/525 passed
- `@x2f/staff`: 11 files, 281/281 passed
- `@x2f/moderation` (hermetic): 16 files, 264/264 passed
- `@x2f/moderation-regtest`: 1 file, 2/2 passed (monerod regtest; download worked)
- `@x2f/staff-web`: 10 files, 95/95 passed
- `@x2f/escrow` (monerod regtest; download worked): 16 files, 104/104 passed
- `@x2f/api` (full): 118 files, 2799 passed | 1 todo (2800), 0 failed. The branch's PROBE-B2 and PROBE-B3 are green.
- `@x2f/web` (full): 138 files, 2135/2135 passed
- `npm run typecheck` (all workspaces): clean
- `npm run copy-lint`: clean (apps/web/src, apps/staff-web/src)

Not run: Playwright, including the branch's new `quote.spec.ts` lien case (not requested); node-proxy, relay and tools projects (not touched by the diff).

Probes, in the separate copy `/home/user/wt/rv-third-lien2p`, diff at `/tmp/claude-0/-home-user-X2F/bdea06da-655a-56d0-8974-5e152881a423/scratchpad/probes-third-lien2.diff`:
- B1-new, `apps/web/test/liens.test.tsx`: the spoofed ending is shown and the attacker's address is signed. 1 passed | 8 skipped. **Real.**
- N2, `apps/moderation/test/gate.test.ts` (merged beside the new lien-rate tests): with round 2 hidden the verifier returns `['buyer']`. 1 passed | 67 skipped. **Real.**
- N3, `apps/api/test/take.test.ts` (take now sends the accepted figure) and `apps/api/test/disputes/lien.test.ts` (the hold insert now carries `rate_bps`). 2 passed | 114 skipped. **Real.**
- I3 and I4, `apps/moderation/test/attest.test.ts`: the older approval spends the newer one; a fresh lien id signs for an innocent buyer. 2 passed | 17 skipped. Both as described.
- B2 and B3 adapted: the old probes cannot be set up as written any more (no newest-wallet lookup; SQL caps the rate at 9000). Their successors are the branch's own `PROBE-B2 (review)` (a creditor cannot point recoveries at the debtor's payout, even after adding it as their own wallet) and `PROBE-B3 (review)` (90% on a small purchase is reduced so the buyer keeps 0.02 XMR; nothing when it does not fit). Both are in take.test and pass in the full API run.

Counts: 1 Blocking (B1-new), 3 Minor (N1 downgraded, N2, N3), 4 Info (I1-I4), 3 owner questions. Earlier: B1, B2, B3, B4, M1, M2, M4, M6 and the lead's I1 fixed; M5 docs only (now safe); M3 disclosed only.
