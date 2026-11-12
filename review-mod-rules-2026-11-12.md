# Security review: wip/lead-mod-rules 7940be9e (D-017, D-070, D-064, D-032), 2026-11-12

Reviewer: independent security reviewer, read-only on code. Branch head `7940be9e` on main `6ebed537`.
Ten commits; each feature has its own RED commit first (`b0dd2349`→`9b1a4fb0`, `afde7344`/`56db967d`→`1d11e7a5`,
`19587fcb`→`c5991d40`, `6fc68823`→`77e48495`). 25 files, +662/-78. Migration 540.
Worktree `.claude/worktrees/mod-rules` (left as found). STAFF LOGINS AND POWERS: the lead runs the
final security review.

## Verdict

**APPROVE with one must-fix (MF1) before landing, plus owner questions.** The D-032 reset is tapped,
bound and single-use. It cannot target the owner. It deletes every login method and known device,
ends every session and requeues cases. Its link finish never re-enables a switched-off or removed
member. With D-070, a keyless moderator always needs two methods and cannot tap. D-064's channel check
is sound when `via` is sent, but `via` is optional (owner question Q1). Migration 540's indexes are
right. The ownerLockout carve-out is narrow and acceptable once MF1 pins owner-only.

## Must-fix

- **MF1 (D-032): make "owner only" explicit, not a consequence of `staff.manage` being ungrantable.**
  The route is `requireStaff('staff.manage')`, and the tap's perm is `staff.manage` (`tapPermOf`).
  Today only the owner role holds it (`roles.ts`: not in `GRANTABLE_PERMS`). But J-21's per-person
  grant checkboxes are in flight, and the ownerLockout tripwire pins only `[POST, 'staff.manage']`. So
  if `staff.manage` (or the staff page's grants) ever became grantable, a senior could reset any
  moderator's security, which is an account takeover, and no test would fail. Fix: in the route,
  `if (req.staff.role !== 'owner') throw 403 forbidden` before any read, and return `'owner'` from
  `tapPermOf` for `reset-staff-security`. In ownerLockout.test.ts, assert the reset route refuses
  every non-owner role, even one holding every grantable perm.

## Should-fix (engineering)

- **S1 (D-032): also clear the target's in-flight state in the reset transaction.** That means their
  unused `key_taps`, their open login `challenges`, and the staff realm's pending approvals or other
  half-done steps. None is usable today, because every credential is gone and the account is disabled
  (`consumeKeyTap` requires the answering key to be registered). Clearing them still makes "full
  revoke" literal and survives later changes. When staff recovery codes land (D-032's "recovery code,
  else"), the reset must delete `recovery_codes` too. Add a tripwire comment at the delete list.
- **S2 (D-032): no notice.** The reset is logged (`staff.security-reset`, `…-finished`), but nothing
  reaches the person reset or the owner's other devices. Recommend an owner alert or push on reset
  and on finish (as new logins get), so a stolen owner session plus a key tap is noticed.

## D-032: the reset, check by check

- **Who can trigger it:** owner only today (see MF1). A senior gets 403 (tested). The tap
  `reset-staff-security` is bound to `{accountId, inviteId, tokenHash, expiresAt}` (`parseKeyTapIntent`,
  exact keys). The server computes `tokenHash` from the submitted token, so a tap for another link,
  another person or another expiry is `tap-invalid` (tested).
- **Replay:** `consumeKeyTap` sets `used_at` atomically, only once, within the TTL, bound to the
  session that started the tap, and only while the answering security key is still registered.
  Replaying a used tap gives `tap-invalid` (tested).
- **The link:** the token is 32 random bytes (base64url, 43 chars). Only its SHA hash is stored
  (`token_hash` unique, `^[0-9a-f]{64}$`). Expiry is at most 24 h plus skew, checked at creation and
  on every use (`openInvite`: `used_at is null and cancelled_at is null and expires_at > now`).
  `finish` sets `used_at`, so it is single use (tested "used once"). A second reset cancels the first
  link, and removing the member cancels it (tested). The bearer of the link can enrol methods, as with
  an invite. The person-binding is the owner's vetting plus his delivery of the link. The `account`
  (names) step refuses a reset link (`account_id` is set: 409), so the login name cannot change.
- **The owner as target:** `lockTarget` gives 409 `owner-protected` before the tap is read (tested
  in securityReset and ownerLockout).
- **Revocation:** in one transaction it deletes every `webauthn_credentials` (security keys and
  passkeys), every `pgp_keys` and every `trusted_devices` row. It also sets `accounts.disabled_at`,
  sets `has_security_key = false`, requeues open/appealed cases (`unassignOpenCases`, unless already
  switched off) and logs. Then `endAllSessions` runs, closing the streams too. Between commit and
  `endAllSessions` the account is already disabled, so the guard refuses. See S1 for the extras.
- **Re-enabling a switched-off member:** no. `finish` for a reset runs `update accounts set
  disabled_at = null ... where m.switched_off_at is null and m.removed_at is null` (tested
  "switched-off member stays switched off"). Removed members cannot reach `finish`, because the link
  is cancelled. Role and hours are not taken from the link row: the staff row is left as it was.
- **Finish requirements:** the same as an invite: a staff login pair (`two-factors-required`) and,
  for mod/senior, a PGP key and a passkey (D-070).
- **Cancel and sweep:** a reset link's cancel or expiry does not erase the person's Terms signature
  (kind-gated, tested).

## The ownerLockout tripwire (Task 7)

The change is a narrow, exact-match exemption for one URL. It pins method and perm, and the source
scan blanks only that exact quoted literal, so any other `reset|recover|email` route still trips. It
adds an assertion that the owner can never be reset. **Acceptable, not a weakening**, once MF1 makes
the pin "owner role" rather than "the `staff.manage` perm".

## D-070: keyless moderators

- `holdsModeratorMethods` = at least one passkey and at least one PGP key. It replaces "all three" at
  invite finish, switch-on, set-role and own-method removal (error `moderator-methods-required`).
- **Two methods at a known device:** `knownDeviceRule` still requires `holdsAllThree` (including an
  attested security key) before allowing one factor. A keyless moderator therefore always needs two
  methods, on any device. `pgpPairRule` still refuses two PGP keys as a pair, so their pair is
  PGP + passkey.
- **No tapping:** `consumeKeyTap` requires a registered `security-key` credential, so a keyless
  moderator cannot rule or approve until they add one. Owner question Q2 (the builder flagged it).
- **No downgrade path:** removing one's last security key is still refused (`security-key-required`,
  account.ts). Removing the last passkey or PGP key is refused. Holding fewer methods only removes the
  one-factor known-device allowance, never adds one. `set-role` no longer requires an attested key
  for mod/senior; this is the ruled change (p11-19), and taps still need one.

