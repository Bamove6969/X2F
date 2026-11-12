# Review: `wip/lead-bans` 2d6c7cc0 (Plan 4 Task 27, bans), security

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. I made no code edits. I reviewed in a detached worktree `rv-bans` at 2d6c7cc0 (removed afterwards). Scope: `git diff 5c19ddbe..2d6c7cc0`, which is the bans commits on top of `wip/lead-mod-rules`. That is 29 files, +891/-13.

Note: the author's `bans` worktree has already moved on to 854222d7 (lead call Q4, RED tests) and has uncommitted edits (`tradeBanRefusal`, popup texts). Those are **not** reviewed here. Everything below is about 2d6c7cc0 only.

## Verdict: CHANGES REQUIRED (2 must-fix)

Counts: 2 Must-fix (MF1, MF2), 6 Should-fix (S1-S6), 5 owner questions, plus info notes. The core is sound:
- the gate sits in `requireSession` and covers every session kind;
- the tap binding is complete;
- staff, owner and member accounts cannot be banned;
- the clock handling is exact;
- the trader-facing answers leak nothing.

The two must-fixes are both about the site ban reaching too far in one direction or the other:
- **MF1:** the allowlist is route-wide, not trade-wide, so it is too wide.
- **MF2:** the ban list written for a lifetime site ban outlives a lift. It can also lock the account out of its own login while trades are still open.

## Tests run (serialised runner, single files, at 2d6c7cc0)

TEST_RESULTS_PLACEHOLDER

Semgrep (p/typescript, p/javascript, p/security-audit; `--metrics=off`) ran on the 28 changed .ts/.tsx files: **0 findings**. There was one engine timeout: rule `express-ssrf` on `apps/api/test/take.test.ts`, a test file. Nothing else was skipped.

## Must-fix

### MF1. The site-ban allowlist matches route templates, so one open trade unlocks all of the person's chats and trades

`siteBanAllows` (apps/api/src/banState.ts) tests `"METHOD /route/:template"` against `TO_FINISH`, and `hasUnfinished` is account-wide. So once a site-banned account has any open trade or non-closed dispute, the gate lets through these routes for **every** `:code` and `:chat` the person is party to:
- `POST /v1/chats/:chat/envelopes` and `/identity`;
- `GET /v1/chats` (the whole list);
- `POST /v1/trades/:code/chat`;
- `POST /v1/trades/:code/events|dispute|appeal|wallet|identity`.

The handlers check party membership, so nobody reaches **another person's** trade or wallet. But the banned person can:
- keep messaging every counterparty in pre-trade offer chats (`chats.trade_code is null`, chat/routes.ts:256-298) and in closed-trade chats, and open a chat on any closed trade of theirs (`POST /v1/trades/:code/chat` only checks blocks for closed trades);
- for example, arrange off-platform deals with the people they met through offers, for as long as one trade stays open (and a banned person can keep a dispute or appeal open).

That is beyond the plan's "they can then reach only what finishes it" (spec 2026-10-14 l.149, Revision 2026-10-29b).

**Fix (engineering):** in the gate, when the route is trade- or chat-scoped, check the specific `req.params.code` / `req.params.chat`:
- a trade route passes only for a trade with `closed_at is null` or a dispute not `closed`;
- a chat route passes only for a chat whose `trade_code` is such a trade;
- `GET /v1/chats` should either list only those chats, or stay blocked and let the trade room open its chat through `POST /v1/trades/:code/chat`.

Add tests: an offer chat and a closed-trade chat are 403 `banned` while another trade is open. The current test (`bans.test.ts`, "with an open trade the person may finish it") only checks that `GET /v1/chats` is 200, which is the over-wide case.

### MF2. A lifetime site ban's ban-list rows are never undone, and they can stop the banned person finishing their trades

`POST /staff/v1/accounts/:id/bans` with `kind: 'site', until: null` calls `recordBan`. This is its first caller, and it is correctly limited to lifetime site bans. `recordBan` puts the account's display name, its login name, the fingerprints of its own PGP keys (and the team members' login names and keys, G27) into `banned_identifiers`. Two consequences:

1. **Lift leaves them.** `POST .../bans/:banId/lift` sets `lifted_at` and nothing else. A lifted (for example, mistaken) lifetime site ban leaves the account's own key on the ban list. From then on:
   - its PGP login fails with 409 `key-unavailable` whenever the login carries a refreshed key (auth/pgp.ts:647);
   - adding or re-adding a key fails (`applyPgpKey`, pgp.ts:965);
   - members of a lifted team account hit the same problem.

   So the lift is incomplete.
