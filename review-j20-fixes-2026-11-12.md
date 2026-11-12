# Review: wip/second-team-limits 818bb016 (J-20 fixes after review-j20-team-limits-2026-11-10), 2026-11-12

Reviewer: independent reviewer, security lens (permissions, bypass). Read-only on code.
Branch `origin/wip/second-team-limits` head `818bb016` (READY; code at `3cc92312`), merge-base with
`origin/main` = `6ebed537` (current main). Commits reviewed since the 10 Nov review (`d3053141`):
`5329d9d2`/`483240e3` (F2, F1 switch point), `42595a4a`/`40fcd000`/`4f31560a` (F5, F4),
`2340a971`/`8f10e0fa` (F6), `677fafa1`/`ceccc415` (F8), merges `d66e71cd`, `28709053`, `3cc92312`.
Diff vs main: 38 files, +1520/-54. Throwaway worktree `.claude/worktrees/rv-j20b` (`npm ci`), removed after.
Rows: S-091 (p7-4 band), S-096 (p7-11 hours), S-107 (p11-27 first login).

## Verdict

**APPROVE for the lead's batch, with one small migration fix (N1) to make in the merge and F1/F3
still waiting on the owner (p11-133).** F2, F4, F5, F6 and F8 are closed as asked; F7 was a hygiene
nit and is acknowledged, not rewritten. The security properties from the first review all still hold
on the merged code (one gate, same locked row, owner-only limits route, confirm bound to the exact
band and hours, hold v3 staging for weak logins, hours enforced at login / per request / in the
transaction / by the sweep). The F2 relaxation (pause and remove not banded) reduces exposure only
and cannot be used to widen it: every path that puts an offer in front of takers is still banded.
No new bypass found.

## Tests run (serialised runner, single files, Node 24.22.1, on 818bb016)

| File | Result |
|---|---|
| apps/api/test/teamLimits.test.ts | 16/16 passed (second run; first run hit a Docker daemon restart by another session, infrastructure only) |
| apps/api/test/team.test.ts | 70/70 passed |
| apps/api/test/jabber.test.ts | 34/34 passed |
| apps/api/test/jabber-paths.test.ts | 27/27 passed |
| apps/api/test/schema.test.ts | 77/77 passed |
| apps/api/test/coolingOff.test.ts | 96/96 passed |
| apps/web/test/team.test.tsx | 16/16 passed |
| `npx tsc -p apps/api --noEmit` | exit 0 |
| psql repro of migration 380's backfill against 331's trigger (N1) | confirms the spurious notice |

Not run: Playwright team.spec, packages/accounts confirmAction, auth-client, full projects, regtest
(the builder reports full vitest 6577/0 and Playwright 508/0 on 3cc92312).

## Status of F1-F8

| Item | Status | Evidence |
|---|---|---|
| F1 band unit XMR vs USD | **Open, owner (p11-133).** Built as XMR, now behind one switch point `BAND_UNIT` (`team/limits.ts`), read only through `tradeSize`/`offerRange`; the comment lists everything a USD switch touches (columns, field names, confirm words, web). Fine as a holding position: XMR is exact and fails closed. p11-133..137 have no rows in owner-answers-register.md yet (only LEAD-HANDOFF 10 Nov 02:45 names them); the lead should add them. |
| F2 band blocks pause/remove; bulk fails whole | **Closed.** `BANDED_OFFER_ACTIONS = {offer-posted, offer-relisted}` (`team/audit.ts`); `auditMember` passes `offerId` to the band check only for those. Bulk switch to `live` checks per offer (`offerInsideBand`) and reports `outside-trade-band` per offer; turning off is never banded (`offers/routes.ts` bulk route). Test `teamLimits.test.ts` "F2": member pauses XMR and fiat offers outside the band, removes one, is refused resuming one, bulk on names the out-of-band offer, bulk off pauses all. |
| F3 fiat offers refused under a band | **Open, follows F1.** Unchanged (`offerRange` returns null for a non-XMR offer → refused on post/resume only now, no longer on pause/remove, so the emergency case of F2 is fixed). |
| F4 Jabber half of S-107 | **Closed (dark, as the rest of jabber-notices).** New outbox kind `team-member-first-login` (migration 380 widens `jabber_outbox_kind_check`), queued in the login transaction (`auth/sessions.ts` `jabber_queue(..., 'team-member-first-login')`), fixed sentence with no name or detail (`jabber/sender.ts` `TEAM_FIRST_LOGIN_TEXT`, COPY-UNSIGNED), so p5-7's "never a name" holds. `first_login_at` classified as bookkeeping in the trigger and `changePaths.ts`; band and hours classified as changes. Tests: jabber.test.ts (one notice, sent text, none on the second login), jabber-paths.test.ts (band/hours notify). See N1 for the migration's backfill. |
| F5 three alerts at the join | **Closed.** In `openSession` the member branch adds `team-member-first-login` and `team-member-login` only when `!a.firstSession`; the join (`routes/team.ts` `startSession(... firstSession: true)`) leaves only finishMember's `team-member-joined`. `firstSession` is set by server code only (sign-up and team-join finishes; every `/login`, approval and recovery path passes false), so a member cannot suppress the lead's login alert. Pinned on the real PGP join in team.test.ts (exactly `['team-member-joined']`, `first_login_at` set). Push still goes on the first login. |
| F6 member `expiresAt` past the window | **Closed.** `endWithinHours` → `callerSessionInfo` in `/v1/account/me`, `PUT session/length`, `POST session/extend` (`routes/account.ts`); stored end unchanged, enforcement unchanged. Extend now computes the wanted end before `rotateSessionToken`, so a refusal rotates nothing. Test in teamLimits.test.ts. |
| F7 RED commit carried helpers | **Acknowledged** (hygiene only, history not rewritten). Every fix this round has its own RED test commit before the fix (`5329d9d2`→`483240e3`, `42595a4a`/`40fcd000`→`4f31560a`, `2340a971`→`8f10e0fa`, `677fafa1`→`ceccc415`). |
| F8 member cannot see own limits | **Closed behind `MEMBER_SEES_OWN_LIMITS` (on; owner p11-136).** `ownLimitsView` reads only `req.auth.memberId`'s own row, so no other member's limits leak; an invalid stored hours value is omitted, not shown. Web "Your limits" card (COPY-UNSIGNED). team.test.ts's exact `/me` shape was extended with `limits` (stricter, not weaker). |

