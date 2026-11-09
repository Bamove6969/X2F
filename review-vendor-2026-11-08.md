# Security review: wip/lead-vendor d5a84e1a (8 Nov 2026)

Branch: origin/wip/lead-vendor at d5a84e1aca03d991d724074a6b0dc4923ab29b30 (main cbf8e50e merged). Checked against origin/main 5c4c8773 (120 commits ahead of the branch's base). Code reading and one openpgp proof of concept (.scratch/foreign-subkey.mjs). No test projects run.

**Verdict: APPROVED WITH CHANGES.** The four lead findings of 6 Nov are fixed. There is no Critical. One new Important (I1) is a false-ban path in the ban-list design. It can't fire yet because nothing calls `recordBan`, so it can be fixed on this branch or before Plan 4 wires up the ban action, but not after. The merge with main needs two test files resolved by hand (both trivial).

## Prior findings (review-vendor-lead-2026-11-06)

1. Pre-proof ban checks: **fixed.** Register start (pgp.ts:690-696), add-key start (`inspectNewKey`, :769-772) and team-join start (:834-838) no longer check. The checks after proof are `insertPgpKey` :146 and `applyPgpKey` :876. Every write goes through them in the merged tree: sign-up :726, add-key :805/:924, hold end hold.ts:201, team join routes/team.ts:254 and :341, staff invite staff/invites.ts:241. In hold.ts:176-186 a `key-unavailable` from the hold end is caught by the savepoint, and the change is dropped.
2. Banned subkey through a login refresh: **fixed.** pgp.ts:591 checks the merged key before the update. Test: banList.test.ts:227.
3. Auto-close against trades that can reopen: **fixed.** DUE (accountInactivity.ts:35-38) needs no open trade, and counts the 60 days from the later of the last login and the latest `trades.closed_at`. A reopen sets `closedAt: null` (machine.ts:430, :510), and every reopen window (48 h dispute after a refund, 30-day late-funds watch, main's new escalate-from-closed) is shorter than 60 days. Each account is locked `for update` and DUE is re-checked in the UPDATE. take.ts:247 locks both accounts `for update` and re-reads `poster_ok` (disabled_at) under that lock, so the race is closed. One gap: no race test and no reopened-trade test were added (M4).
4. A wrong mass close can't be undone: **fixed as specified** (skip after a gap or a start, skip during maintenance, cap of 10 per pass, owner alert). M1 covers what is left.
5. Minors: Jabber normalisation, the recordBan note, the 198 comment and the bans.ts header are all fixed.

## Important

**I1. Anyone who gets banned can ban someone else's PGP key, and that locks the victim out of PGP login (staff and owner included).**
Files: bans.ts:66-69 (`keyFingerprints` takes every subkey packet, with or without a binding), bans.ts:196-214 (`recordLoginAndKeys` bans every fingerprint of the stored key), pgp.ts:104 (`storableKey` keeps v4 keys whole, and v6 keys keep every subkey), pgp.ts:591 (every PGP login finish checks the merged key; `refreshed` is always set for a known key, pgp.ts:666). Same check in staff/login.ts:41.
Scenario: Mallory takes Vera's public key (from a keyserver, a chat or a past-rep proof) and appends Vera's primary key packet to his own key as a public subkey packet. Its fingerprint is the same (v4 and v6 fingerprints hash only the key body). It needs no signature from Vera, not even a binding from Mallory. `inspectPublicKey` accepts the key, and the login challenge goes to Mallory's real encryption subkey, so he proves it and signs up (`key-in-use` checks only the primary). He then gets that throwaway account banned. `recordBan` puts Vera's fingerprint on the ban list. From then on, every PGP login of Vera's ends 409 `key-unavailable` after she has decrypted the code, and the key can't go on any account. If Vera is a moderator or the owner, she has lost one of her required factors (Q51, p4-4). Proved with openpgp 6.3.2 (.scratch/foreign-subkey.mjs): the combined key passes `inspectPublicKey`, and `getSubkeys()` lists Vera's primary fingerprint.
Fix: ban only what the banned person has shown they control: the primary fingerprint, the subkey the account proved (the challenge recipient), and signing subkeys with a valid binding and a valid embedded back-signature. Don't ban unbound or foreign subkeys, and make `storableKey` drop subkeys that have no valid binding. Optionally refuse, at write time, a key with any subkey fingerprint already on file as another account's key. Add the proof of concept as a red test in banList.test.ts: "a banned account whose key carries another account's key as a subkey does not ban that account's key".

## Minor

**M1. The cap slows a mass close but doesn't stop it.** accountInactivity.ts:31, :59-86. After the one pass that is skipped (a gap or a start), every 10-minute pass closes up to 10 more accounts and raises another `auto-close-capped` alert. That is up to 1,440 closes a day, and each close deletes the account's PGP keys (:75) for good. Scenario: the server clock jumps months ahead, or the site comes back after an outage long enough that many accounts passed 60 days while nobody could log in. The owner's only brake is maintenance mode. Fix: once the cap is hit, latch the job off (a site flag) until the owner turns it back on. Also count an API outage as part of the clock, for example by skipping accounts whose deadline fell while logins were down.

**M2. A ban recorded after the 60-day close misses the PGP keys.** accountInactivity.ts:75 deletes `pgp_keys` (G14 reuse), and bans.ts:207 reads keys only from `pgp_keys`. Scenario: a scammer's last trade closes and he stops logging in. A report is upheld after the account has closed, and the Plan 4 ban records only the names, so the key goes straight onto a new account. Fix: at close, keep the fingerprints in a closed-keys table (keyed tags, as in 017) and have `recordBan` include them. Or ask the owner whether a closed account can be banned at all.

**M3. G13 counts an expired PGP key as a strong method.** methods.ts:393 uses `after.pgp`, not `after.usablePgp`. A vendor with an expired PGP key and a passkey can remove the passkey and be left with a password login only, which G13 forbids. Fix: count `usablePgp + keys + passkeys`.

**M4. Tests asked for in item 3 are missing:** a take racing a close, and a trade that closes and then reopens (a dispute after a refund, or late funds) before day 60. The code is right; the tests would guard it. File: accountInactivity.test.ts.

**M5. Migration rename.** The history once had `200_vendor_inactivity.sql`, now `200_account_inactivity.sql`. Any dev or staging database that applied the old name will fail on `add column last_login_at`. Nothing outside the branch carries it, so this only matters for local databases: reset them.

## Migrations and merge

- 017, 198 and 200 are used by no other origin/wip/* branch (all 79 checked) and not by main. Main uses 199 and 201 next to them, and the branch doesn't touch 113-122 or 316. The runner applies by name set, so 017 and 198 apply cleanly on a database that already has 312.
- `git merge-tree origin/main HEAD` gives two conflicts, both in tests: schema.test.ts (three migration lists: take the union, adding main's 113, 119, 122 and the branch's 017, 198, 200 in name order) and site.test.ts imports (keep both `markSellerNudged` and `makeVendor`). Main's later backend changes (release claim, seller nudge, escalate from closed or lapsed, site_flags row check) all keep `closedAt: null` on a reopen, so DUE still holds. After the merge, run main's new trade/nudge tests that post offers once, because their posters must now be vendors.

## Checked and fine

Becoming a vendor needs the account holder's own full session (members 403 `owner-only`, backup sessions refused), no hold, and a confirm with a passkey, security key or PGP key. The password confirm refuses `become-vendor` before any work. In the merged tree only password, webauthn and pgp issue confirm tokens. The switch is one way. Only vendors post or turn on offers (POST, PATCH live, bulk status) and only vendors invite or change team roles. The fee is unchanged (the poster's). Banned names are checked in both namespaces through `namesTaken` (createAccount, setLoginName, member and staff logins, a login name waiting in a hold) and give the generic answer, except the public display name. A closed account is refused at login and on every session (member sessions too), drops off listings, and can't be taken. Its names stay taken. Banned identifiers are stored only as keyed tags, and nothing serves them.

## Owner questions (not findings)

- p4-5 says "every account". The code closes every trader-kind account (vendors and traders) but never staff, owner or member logins. Closing the owner would be harmful, so this reading looks right; it should be confirmed.
- p11-13 (signature erased when the account closes) is on another branch. When it lands, `closeDueAccounts` must erase the signature too.
