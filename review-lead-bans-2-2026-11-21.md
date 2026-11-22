# Review: `wip/lead-bans-2` ab615f88 (Plan 4 Task 27 ban stages, onto main 2da4f93d), security

Reviewer: independent security reviewer (cloud helper), 21 Nov 2026. No code edits to the branch. I reviewed `git diff origin/main...ab615f88` (48 files, +1762/-62) in a detached worktree, `.claude/worktrees/rev-bans`. Every guard-revert was a throwaway edit, reverted with `git checkout`, and the tree was clean at the end.

Earlier reviews: `review-bans-2026-11-12.md` (CHANGES), then `re-verify-bans-2026-11-12.md` and `re-verify-bans-mf1-s1-2026-11-12.md` (PASS at 2ac92021, and 0ef4b7a7 added the frontDoor row). This review covers what changed in bringing that work onto main: the session-query ban read, main's newer trade-room routes on the gate, issuedAt on the two taps, the profile/record filter, the retired NEEDS_BANS_MERGE, and the migration renumbered to 780.

## Verdict: APPROVE WITH MINORS

There are no must-fixes. The gate, the per-trade and per-chat scoping, the tap binding, the ban-list checks and the lift are sound, and each is pinned by a test that bites when reverted. The two minors are missing tests: the code is correct, but nothing would catch a regression.

- **m1. The poster side of a take under a ban is not pinned.**
- **m2. Opening an offer chat on a banned poster's offer is not pinned.**

## Findings

### m1. Take: the banned-poster check has no test (apps/api/src/trades/take.ts:153)
`OFFER_SQL`'s `poster_ok` includes `not ${banHidesSql('o.account_id')}`. That clause is the only thing that stops a buyer who holds an offer id (a bookmark, an old chat, or the id shown before the ban) from taking a trade-banned or site-banned vendor's offer. I removed the clause, and `take.test.ts` and `staff/bans.test.ts` stayed green (110/110). `take.test` pins only the taker's ban (line 367).

Fix (engineering): in `take.test`, ban the poster (trade ban and site ban), take their offer by id, and expect the same 404 as for a hidden offer. Also expect no row in `trades`.

### m2. Offer chat: the banned-poster check has no test (apps/api/src/chat/routes.ts:136)
`POST /v1/chats` resolves the offer through `LISTED`, which now includes `banHidesSql`. I removed the clause, and `chat.test.ts` and `staff/bans.test.ts` stayed green (86/86). Without it, anyone holding the offer id could open a new offer chat with a banned vendor. A site-banned vendor cannot read that chat, because the gate refuses it. A trade-banned vendor could keep negotiating off the list.

Fix (engineering): in `chat.test`, `POST /v1/chats` on a banned poster's offer should return the same refusal as for a hidden offer.

### Info
- **i1. A dev or demo database that ran `560_account_bans.sql` will fail at 780.** The migrator tracks migrations by name (`src/db/migrate.ts`). 780 uses a plain `create table account_bans`, so a database that already applied the old 560 from `wip/lead-bans` fails with "relation already exists". 560 was never on main, so production and fresh databases are fine. Reset any such scratch or demo database before landing. Otherwise the migration is safe: it is one transaction; it creates a new table and two indexes; it depends only on `accounts`, `key_taps` and `jabber_note_change()` (331), all earlier; and it does no backfill.
- **i2. A site-banned person who still has an unfinished trade gets content-free chat pings for their offer chats.** They keep `/v1/events` (ACCOUNT), so pings for those chats still arrive. The payload is `{type:'chat', chat}` (events/bus.ts:8), with no content. `GET /v1/chats/:chat` on an offer chat is 403 `banned`, so nothing can be read. Acceptable.
- **i3. On main, the early display-name ban check (`assertDisplayNameFree`, accounts.ts:121) can be removed without any test failing.** While the banned account exists, its own `display_key` already answers `display-name-taken`. Once the account is gone, `namesTaken` refuses generically. This code is not in this diff, and it is noted only for completeness.
- **i4. A request already past the session query is served unbanned.** I find this acceptable (brief item 7):
  - Take and post cannot slip through. Take locks both accounts `for update` (take.ts:295), and post locks the account through `lockAccountLive`. Either lock conflicts with the ban route's `for no key update` (`lockTrader` → `lockAccount`). Both then re-read the ban inside their own transaction: `tradeBanRefusal` for the taker, `poster_ok` for the poster, and `accountRefusal` when posting. So the ban either waits for the take or post to commit, or the take or post sees the committed ban.
  - What can still be served: a read already in flight, or a trade-room action already past the gate. None of these starts anything new.
  - Open event streams are closed after the commit (S2).

