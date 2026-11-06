# Review round 2: Plan 2 Tasks 16 and 17 (device approval, mig 013; 24-hour hold, mig 014), 2026-10-30

Branch `wip/lead-p2-task17` @ `b9b3ca6` (contains main line `5c4d35b`). Diff base: `git merge-base b9b3ca6 origin/claude/compassionate-johnson-k95ssr` = `5c4d35b` (74 files, +4420/-359). Round 1: `review-task16-17-2026-10-30.md`.

## Verdict: CHANGES REQUIRED (1 Critical, 4 Important, 6 Minor)

The round-1 findings are fixed as designed (table below). The new design is sound: `account_holds`, `gateChange` before the write in the route's own transaction, `pending_change`, the `started_methods` snapshot, `STRONG_COMBOS` exactly the owner's 14:12 list, `FINISH_OPEN_TRADES`, everything under `lockAccount`, the server clock only, and refusals through CantDoThat.

But the owner's way out of a hold (a strong login with a pre-hold method) can be blocked by the device limit. I reproduced a full takeover from **a password alone**, through the real routes (C1 below).

## Round-1 findings

| R1 | Status |
|---|---|
| C1 a method added by a weak session predates the hold | **Fixed.** `started_methods` snapshot (`hold.ts:202`, `ownerProof` `:229`), and the add itself waits in `pending_change`. Real-clock test `coolingOff.test.ts:366`. |
| C2 changes during the hold apply at once | **Fixed.** The 9 routes call `gateChange` before writing; a running hold refuses every session (`hold.ts:306-307`). Tests `:427-478`. |
| I1 PGP alone strong | **Fixed.** `strength.ts:17-32` is an explicit allow-list (`pgp-single` waits). |
| I2 not atomic | **Fixed.** The hold is written in the same transaction as the session or change (`approval.ts:191-200`, `recovery.ts:207-219`, `gateChange`). Failure-injection tests `:480-526`. |
| I3 backup sessions can't finish trades | **Fixed.** `FINISH_OPEN_TRADES` (`trades/routes.ts:66`, disputes, confirmations). |
| I4 names differ from plan 29c | **Fixed** (`recovery-hold`, `hold-started/ended`, `account_holds`). |
| I5 merge, migrations | **Fixed.** Main line merged. 013/014 are free on the main line; 015 is Task 18's. |
| I6 refusals via CantDoThat | **Fixed** (`cantDoCodes.ts`). cantDoThat-lint and copy-lint pass. |
| I7 nudge.test red | **Fixed** (passes). |
| M1 cancelled backup ends hold | **Fixed** (`recovery.ts:244`). |
| M2 logout timer | **Fixed** (gated). |
| M3 offers takeable | Lead accepted. Implemented as decided. |
| M4 approval TTL | **Fixed** (5 min). |
| M5 device count leaked | **Fixed.** |
| M6 strong owner login skips limit | Limit now applies, but as a bare 409 with no way to log a device out. **This is the hole in C1 below.** |
| M7 logouts not atomic | **Fixed** (`approval.ts:346-358`). |
| M9 tests | Mostly added. See N-M5 for the gaps that remain. |

Lead decisions are implemented as decided:
- **M3:** offers stay takeable.
- **Every session refused during the hold:** `gateChange` refuses before any strength check.
- **Terms allowed:** `account.ts:259-275`, with no `requireNotHeld`.
- **A backup login waits once:** the `waited` check (`hold.ts:311`).

## Is there a 10th ungated route?

Every mutating route was enumerated (`git grep` of `app.post|put|patch|delete`).

**The 9 gated routes** (logins, keys, backup methods, names, security settings):
- password
- pgp/finish
- webauthn/finish
- totp/finish
- recovery-codes
- DELETE methods
- login-name
- one-device
- logout-timer

The `start` routes only issue challenges and carry `requireNotHeld`. Display names have no change route.

