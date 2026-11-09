# Security review: wip/lead-hold-v3 da7e7f77 (local h3; merge-base origin/main 5c4c8773). CHANGES REQUIRED. 2 Critical, 3 Important.
Reviewer: lead's independent security reviewer, 8 Nov 2026. Read-only. Ran apps/api/test/holdV3.test.ts: 38/38 pass (the two Criticals are not covered by any test).

## Prior review (6 Nov, b0bc72c4): all closed
- C1 recovery chain: closed. recovery.ts:226 deletes trusted_devices at the recovery-code login; revealDue (recovery.ts:270-278) allows only a strong full session or the waited recovery session, opened at or after the code was replaced, never a member. Tested (holdV3 "a password thief on a once-trusted device never reads the new code").
- I2 purge: closed. 016_hold_v3.sql:58-68 before-delete trigger takes drafts first; tested with the purge and an account deletion.
- I3 web: closed. HoldChanges.tsx (ticks, Cancel all, Approve now), NewRecoveryCode.tsx, auth-client routes.
- I4 permanent freeze: closed in held.ts:106-124 (resume decided per trade when its last row goes; maintenance waits). But see Critical 2: the timer loop undoes every hold pause.
- I5 disputes on paused trades: closed. machine.ts:560 WHILE_PAUSED adds walk-away and open-dispute; held account refused (disputes/routes.ts:237, :270).
- I6 approval flood: closed (approval.ts refused outcome, thrown after commit). Moot now that G58 replaced the discard.
- I7 removals: closed by owner p5-7 (wallets/routes.ts:385-401, team/members.ts:225-231 staged).
- I8 PGP login username: closed (pgp.ts requireLoginName, G6).
- Minors: all addressed (cancel-all takes every session's drafts, wallet address ends, a daily cap, staff extend/end routes, appeal/dispute refused for the held account, catchUpHeldTrades, push on applied). The cap is now Critical 1.

## CRITICAL
1. A password thief can stop the real owner cancelling, so the thief's new password applies and the owner is locked out.
   holdRoutes.ts:115 (cancel), :77, :97; hold.ts:494; holdChanges.ts:46-47; throttle.ts:121-133.
   The 100/day cap is one bucket per account (`hold-changes:<accountId>`), shared by every session, and dailyCap counts every call before anything else, refused ones included. Cancel is behind it.
   Scenario: thief has the username and password (copied device cookie, or an approval the owner tapped). At 00:00:05 UTC he stages and submits a new password (due 00:00:05 next day), then sends 100 `DELETE /v1/account/hold/changes/<random uuid>` (each a 404, each counted). The owner sees the alert and taps Cancel all: 429 slow-down until midnight. A recovery-code login logs the thief out but its session's cancel hits the same 429 (G32 keeps the waiting change). The cap resets 5 seconds before the change applies, and the thief, if still logged in, burns the new day too. applyPassword (password.ts:378-381) then revokes every session but the thief's, the owner's recovery session included. The holdV3 test at :343 already shows a full bucket refusing DELETE /v1/account/hold/changes.
   Fix: never cap cancelling (it only takes power away; g65 "a cancelled change never applies"). Cap staging and submitting per session, count only successful ones, and coalesce the alerts instead. Test: a session at the cap still cancels; a second session's flood never blocks the owner.

2. Hold-paused trades resume within 5 seconds: the "frozen until a moderator decides" guarantee (G7, G33) never holds in production.
   packages/trade/src/timerLoop.ts:69; apps/api/src/main.ts:137-143 (startTimers runs every 5 s, TIMER_LOOP_MS); trades/held.ts:24-26 (the SEAM note says the loop "is not running in the API yet": wrong, it runs on main too).
   With maintenance off, decide() resumes every trade with paused_at set, whoever paused it. syncHeldTrades never pauses again (the row is already `paused`). The trade's deadlines then run, and /internal/v1/watch reports paused=false (internal/routes.ts:330), so the moderation service's timers (final alert, lapse escalation, the 6 h fallback) run too. Meanwhile refuseHeldTradeEvent still blocks the held party entirely and the partner's mark-paid.
   Scenario: buyer B has sent fiat; seller S's account goes into a recovery-code hold before B taps "I've paid". The trade is paused, resumed by the next timer pass, B's mark-paid is refused (409 counterparty-unavailable), the pay window and the moderator's timers run out, and the escrow is refunded to S with no moderator decision. B's only option is a dispute after the refund. A maintenance end resumes held trades the same way.
   Fix: the timer loop must not resume, and the watch must report paused, while the trade has an open held_trades row (filter in timers.ts's query, or pass the held codes into timerEvents); remove the SEAM note. Test with the real loop: a held trade stays paused across timer passes and across a maintenance on/off.

## IMPORTANT
3. A team member with the hold-cancel right can block their own removal or loss of rights for good.
   holdChanges.ts:198-204; holdRoutes.ts:130-140; routes/team.ts:191-213.
   A username-and-password lead's removal or role change of a member is staged (p5-7). A member with `hold-cancel` (or `hold-end`) cancels any waiting change, including `team-remove`/`team-roles` for that member's own id. Scenario: the lead removes a rogue member; the member unticks it; this repeats every time. Only a strong login (which this lead may not have) or a recovery-code login gets the member out. The member keeps access the whole time (p5-7: "the member keeps their access until it applies").
   Fix: a member may not cancel or approve a waiting change that names them (team-remove, team-roles with memberId = their own). Ask the owner whether members may touch team changes at all (p4-8 grants the right; G57 "only a team lead can kick out team members").

4. A username-and-password owner can neither kick out a thief nor make their own password change land (owner g64).
   holdChanges.ts:175 (every submission moves every waiting change of the account to now + 24 h); routes/account.ts:457 (a weak session ends only itself).
   g64: the new credentials take effect after 24 hours, "so the real owner can still log in with the old ones and kick out a thief". In the code the owner's weak session can't end the thief's weak session (R3-M2, a lead decision of 30 Oct, older than g64). And the owner's own submitted password change can be held back for ever: the thief submits any small change every ~23 h, which pushes the owner's due date back each time, at a cost of 2 actions. The only way out is a recovery-code login (logs everyone out, a 24 h freeze; the owner's waiting change then applies during the hold and revokes the owner's recovery session too, per item 1's applyPassword).
   Fix (owner/lead decision; it touches the banner's single date): give each change its own 24 h from its own submission, or never move a change already submitted; and let a weak session end weak sessions younger than itself, as R4-M1 already does for recovery sessions. Ask the owner if the one-date banner is his rule.

5. During a hold the partner's buyer-cancel moves coins, against G7 "no coins move until a moderator decides".
   trades/held.ts:41 (PARTNER_EXITS includes buyer-cancel); machine.ts:560.
   On a funded trade whose seller is held, the partner buyer's "Cancel trade" returns the escrow to the seller's refund address at once (R39). The address is safe (locked at setup), but it is money moving during a hold with no moderator. Owner call (money rule): either allow it as a way out and record it under G7, or limit the partner to open-dispute and walk-away (before funding) once the escrow holds coins. Test (holdV3:750) currently asserts it goes through.

## MINOR
6. Staff hold end: the activity-log entry is written in a second transaction after the hold has ended (staff/holds.ts:51-57), so a failure leaves an unaudited end (G35: every hold action audited). It also passes no TradePublisher (staff/holds.ts:53 → hold.ts:708), so partners' live views don't hear the resume. Write the log inside endHoldByModerator's transaction (a hook) and pass app.tradePublish.
7. p7-9 (8 Nov) says team changes of a username-and-password lead still wait even when a strong member makes them; a `hold-end` member's Approve now (holdRoutes.ts:92-109) ends that wait for team changes too. Owner question: does "End a hold" cover team changes?
8. A password-only owner can lose the replaced recovery code without being told: revealDue needs the waited recovery session or a strong login. The recovery session expires 25 h idle / 48 h absolute (sessions.ts:98), and a staff extension past 48 h (hold.ts:666-679, up to 30 days per call) outlives it. A later password session can't reveal, and recoveryCodeToShow stays false. Fix: after that, tell the owner the code needs replacing (or allow the reveal to a full session on the recovery session's device).
9. Stale comments that say the opposite of the code: recovery.ts:7 and hold.ts:18 ("waiting changes are discarded" at a recovery-code login; G32 keeps them, recovery.ts:200-202), approval.ts:196 and methods.ts:354 (a strong login "discards" waiting changes; G58 replaced that).
10. syncHeldTrades' check for another open row (held.ts:111-117) is not under the trade lock: a second account's hold that starts between the check and the resume can be resumed over. Narrow; do the check inside applyEvent's `before`.
11. Members with hold-see get `by` (the lead's device labels) for each waiting change (holdChanges.ts:250). Drop it for members unless design wants it.

## Confirmed safe
- Approve now: strong full session only (weakOf: recovery and weak sessions 403), never during an account hold, ids must be waiting changes, approved under the account lock (holdRoutes.ts:93-109). A thief can't make his session strong: TOTP, passkey and PGP adds are staged.
- An account hold ends only by time, a passkey/security key/PGP key the account held when it started (ownerProof; password+TOTP is not enough), or staff with accounts.freeze. No login opens a session during it, trusted device or member included (approval.ts, sessions.ts:181-189).
- Recovery code: spent under the account lock (one use), replaced at once, sealed, revealed once only to the right session, a thief's trusted cookie dies. The owner's proof ends the recovery session and the trust.
- A password thief during the 24 h: every change to login, security, wallets, members (removals included) and the recovery code is staged; he can't log out other sessions, answer approvals, mark the hold's alerts seen, invite members (strong only) or add a payout wallet to a trade beyond the account's usable ones. He can still trade, post and pause offers, block users and read alerts and chats (as built, owner Q14). No email/Jabber address exists yet: when Jabber lands its address change must go in SECURITY_CHANGE_ROUTES.
- Team rights never reach the lead's drafts (holdChanges.ts:200); members can't stage; member rights include the lower ones (perms.ts hasRole).
- Races: stage/submit/cancel/approve/settle, the recovery login and the owner's proof all take the account lock; a take that races the login is caught by catchUpHeldTrades.
- Purge and deletion with drafts and submitted changes (trigger + set null + check), tested.
- G62: waiting changes keep counting during maintenance, tested.

## Strings added (all flagged, none signed)
COPY-UNSIGNED: apps/web/src/screens/settings/holdCopy.ts (whole file), NewRecoveryCode.tsx, HoldChanges.tsx, teamCopy.ts ROLE_WORDS and the hold-rights line, cantDoCodes.ts holdChangesCantDoText and the changes-changed refusal. DESIGN: cantDoCodes.ts:418, :430, :484. Factual errors to fix before design signs: :418 and :430 say open trades can still be finished (held trades refuse the held account's own sessions, holdV3 "cannot move its held trades either"); :430 says a backup login "in the meantime" works (the old code is spent and the new one is sealed); :484 says a username-and-password device "can't change their roles" (role changes are now staged).