## Answers to the brief

1. **Routes beyond the allow list.**
   - The gate sits inside `requireSession` (sessions.ts:487). It runs after the member, recovery, hold and kind checks, and before the Terms check. It covers every trader session, because the ban is read on `s.account_id`.
   - That includes team-member sessions, which are rows of the team account. A member login's own session is always 401.
   - The gate denies by default: only `ALWAYS`, `ACCOUNT`, `TRADE`, `CHAT` and the nudge pass (banState.ts:144-189).
   - I listed the 252 route templates and checked every allowed pattern against the real routes.
     - Each newly allowed route exists, under the same parameter name the gate reads: `:chat` for chat key, grant and key read; `:code` for ruling-statement, payment-proof, proofs and blur-checks.
     - A route that used another parameter name would fail closed.
     - The proofs PUT runs `requireTraderFirst` in `onRequest`, where params and the route template are already set.
   - Every route outside `requireSession` starts nothing for an existing account: login, register, `/v1/site` (whose `insideAccount` treats 403 as outside), `/v1/terms`.
   - What the web trade room calls is all on TRADE or CHAT. The rate-first `GET /v1/reviews/pending` is called only from Quote and AcceptedSheet, never from the room.
2. **Another person's trade, a finished trade, or an offer chat.**
   - `unfinishedTrade` requires the caller to be a party and the trade unfinished: open, or with a dispute that is not closed.
   - `unfinishedChat` requires the caller to be a party to the chat, the chat to be joined to such a trade, and the caller to be a party to that trade. An offer chat (`trade_code` null) cannot match the join.
   - Codes are normalized with the same `normalizeTradeCode` the handlers use (trades/routes.ts:60, chat/routes.ts:159, proofs/routes.ts:61, identity.ts:46), so the gate and the handler always resolve the same trade.
   - A nudge passes only when its `context` is such a trade or its chat, and the handler still checks the recipient.
   - All of this is pinned (table).
3. **Ban-list bypasses.**
   - **Names:** names are `[A-Za-z0-9._-]{5,20}` (packages/accounts/src/username.ts:30), so there are no Unicode variants. Tags fold case and NFC (accounts.ts:132). Look-alikes such as `l` and `1` are allowed by owner decision Q79, and that is tested.
   - **Keys:** every subkey of a presented key is checked (`keyFingerprints`), so the subkey trick is refused at sign-up, at add-key, at past-rep and at login refresh (all pinned).
   - **The own-key exemption** applies only at PGP login and only to rows with `account_id` = the logging-in account (bans.ts:169). A new account carrying the banned key is still refused.
   - **Timed bans** record nothing, so during a timed site ban the person can register a new account with a new name and key. Their old name and key stay unique to the banned account. This is the open owner question OQ4 from 12 Nov, carried forward.
4. **Tap replay or mismatch, and moderator paths.**
   - Every field of the `ban-account` tap is what gets applied: account, ban id, kind, rule, until, and the signed issuedAt checked against `started_at`.
   - `reason_code` is derived server-side from the bound rule. The note is not bound (accepted 12 Nov, staff-only text).
   - The tap is consumed inside the transaction, after every check (staff/bans.ts:165). Use is single (conditional `used_at`), bound to the session, and the key must still be registered. `tap_id` is unique.
   - `lift-ban` binds the account and the ban id, and the kind of lift comes from the stored row.
   - A moderator who is not senior has no path:
     - Both routes need `requireStaff('accounts.ban')`, which only senior moderators and the owner hold.
     - `accounts.ban` is not in `GRANTABLE_PERMS`.
     - `tapPermOf` maps both taps to `accounts.ban`.
     - The ruling card refuses every ban action for mod and senior alike (`rulings.test`, which is stronger now).