**Not gated, and they matter:**
- `DELETE /v1/account/sessions/:id` (devices; C1, N-I3)
- `POST /v1/account/approvals/:id` outside a hold (block a login, log out a device, one-device logouts; C1, N-I3)
- `DELETE /v1/account/push` and the subscription cap on `POST /v1/account/push` (N-I2)
- `POST /v1/wallets` from a waiting session (payout; N-I4)
- `POST /v1/account/alerts/:id/seen` (N-M3)
- `DELETE /v1/account/recovery-sessions/:id` (fine: it helps the owner)

## Critical

**N-C1. A password alone fills the device limit during its own hold. The owner's strong login then gets 409 `too-many-devices` and can never end the hold, so the thief's pending changes apply.**

Code:
- `apps/api/src/auth/approval.ts:227-229`: the owner's proof at the limit gets a bare 409.
- `approval.ts:231-232`: `trusted && inUse < max` starts a session with no hold check.
- `approval.ts:222`: the first weak login when nothing is logged in.
- `device.ts:43-61`: the trust is a client-held cookie and can be copied.

Scenario, reproduced in my worktree through the real routes. The test was deleted afterwards. Expected output: owner 409 twice, passkeys left 0.
1. The owner is a passkey trader with a password set, and is logged out (the 12 h idle timer, or explicitly).
2. The thief logs in with the password on a new browser. Nothing is logged in, so the thief gets a session and a `weak-new-device` hold.
3. The thief copies only the `__Host-x2f_dev` cookie into 2 more cookie jars and logs in with the password twice more. The device is trusted and in use is under 3, so both logins answer `{status:'ok'}`: no approval, no new hold.
4. The owner logs in with the pre-hold passkey on any browser: **409 `too-many-devices`**. The owner has no session from which to log a device out. A backup login gives a recovery session, which cannot end sessions.
5. The hold runs out by time. The thief logs in again (trusted, no approval) and sends `DELETE /v1/account/methods/passkey/:id` with a password confirm token: 202 `held`.
6. The owner's passkey login: 409 again.
7. 24 h later `settleDueHolds` removes the owner's passkey (`login-method-removed`). Repeat for any other method. The account belongs to the thief, from a password alone.

With "One device at a time" on (max 1), the thief needs just one session.

Outside a hold, the same weak sessions can also block every owner login from an untrusted browser (N-I3).

Fix (the lead decides the shape; all of these are needed in some form):
- A strong login with owner proof during a hold must never be refused by the limit. Recommended: it ends the hold and **revokes every session whose login waits** (`strength <> 'strong'`), and the session that started the hold, in the same transaction, with alert `sessions-ended`. Alternatively, return the session chooser, as `decide` does, but a chooser alone lets the thief re-fill the slots.
- During a hold, a waiting login must not open a new session from a trusted device either. Refuse with `recovery-hold`, or count it as `weak-new-device` (extend the hold). Device trust is a copyable cookie, so it must not override the hold.
- Test: exactly the scenario above. Expect the owner's passkey login to answer `ok`, the hold to end, the thief's 3 sessions to be revoked, and the passkey to stay.

## Important

**N-I1. The owner's strong login ends the hold but leaves the backup session that started it. After that session's own 24 h, its changes apply at once (`waited`), which is a takeover.**

Code:
- `hold.ts:220-226` (`endHoldIfOwner` deletes only the hold row)
- `hold.ts:311` (`waited`)
- `sessions.ts:55` (a recovery session lives 48 h)
- `password.ts:395-406` (`allowRecovery` with the confirm exemption `recovery: true`)

Scenario:
1. The thief has one recovery code and does a backup login. That gives a held recovery session plus an account hold.
2. The owner, alerted, logs in with a passkey. The alert says "The 24-hour hold ended" (`Alerts.tsx:35`), and the owner believes it is over.
3. At +24 h the thief's session is past its own hold, and the account has no hold. Then:
   - `PUT /v1/account/password` (no confirm, `waited` → applied) ends every other session;
   - `webauthn/finish` adds the thief's passkey at once;
   - the thief logs in with it on a new browser. No full session is open, so the login is strong with no approval and no hold.
   - The thief removes the owner's methods.