2. **While banned with open trades.** A lifetime site-banned seller whose PGP login carries a refreshed (merged) key is refused at login (`assertKeyNotBanned` before the session starts). So the "finish open trades" path that the gate allows cannot be reached, which cuts against A5 ("no coins get stuck"). This is a narrower case, but it is real for keys that get extended or have new subkeys.

The fix picks a behaviour, so it needs an owner or lead call. My recommendation:
- (a) on lift of a lifetime site ban, delete `banned_identifiers` rows whose `account_id` is the account or one of its team members' login accounts. The rows carry `account_id`, so this is exact. Log it.
- (b) at the PGP login refresh, skip the ban-list check when the banned fingerprints are the account's own. Alternatively, record the ban list only once nothing is unfinished.

Add tests for both.

## Should-fix

**S1. The web cannot reach an open trade once banned, and nothing tests it.** `api/client.ts` sends **every** 403 `banned` to `/account/banned`. Many shell and browse calls are behind `requireInside` (`/v1/price`, `/v1/news`, `/v1/offers`, `/v1/currencies`, `/v1/methods`), and these are not on the allowlist. So the home page bounces straight to the notice. The notice (`AccountBanned.tsx`) has no link to the person's open trades and ignores `returnTo`.

Inside the trade room, `sendNudge` (`POST /v1/nudges`, used by PaidWaiting and SellerRefund) is also refused, which bounces the person out mid-trade. The plan's `apps/web/e2e/banned.spec.ts` was not written.

Recommendation (user-visible, so a lead or owner call):
- the notice lists the unfinished trades with links (one more field on `GET /v1/account/ban`);
- allowlist `POST /v1/nudges` while unfinished, since it starts nothing;
- add the e2e test.

**S2. Placing a site ban does not end the account's live streams.** An already-open `GET /v1/events` stream keeps delivering for up to `MAX_STREAM_MS` (10 min). Only the reconnect runs the gate. Call `app.events.closeAccount(accountId)` after a site ban commits, as `endAllSessions` does.

**S3. New-device login approval is gated.** `/v1/account/approvals*` (auth/approval.ts:647-655) is not on the allowlist. A site-banned person with an open trade who logs in on a new device that needs approval cannot approve it from the old device. Recommendation: allow these routes while something is unfinished (they start no trade).

**S4. The feedback form is gated.** `POST /v1/feedback/form` deliberately sets `allowHeld` so that "everyone who is refused ... can say so" (owner, sessions.ts:362-366). The ban gate refuses it. The notice's moderator links cover the same need, but this is the owner's stated rule, so it needs a lead call.

**S5. The reinstatement log has a gap.** The place route's "make room" update (staff/bans.ts, `update account_bans set ended_at = until ...` before the insert) ends a timed ban whose end has passed without writing `account.reinstated`. `settleEndedBans` then never sees it, so that ban has no reinstatement entry. Log it there, or call one shared settle function.

**S6. The lift log lacks the ban id.** `account.ban-lifted` carries `{ accountId, kind }` while `account.*-banned` carries `banId`. Add `banId` (an `id`-kind key in the schema).

## Owner questions (recommendation in brackets)

- **OQ1.** Any senior moderator can lift any ban, including a lifetime ban the owner placed. [Lifting a lifetime ban should be owner-only, or need a second tap.]
- **OQ2.** D-017's offence count counts every earlier row, including bans lifted as mistakes, and counts a trade ban and a site ban for the same incident as two offences. [Count only bans not lifted, and count one per incident.]
- **OQ3.** A lifetime **trade** ban (for example, scamming as a trade ban at the third offence) records no identifiers, so the person can sign up again and trade. [Record identifiers for any lifetime ban, or require a lifetime ban to be a site ban.]
- **OQ4.** During a timed site ban the person can register a fresh account, because nothing is recorded (lead reading in staff/bans.ts). [Accept for now, and say so in the register.]
- **OQ5.** The MF2 remedy: what a lift should undo.

## Answers to the brief's questions