## D-064: ending a hold via secure Jabber

- **Strict body:** `{}`, no body, or `{via:'secure-jabber'}` only. Anything else is 400: extra keys,
  any other `via`, an array, or a non-object.
- **The check:** `precheck` runs inside `endHoldByModerator`'s transaction, under the account lock,
  before anything is deleted. It requires a `jabber_contacts` row for the account with `jid_sealed`
  set and `verified_at <= hold.startedAt`. Proving a new address always sets `verified_at = now`
  (`jabber/routes.ts:182`), and the DB requires `jid_sealed` and `verified_at` to be null together.
  So an address proven or changed after the hold began cannot satisfy it (tested). Extending the hold
  does not move `started_at`. The log entry carries `via`.
- **Gap, owner question Q1:** `via` is optional, and without it the route ends the hold with no
  channel check, as before (hold v3, owner G35: logged, perm `accounts.freeze`). So the Jabber rule is
  a label, not a gate. A senior can always omit it. Recommendation: make the reason required, from a
  short enum (`secure-jabber`, plus whatever other channels the owner rules), so every hold end states
  how the holder was verified.

## Migration 540

- `kind` is `'invite' | 'reset'`, and a reset must have `account_id`.
- `staff_invites_invite_account`: unique `(account_id) where kind = 'invite'`. This keeps the old "an
  invite makes one account" rule; nulls (before names) do not collide.
- `staff_invites_open_reset`: unique `(account_id) where kind = 'reset' and used_at is null and
  cancelled_at is null`. Expired but uncancelled links still count as open, but the route cancels
  every open link of the person before inserting, so a new reset after expiry works. Concurrent
  resets serialise on `lockTarget`'s account lock. `token_hash` and `tap_id` stay unique from 205.
  The insert uses `on conflict do nothing`, which catches any of these, and answers 400.
- Sound.

## D-017

`packages/staff/src/banRules.ts` is pure and not wired to any route yet. Scamming may be lifetime
from the first offence, the third offence forces lifetime, and otherwise the moderator picks. The list
is a lead draft (COPY-UNSIGNED labels), for the owner to write. No security surface until it is wired.

## Tests (serialised runner, single files, on 7940be9e)

| File | Result |
|---|---|
| apps/api/test/staff/securityReset.test.ts | 6/6 |
| apps/api/test/staff/ownerLockout.test.ts | 8/8 |
| apps/api/test/staff/members.test.ts | 27/27 |
| apps/api/test/staff/account.test.ts | 11/11 |
| apps/api/test/staff/holds.test.ts | 5/5 |
| apps/api/test/holdV3.test.ts | 45/45 |
| apps/api/test/staff/keyTap.test.ts | 28/28 |
| apps/api/test/staff/login.test.ts | 41/41 |
| apps/api/test/schema.test.ts | 77/77 |
| packages/staff (whole project) | 213/213 (9 files) |

Changed old tests: members/account error codes follow D-070 (all three methods → PGP + passkey).
The moderator invite test now also proves that a security key without a passkey is refused. Stricter
where it changed; no weakening.