Fix: in `endHoldIfOwner`, revoke every recovery session of the account and the hold's `started_by` session in the same transaction (alert `recovery-hold-cancelled` / `sessions-ended`). This also stops a weak `started_by` session from queueing the next change. Add a test for it.

**N-I2. A waiting session can silence the owner's pushes, which are the hold's only warning.**

Code:
- `push/routes.ts:109-112`: `DELETE /v1/account/push` with no body deletes *every* subscription of the account, not only the caller's.
- `push/routes.ts:92-95`: `POST` evicts the oldest subscriptions beyond `PUSH_SUBSCRIPTION_CAP` across the whole account.

Neither is gated or held.

Scenario: the thief's weak session (on a trusted device, or approved by mistake) clears all pushes, then changes the password (202 held). The owner gets no `hold-started` push and never sees the change unless they open the app. After 24 h the password applies and the owner's sessions end. R42's safety rests on the owner being told within the 24 h.

Fix:
- A session deletes only subscriptions with its own `session_id`.
- The cap evicts only within the caller's session (or refuses at the cap).
- Optionally, refuse both during a hold.

**N-I3. Weak sessions can end the owner's sessions and veto the owner's strong logins, with no hold and no confirm.**

Code:
- `routes/account.ts:389-400`: `DELETE /v1/account/sessions/:id` from any full session.
- `approval.ts:428-440`: any full session blocks any approval, and approving at the limit with `logOut` or one-device ends sessions.
- `approval.ts:231-232`: strong logins need approval like weak ones.

Scenario (outside a hold): the thief (trusted device or a mistaken approval) logs every owner session out and keeps 3 sessions open. From then on, every owner login, passkey included, waits for approval from the thief's devices, which block it. Only a backup login (which starts a hold) and then a strong login gets the owner back in, and that is exactly what N-C1 defeats.

Fix (lead call; it ties in with N-C1):
- a session whose login waits may not end a strong session (or doing so is a gated change);
- only strong sessions may answer the approval of a strong login; or a strong login on an untrusted device with only waiting sessions open goes in and ends them.

**N-I4. A PGP-alone (`pgp-single`) session can add a payout wallet that is usable at once, with no hold.**

Code:
- `wallets/routes.ts:233-235` with `STRONG_CONFIRM_METHODS = ['pgp', 'passkey', 'security-key']` (`confirm.ts:35`);
- `POST /v1/wallets` does not call `gateChange`.

Scenario: someone with only the owner's PGP private key logs in (on a trusted device, or approved). The owner's 14:12 ruling says that waits 24 h, but no hold starts because nothing gated changed. They confirm a new wallet with PGP and it is usable immediately (`usable_from = now`), then use it as a trade payout (`POST /v1/trades/:code/wallet`). A password confirm waits 24 h (the payout wait), so this is PGP-specific.

The owner's wallet rule of 10-24 (PGP confirm = immediate) conflicts with 14:12 (PGP alone = weak). Flag to the lead and owner. The safe default: a wallet added by a session whose login waits gets `usable_from = now + 24 h` (or goes through `gateChange`) whatever the confirm method.

## Minor

**N-M1. The FU-D login-name gap (asked to assess). Not exploitable for impersonation or takeover. Lock-out only in a rare key-rotation case.**

Code:
- `routes/account.ts:438-448` (`applyLoginName`): at expiry it checks only a login tag under the *same* `keyId`. It takes no `NAMES_LOCK` and does not check the display namespace.
- `accounts.ts:221-236`: `namesTaken` does not see pending tags in `account_holds`.

What can happen:
- **Display-name collision.** During the hold another sign-up can take display name X. At expiry X becomes A's private login name while it is B's public display name, which breaks FU-A I1-B ("a display name is never someone's login name"). Consequences:
  - **No impersonation.** A's public name is different.
  - **No takeover.** The login name is only the identifier, and nobody outside can tell X is a login name. The person who set the pending name already knows it: the owner, or a thief who already has a session.
  - **No lock-out.** Login by X resolves only to A.
  - **Worst case:** a random collision makes A's login name public and helps guessing against a password-only account.
