# Re-verify: `wip/lead-bans` 105fc09d (bans review MF1, MF2, S1-S6)

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. I made no code edits to the branch. I worked in a detached worktree `rv-bans2` (removed afterwards); the one throwaway mutation run there was reverted. Every test run held `~/x2f-comms/check.lock`.

Scope:
- 5b151773: the red tests, test files only (5 files, +313/-7). On top of 53f9dd47.
- 105fc09d: the fix, 9 source files.

The review being re-verified is `review-bans-2026-11-12.md`.

## Verdict: PASS for every item; 1 test defect to fix (e2e/banned.spec.ts)

All eight items are fixed at their cause and pinned by a test that fails at 5b151773 and passes at 105fc09d. No regressions in the files I reran.

The one defect is in the new e2e spec: VERDICT_E2E_PLACEHOLDER

## Item by item

| Item | Fixed at the cause? | Pinned by (red at 5b151773, green at 105fc09d) |
|---|---|---|
| MF1 allowlist per trade and chat | Yes | `bans.test` "MF1: an open trade opens only itself..." and "MF1: a closed trade whose dispute is still open...". Plus a mutation check, below. |
| MF2a lift clears the ban list | Yes | `bans.test` "MF2 (lead call): lifting a lifetime site ban takes ... off the ban list, and only theirs" |
| MF2b banned seller can log in | Yes | `banList.test` "review MF2 (lead call): a banned account's own registered key is never refused at login..." |
| S1 way back into the trade | Yes | `bans.test` "S1, S3, S4: ..." and "S1: the notice lists the open trades and disputes"; `accountBanned.test` "review S1"; `e2e/banned.spec.ts` (see the e2e section) |
| S2 streams ended | Yes | `bans.test` "S2: a site ban closes the account's open event streams; a trade ban does not" |
| S3 approvals | Yes | `bans.test` "S1, S3, S4" (approvals pass with an open trade, are refused with nothing unfinished) |
| S4 feedback form | Yes | `bans.test` "S1, S3, S4" (passes even with nothing unfinished) |
| S5 reinstated logged | Yes | `bans.test` "S5: a new ban that closes out an ended, unsettled one logs account.reinstated for it once" |
| S6 banId in the lift log | Yes | `bans.test` "lifting is tapped and logged" (now expects `banId`), and the MF2 test |

### MF1: the gate checks the specific trade or chat

`siteBanAllows` (banState.ts) is now async and takes the request: method, route template, `params` and `body`. It splits routes into four groups:
- `ALWAYS`: the notice, `me`, the Terms, the feedback form.
- `ACCOUNT`: account-wide reads and upkeep. These pass only while `hasUnfinished`.
- `TRADE`: a trade's own routes. They pass only when `params.code`, normalized, names one of the account's unfinished trades: `closed_at is null`, or a dispute not `closed` (so the appeal window counts).
- `CHAT`: a chat's own routes. They pass only for a chat of the account's on such a trade. An offer chat (`trade_code` null) never passes, because the join requires a trade.

`GET /v1/chats` (the list) is gone from the allowlist. `POST /v1/nudges` passes only when the body's `context` is such a trade or such a chat. The nudge handler still checks that the recipient shares that context (`hasSharedContext`), so a nudge can only go to that trade's counterparty.

The test covers both sides:
- **Refused:** a closed trade, its chat and its events; an unknown or malformed code; a closed trade's chat; an offer chat (GET, envelopes, identity); the chat list; a nudge in a closed trade's context, an offer chat's context, or with no context.
- **Allowed:** the open trade (including the lower-case, dash-less spelling of its code), its events and chat, its chat's routes, and a nudge in the trade's context or its chat's context.

**Mutation check.** At 5b151773 the MF1 test fails first on the *allowed* nudge line, which is S1 territory. So that run does not show that the *refused* half bites. I put back the old route-wide semantics in a throwaway edit of `banState.ts`: trade and chat routes passing on `hasUnfinished`, and `GET /v1/chats` allowed. MUTATION_PLACEHOLDER

### MF2: the ban list is undone on lift, and never stops the account's own key at login

**Lift.** For a lifetime site ban, the lift now deletes the `banned_identifiers` rows whose `account_id` is the account, or one of its team members' login accounts. The members come from `team_members`, removed ones included; `recordBan` records those too, so the two match. The log carries `identifiersRemoved`. Rows recorded for anyone else stay (the test checks a bystander's ban).

**Login.** The PGP login's refreshed-key check passes `ownAccountId`, and `anyBanned` then ignores rows recorded as that account's own (`account_id is distinct from $3`). So a site-banned seller whose merged key carries their own banned primary still logs in. A subkey banned as someone else's, or with a null `account_id`, still refuses with 409 `key-unavailable` (tested). Adding a key (`applyPgpKey`, `insertPgpKey`) still refuses the account's own banned key; only the login gets the exemption. For a team member's PGP login, `account.id` is the member's login account, which is also the `account_id` its rows were recorded under. Password, passkey and recovery logins never checked the ban list, so nothing else stood in the way.

### S1-S6

- **S1.**
  - `GET /v1/account/ban` returns `unfinished: [{ code, dispute }]`, newest first, under a site ban (empty otherwise).
  - The notice links each one to `/trade/:code`, or to `/trade/:code/dispute` when its dispute is open. Both routes exist in App.tsx.
  - `ACCOUNT` lets the shell and the trade room's reads through while something is unfinished: news, methods, price, currencies, hold, push, chat-keys, events, wallets, alerts. `POST /v1/nudges` is allowed per trade (MF1).
  - Browsing offers, posting, taking, settings and new chats stay 403 (tested).
- **S2.** After the ban's transaction commits, a site ban calls `traderEvents.closeAccount(accountId)`. `main.ts:152` passes `app.events` to the staff API in the same process, and the test helper now does the same. A reconnect then meets the gate. That is fine for a person still finishing a trade, because `/v1/events` passes while something is unfinished.
- **S3.** `GET /v1/account/approvals(/:id)` and `POST /v1/account/approvals/:id` pass while something is unfinished, and are refused with nothing unfinished (tested).
- **S4.** `POST /v1/feedback/form` is in `ALWAYS` (tested with nothing unfinished).
- **S5.** The place route's make-room update returns the bans it ended and writes one `account.reinstated` for each. The settle job then finds nothing left to log for them (tested: exactly one entry).
- **S6.** `account.ban-lifted` carries `banId`. The action schema adds `banId: 'id'` and `identifiersRemoved: 'number'`.

## Tests (single lock, at the commit named)

RESULTS_PLACEHOLDER

## Notes (none blocking)

- `ACCOUNT` passes on "anything unfinished", account-wide. That is right for shell reads. It also lets a site-banned person with one open trade approve a new device's login (S3, as recommended), subscribe push, and post chat-key envelopes for their own devices. None of these start a trade or reach another person.
- A site-banned person in an unfinished trade cannot add a wallet (`POST /v1/wallets` is refused). The trade's wallet step uses an existing wallet, so this only matters for someone with none, which an open trade practically rules out.
- A site-banned account's requests now cost 1-2 extra queries each. Only banned accounts pay it.
- The e2e stubs the API rather than running the real gate (the gate itself is pinned in `bans.test`). The spec's `waitForTimeout(500)` "stays open" check is weak against slow redirects. Waiting on a specific request would be firmer.