5. **403 vs 404 leaks to third parties.** None.
   - A third party never receives 403 `banned`.
   - A site-banned profile or record returns the same 404 body as an unknown name.
   - A banned vendor's offers are hidden as other hidden offers are, and a take returns the same 404 as for a missing offer.
   - The banned person gets 403 `banned` for another person's trade code, exactly as for their own closed trade, so there is no oracle there either.
6. **Migration.** Safe; see i1. Idempotence comes from the migrator's name tracking and its transaction. The only hazard is the old 560 name on scratch databases.
7. **The in-flight window.** Acceptable; see i4.

## Guard-revert table

Each row is one throwaway edit at ab615f88, run against the named file(s), then reverted.

| # | Guard reverted (file) | Test file(s) | Result |
|---|---|---|---|
| 1 | Lift deletes the ban-list rows (staff/bans.ts:213) | staff/bans | **caught** (MF2 lift test) |
| 2 | `lockTrader` refuses a non-trader target | staff/bans | **caught** (checks the input) |
| 3 | 409 `already-banned` | staff/bans | **caught** |
| 4 | D-017 term check (`lifetime-required` / `-not-allowed`) | staff/bans | **caught** |
| 5 | `recordBan` only for a lifetime site ban (made: every site ban) | staff/bans | **caught** |
| 6 | `tapPermOf` maps `lift-ban` to `accounts.ban` (made: `disputes.handle`) | staff/bans + staff/keyTap | **caught** (moderator cannot ban) |
| 7 | Lift's 409 `wrong-state` on a ban not in force | staff/bans | **caught** |
| 8 | Tap's session binding dropped at the ban route | staff/bans | fails closed (22 refuse `tap-invalid`): not a meaningful revert; covered in keyTap.test |
| 9 | S5 `account.reinstated` at make-room | staff/bans | **caught** |
| 10 | Session query reads only `kind = 'site'` (made: any ban) | staff/bans | **caught** (trade ban leaves the app open) |
| 11 | Offer chat hides a banned poster's offer (chat/routes.ts:136) | staff/bans + chat | **NOT caught** (m2) |
| 12 | Take's `poster_ok` hides a banned poster (take.ts:153) | take + staff/bans | **NOT caught** (m1) |
| 13 | Chat key/grant moved from CHAT to account-wide | staff/bans | **caught** |
| 14 | Ruling statement and payment proof moved from TRADE to account-wide | staff/bans | **caught** |
| 15 | UNFINISHED without the open-dispute clause | staff/bans | **caught** (4 tests) |
| 16 | UNFINISHED always true | staff/bans | **caught** (5 tests) |
| 17 | Early display-name ban check (accounts.ts:121, main's code) | banList | not caught (i3; `namesTaken` backstops) |
| 18 | `namesTaken` ban-list clause | banList | **caught** |
| 19 | `insertPgpKey` ban check (sign-up and join) | banList | **caught** (3) |
| 20 | `applyPgpKey` ban check (add-key) | banList | **caught** |
| 21 | PGP login refresh ban check | banList | **caught** (2) |
| 22 | Past-rep ban check | pastrep | **caught** |
| 23 | Record route's site-ban filter (reputation/record.ts:138) | profile + staff/bans | **caught** |

Not reverted, because the builder had already listed them as caught: the session gate, trade scope, chat scope, take (taker), post, listing hide, tap binding, issuedAt, lift tap, own-key exemption, ruling card, profile filter and stream close.

## Tests run at ab615f88

| Run | Result |
|---|---|
| api `staff/bans`, `banList`, `take`, `offers`, `profile` (no lock, nice 10) | 200/200 (5 files) |
| api `schema`, `staff/keyTap`, `jabber-paths`, `disputes/rulings`, `frontDoor`, `sessions`, `chat`, `nudge`, `team`, `staff/matrix` | 591/591 (10 files) |
| web `accountBanned`, `client`, `cantDoThat-lint`, `tradeBanText` | 93/93 (4 files) |
| staff `intent` | 24/24 |
| auth-client `flows` | 15/15 |
| Playwright `banned`, `post`, `quote`, `myOffers`, `profile` (lock, `--trace off`, 1 worker) | 81/81 |
| `tsc --noEmit` apps/api, apps/web | clean |
| full `npm run check` (lock) | **not run**: queued on `check.lock` for over an hour behind other helpers' regtest and Playwright runs, then cancelled. The lead should treat APPROVE as conditional on a green full check at ab615f88 (reviewer rule, 13 Nov). |

No test was weakened. The removed test lines are:
- the rulings ruling-card test, now stronger (mod and senior, plus a site-ban action and no `account_bans` row);
- the migration lists;
- the copy-lint cap 71 → 72, for the D-020 notice lead, annotated.

## Owner questions carried forward (unchanged from 12 Nov, still open)
- **OQ1.** A senior moderator can lift a lifetime ban that the owner placed.
- **OQ3.** A lifetime *trade* ban records no identifiers.
- **OQ4.** During a timed ban, re-registering with a new name and key is possible (brief item 3).
- **Lead default (21 Nov).** The ruling card carries no ban. Whether a ruling should ban, and whom, is an owner call.

---

## Addendum (22 Nov): `wip/lead-trades-list-2` b7fb9969, `git diff 6a4d0fed b7fb9969` (main a8cfc6ac bans merged; NEEDS_TRADES_LIST resolved)

Reviewer: the same, in a detached worktree, `.claude/worktrees/rev-tl2`. No changes to the branch. The commits in scope are 3b79f2dd (the merge of main a8cfc6ac), 881ddf8a (the RED tests) and b7fb9969 (the fix).

### Verdict: APPROVE

There are no findings. m1 and m2 above still apply on this branch, because the bans code is unchanged.

### What was checked
- **The gate.** `GET /v1/trades` joins `ACCOUNT` (banState.ts:158), so it passes only while `hasUnfinished`. With nothing unfinished it answers 403 `banned` (tested).
- **The session flag.** `req.auth.siteBanned` is `row.kind === 'trader' && row.site_ban_reason !== null` (sessions.ts:530). It comes from the same session-query ban the gate reads, on `s.account_id`, so team members' sessions get it too.
- **The list filter.** list.ts adds `and (not $7::boolean or ${UNFINISHED_SQL})` on top of the party filter it already had, `(t.buyer_account_id = $1 or t.seller_account_id = $1)`, with `$1` = `req.auth.accountId`.
  - A site-banned owner or member can therefore list only the account's own unfinished trades.
  - **Finished trades:** never listed. A closed trade with an open dispute stays, which matches what the gate already lets the trade room open.
  - **Anyone else's trades:** never listed, because of the party filter.
  - The SQL fragment is a constant. Its `t` alias is `trades`, and its `d` alias does not collide with anything.
- **Policy choice.** Leaving finished trades out, rather than answering 403, is consistent:
  - the trade-room gate already serves exactly the unfinished set;
  - the per-trade `GET /v1/trades/:code` on a finished trade stays 403 `banned`, so the list cannot be used to reach one.

  I agree with it.
- **The part boxes and lastActedBy.**
  - `partsFor` and the `status` 403 `forbidden` check come before the query and are unchanged.
  - `lastActedBy` still requires `memberId === null && level === 'full'`.
  - The tests pin all of it: owner; members with both boxes, with active only, and with history only; history 403 for active-only; members never get `lastActedBy`.
- **The merge resolutions.**
  - For app.ts, frontDoor.ts, take.ts, App.tsx and flows.test, every line either parent added since the merge base 2da4f93d is present in 3b79f2dd. No line either parent removed has come back.
  - `git diff --cc` shows no hand-edited hunks except the comment in flows.test, which now names both reads. Its `NOT_AUTH_CLIENT` list keeps both `GET /v1/account/ban` and `GET /v1/trades`.

### Guard-reverts (staff/bans.test)

| Guard reverted | Result |
|---|---|
| The list filter removed | caught (3) |
| `siteBanned` forced false | caught (3) |
| The `GET /v1/trades` gate entry removed | caught (3) |
| `GET /v1/trades` moved to `ALWAYS` | caught (1: idle banned account must get 403) |

### Tests at b7fb9969 (no lock, nice 10)
- api `staff/bans`, `tradesList`, `frontDoor`, `take`, `sessions`, `team`, `schema`: **354/354** (7 files).
- auth-client `flows`: **15/15**.
- `tsc --noEmit` for apps/api and apps/web: clean.
- Not run: Playwright (the lead said to skip it; a cloud runner covers it), and the full `npm run check`.