- **Key-ring rotation during the hold.** A sign-up with login name X under the new key passes, and at expiry A also gets X under the old key id. The two accounts share a login name. Logins by name take `rows[0]` of a two-row match (`password.ts:106`, `recovery.ts:138`, `webauthn.ts:576`), so one owner can be locked out of logging in by name.
- **Retired key.** If the key is retired before expiry, A's tag matches nothing, so A cannot log in by name.

Fix:
- `namesTaken` also matches pending `login-name` tags: `account_holds.pending_change` `(keyId, tag)` against both the login and display `LoginTags`, which it already computes under every key.
- `applyLoginName` takes `NAMES_LOCK`, and drops the change (alert `applied:false`) when `keyId` is not the current key.
- Add the missing test of a held login-name change (none exists).

**N-M2. `holdInTx` re-throws any non-`ApiError` from `applyChange` (`hold.ts:148-151`).** Every login and gate for the account calls `holdInTx` (`approval.ts:212`, `hold.ts:306`). One persistent raw error would make every login of the account 500 until it is fixed. Today's known case is a transient unique-violation race on `accounts_login_tag_key` (N-M1, no `NAMES_LOCK`). Fix: drop the change on any error inside the savepoint, and log only its kind.

**N-M3. A weak session can mark the owner's alerts seen** (`routes/account.ts:417-430`). This hides `hold-started` and `new-login` from the badge. It predates this branch, but it now hides the hold's own warnings. Fix: refuse it for waiting sessions during a hold, or never let it touch `hold-*` and `new-login`.

**N-M4. `requireNotHeld` is an unlocked read** (`hold.ts:264-269`) on take, offers and wallets. A request racing a hold that is starting can still pass. Only the session that starts the hold benefits, and it could have acted first anyway. Note only.

**N-M5. Test gaps:**
- the N-C1 scenario;
- the owner's strong login with a live backup session (N-I1);
- a held `login-name` change applied or dropped at expiry (N-M1);
- push unsubscribe scope (N-I2).

**N-M6. Migration renamed from `014_cooling_off.sql` to `014_account_hold.sql`.** The runner applies by name, so any dev or staging database that ran the old file fails on `add column strength`. Put it in the deploy notes, or reset those databases. An approval decided before a hold and collected during it (`approval.ts:346-358`) opens a session during the hold. That session is refused everything, so this is a note only.

## Races and time

- Starting, extending, settling and ending a hold all run under `lockAccount`, with the approvals advisory lock taken first in `traderLogin` and `decide`.
- Two concurrent gated changes: the second sees the running hold and gets 403.
- An owner login at the moment of expiry: `holdInTx` settles first, then `ownerProof`.
- `settleDueHolds` and request-time settling both lock: no double apply.
- Every time comes from `deps.clock()`. No database `now()` is used in a hold decision.
- Refusals: 403 `recovery-hold { holdUntil }` everywhere. The web routes it through `loginCantDo` / CantDoThat (`HOLD_CODE`), and 202 `held` shows `heldNote`.

## Test runs

All in my own detached worktree `~/x2f-worktrees/rv-t1617r2` @ b9b3ca6 (npm ci, npm 11.21.0), each under `flock ~/x2f-comms/check.lock`. The worktree has been removed.
- tsc: apps/api 0, apps/web 0, packages/auth-client 0.
- api vitest, 16 files: coolingOff, deviceApproval, account, nudge, password, pgp, push, recovery, schema, security-review, totp, webauthn, login-tags, wallets, take, offers. **646 passed, 1 todo, 0 failed.**
- auth-client vitest: 5 files, **72 passed**.
- web vitest, 8 files: hold, loginApprove, devices-tripwire, task30-refusals, task30-units, cantDoThat-lint, copy-lint, app-routes. **63 passed.**
- N-C1 reproduction: a scratch test built on coolingOff.test.ts's helpers, through the real routes. Owner passkey login 409 during both holds; the owner's passkey removed at expiry. Deleted afterwards and never committed.
