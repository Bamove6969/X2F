# HANDOFF: hold model v3 (API), 2026-11-02

Branch `wip/lead-hold-v3` (pushed), head **b5802ec9**, worktree `~/x2f-worktrees/lead-hold-v3` (npm ci done).
Main line `origin/claude/compassionate-johnson-k95ssr` @ b6835ee is merged in (ef29c2a, clean, no api or lockfile changes).
Commits: d1f7a05 red tests; 8761e6a feature WIP; ef29c2a merge; b5802ec fixes.

## What's done (API + data model)
- **Migration `016_hold_v3.sql`**:
  - `account_holds` reason adds `recovery-code`.
  - `hold_changes`: staged drafts and submitted changes, with `seq`, `session_id`, `submitted_at`, `due_at` and `methods_before`. A trigger deletes a draft when its session is revoked.
  - `held_trades`: one row per (code, account), action `cancel`/`pause`, with `paused` todo/paused/skipped and `released_at`. It has no foreign key to trades, because of the lock order.
  - `recovery_code_reveals`: the new code, sealed, kept until it is shown once.
- **Password-only changes** (`auth/holdChanges.ts`, `auth/holdRoutes.ts`):
  - `gateChange` now stages the change (202 `{status:'staged', changeId}`) instead of starting an account hold.
  - `GET /v1/account/hold` returns `accountHold`, `changes{count,takesEffectAt,items}`, `drafts` and `changesWait`.
  - `POST /v1/account/hold/changes/submit {ids}` sets 24 h for all waiting changes (one date) and sends alert `hold-changes-submitted` (the list) plus a push.
  - `DELETE /v1/account/hold/changes[/:id]`: any lead session can cancel, a weak one included.
  - A login with a passkey, security key or PGP key held before the submission discards the changes (`discardChangesIfOwner` in `traderLogin`). Password+TOTP does not.
  - Job `settleDueChanges` runs every minute (main.ts) and applies the changes through `applyChange`.
  - A team role change (`PATCH /v1/team/members/:id`) from a weak session is staged (kind `team-roles`, `applyRoles`).
  - `GET /v1/account/me` gains `pendingChanges`, `changesWait` and `recoveryCodeToShow`.
  - The login-name reservation also covers `hold_changes`.
- **Recovery-code login** (`recovery.ts` `backupSession`): in one transaction it:
  - revokes all sessions, members included (alert `sessions-ended` with reason `recovery-code`);
  - expires approvals;
  - discards changes;
  - starts the hold (`recovery-code`);
  - holds the trades (`trades/held.ts`);
  - renews the ONE code (`RECOVERY_CODE_COUNT=1`) and seals it for `POST /v1/account/recovery-code/reveal`, shown once to a full lead session opened after it.

  During the hold every login is refused (`traderLogin`; a member's login in `openSession`) except the owner's proof with a pre-existing passkey, key or PGP key (password-totp no longer counts), which ends the hold. A TOTP backup login now answers 403 `method-not-allowed`. The held account's offers are hidden (`holdSql.ts`, from recovery-rules).
- **Trades** (`trades/held.ts`):
  - Funded trades get the machine's system `pause` after commit (`syncHeldTrades`, plus a minute job). They resume when the hold ends (time, owner proof, moderator).
  - The partner view has `counterpartyProblem`. Partner events other than `buyer-cancel`/`walk-away` get 409 `counterparty-unavailable`. The held account's own events get 403 `recovery-hold`.
- **No approver**: a new device gets in only with a passkey, key or PGP. Anything else gets 403 `approval-unavailable`, with no hold. No `weak-new-device` holds any more.
- **Moderator hooks** (internal, no route): `extendHoldByModerator` and `endHoldByModerator` in hold.ts.
- **Route classification**: the 4 new write routes are in `LIVE_SESSION_ROUTES`. The team tripwire is updated. `schema.test.ts` lists 016.

## Test status
- **apps/api tsc**: clean before the last commit's small edits. Re-run it.
- **holdV3.test.ts**: 20/24 passed on the run before b5802ec. b5802ec fixes 3 of the 4 failures (ordering, plus two test-setup issues), but that has not been re-run yet.
- **Still unknown**: one failure in the partner-view check of "trades: …partner sees only…". Some string in the partner's trade view matches /hold|security|vendor/. The diagnostic run (test now prints `.{40}word.{40}`) failed again but its output showed no readable match. Next: print `words` itself and look. Find the field and either rename it or narrow the test.
- **NOT yet run**: coolingOff.test.ts (its many Task-17 tests are now obsolete, see below), deviceApproval, recovery, team, take, offers, wallets, account and schema tests, separation-check.

## Exact next steps
1. `cd ~/x2f-worktrees/lead-hold-v3/apps/api && flock ~/x2f-comms/check.lock npx tsc --noEmit`
2. `flock ~/x2f-comms/check.lock npx vitest run --project @x2f/api apps/api/test/holdV3.test.ts` and fix the remaining partner-view word failure.
3. Rewrite the obsolete tests in **coolingOff.test.ts** to v3:
   - "one weak way", C1, C2, I2 (`t_fail_holds` cases for change and new-device holds), "during the hold" (`heldTrader` relied on a weak new-device hold; use a recovery-code login instead), and I3 (a held backup session finishing trades is now refused by v3).
   - Round 2 to 4 cases that start a hold with `changePassword` (202 is now `staged`, not a hold).
   - Keep the strength table, classification and lock tests.
4. Update **recovery.test.ts**: one code, no TOTP backup login, sessions logged out.
5. Update **deviceApproval.test.ts**: no-approver cases, now `approval-unavailable`.
6. Update **team.test.ts**: a weak role change is now 202 staged, not 403.
7. Then run the api suite, typecheck and separation-check under flock, and push.

## Seams (trade engine, not done)
- The trade machine has no system cancel event, so "unfunded trades cancelled" is only marked (`held_trades.action='cancel'`, partner flag, partner may leave). It needs a new system event in packages/trade, plus store `STORED`, protocol and web.
- The timer loop (`timerLoop.ts`) is not wired into the API yet. When it lands, "maintenance off → resume every paused trade" must skip trades with an open `held_trades` row.
- `counterpartyProblem` is only on `GET /v1/trades/:code`. Views built by live-event publishers say false.

## Open questions for the owner (conservative choice taken)
1. PGP-alone sessions: their changes still queue like password-only ones. Today's 10-29 rule is kept; v3 says "username+password-only".
2. Which changes queue: all of today's security changes are queued, not only login methods, wallets and team. That includes login name, one-device, logout timer, recovery code and wallet adds. Wallet removal and member removal stay immediate, because they only take access away.
3. A later submission resets every waiting change to 24 h from the latest submission (one date).
4. Submitted changes survive the revocation of the session that staged them; drafts do not.
5. Team members cannot see or cancel the lead's waiting changes (owner-only routes).
6. A recovery-code login discards waiting password-only changes.
7. Partner may still leave a held trade (buyer cancel or seller walk-away); everything else is refused. Chat and disputes stay open.
8. The new recovery code can be revealed by any full lead session opened after its use, a password-only one included. It is sealed with the TOTP key store under its own context.
9. TOTP backup login is removed (owner: TOTP-only login not allowed).
10. Password+TOTP on a new device with only weak sessions open still goes in (the R2 N-I3 rule kept). Only "no device at all" requires passkey, key or PGP.
11. Incident ID for the moderator pop-up: not built.
12. Moderator end/extend: alerts only, no audit row. Sessions are untouched on end.
13. Cap of 20 changes per account (`too-many-changes`).
