# Security review: wip/lead-team-perms (J-10, team permission model), 2026-11-09

Reviewer: independent security reviewer (read-only on code).
Branch: `wip/lead-team-perms`, worktree `.claude/worktrees/team-perms`, head `f611f666`
(1d6a8224 RED, 0417e3e1 catalogue, fee6a696 routes, f611f666 notes), base `signup-team 08d96d4d`.
29 files, +1233/-193.

## Verdict

**Approve for the lead's batch, with one merge blocker against hold-v3 (M1).** On its own base the
branch is sound. Every member route names a box. The owner's hard rules are enforced in three places:
the DB check, `parseAbilities`, and `hasAbility`, which never answers yes for a hard id. Team
administration stays owner-only. The old `{ roles }` body maps to exactly the old access. Confirm
tokens bind the exact set. The catalogue route is static. Notes are isolated per account.

Before this branch and `wip/lead-hold-v3(-port)` meet, M1 must be fixed. As written, migration 360
throws away hold-v3's `hold-see` / `hold-cancel` / `hold-end` roles, or aborts on them. Hold-v3's
staged `team-roles` change also needs an abilities version (item 10). M2 (offer audit rows carry
no amounts) and M3 (the PGP confirm text shows only a count) are owner-rule and WYSIWYS gaps to fix
in this job or the next. The rest is minor.

## Tests run (serialised runner, single files)

- `apps/api/test/teamAbilities.test.ts`: 11/11 passed
- `apps/api/test/team.test.ts`: 52/52 passed
- `apps/api/test/schema.test.ts`: 73/73 passed
- `apps/api/test/feedbackForm.test.ts`: 40/40 passed

No typecheck or web/e2e run. `packages/accounts/test/confirmAction.test.ts` was not run (different project).

## Findings

### M1 (Major, merge blocker vs hold-v3): migration 360 knows only `offers` and `trades`

`wip/lead-hold-v3-port` migration `016_hold_v3.sql` §6 widens `team_members_roles_check` to
`{offers,trades,hold-see,hold-cancel,hold-end}`. Its `team/perms.ts` makes the hold rights
hierarchical: `hasRole`, where `hold-end` covers `hold-cancel`, which covers `hold-see`. Routes use
them (`holdRoutes.ts:95` `member: 'hold-end'`, `:135` `member: 'hold-cancel'`), as do the audit
actions `hold-changes-cancelled` and `hold-changes-approved`.

In the merged tree, 016 runs before 360, and 360's `update ... set abilities = array(...)` maps only
`offers` and `trades`:
- A member with `{offers, hold-see}` silently loses `hold-see`. That narrows, which is safe, but it
  undoes a lead's grant.
- A member with only hold rights, e.g. `{hold-end}`, gets `{}`. The `cardinality(abilities) >= 1`
  check then fails and the whole migration aborts. It fails safe, but the deploy is blocked.
- The ids happen to match the catalogue rows 46-48 (`hold-see`, `hold-cancel`, `hold-end`). Those
  are marked `not-built`, so `GRANTABLE` already allows them, but the hierarchy is lost: flat
  `hasAbility` will not let a `hold-end` member through a `hold-see` route.

Fix in the merge:
1. 360 maps `hold-see → {hold-see}`, `hold-cancel → {hold-see,hold-cancel}` and
   `hold-end → {hold-see,hold-cancel,hold-end}`. A test pins this, like the existing one at
   team.test.ts:1191.
2. Either `parseAbilities` closes the set downward (ticking `hold-end` ticks the two below it), or
   the hold routes name lists (`['hold-see','hold-cancel','hold-end']`). The first is clearer for the
   owner's page.
3. The catalogue rows 46-48 become `grantable`.
4. `ACTION_ABILITY` gains hold-v3's audit actions.
5. hold-v3's `ROLE_ORDER` / `parseRoles` and the confirm shape for `team-roles` must agree with
   team-perms' `parseRoles`, which accepts only offers/trades.

Whether `hold-end` (high risk: it applies waiting security changes now) should become a hard
owner-only box is an owner question (Q4).

### M2 (Medium, owner rule "every effectful member action logged with name and amount"): offer rows carry no amounts

