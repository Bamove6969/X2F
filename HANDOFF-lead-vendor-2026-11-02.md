# Handoff: Trader/Vendor account types + ban list (lead-vendor), 2026-11-02

Branch: `wip/lead-vendor` (pushed). Head: `20a8bef8`. Worktree: `~/x2f-worktrees/lead-vendor` (npm ci done).
Based on the main line `origin/claude/compassionate-johnson-k95ssr`; main line b6835ee is merged in (clean).
It also merges cleanly with claude2's `wip/second-api-cap-dispute` (checked with git merge-tree at 172c5fc).

## Done

### API
- **Migration `017_ban_list.sql`**: table `banned_identifiers` (kind display-name / login-name / pgp-fingerprint / jabber, `tag_key_id`, `tag` = 32-byte HMAC, `account_id` on delete set null, `banned_at`). Keyed tags only, under X2F_LOGIN_NAME_KEYS. Names reuse `loginTag`, so a banned account's login tag is copied as is.
- **Migration `198_account_type.sql`**: `accounts.account_type` ('trader' default | 'vendor') + `vendor_since`; check: only kind='trader' rows can be vendors. Backfill (between the `-- backfill:start/end` markers, which vendor.test.ts runs again): an account with live/paused offers or live team members becomes a vendor only if it has a PGP key or WebAuthn credential. Otherwise it stays a trader: its offers stay listed and can be paused or removed, but it can't post or turn one back on. Its team stays, but it can't invite or change roles. (198 is used because the backfill reads offers (102); 016 is taken on the recovery-code branch.)
- `src/bans.ts`: `recordBan(deps, accountId, { jabber? })` is the internal function for Plan 4's ban action. It records the display name, the login tag, every PGP fingerprint (primary + subkeys) and the Jabber account. Also: `assertKeyNotBanned` (409 `key-unavailable`), `jabberBanned` / `normalizeJabber` (the Jabber seam: no Jabber account exists in the code; NEEDS_JABBER_SETUP), `recordBannedValues`, `keyFingerprints`. No staff UI.
- Name checks: `namesTaken` (createAccount, setLoginName, a held login name) refuses banned names in both namespaces with the generic 409 `names-unavailable`. `assertDisplayNameFree(db, n, config)` refuses a banned display name early with 409 `display-name-taken`.
- PGP checks: at register start, add-key start (before the confirm token), and team join start. The authoritative checks are in `insertPgpKey` and `applyPgpKey` (which now takes `config`; the hold settle path is covered too).
- `src/routes/accountType.ts`: `PUT /v1/account/type { type: 'vendor', confirmToken }`.
  - Allowed: the owner's full trader session only (members get `owner-only`).
  - Refusals: `requireNotHeld`; in the transaction, a live session plus the hold re-check under the lock. Already a vendor → 200. No key → 403 `vendor-needs-key`. Then the `become-vendor` confirm is redeemed; a method other than pgp, passkey or security-key → 403 `method-not-allowed`. Then the switch and the alert `became-vendor`.
  - Not built: switching back (`type` other than vendor → 400).
  - Classification: in LIVE_SESSION_ROUTES and HOLD_BLOCKED_ROUTES, with a coolingOff ROWS entry.
- The confirm action `become-vendor` is in packages/accounts. `STRONG_ONLY_ACTIONS` / `needsStrongConfirm`: `POST /v1/confirm/password` refuses it (403 method-not-allowed).
- Offers: `assertMayPost` → `assertVendor` (403 `not-vendor`) as its own line, which keeps it compatible with the per-side cap branch. `accountRefusal` returns 'not-vendor' for the bulk switch. Team: `requireVendor` preHandler on invites and role changes, and `ownerWriteGate(strong)` re-checks under the lock. Removal stays allowed.
- `GET /v1/account/me` sends `accountType` (for a member: the team account's type). Error codes added: not-vendor, vendor-needs-key, key-unavailable.
- Fee: no change needed. The fee is the poster's (packages/trade), and only vendors post. The seam is noted in accountType.ts (NEEDS_FEE_BY_ACCOUNT_TYPE).

### Web
- New screen `/settings/account-type` (screens/settings/AccountType.tsx + accountTypeCopy.ts, COPY-UNSIGNED from the BecomeVendor board), linked from Security.
  - Shows: the current type, the comparison, and whether the requirement is met (with "Add a passkey, security key or PGP key" when it isn't).
  - Switch flow: the "Switch to a vendor account?" sheet, then confirm-it's-you.
  - Refusals go through CantDoThat.
  - Left out: the session-length row (not built) and the switch-back sheet (OPEN).
- ConfirmSheet hides the password for `become-vendor`.
- `mayPostOffers` is false for trader accounts, so there is no Post offer tab.
- PostOffer shows a trader the not-vendor CantDoThat and a link to Account type instead of the form.
- My offers: a trader's primary action is "Switch to a vendor account".
- Copy: cantDoCodes has not-vendor and vendor-needs-key (CANT_DO) and key-unavailable (not-refusal), plus texts. refusals.ts has KEY_UNAVAILABLE.
- auth-client: `accountType`, `isVendor`, `becomeVendor`, `becomeVendorAction`, `AccountType`.

## Test status
- API tests passed **before** merging the main line: offers, offersBulk, blocks, take, team, coolingOff, vendor (15), banList (15), account, schema, login-tags.
- After the merge, I re-ran only offers.test (33/33).
- Web: accountType.test.tsx, ui.test, cantDoThat-lint and copy-lint tests pass (78). auth-client tests pass (76).
- Typecheck passes for api, web and auth-client. `npm run copy-lint` is clean.
- **Not run yet:** the full API suite after the merge, the full web suite, full `npm run typecheck`, and separation-check (check.lock was held, so flock timed out).

## Next step (exact)
1. `cd ~/x2f-worktrees/lead-vendor && flock ~/x2f-comms/check.lock bash -c 'npm run typecheck && npm run copy-lint && npm run separation-check && npx vitest run'`. Fix any fallout. Likely spots: web tests that render BottomNav/MyOffers/PostOffer with a stubbed `me` and no accountType (they should be fine, because null type is allowed), and API tests from the merged main line that post offers through new helpers (add `makeVendor`).
2. When claude2's `wip/second-api-cap-dispute` lands: merge it. Any new test poster helper there needs `makeVendor(deps, id)` (test/helpers/accounts.ts).
3. Ask for a review, then land.

## Open questions for the owner (built conservatively)
1. Other vendor requirements (e.g. N completed trades)? Built: a key only.
2. Switching back to trader: what happens to live offers and the team? Built: not possible yet (400). The UI says "comes later".
3. Does a password-only or recovery-code login affect vendor status? Built: no effect. The switch itself needs a confirm with a passkey, security key or PGP key, but no strong session (PGP-alone sessions can switch).
4. Migration: accounts with offers or team but no key stay traders with grandfathered offers (listed, can pause/remove, can't relist) and their team kept (can't invite or change roles). Should they instead be vendors anyway, or have their offers paused?
5. Bans: should look-alikes of a banned display name be refused too (like staff names)? Should a timed or lifted ban (Plan 4 `ban-lifted`) remove entries? Built: forever, no removal function. Should banning a vendor also ban its members' logins and keys? Not done.
6. Rotating out an X2F_LOGIN_NAME_KEYS key retires the bans tagged under it (there is no plaintext to re-tag from). Keep old keys in the ring.
7. Session lengths per type (trader 2/4/6/12, vendor 2/6/12/24) are not part of this branch.
