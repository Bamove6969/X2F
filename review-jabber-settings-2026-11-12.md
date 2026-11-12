# Security review: `wip/lead-jabber-settings` 06a6a7ad (W-021 Jabber events, D-067 contact link, W-006 loud alarm)

Reviewer: independent security reviewer (cloud helper), 12 Nov 2026. Read-only on code.
Base main 6ebed537.
- First reviewed at 98ec947a: 1a728687, f3ef8fbf and 988555bd (red tests), then 81e8c97c (feature) and 98ec947a (READY).
- Then, at the lead's request, at **06a6a7ad**: a285dd50 (red tests), then 06a6a7ad (READY).
- 06a6a7ad touches only `336_jabber_events.sql`, `jabber-events.test.ts` (+19, a285dd50's two tests only), web `jabberCopy.ts`, `jabberEvents.test.tsx` and the auth-client kind type. `staff/settings.ts`, `sw.js` and `alarm.tsx` are byte-identical to 98ec947a, so F2-F4 apply unchanged.

Scope: whether a stolen weak session can silence account-change alerts, the gates on the new PUT, the triggers and `jabber_queue`, team-member notices, the D-067 URL check, the sw.js message passing, and the custom sound staying on the device. This touches logins and money: the Jabber notice is the takeover alarm, and it covers payout-address changes.

## Verdict at 06a6a7ad: PASS on the engineering, HOLD on one owner call (F1)

Counts: 0 Major in the engineering, 1 owner decision at Major weight (F1), 3 Minor (F2-F4), 3 Info (F5-F7).

The move into `jabber_queue` is done safely:
- `jabber_contact_changed` (the notice that the setting itself changed) now writes `jabber_outbox` directly, with kind `account-change` and the same `on conflict (account_id, txid, kind) do nothing`. So muting account-change still announces itself once.
- The test "turning an event off or on queues one account-change notice, even when account changes are the event turned off" is unchanged: the test file at 06a6a7ad is identical to a285dd50's, which only added two tests.
- The trigger functions are no longer redefined. `jabber_note_change` and `jabber_dispute_opened` go back to their 331 bodies, and the mute is applied once, inside `jabber_queue`, keyed on the contact's own account (`c.account_id = acct`, which is the team account for a member's change).

What stays as at 98ec947a:
- **A weak session cannot silence anything.** `PUT /v1/account/jabber/events` has the same gates as the other Jabber writes:
  - `requireSession({ kinds: ['trader'] })` with no `member` option, so a team member gets 403 `owner-only` on the GET and the PUT (tested).
  - `requireNotHeld`.
  - `writeGate` first in the transaction: a live-session re-check, the hold (403 `recovery-hold`) and `weakOf` (403 `weak-session`), both tested.
  - A disabled account is refused by `requireSession`.
  - The route is in `JABBER_WRITE_ROUTES` and `OWN_DATA_WRITES`, the GET is in `OWN_DATA_READS`, and `coolingOff.test.ts` covers the PUT.
- **`muted_kinds` is written only by this PUT.** It has a check against the allowed kinds, and Turn off (DELETE) drops the row and the picks. Setting a pick to its current value writes nothing and tells nobody (tested).
- **Team-member changes still notify** a team account that has not muted account-change (the member clause in `jabber_note_change` is unchanged, and `jabber` and `jabber-paths` still pass). A team account that muted account-change does not hear them (tested). That is intended, and part of F1.

## Every caller of `jabber_queue` at 06a6a7ad, and what a user can now mute
`git grep jabber_queue` at 06a6a7ad finds no application caller. The SQL callers are below. The outbox worker's own re-inserts (`outbox.ts` retry and deferral) write `jabber_outbox` directly and are not muted, so a notice already queued before a mute is still delivered.

| Caller | Kind | Mutable? | What it reports |
|---|---|---|---|
| `jabber_note_change` (331), on `accounts` (login name/tag, display name, `disabled_at`, …), `passwords`, `totp`, `recovery_codes`, `webauthn_credentials`, `pgp_keys`, **`wallets`**, `team_members`, **`account_holds`**, `trading_holds`, `nudge_settings`, `account_blocks`, `past_reputation`, `banned_identifiers` (334); a team member's login account notifies its team | `account-change` | **yes**, by the `account-change` pick | every login method change; **payout-address changes**; **a recovery-code hold starting or ending** (the thief's recovery login); moderator freezes; member add/remove; bans |
| `jabber_dispute_opened` (331) | `trade-attention` | yes | a dispute on a trade the account pays |
| `jabber_contact_changed` (now 336) | `account-change` | **no**: direct outbox insert | the Jabber setting itself: turn off, pause, a new address, a change of picks |
| J-20 `sessions.ts:283` (`wip/second-team-limits`, not landed) | `team-member-first-login` | **yes**, once J-20 lands: 336's check already allows it, and J-20 calls `jabber_queue` | S-107: a team member's first login, which replaced the lead approving it (p11-27) |