## Security re-check on the merged code

- **Band, every exposure-creating member action.** Offer post (`offers/routes.ts:904`, after the tiers
  insert in the same transaction), single relist (`:958`), bulk relist (`:1263` plus the per-offer
  pre-check). These are the only three offer routes (`POST /v1/offers`, `PATCH /v1/offers/:id`, `POST
  /v1/account/offers/status`). Trade events (`trades/routes.ts:166,177`). Take and wallet-set stay
  `ownerDeviceOnly` for members. The bulk pre-check reads the band without a lock (`memberBand`), but
  each switched offer then goes through `auditMember` → `assertLiveMember`'s `for share` row, so a
  concurrent narrowing fails the transaction closed. No bypass.
- **Flex offers merge (490).** `offerRange` now takes min/max over every `offer_tiers` row of every
  currency; tiers are written once (trigger `offer_tiers_written_once`) and inserted before the audit
  check, so a member cannot add an out-of-band tier after the check. An offer with no tiers gives null
  → refused (fails closed).
- **Limits route.** Still `owner` (`requireSession({ kinds: ['trader'] })`, no `member`) → members 403
  `owner-only`; confirm `team-limits` bound to memberId + `bandKey` + `hoursKey`; weak sessions staged
  through hold v3; `NAMES_MEMBER`/`refuseNamingMember` include `team-limits`, so a member with
  hold-end/hold-cancel cannot act on a staged change of their own limits. Unchanged since the first review.
- **Hours.** Login refusal, per-request revoke, in-transaction check, one-minute sweep, S-m4 refusal,
  join-step refusal (`assertJoinInsideHours`) all present after the merges.
- **Jabber text.** No member name, method or device reaches Jabber; only the fixed sentence.

## New findings

### N1 (Minor, engineering; fix in the merge): migration 380's backfill sends a false "account change" Jabber notice

`380_team_limits.sql:29` runs `update team_members set first_login_at = joined_at where joined_at is
not null` while migration 331's trigger `jabber_note_change('account_id')` (no ignored columns) is
still on `team_members`; the trigger is only re-created with `first_login_at` ignored at `:41-43`. So on
any database with a team account that has Jabber notices on and a joined member, the migration queues
one `account-change` notice per such account ("An account change was made on your X2F account.") for
a change nobody made. Reproduced in a scratch Postgres 17 with 331's function and trigger verbatim:
one `account-change` row in `jabber_outbox` after the migration body. Impact is small (jabber-notices
is dark, so likely no recipients at deploy) but it is a false security notice, which trains users to
ignore real ones. Fix: move the `drop trigger` / `create trigger` (lines 41-43) above the backfill
update, or disable the trigger around it. The migration has not shipped, so editing 380 is fine.

### N2 (Nit, information; no change asked): a member with a hold right sees colleagues' staged limits

`describeChange` now carries `band` and `hours` for a staged `team-limits` change, and
`GET /v1/account/hold` shows every waiting change to a member whose hold right is not `none`
(`holdRoutes.ts`). So such a member can read another member's staged band and hours. Same pattern as
staged `team-abilities` (boxes) today, from owner p4-8; noted for consistency only.

### N3 (Nit, design; already flagged by the builder): two Jabber messages at the join

At the join the lead's Jabber gets the generic `account-change` (team_members row joined) and the new
`team-member-first-login`. Design to say whether to merge (builder's Q3 Jabber half). Not a security issue.

## Owner / design questions (unchanged or carried)

- **p11-133 (F1/F3): band unit.** Still open. Recommendation unchanged: USD cents at market (flip
  `BAND_UNIT`; trade by `trades.usd_cents`, offer range by `usdCentsOf` at the quote, 409
  `price-unavailable` with none). If the owner keeps XMR, record it and decide F3 (convert fiat ranges
  at the quote vs refuse).
- **p11-134 (F2):** built as the lead default (pause/remove never banded). Owner to confirm.
- **p11-136 (F8):** built as the lead default (member sees own limits, switch on). Owner to confirm.
- **Q5, Q6** of the first review stay as built.
- **N3 / W-021:** design wording for the join's Jabber messages; W-021 must list `team-member-first-login`.
- **Register:** add rows for p11-133..137 to owner-answers-register.md (they exist only in the handoff log).