1. **Reaching beyond the allowlist.**
   - The gate sits in `requireSession` after the session, member, recovery and kind checks and before the Terms check. It runs for every `kind = 'trader'` session: full, recovery, held, and team-member sessions (a member's session is a row of the team account, `account_id = team`). Member login accounts can never hold a session (401).
   - Routes outside `requireSession` (login, register, team join, logout, `/v1/site`, `/v1/terms`, approval poll) start nothing for an existing account. Login is allowed by design ("after that they see only the ban notice").
   - A new member joining a banned team gets a gated session.
   - Websocket/events: `GET /v1/events` goes through `requireSession` and is allowlisted only while something is unfinished. An already-open stream outlives the ban by up to 10 minutes (S2).
   - Staff sessions (`app = 'staff'`) never reach trader routes.
2. **Allowlist too wide.** Yes, see MF1: it is per route, not per trade or chat. It never reaches *another person's* trades, chats or wallets: `roleInChat`, the trade party checks and `/v1/wallets` (own account only) hold. Wallets are read-only on the allowlist (no add or remove).
3. **Perm and tap.**
   - All three routes are behind `requireStaff('accounts.ban')` (owner and senior; not in `GRANTABLE_PERMS`, so no grant can hand it out). `tapPermOf` maps both new tap kinds to `accounts.ban`, so a moderator cannot even start one.
   - The `ban-account` tap binds account, ban id, kind, rule and end (null for lifetime). It is session-bound, lasts 2 minutes, is single-use (conditional UPDATE), and `account_bans.tap_id` is unique. It is consumed only after every check, inside the transaction, and a refusal leaves it unused (tested).
   - `lift-ban` binds account and ban id. Replay is refused.
   - The note is not bound. That is fine: it is staff-only text from the same request.
4. **Clock.**
   - `until` must be ISO with milliseconds and `Z`, and must round-trip through `Date` (`checkBanTerm`). The tap's `ISO_UTC` and `timestamptz` make time zones a non-issue.
   - The point checks compare `until > now` on every request, so a ban ends to the second (tested at ±1 s).
   - A null `until` is never ended: `settleEndedBans` filters `until is not null`, and a schema check forbids `ended_at` without `until`. Tested at +10 years.
   - The offer lists and the poster's side of a take use `ended_at is null`, so they lag the end by up to one settle minute. This is documented in banState.ts and acceptable.
5. **Owner or staff banned.** No: `lockTrader` returns 404 unless `accounts.kind = 'trader'` (tested with a senior's account). The owner's account is not a trader account either. Team members cannot be banned individually: the team account is the target.
6. **`GET /v1/account/ban` leaks.** No. It returns `{ kind, reasonCode, until, permanent }` per ban plus the three https contact links. The 403 `banned` body is `{ kind, reasonCode, until }`. The rule id goes only to the staff-only activity log, and the note goes nowhere outside the staff list (tested). The Jabber change trigger only says "something changed".
7. **`recordBan` only for lifetime site bans.** Yes: `kind === 'site' && until === null`, and it is the only caller. See MF2 and OQ3 for the consequences.
8. **Cost per request.** There is one extra query on every trader request (`activeBans`). It is served by the partial unique index `account_bans_one_standing (account_id, kind) where ended_at is null and lifted_at is null`: one index probe, typically well under 1 ms, but still a pool round-trip. The second query (`hasUnfinished`) runs only for a site-banned account. Take and post add one more query each, inside their transactions. Optional: fold the site-ban test into the session SELECT (`exists (...) as site_banned`) to save the round-trip on every request.
9. **Weakened tests.** None found. The diff removes no assertions. The `-` lines in tests are only the migration-list lines (560 appended) and the copy-lint limit.
   - The copy-lint limit rose from 65 to 66 for exactly one new `not-a-refusal` string, the D-020 notice lead. It is annotated in the source and explained in the test comment. That is legitimate, because the notice is not a refused action.
   - `cantDoCodes.ts` also registers `moderator-methods-required` and `no-secure-jabber` as not-refusals. These are mod-rules codes picked up in the merge, and both are staff-app only.

## Info

- Missing coverage worth adding with MF1:
  - a team member's session and a recovery session under a site ban;
  - a HEAD request;
  - `/v1/events` while banned with nothing unfinished.
- `hasUnfinished` covers open trades and disputes that are not closed (`published` included, so the appeal window counts). The spec also names liens and "a payout still arriving". Liens are not on this base. Whether any payout can still be arriving after `closed_at` is set should be confirmed, or a `NEEDS_` marker left.
- The staff-web has no ban UI yet (API only).
- On a failed `GET /v1/account/ban`, `AccountBannedRoute` navigates home. If the failure is persistent, home will bounce back on the next 403, which could loop. This is minor.