## semgrep

`--config auto` refuses to run with metrics off. I ran the registry packs instead, with metrics off:
`p/typescript p/javascript p/nodejsscan p/security-audit p/secrets` on the 14 changed source files,
239 rules. 5 findings, all false positives:
- 4 × `regex_dos` (invites.ts:134-136, banRules.ts:78): anchored, fixed-length patterns with no
  nested quantifiers.
- 1 × `node_secret` (auth/hold.ts:254): an unchanged pre-existing line, `Buffer.from(c.secretEnc, …)`.

The local rules (`tools/semgrep`) matched no files.

## Owner questions

- **Q1 (D-064):** should ending a recovery hold require a stated verification channel? Recommend
  yes, as an enum, with `secure-jabber` the first value.
- **Q2 (D-070):** a keyless moderator cannot tap, so they cannot rule or approve. Is that intended
  (the key is needed only to act), or should rulings accept another strong confirmation? Recommend
  keeping taps key-only.
- **Q3 (D-032):** the reset is one owner tap. The owner's own key changes take both owner keys (G4).
  Should a staff reset (a takeover surface) also take both? Recommend yes, given MF1's stakes.
- **Q4 (D-032, register):** the owner said "username + password"; staff have no passwords, so a
  link is built (Q-B3 open). Confirm the link.

## Re-verify at 5c19ddbe (12 Nov 2026)

Fix commits 94687587 (red tests) and 5c19ddbe (fix) on 7940be9e. Checked in a detached worktree
(/home/user/X2F/.claude/worktrees/review-modrules) at origin/wip/lead-mod-rules = 5c19ddbe.

**Verdict: MF1, S1 and S2 are closed. The branch is READY to land.** The owner questions from
the first review are unchanged.

### Checks

- Runner, API: staff/securityReset, staff/ownerLockout, staff/matrix, staff/keyTap: 4 files,
  147 passed, 0 failed.
- semgrep on the 6 changed files: 0 findings.
- dockerd was not touched.

### MF1: the owner only, by role

- **Route.** The first statement of `POST /staff/v1/members/:id/reset-security` is
  `if (req.staff.role !== 'owner') throw 403 forbidden`. It runs before `idParam`, before the
  body is read, and before any query on the target. Only the guard's own load of the caller's
  staff row comes earlier.
- **Tap.** `tapPermOf('reset-staff-security')` now returns `'owner'`. The tap-start check
  (staff/app.ts `allows`) treats `'owner'` as `req.staff.role === 'owner'` and never consults
  `can()` or grants. So the tap start refuses non-owners whatever they hold. `consumeKeyTap` is
  reached only past the route's role check.
- **No grantable perm can reach it.** The role check ignores perms entirely. The new
  ownerLockout test gives a senior, a mod and a helper every perm in `GRANTABLE_PERMS`. Each
  gets 403 `forbidden` on the route and 403 on `taps/start` for the reset intent. The
  securityReset test pins `tapPermOf` to `'owner'`.

### S1: in-flight state cleared, only the target's

- Inside the reset transaction, after `lockTarget(c, id)`, three statements run:
  - `delete from key_taps where account_id = $1 and used_at is null`;
  - `delete from challenges where account_id = $1 and used_at is null`;
  - `delete from login_approvals where account_id = $1 and used_at is null`.
- `lockTarget` gives 404 for someone not on the staff, 409 `owner-protected` for the owner, and
  refuses a removed member. `$1` is that validated target id from `idParam`. The caller's id and
  anything from the body never reach these deletes.
- `key_taps.account_id` is the account that *started* the tap. The owner's own reset tap is
  bound to the owner's account and has already been consumed, so neither condition can touch it.
  Other staff's taps carry their own account ids.
- The TRIPWIRE comment (delete `recovery_codes` here once staff codes land) is in place.
- Test: the target's unused tap, open challenge and pending approval are gone, and its used tap
  stays.
- Minor test gap, not a blocker: there is no negative control showing that another account's
  unused tap or challenge survives. The SQL makes that clear anyway.

### S2: alerts and push

- The alerts are `staff-security-reset` (written in the reset transaction) and
  `staff-security-reset-finished` (in the accept-finish transaction, only for `kind = 'reset'`).
  Both go through `addOwnerAlert` to every live owner account. Their detail is exactly
  `{ staffId }`. It carries no token, no link, no invite id and no token hash. The link stays in
  the owner's own 201 answer, as before.
- The push uses `pushOwnerAlert`, and both kinds are now in `PUSHED_OWNER_ALERTS`. It sends only
  the fixed `alert` text ("Something needs your attention", no detail) after the commit, and a
  failure is swallowed, so a push failure can't undo the reset.
- Test: both kinds are in the pushed set, and each alert holds `{ staffId: mod.id }`.

### Still open

The first review's owner questions are unchanged.