`auditMember` adds the trade's amount only when there is a `tradeCode`. All four offer actions log
`{ offerId }` only: `offer-posted` (offers/routes.ts:482), `offer-relisted` and `offer-paused` /
`offer-removed` (:528, :535, :737). An offer has no single amount, but the lead cannot tell from the
log what a member posted. The offer row can be deleted (removed offers are gone), so the log is the
only record left. Recommend `offer-posted` logs side, currency, price mode with margin_bps or fixed
price, min/max fiat and method id. Pause, relist and remove should log at least side, currency and
the limits. Trade actions are fine: amount, fiat cents and currency come from `trades` in the same
transaction. Names come from the join on `team_members`, which is never deleted.

### M3 (Medium, WYSIWYS): the PGP confirm text for a boxes change shows only a count

`describeAction` for `team-invite-abilities` / `team-abilities` says "invite X as a team member
(N abilities)" or "change a team member's abilities (N abilities)". This text is the `purposeText`
of the encrypted PGP confirm (auth/pgp.ts:736), the one channel a compromised web page cannot rewrite. The
hash binds the exact list, so a token cannot be replayed with another set (item 7 passes). But a
tampered page could ask the owner to confirm "5 abilities" while sending a different 5, including
high-risk ones such as `trades-mark-paid` or `disputes-answer`. The old roles text named the
roles, and wallets name their address ends. Recommend the text lists the box labels, or at least
every `risk: 'high'` box by label plus a count of the rest. This is new user-visible copy, so it
is a question for the owner and design (Q5). `team-abilities` does not name the member either; that was already true of `team-roles`.

### m1 (Minor): read boxes do not scope the trade reads exactly

- `GET /v1/trades/:code`, the confirmations route and `GET /v1/trades/:code/identity` accept
  `TRADE_READ = [trades-see-active, trades-see-history]`. A member with only "See trade history" can
  therefore read an active trade by its code, and the reverse. Low impact, since the codes come from
  the same account. Recommend checking the trade's state against the box, or say in the catalogue
  that either box reads any trade.
- `POST /v1/trades/:code/events` needs only the event's own box. A member with `trades-mark-paid`
  and no read box can act on a trade they cannot read. Recommend `sendEvent` also requires
  `TRADE_READ`, or that presets always pair them.

### m2 (Minor): `EVENT_ABILITY` is `Record<string, string>` and the lookup uses `!`

It covers today's `CLIENT_EVENTS` minus `open-dispute`. A new client event added later makes
`assertMemberMay(req.auth, undefined)` throw a TypeError, a 500 for members. That fails closed, but
loudly. Type it as `Record<Exclude<ClientEventType,'open-dispute'>, string>` so the compiler forces an entry.

### m3 (Minor): the legacy `roles` view can misstate a custom set

`legacyRoles` reports `offers` when `offers-post` is held and `trades` when `trades-see-active` is
held. The web still gates on `roles` (App.tsx:154, session/member.ts:30) and edits with the old
RolePicker (settings/Team.tsx). A custom member, say `trades-see-active` only, shows as "Trades". If
the lead re-saves through the old picker, the set is replaced by the full `ROLE_ABILITIES`, and any
notes boxes are dropped. This is not an escalation, because it is the owner's own confirmed change
and the confirm names the roles, but it is misleading. It resolves when the web renders the boxes.
Until then, recommend Team.tsx shows "Custom" when `preset === null`.

### m4 (Minor): notes have no volume cap

`POST /v1/account/notes` has no budget and no per-account cap. A member with `notes-add` can write
unbounded 1000-character rows (they are logged, and they die with either account). Recommend a
per-account daily budget, as other social writes have, or a cap per trader, e.g. 200, which
matches the GET's `limit 200` (otherwise older notes become invisible).

### n1 (Nit): note authors are shown by the live display name

`by` joins `team_members.display_name`. A removed member's name can be reused by a later member
(the uniqueness index covers live rows only), so old notes and audit rows would look written by the
newcomer. This was already true of the audit log. Consider exposing `memberId` alongside, or a
"(removed)" mark.

### n2 (Nit): the DB check stores unknown ids

`team_members_abilities` refuses the hard ids only; any other text fits. Corrupt ids grant nothing,
because `effectiveAbilities` filters them through `GRANTABLE`. That is acceptable: a stricter
`abilities <@ catalogue` check would need a migration whenever the catalogue grows.

## The ten checks

