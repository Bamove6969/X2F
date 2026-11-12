# Security review: team S-104 / S-105 (wip/lead-team e000ebfc), 12 Nov 2026

Independent security review for the lead (logins and team permissions). Branch e000ebfc on main
6ebed537 (17 files, +433/-58; migration 390). Worktree /home/user/X2F/.claude/worktrees/team. No code
edits.

## Verdict

**READY to land. No must-fix.** I found no path for a weak session to give a member any box at
once. A member with no boxes has only the always-on abilities. Approving the draft early is safe
(a strong login only, and never by the member it names). The numbering cannot race. chatLabel never
carries the member's name. HARD_OWNER_ONLY is enforced in all three places. There is one medium
item: S-104 widens what a password thief can do (F1). The owner ruled S-104, so this is not a
defect, but it should be closed through the recovery M1(b) ruling.

## Checks run

- Runner, API: team, holdV3, teamAbilities, coolingOff, schema, vendor, frontDoor: 7 files,
  347 passed, 0 failed.
- Runner, web: team.test.tsx, team-tripwires, teamCantDoTitle: 3 files, 21 passed, 0 failed.
- semgrep (p/typescript, p/nodejs, p/secrets, tools/semgrep) on the 17 changed files: 0 findings.
- dockerd was not touched.

## 1. Can a weak session give boxes at once?

- **Both request shapes.** `input(req)` turns the legacy `{roles}` body into abilities through
  `ROLE_ABILITIES`. The handler's `stage` then stages exactly those `abilities` for both shapes,
  and the row is inserted with `[]` whenever `stage` is set. Tested for each shape: 201, boxes `[]`,
  a draft `{kind:'team-abilities', memberId, abilities}`, and the token spent.
- **Race with the session turning weak.** The handler reads the strength without a lock to pick a
  path, but each path fails closed under the account lock:
  - strong path: `ownerWriteGate({strong:true})` re-checks `waits(live.strength)` under the lock,
    so a session that turned weak gets 403 and nothing is written;
  - weak path: `ownerWriteGate({strong:false, vendor:true})`, then `gateChange` inside the same
    transaction. That re-checks the live session and the hold, and stages unless the session is
    strong, in its sign-up window, or a recovery session that has already waited. In every case
    where `gateChange` returns null, `createInvite` throws `weak-session` and rolls back the insert.
  The window after the handler's read is pinned by the rewritten "LateWeak" test: the session is
  weakened just after the handler reads its strength, and the result is 403 with no member
  written. The earlier window (weak before the read) takes the staged path, so no box reaches
  the member there either. The rewrite moves the injection point to the one window that still
  matters. It is not a weakening.
- **Replayed confirm token.** Tokens are single-use and bound to the action: `team-invite` or
  `team-invite-abilities`, with the name and the boxes. A weak invite spends its token (tested). A
  replay is refused, and the token cannot be reused for `team-abilities` (PATCH), which is a
  different action.
- **Editing a member with no boxes.** From a weak session, `PATCH /v1/team/members/:id` is staged
  through `gateChange`, as on main. From a strong one it applies at once, which is allowed.
  `parseAbilities` refuses an empty set, so `[]` cannot be requested. At apply time,
  `applyAbilities` re-parses the set, and a member who is no longer live is a 404, so the change is
  dropped.
- **Sign-up window.** `requireStageableSession` refuses a weak session inside its window before
  the token is spent. Under the lock, `gateChange` returning null gives the same refusal (tested).
- **Recovery sessions.** The team routes' `owner` preHandler has no `allowRecovery`, so they are
  refused.

## 2. Does a member with no boxes really have no powers?

Every route reachable by a member goes through `requireSession({member: X})` and `hasAbility`.
Routes without `member` answer 403 `owner-only` (sessions.ts). With an empty stored set,
`effectiveAbilities` gives only ALWAYS_ON (own login methods, own recovery codes, extend own
session). The routes open to any member (`member: 'any'`, 12 of them) are:
- the front door's `requireInside` (price and other public data);
- the confirm start/finish routes (WebAuthn, PGP);
- Terms acceptance for the member themselves;
- session length, session extend and idle reminder (their own session);
- `/v1/account/me`;
- `/v1/team/permissions` (the catalogue);
- `GET /v1/account/hold` (with rights `none`: only `takesEffectAt`, no list).

