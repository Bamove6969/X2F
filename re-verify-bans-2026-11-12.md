# Re-verify: `wip/lead-bans` 2ac92021 (bans review MF1, MF2, S1-S6)

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. I made no code edits to the branch. I worked in a detached worktree `rv-bans2` (removed afterwards). The one throwaway mutation there was reverted, and the tree was clean at the end. Every test run held `~/x2f-comms/check.lock`.

Commits on top of 53f9dd47:
- **5b151773:** red tests, test files only.
- **105fc09d:** the fix, 9 source files.
- **2ac92021:** READY. Only `e2e/banned.spec.ts`: the three URL checks now allow `?returnTo=`.

The review being re-verified is `review-bans-2026-11-12.md`.

## Verdict: PASS on all eight items; 1 must-fix before landing (a pre-existing red test, not caused by these fixes)

All eight items are fixed at their cause. Each is pinned by a test that fails at 5b151773 (or, for the e2e, against 53f9dd47's source) and passes at 2ac92021. Nothing regressed in the 16 API files, 4 web files, the e2e spec or tsc.

**Must-fix: `frontDoor.test.ts` is red on the branch.** One test fails: "every session-guarded route ... is behind requireInside or is listed as own-data-only with a reason". The cause is that `GET /v1/account/ban` is not in `OWN_DATA_READS` (`apps/api/src/auth/frontDoor.ts`).
- It fails identically at 53f9dd47, 105fc09d and 2ac92021. The route came in at 2d6c7cc0 (Task 27).
- My first bans review did not run frontDoor, so I missed it there. Sorry.
- Fix: one entry, e.g. `'GET /v1/account/ban': 'my own bans in force (general reason and end only), my unfinished trades under a site ban, and the moderator links'`.

## Item by item

| Item | Fixed at the cause? | Red at 5b151773, green at 2ac92021 |
|---|---|---|
| MF1 allowlist per trade and chat | Yes | `bans.test` "MF1: an open trade opens only itself and its chat ..." and "MF1: a closed trade whose dispute is still open ..."; mutation check below |
| MF2a lift clears the ban list | Yes | `bans.test` "MF2 (lead call): lifting a lifetime site ban takes ... off the ban list, and only theirs" |
| MF2b banned seller can log in | Yes | `banList.test` "review MF2 (lead call): a banned account's own registered key is never refused at login ..." |
| S1 way back into the trade | Yes | `bans.test` "S1, S3, S4" and "S1: the notice lists the open trades and disputes"; `accountBanned.test` "review S1"; `e2e/banned.spec.ts` test 1 |
| S2 streams ended | Yes | `bans.test` "S2: a site ban closes the account's open event streams; a trade ban does not" |
| S3 approvals | Yes | `bans.test` "S1, S3, S4" (allowed with an open trade, refused with nothing unfinished) |
| S4 feedback form | Yes | `bans.test` "S1, S3, S4" (allowed with nothing unfinished) |
| S5 reinstated logged | Yes | `bans.test` "S5: a new ban that closes out an ended, unsettled one logs account.reinstated for it once" |
| S6 banId in the lift log | Yes | `bans.test` "lifting is tapped and logged" (now expects `banId`), and the MF2 test |

At 5b151773, the failures in `bans.test` (7), `banList.test` (1) and `accountBanned.test` (1) are all the intended assertions. None is a setup error: for example, rows still present after a lift, `closeAccount` not called, a missing `account.reinstated`, `GET /v1/news` refused, `unfinished` undefined.

### MF1: the gate now checks the specific trade or chat

`siteBanAllows` (banState.ts) is now async and takes the method, the route template, `params` and `body`. Routes fall into four groups:
- **`ALWAYS`:** the notice, `me`, the Terms, the feedback form.
- **`ACCOUNT`:** account-wide reads and upkeep. They pass only while `hasUnfinished`.
- **`TRADE`:** a trade's own routes. They pass only when `params.code`, normalized, names one of the account's unfinished trades: `closed_at is null`, or a dispute that is not `closed` (so the appeal window counts).
- **`CHAT`:** a chat's own routes. They pass only for one of the account's chats on such a trade. Offer chats never pass, because the check joins to a trade.

The chat list (`GET /v1/chats`) is gone from the allowlist. `POST /v1/nudges` passes only when the body's `context` is such a trade or such a chat, and the handler's `hasSharedContext` still limits the recipient to that trade's counterparty.

**Tests.**
- Refused: a closed trade, its chat and its events; an unknown or malformed code; the closed trade's chat; an offer chat (GET, envelopes, identity); the chat list; nudges in a closed or offer-chat context, or with no context.
- Allowed: the open trade, including a lower-case, dash-less spelling of its code; its events and chat; its chat's routes; nudges in its context.

**Mutation check.** At 5b151773 the MF1 test fails first on an *allowed* line (the nudge). So that run alone does not prove the *refused* half bites. At 2ac92021 I put back the old route-wide behaviour in a throwaway edit of `banState.ts`: trade, chat and nudge routes pass on `hasUnfinished`, and `GET /v1/chats` is allowed. The MF1 test then **fails** on a refused line: `GET /v1/trades/<closed trade>` was let through. So the over-wide case is pinned. The edit was reverted with `git checkout`, and the tree was clean afterwards.

### MF2: the ban list is undone on lift, and never stops the account's own key at login

**Lift.** Lifting a lifetime site ban deletes the `banned_identifiers` rows whose `account_id` is either:
- the account itself, or
- one of its team members' login accounts (from `team_members`, removed members included, matching what `recordBan` records).

The log entry carries `identifiersRemoved`. A bystander's ban stays (tested).

**Login.** The PGP login's refreshed-key check passes `ownAccountId`, and `anyBanned` then skips rows recorded as that account's own (`account_id is distinct from $3`). So a site-banned seller whose merged key carries their own banned primary still logs in. Still refused with 409 `key-unavailable` (tested): a subkey banned as someone else's, or with a null `account_id`.

Where the exemption does not apply:
- Adding a key (`applyPgpKey`, `insertPgpKey`) still refuses the account's own banned key. Only the login is exempt.
- For a member's PGP login, `account.id` is the member's login account, which is the same id its rows were recorded under.
- Password, passkey and recovery logins never checked the ban list.

### S1-S6

- **S1.**
  - `GET /v1/account/ban` returns `unfinished: [{ code, dispute }]` under a site ban (empty otherwise), newest first.
  - The notice links each trade to `/trade/:code`, or to `/trade/:code/dispute` when its dispute is open. Both routes exist in App.tsx.
  - While something is unfinished, `ACCOUNT` lets the shell and the room's reads through: news, methods, price, currencies, hold, push, chat-keys, events, wallets, alerts.
  - Offers, posting, taking, settings and new chats stay 403 (tested).
- **S2.** After the transaction commits, a site ban calls `traderEvents.closeAccount(accountId)`. `main.ts:152` passes `app.events` to the staff API in the same process, and the test helper now does the same. Reconnecting is fine for someone still finishing a trade: `/v1/events` passes while something is unfinished.
- **S3.** `GET /v1/account/approvals(/:id)` and `POST /v1/account/approvals/:id` pass only while something is unfinished.
- **S4.** `POST /v1/feedback/form` is in `ALWAYS`.
- **S5.** The place route's make-room update returns the bans it ends and logs one `account.reinstated` each. The settle job adds none for them (tested: exactly one).
- **S6.** `account.ban-lifted` carries `banId`. The schema adds `banId: 'id'` and `identifiersRemoved: 'number'`.

### The e2e spec (2ac92021)

At 105fc09d, all three URL checks used `/\/account\/banned$/`. That cannot match, because `api()` redirects to `/account/banned?returnTo=...`. Both tests that use it failed at 5b151773, and would have failed after the fix too, for the wrong reason. 2ac92021 changes the checks to `(\?|$)`.

With that spec:
- **At 2ac92021:** 3/3 pass (`--trace off`).
- **Against 53f9dd47's source** (spec copied in): test 1 **fails** on the intended assertion, the missing `Trade K7M2-...` link (S1). Tests 2 and 3 pass there, as regression checks should.

## Tests (single lock)

At 5b151773 (red):

| File | Result |
|---|---|
| api `staff/bans.test.ts` | 7 failed / 13 passed (20), all 7 new |
| api `banList.test.ts` | 1 failed / 26 passed (27), the new one |
| web `accountBanned.test.tsx` | 1 failed / 4 passed (5), the new one |
| `e2e/banned.spec.ts` (old regex) | 2 failed / 1 passed, see the e2e section |

At 105fc09d (API and web source are identical at 2ac92021):

| File | Tests |
|---|---|
| api `staff/bans` | 20/20 |
| api `banList` | 27/27 |
| api `offers` | 40/40 |
| api `take` | 57/57 |
| api `sessions` | 28/28 |
| api `team` | 70/70 |
| api `holdV3` | 45/45 |
| api `schema` | 77/77 |
| api `staff/keyTap` | 28/28 |
| api `staff/matrix` | 105/105 |
| api `nudge` | 58/58 |
| api `chat` | 54/54 |
| api `accountInactivity` | 18/18 |
| api `staff/members` | 27/27 |
| api `frontDoor` | **20/21, the pre-existing failure above** (same at 53f9dd47) |

At 2ac92021:

| Check | Result |
|---|---|
| web `accountBanned` + `client` + `cantDoThat-lint` + `tradeBanText` | 93/93 (4 files) |
| `e2e/banned.spec.ts` with `--trace off` | 3/3 |
| `tsc --noEmit`, apps/api and apps/web | clean |

Extra checks:
- MF1 mutation at 2ac92021: the MF1 test fails, as it should.
- Fixed e2e spec against 53f9dd47's source: test 1 fails, as it should.
- Semgrep (p/typescript, p/javascript, p/security-audit; `--metrics=off`) on the changed files, exported from 105fc09d: **0 findings, 0 errors**, 10 files scanned. Semgrep's default ignore skips the test files.

## Notes (none blocking)

- `ACCOUNT` passes on "anything unfinished", account-wide. That is right for shell reads. It also means a site-banned person with one open trade can approve a new device's login (S3, as recommended), subscribe to push, and post chat-key envelopes for their own devices. None of these starts a trade or reaches another person.
- A site-banned person mid-trade cannot add a wallet (`POST /v1/wallets` stays refused). The trade's wallet step uses an existing one.
- Each request from a site-banned account costs 1-2 extra queries. Only banned accounts pay.
- The e2e stubs the API rather than running the real gate (the gate is pinned in `bans.test`). Its `waitForTimeout(500)` "stays open" check is weak; waiting for a specific request would be firmer.