**The direct outbox write does not bypass anything.** The old `jabber_queue` (331) was a bare insert with the per-transaction dedupe. There was no rate limit, no `enabled` check (the callers check `enabled`) and no kind check (that is the outbox's own column `check`, which binds the direct insert too). The direct insert keeps the dedupe. Delivery throttling, OMEMO, Tor and retries all live in the worker, which treats every row the same. One consequence, already true before this branch: nothing rate-limits how often the settings notice can be triggered. Each PUT toggle is its own transaction and so its own notice, and toggling needs a strong session. That is Info only: it is spam to one's own address.

**Merge note with J-20.** 380 widens `jabber_outbox_kind_check` and re-creates the `team_members` trigger. It does not redefine `jabber_queue`, so the mute survives the merge in either order. If 336 lands first, keep its `muted_kinds` check in step with 380's kinds, as 336's own comment asks.

## Findings

### F1 (owner decision, Major weight): one switch silences every security notice, with the payout-address and recovery-hold notices among them
At 98ec947a this was F2 (Minor, the account-change mute). Moving the mute into `jabber_queue` does not change what `account-change` covers, but the table above makes the reach plain. With account changes off:
- a password, 2FA, passkey, PGP or recovery-code change is silent;
- **a payout wallet change** is silent;
- **a recovery-code hold starting** (the strongest sign of a takeover in progress) is silent;
- member changes and moderator freezes are silent.

Only one generic sentence is sent at the moment of the mute ("An account change was made on your X2F account.", fixed text per p5-7), indistinguishable from any other change. And the Jabber card still shows the address as **On** (`state: 'on'`). The web shows `accountChangeOffWarning` on the events page itself, but not on the status.

A weak session cannot do this (gated). Someone with a strong session could already Turn off or pause with the same single notice, so the branch gives a thief no new capability. It does give a quieter one: the status stays "On".

J-20's `team-member-first-login` becomes mutable as soon as J-20 lands. p11-27 made that notice the replacement for the lead approving a member's first login, so being able to mute it changes the trade-off the owner signed.

Options for the owner, recommendation first:
- (a) **`account-change` and `team-member-first-login` cannot be muted.** Only `trade-attention` and future non-security kinds can. Pausing the whole switch stays the visible way to stop everything.
- (b) They can be muted, but turning one of them off goes through the 24 h security-change wait (hold v3), with the notice at the start, and the status reads "On, account changes off" (COPY-UNSIGNED, for design).
- (c) As built.

Engineering is ready for any of these. For (a), narrow the `muted_kinds` check and the PUT's allowed kinds, a two-line change plus tests.

### F2 (Minor): the D-067 check validates the parsed URL but stores the raw string
`isModeratorContactLink` parses with WHATWG `URL` and then checks the protocol, user info, port, the exact host (`matrix.to` or `t.me`), and the path and hash shape. I tried it against tricky inputs with Node 24:
- **Refused:** `user@`, `matrix.to@evil.com`, `evil.com\@matrix.to`, `matrix.to\@evil.com`, a Cyrillic `mаtrix.to` (it becomes `xn--…`), `matrix.to.` (trailing dot), `t.me:8443`, `%2F` in the host, IP hosts, and tabs (blocked by LINK's `\s`).

  So no host, user-info, port or Unicode trick changes the destination host.
- **Accepted, but stored as typed rather than in normalised form:**
  - `https://MATRIX.TO/#/@a:b`
  - `https://matrix.to:443/#/@a:b` (the default port normalises to '')
  - `https://matrix.to/%2e%2e/#/@a` (the path normalises to '/')
  - `https://t.me/%2e%2e/x`
  - a hash with raw `"><script>` (`\S+`)
  - `https://t.me/x?start=1` (t.me's `search` is not checked; a `?start=` link starts a Telegram bot with a payload)

None of these goes to another host, and React escapes attributes, so there is no XSS today. The value is not rendered anywhere yet: only staff settings read it. Still, a validator that checks one string and stores another is how a later renderer gets surprised.

Fix:
- Store `u.href`, or refuse unless `u.href === v`.
- Require `u.search === ''` for t.me.
- Narrow the matrix.to hash to Matrix identifier characters, for example `^#/[#!@+][A-Za-z0-9._=\-/:]+$`, which still allows `#room:server`, `!id:server` and `@user:server`.
- A row stored before this change is not re-checked (Info): there is no migration check, only the PUT.

### F3 (Minor): the alarm accepts any same-origin page's service worker message
`pushKindOf` takes any `{ type: 'x2f-push', kind }` from `navigator.serviceWorker`'s `message` event, which comes only from this origin's service worker. The harm is limited to code already running on the X2F origin making the device ring, so this is not a cross-origin issue.

On the sending side, sw.js filters `matchAll({ type: 'window', includeUncontrolled: true })` to `origin === self.location.origin`, which `clients.matchAll` already guarantees, and posts only the kind, never the payload. The push bodies are the fixed sentences anyway. **No push content leaves the origin.**

Nothing to fix. Noted so that nobody later adds payload fields to that message.

### F4 (Info): the custom sound stays on the device (checked)
`indexedDbSoundStore` writes the `x2f-alarm` IndexedDB database with a single key. `checkSoundFile` limits it to `audio/*` and at most 1 MB. Playback is `decodeAudioData` on a copy, and an undecodable file falls back to the tone.

`alarm.tsx` contains no `fetch`, `XMLHttpRequest`, `sendBeacon`, `navigator.share`, `postMessage` or object-URL export. The settings live in `localStorage` (`x2f.alarm`), wrapped in try/catch and read defensively. The file never reaches the API or the service worker.

The only exposure is local: another script on the X2F origin could read the sound, which is the same trust as the rest of the origin. The sound is also not cleared at logout. On a shared device, the next person sees "Your sound". That is cosmetic, but design should know.

### F5 (Info): migration number and ordering
336 sits between 335 and 345, and main already has 345 to 500 applied. The runner applies missing files by name, so an existing database runs 336 after 500. That is fine here, because 336 only replaces function bodies and adds a column, and no later migration redefines those functions. As the migration itself says, re-check the number at landing.

### F6 (Info): the READY note said semgrep was not run; I ran it
`/root/.local/semgrep-venv/bin/semgrep --no-git-ignore` on the 12 changed source files:
- the registry rulesets p/typescript, p/javascript and p/react: 74 rules, 0 findings
- the repo's `tools/semgrep`: 2 rules, 0 matching targets (they cover other paths)

Semgrep does not parse the SQL migration. I reviewed it by hand above.

## Tests run (serialised runner, throwaway worktree `rv-jset`, fresh `npm ci`; dockerd was up, no restart)

At **06a6a7ad**:
- `apps/api/test/jabber-events.test.ts`: 15/15 passed (including a285dd50's two)
- `apps/api/test/jabber.test.ts`: 33/33 passed
- `apps/api/test/jabber-paths.test.ts`: 26/26 passed
- `apps/api/test/coolingOff.test.ts`: 96/96 passed
- web `alarm.test.tsx` + `sw.test.ts` + `jabberEvents.test.tsx`: 38/38 passed (3 files)

At **98ec947a** (first pass):
- `jabber-events`: 13/13 passed
- `jabber`: 33/33 passed
- `jabber-paths`: 26/26 passed
- `coolingOff`: 96/96 passed
- `staff/settings`: 11/11 passed
- web, the same 3 files: 37/37 passed

`staff/settings.ts` is unchanged between the two heads, so its 11/11 carries over.

semgrep: see F6 (06a6a7ad's changed TypeScript files re-scanned: 74 rules, 0 findings).

Not run: Playwright (security.spec parity with the new Settings cards), `npm run check`, `schema.test.ts` (the READY note reports 77/77).

## Questions
1. **F1 (owner):** may `account-change` (which covers payout wallets and recovery holds) and J-20's `team-member-first-login` be muted? Recommend (a): not mutable, only `trade-attention` and future non-security kinds. Otherwise (b): mutable through the 24 h security-change wait, with the status reading "On, account changes off".
2. **F2 (lead):** store the normalised contact link (`u.href`), require no query string on t.me, and narrow the matrix.to hash to Matrix identifier characters. This is engineering only.
3. **Merge with J-20 (lead):** keep 336's `muted_kinds` check in step with 380's `jabber_outbox_kind_check`, whichever lands first.