None of these acts on trades, offers, wallets, the team or the account's security. The trade stream
needs `trades-see-active`. The test checks that `GET /v1/account/offers` is 403 until the draft
applies and 200 after. **OK.**

## 3. Approving the draft

- **Strong approval** (`POST /v1/account/hold/changes/approve`): the session is re-checked under
  the lock, then `weakOf` (403 for a weak session), the hold check and `approveChanges` (exact
  submitted ids, then settle in order). Tested: approve applies the boxes, and a cancelled draft
  never applies.
- **Can a member act on a draft about themselves?** No. Only a member with `hold-end` may approve,
  and `refuseNamingMember` gives 403 for any `team-abilities`, `team-roles` or `team-remove`
  change whose `memberId` is the caller. The new member holds no boxes, so has no hold rights. A
  *different* member with `hold-end` may approve another member's boxes. That is the owner's p4-8
  design and needs a strong login.
- Submitting is only possible for the session that staged the draft (`submitChanges` filters by
  `session_id`).

## 4. Can the numbering race and give duplicates?

The only insert path is `createInvite`, inside `ownerWriteGate` →
`requireLiveSessionInTx` → `lockAccount`, so inserts into a team are serialised. The BEFORE
INSERT trigger then picks the lowest number free among live rows. The partial unique index
`(account_id, assistant_no) where removed_at is null` is the backstop (tested), and a CHECK
requires a number on every live row. A duplicate is therefore impossible through the API. A
direct insert that somehow ran without the lock would fail with 23505 on the index; `createInvite`
maps only `team_members_live_name`, so that would surface as a 500. That is acceptable.
Expired invites free their numbers when they are closed, which happens in the same transaction
before the insert. The backfill numbers existing live rows by `created_at, id`.

## 5. Does chatLabel leak the member's name?

`assistantLabel(leadDisplayName, n)` = "<lead display name> Assistant N". It is built only from
`accounts.display_name` of the team account (public) and the number. It is returned only by
`GET /v1/team` (the lead) and `/v1/account/me` (the member). Neither the counterparty nor the chat
receives it yet: the member chat key path is not built, and the tripwire tests stay. The member's
name is still visible inside the team (the lead's list, the audit log, trader notes' `by`), which
is intended. Tests check that the label never contains the member's name. **OK.**
- **I1 (owner question, listed as a lead default).** A removed member's number is reused. A
  counterparty who chatted with an old "Assistant 2" cannot tell it from the new one. That
  matters little until member chat exists, but before then ask whether numbers should be retired
  (never reused while chats or disputes from the old holder are still kept).

## 6. Is HARD_OWNER_ONLY still enforced?

Yes, in three layers:
- **DB:** migration 390 keeps the same 11-id list as 360. Only the `cardinality >= 1` part is
  dropped. A test checks that the SQL list equals `HARD_OWNER_ONLY` and that each id is refused on
  insert.
- **Request:** `parseAbilities` accepts only GRANTABLE ids and refuses an empty set.
- **Check:** `hasAbility` excludes HARD_OWNER_ONLY whatever is stored.

## Findings

- **F1 (medium; owner-ruled trade-off, close it through recovery M1(b)).** Before S-104, a weak
  foothold (password plus an approved device) could not create a member login at all. Now a
  thief on a password session can invite a member they control. That member joins at once and
  sets up their own, possibly strong, login (always-on own methods). The member has no boxes, but
  is a lasting second foothold, and the thief's submitted `team-abilities` draft grants the boxes
  24 h later. The owner's password change, and S-110, revoke the member's sessions, but the member
  can log in again with their own methods, and S-110 (as fixed) drops only waiting *password*
  changes. The defences are the `team-member-joined` alert and Jabber notice, the
  `hold-changes-submitted` alert, and the owner cancelling or removing. Recommendations:
  - (a) Include `team-abilities` drafts and new members from weak invites in the recovery M1(b)
    ruling (S-110 cancels the waiting changes and lists members invited from weak logins for
    removal).
  - (b) The `team-member-joined` alert could say that the invite came from a username-and-password
    login. That is a copy and design question.
  Not a blocker.
- **I1 (owner question):** number reuse (above).
- **I2 (info):** what `/v1/account/me` shows a member with no boxes is unchanged from main (the
  team account's overview). Worth a glance now that a weak foothold can create such a member;
  nothing sensitive was spotted.

## Must-fix list

None. Recommended: F1(a) as part of the recovery M1(b) owner ruling.