1. **Member writes without a box / `{ roles }` beyond the mapping: none found.** All
   `requireSession({ member })` sites at head: offers (`offers-post`; `offers-see`; `offers-pause`;
   PATCH `[pause, delete]`, then `assertMemberMay` for the exact status; the bulk status route
   accepts only live/paused). Trades: `TRADE_READ`; `trades-see-active` for final-alert-seen (a
   member's receipt writes only the audit row); events `MEMBER_EVENT_ABILITIES`, then each event's
   box. Take, wallet and identity: `[take, accept]` plus `ownerDeviceOnly`. Disputes: GET
   `disputes-answer`, appeal `disputes-appeal`, open owner-only. Wallets list: `wallets-see`. Event
   stream: `trades-see-active`. Feedback: `feedback-send`. Notes: view and add. `any` for
   `/v1/account/me`, the offer viewer check and `/v1/team/permissions`. No chat route names a member
   (C-019). The `{ roles }` body goes `parseRoles → rolesToAbilities → ROLE_ABILITIES`, which has no
   hard or soft owner-only id. `{ roles }` and `{ abilities }` together are 400.
2. **Hard owner-only set: enforced in the DB and in code.** The DB check list in 360 has 11 ids,
   equal to `HARD_OWNER_ONLY` (rows 21, 22, 36, 42, 49, 50, 51, 55, 56, 57, 66), pinned by
   team.test.ts:1191. `parseAbilities` accepts `GRANTABLE` only, so any owner-only id (hard or the
   soft rows 63-65), an always-on id, an unknown id or a duplicate is 400 `bad-request`, before the
   confirm token is spent (R17). `hasAbility` refuses a hard id even from a corrupt row (tested).
   Releasing and funding stay `member-cannot-sign` whatever the boxes (`assertMemberMaySend` runs
   first). `trades-fund` is grantable as `waits-member-keys` but changes nothing.
3. **Escalation: none.** Every team admin box is hard owner-only and never storable. Every team
   route uses `owner = requireSession({ kinds: ['trader'] })` without `member`, so a member gets 403
   `owner-only` on invites, PATCH, DELETE, list and audit. A member cannot change their own set or
   invite anyone.
4. **Migration 360 mapping: no member widened on this base.** Old access compared with new boxes:

   | Old gate (08d96d4d) | Old role | New gate | Mapped boxes include it? |
   |---|---|---|---|
   | POST /v1/offers (`offers`) | Offers | `offers-post` | Offers: yes |
   | PATCH /v1/offers/:id (`offers`) | Offers | `offers-pause` / `offers-delete` | Offers: yes |
   | GET /v1/account/offers (`offers`) | Offers | `offers-see` | Offers: yes |
   | POST /v1/account/offers/status (`offers`) | Offers | `offers-pause` | Offers: yes |
   | GET /v1/trades/:code, confirmations, identity GET (`trades`) | Trades | `TRADE_READ` | Trades: yes |
   | final-alert-seen (`trades`) | Trades | `trades-see-active` | Trades: yes |
   | trade events (`trades`) | Trades | each event's box | Trades: all 9 member events yes |
   | take / wallet / identity POST (`trades` + ownerDeviceOnly) | Trades | `[take, accept]` + ownerDeviceOnly | yes; still refused |
   | GET dispute (`trades`) | Trades | `disputes-answer` | Trades: yes |
   | POST dispute (`trades`) | Trades | owner-only | **narrowed** (D-066) |
   | POST appeal (`trades`) | Trades | `disputes-appeal` | Trades: yes |
   | GET /v1/wallets (`trades`) | Trades | `wallets-see` | Trades: yes |
   | GET /v1/events (`trades`) | Trades | `trades-see-active` | Trades: yes |
   | POST /v1/feedback/form (`any`) | both | `feedback-send` | both: yes |
   | /v1/account/me, offer viewer (`any`) | both | `any` | unchanged |

   Offers also stores the four `not-built` edit boxes. They are inert, since no route names them.
   Nobody gains a route. With hold-v3 merged, see M1.
5. **Audit rows.** Every trade action carries amount_atomic, fiat cents and currency. The lead's
   `release-started` on a team account is logged with `member_id` null (T-076), and
   `team_audit_lead_actions` allows null only for that action. The member's name comes from the
   join. Notes log `{ noteId, about }` and never the text. The appeal logs no `why`, and the dispute
   reason only, never its note. Offers carry no amounts (M2).
6. **Notes isolation: per account, as intended.** Every query filters `n.account_id =
   req.auth.accountId`. For a member that is their team account, so a member of team A never sees
   team B's notes on the same trader, and the delete is scoped the same way. The test covers another
   account owner, not team B's member, but the code path is the same `accountId`. Self-notes are
   400. A non-trader subject is 404. The text is immutable (trigger), 1-1000 code points (DB and
   API agree), with no control or format characters.
7. **Confirm binding: yes.** `actionHash` is SHA-256 of the canonical JSON of `{ kind, memberId |
   name, abilities }`. `abilities` is the sorted, catalogue-order string the server computes from
   the body (`parseAbilities`). At issue, `actionInput.teamAbilities` accepts only that canonical
   form. A token for one set, or for the old `team-roles` kind, does not match another set or kind.
   The confirm text is weak (M3).
8. **`GET /v1/team/permissions`: catalogue only.** `catalogueView()` is static data (rows, groups,
   presets, rules) with no `req` input. It is open to the owner and any member, `allowStaleTerms`,
   `touch: false`.
9. **Migration numbers: correct.** 360 and 361 fall in J-10's assigned 360-369
   (owner-answers-assignments.md:35). schema.test.ts lists them in all three places, and that test
   passed. hold-v3-port's own schema lists will need them on merge.
10. **hold-v3 staging: not yet, by construction; it needs the merge work.** On this base, PATCH and
    invites need a strong session: `requireStrongSession` before the confirm, and `ownerWriteGate`
    with strong set to true under the lock. A weak login is refused with 403 `weak-session` and
    never staged, which is stricter than v3. `wip/lead-hold-v3-port` removes `requireStrongSession`
    from PATCH and stages `{ kind: 'team-roles', roles: TeamRole[] }` through `gateChange`, applied
    by `applyRoles`, which writes the dropped `roles` column. The merge must:
    - add a `team-abilities` PendingChange holding the sorted abilities;
    - route **both** body shapes (`{ roles }` mapped by `rolesToAbilities`, and `{ abilities }`)
      through the same weak-session staging branch, so that a weak `{ abilities }` PATCH cannot
      reach `setAbilities` directly;
    - re-validate the set at apply (`parseAbilities`; the DB check is the backstop);
    - close streams with `STREAM_ABILITY`;
    - make the waiting-changes review name the boxes;
    - keep hold-v3's `requireVendor` and `liveMember` checks.
    No staged `team-roles` row exists in any deployed DB, so no data translation is needed beyond M1.

## Builder's questions, with recommendations

- **Q1. Manager preset contents (p7-5).** It is currently the union of the Offers and Trades
  bundles (a lead placeholder). Recommend the owner ticks it on page 13. Until then the placeholder
  is safe: it holds no hard ids and no box that is not built and wired.
- **Q2. Notes per team.** The owner's ruling is that notes belong to the account and every member
  with View sees the lead's notes and other members' notes. Isolation between accounts is verified.
  Recommend keeping notes per account (the team), as built. The lead deletes and members never do.
- **Q3. Note limits.** NOTE_MAX is 1000 characters (an engineering default). Recommend adding a
  volume cap (m4) and leaving 1000 as is.
- **Q4. Hold rights after the hold-v3 merge.** Should `hold-end` (apply waiting security changes
  now) stay a grantable box, as p4-8 says the lead grants it, or become hard owner-only? Recommend
  it stays grantable per p4-8, closed downward (M1), and marked high risk. The owner should
  re-confirm, because it lets a member bring a weak login's security changes forward.
- **Q5. Confirm wording for boxes (M3).** Recommend the PGP and sheet text names the boxes, at
  least the high-risk ones, by label. This is copy, so it needs owner and design sign-off.
- **Q6. Feedback is now a box.** Members without `feedback-send` can no longer use "How's X2F
  doing?", which was `any` before. Every migrated member keeps it. Recommend the owner confirms this
  (Q69 says "per member", which reads as per-member limits, not as a box). Otherwise make it
  `always`.
- **Q7. "Answer the moderator" cannot answer yet.** The box opens only GET dispute. Replying goes
  through the dispute chat, which stays owner-only (C-019). Recommend the catalogue `does` text
  says "see" until a member chat key path exists, or mark the box `waits-member-chat-key` for its
  reply half.
