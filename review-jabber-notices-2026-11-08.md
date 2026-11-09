# Security review: wip/lead-jabber-notices (Jabber account-change notices)

- Branch: `wip/lead-jabber-notices`, head `4446e3c5` (worktree `/home/user/X2F/.claude/worktrees/jabber`), API migration 331.
- Diff reviewed: `git diff origin/main...HEAD` (29 files, +2245/-6; commits 43def7f9..4446e3c5).
- Reviewer: independent security reviewer, read-only (cloud lead session, 9 Nov 2026). No code changed. `npm ci` was run in the worktree so tests could run.
- Tests: `xmpp.test.ts`, `jabber-paths.test.ts`, `jabber.test.ts` were tried through the serialised runner twice. **They did not run.** Both tries failed in the Postgres global setup (`docker port <id> 5432/tcp: no public port published`, Docker contention on the shared box), before any test started. Full check, semgrep and Playwright were not run, by the builder or by me.

## Verdict

**CHANGES REQUESTED. It may land dark** (`X2F_XMPP_*` unset, so no sender, no worker, and the set-up answers `jabber-unavailable`) once M1-M4 are fixed or ruled on. **It must not be switched on until the owner rules on OMEMO and Tor (H1, H2).**

The database choke point is well built:
- the trigger is in the same transaction, so a rollback queues nothing;
- one notice goes out per (account, txid, kind);
- the paths test is checked both ways;
- the weak-session and hold gates are correct.

The XMPP client has no XML injection, verifies TLS strictly, and has no STARTTLS or plaintext path.

But the sender does no OMEMO and does not use Tor. Every notice is plaintext to two server operators, the connection runs over clearnet, and the UI copy implies more protection than the system gives. Those two points go against the owner's 29 Oct rule ("OMEMO Jabber over Tor as the only extra"). That is a design decision for the owner, but the facts are below.

## Findings

### H1 (High, owner decision): no OMEMO, so the XMPP servers read every notice
- Where: `apps/api/src/jabber/xmpp.ts:138-141` (a plaintext `<body>`), and the header comment at `xmpp.ts:16-19` ("Not built yet: ... OMEMO encryption").
- Scenario: each notice is a plain `type='chat'` message. It goes to X2F's own XMPP server, then over s2s to the user's server. Both store it (offline storage, MAM archive). It can also be seen by anyone with access to the user's account or server, and by any device that syncs the archive. The text itself gives nothing away: a fixed sentence, no trade code, amount, counterparty or username. What the operators do read:
  - that this JID is an X2F user (sender JID, plus `<nick>X2F alerts</nick>`);
  - the exact time of every account change;
  - when a dispute is opened on a trade where the user is the buyer (the `trade-attention` text);
  - the six-digit test code.
- The UI says "Secure Jabber (XMPP)" and "OMEMO encryption recommended" (`apps/web/src/screens/settings/jabberCopy.ts:8,10`). A user who turns OMEMO on in their client still gets X2F's messages unencrypted. Clients such as Conversations then mark them "unencrypted", or hide them if the user set "OMEMO only". So the word "recommended" misleads.
- Fix (owner first): either build OMEMO (a device key for X2F, device-list and bundle fetch over PEP, encrypt to every device of the recipient), or keep plaintext with honest copy. If plaintext stays, drop "OMEMO recommended", and consider dropping the nickname and the word "X2F" from the text so that a server operator does not learn membership.

### H2 (High, owner decision): never over Tor; X2F's server reaches the XMPP server over clearnet
- Where: `xmpp.ts:104-107` (`tls.connect({ host: cfg.host, port: cfg.port, ... })`) and `apps/api/src/config.ts:283-284` (`X2F_XMPP_HOST`, which accepts any lower-case host name).
- Scenario: there is no SOCKS support, so the connection is a direct TCP connection after a system DNS lookup.
  - A `.onion` value passes the config check (it is a valid host name), but with a normal resolver it fails to resolve, and the DNS query for `xxxx.onion` leaks to the resolver.
  - With a clearnet host, X2F's server IP and its notice timing are visible to the network and to the server operator.
  - The s2s hop from X2F's XMPP server to the user's server is also clearnet unless that server is onion-only.
- "Direct TLS only" is true, but it is TLS, not Tor.
- Fix: add a SOCKS5h client to the local Tor daemon (`127.0.0.1:9050`, with the host name resolved by Tor). Add a config switch that refuses to start the sender unless the host is `.onion` (or traffic goes through Tor) when the owner's Tor rule applies. Keep the certificate check against the JID domain (`servername`). Over an onion address TLS is optional, but keep it anyway.

### M1 (Medium): the sending account's server learns X2F's whole Jabber user list; timing links people to trades
- Where: the design as a whole (`outbox.ts`, `xmpp.ts`), and `X2F_XMPP_JID` naming any server.
- Scenario:
  - If X2F's alert account sits on a third-party public server, that operator gets, over time, the full list of X2F users who turned Jabber on, plus the timing of every change. That is a user directory.
  - A counterparty who opens a dispute at time T, and who can see the buyer's server's traffic (runs the server, or colludes with or subpoenas its operator), sees `trade-attention` arrive at T. That links the JID to the buyer's X2F username.
  - Sealing with a random nonce and a per-account context (`address.ts:229-241`) means two X2F accounts with the same JID cannot be linked from the database alone. Anyone holding `X2F_JABBER_KEYS` and the database can link them.
- Fix: the owner should require that X2F runs its own XMPP server for the alert account, onion-only (this also fixes the s2s side of H2 for onion recipients). Optionally add a random 0-N minute delay before each send, to blur the timing.

### M2 (Medium): no per-recipient limit or coalescing; one actor can flood a recipient or stall everyone
- Where: `apps/api/migrations/331_jabber_notices.sql:42-59` (unique on `(account_id, txid, kind)` only) and `outbox.ts:203-241` (FIFO, 25 per 5 s, serial; dropped after 4 failures).
- Scenarios:
  - (a) Each transaction is one message. A team member's login account notifies the team account (`331:83-84`). A member, or a thief holding a member login, can loop on cheap self-changes (for example `nudge_settings`, or their own password) and send the owner hundreds of messages. The owner's own repeated toggles do the same.
  - (b) The outbox is FIFO and capped at about 5 per second, so one flood delays every other user's notices.
  - (c) A flood makes the XMPP servers rate-limit X2F's account (mod_limits, anti-spam). Sends then fail, and after 4 tries the notices are **silently dropped** for everyone.
  - Third parties cannot cause notices directly. Failed logins write nothing to the change tables, `account_blocks.blocked_id` is excluded, and disputes are bounded by the trades the victim is in.
- Fix (part of it changes behaviour, so owner): keep at most one unsent notice per (account, kind). An insert while one is waiting merges into it, which still meets "a message for every change" because the text never says how many. Also add a minimum gap per recipient, for example 1 per minute. Order the outbox by recipient fairly, not purely FIFO.

### M3 (Medium): the test-code path messages any JID and can be spent by Sybil accounts
- Where: `apps/api/src/jabber/routes.ts:31-35,123-154` (5 per account per day, 2,000 per site per day).
- Scenario: anyone with an account can send "Your X2F test code is NNNNNN." to any JID, 5 a day. About 400 cheap accounts use up the site-wide cap, after which nobody can set up Jabber until UTC midnight. Unsolicited messages to strangers also get X2F's alert account reported as spam (XEP-0377, community blocklists). If the account is blocked, **every** notice fails (see M2c).
- There is no delivery oracle: the route always answers 202. That is good.
- Fix (owner, since the limits change behaviour): require a strong session and some account age or standing before a test message is allowed. Add a per-domain cap. Consider putting the test codes on a separate sending account from the notices, so a spam block cannot kill the notices.

### M4 (Medium): when a key is removed from the ring, the user silently loses protection while the UI still says "on"
- Where: `address.ts:236-241`, `routes.ts:87-104` (`statusOf` returns `state: 'on'` with `address: null` when the blob does not open), `outbox.ts:215-221` (`dropped++`), and `docs/dev-setup.md` (no rewrap tool).
- Scenario: an operator removes an old `X2F_JABBER_KEYS` key. Every address sealed under it stops getting notices, and the user still sees the switch On, with "Not set up" as the address. A user who believes they are protected is not.
- Fix (engineering): at startup, refuse to start if any `jabber_contacts` or `jabber_outbox` blob names a key id that is not in the ring (as other rings do through their count queries). Or add a rewrap tool. Give `statusOf` a distinct state such as `broken`, rather than `on` with a null address.

### L1 (Low): SASL PLAIN only, even when SCRAM is offered; no channel binding
- Where: `xmpp.ts:127-129`. The test server offers `SCRAM-SHA-1` and `PLAIN`, and the client picks PLAIN.
- Scenario: the password reaches the server (and any TLS interceptor holding a CA-issued certificate for the domain) in the clear inside TLS. Inside verified TLS this is acceptable, but SCRAM-SHA-256-PLUS (tls-exporter binding) would defeat a mis-issued-certificate MITM.
- Fix: implement SCRAM-SHA-256, with -PLUS where offered, and use PLAIN only when nothing else is offered (or never).

### L2 (Low): the XMPP client's parsing and delivery semantics
- What is good:
  - TLS: `rejectUnauthorized: true`, `minVersion: 'TLSv1.2'`, `servername` set to the JID domain, and `socket.authorized` checked again. The system CA store is used in production, and a `ca` override exists only for tests. There is no STARTTLS and no plaintext path (`xmpp.ts:104-121`), and the tests cover a plaintext server, a wrong-domain certificate and an unknown CA.
  - Injection: none. `to` must match `BARE_JID`, whose character class excludes `<>&'"` and which does not allow a resource. `to` is also XML-escaped. The body is one of three fixed texts, the test code must be six digits, and the domain comes from config (`xmpp.ts:96-103,139-142`, `sender.ts:184-191`).
- Gaps:
  - (a) A message bounce (`<message type='error'>`, for example an unknown recipient) is not detected. The send counts as sent and `last_sent_at` is updated, so the UI shows "Last message" for a message that never arrived.
  - (b) The `<failure` and `<stream:error` checks are regexes over the whole buffer, and the stream is never parsed as XML. That is harmless here: the client sends no presence, so no third-party stanzas arrive.
  - (c) No ALPN `xmpp-client` is sent. Some direct-TLS endpoints that multiplex on port 443 need it.
  - (d) `BARE_JID` refuses valid JIDs: an apostrophe or other RFC 7622 local-part characters, and IDN domains. That is a usability limit, not a security one.
- Fix (a): wait briefly for an error stanza that carries the message id before the ping completes, and do not set `last_sent_at` when one arrives.

### L3 (Low): the mask shows the whole local part of short addresses
- Where: `address.ts:217-220` (`jid.slice(0, Math.min(4, at))`).
- Scenario: `bob@xmpp.org` is shown as `bob…@xmpp.org`, and a four-character local part is shown in full. The API answer is therefore the full address.
- Fix: show at most `min(4, local.length - 1)` characters, or a single character when the local part is 4 characters or fewer.

### L4 (Low): retention of sealed addresses
- Where: `331:17-37` and `routes.ts:140-146`.
- Scenario:
  - `pending_sealed` (a typed, never-proven address, possibly someone else's) is kept after `pending_expires_at` with no purge.
  - `jabber_outbox` rows keep their own sealed copy after Turn off, or after the account is deleted (there is no foreign key, by design). They last until sent or dropped, at most about 36 minutes of retries. That is acceptable, but should be written down.
  - There is no trader account-closure path in the code yet. A future closure that sets `disabled_at` rather than deleting the row would keep `jabber_contacts` forever.
- Fix: a retention job that clears expired `pending_*`. When closure is built, it must delete `jabber_contacts`.

### L5 (Low): bypasses and blind spots of the trigger choke point
- Where: `331:64-135` and `apps/api/test/jabber-paths.test.ts:145-160`.
- What holds:
  - A bulk `update`/`delete` fires per row, and the unique key gives one notice per transaction.
  - `COPY` fires the trigger.
  - A rolled-back transaction queues nothing, and savepoints share the top-level txid. The test exists (`jabber-paths.test.ts:201`).
- What bypasses it:
  - `TRUNCATE` (no statement trigger);
  - `session_replication_role = replica`;
  - `ALTER TABLE ... DISABLE TRIGGER`;
  - any account data in a table that references an account **without a foreign key to `accounts`**, or only indirectly (through `wallets.id`, `team_members.id`, a trade). The paths test only enumerates foreign keys to `accounts`.
- Fix: add `before truncate ... raise` on each change table, as `reviews` and `activity_log` already do. Extend the test to tables that have a foreign key to any change table. Add a CI grep that rejects `disable trigger jabber_` and `session_replication_role` outside a reviewed migration.

### L6 (Low): maintenance writes spam users, and a restricted role could fail on the trigger
- Where: `331:64-91` (`language plpgsql`, not `security definer`).
- Scenarios:
  - (a) Background jobs notify users:
    - the hold ending by its timer (`hold.ts:167/266/303` delete `account_holds`): arguably right;
    - expired team invites being marked removed (`team/members.ts:284`): the owner gets a message for nothing they did;
    - any future backfill migration on `accounts` or another change table: one message to every Jabber user.
  - (b) The trigger needs `select` on `jabber_contacts` and `team_members` and `insert` on `jabber_outbox` under whatever role is writing. A future job that writes a change table under a restricted role (as `x2f_purge` is used for chats and reviews) would **fail its write**. That contradicts the comment "Never raises".
- Fix: make the function `security definer` with `set search_path = public, pg_temp`, owned by the migration role. Document a reviewed way for a migration to skip notices (for example, disable the trigger inside the migration's own transaction, with a review rule).

### L7 (Low): key handling details
- Where: `address.ts:247-250` and `331:28`.
- Findings:
  - `codeHash` uses the ring's **raw** current AES-GCM key as the HMAC key. The migration comment says "under a subkey". One key is used by two primitives. That is not exploitable here, but derive a key (HKDF `x2f/jabber-code`) to match the comment.
  - A key rotation between test and verify makes the correct code fail and use up a try.

### L8 (Info): at-most-once delivery and what a crash loses
- Where: `outbox.ts:208-213`.
- The `delete ... returning` commits before the send. A crash, a deploy kill, or a database error during the retry `insert` loses up to 25 notices with no trace. That matches "at-most-once" as built. The owner should know that a notice can be lost, and that nothing tells the user.

### L9 (Info): PGP armor refresh at login is bookkeeping
- Where: `changePaths.ts:65` and `auth/pgp.ts:584`.
- The stored armor (new subkeys or UIDs merged at login) can change with no notice. The fingerprint is proven, so this is low risk. Noted for completeness.

### Item 6 (weak sessions and holds): verified correct
Every write route checks, in this order:
- `requireSession({ kinds: ['trader'] })` (members get `owner-only`);
- the `requireNotHeld` preHandler;
- then, under the transaction, `writeGate`: `requireLiveSessionInTx`, then `holdInTx`, then `weakOf` (`routes.ts:107-117`).

The routes are listed in both `LIVE_SESSION_ROUTES` and `HOLD_BLOCKED_ROUTES` (`auth/hold.ts:504-505,595-597`), and `jabber.test.ts:240` covers the case. `GET` stays open to weak sessions, but returns only the masked address. A weak foothold cannot redirect or silence the notices, and turning them off, deleting them or replacing the address tells the old address (`jabber_contact_changed`, `331:96-107`).

### Item 8 (strings): mostly marked; three gaps
- Marked:
  - `TRADE_ATTENTION_TEXT` (`sender.ts:163-166`) and `testCodeText` (`sender.ts:179-180`) carry COPY-UNSIGNED.
  - `jabberCopy.ts` has a file-level COPY-UNSIGNED.
  - `ACCOUNT_CHANGE_TEXT` is the owner's sentence.
- Gaps:
  - `'On'` / `'Off'` at `apps/web/src/screens/settings/Alerts.tsx:142` are hard-coded and unmarked.
  - `aria-label={C.back}` ("Back to alerts") on a link that goes to `/settings/security` (`JabberSetup.tsx:96`) says the wrong thing.
  - `previewText` duplicates `ACCOUNT_CHANGE_TEXT` instead of importing it, so the two can drift.
  - The copy problems with "Secure" and "OMEMO encryption recommended" are under H1.

## Owner questions

1. **OMEMO and Tor (H1, H2).** HANDOFF 29 Oct says "OMEMO Jabber over Tor as the only extra". The p5-7 board says "OMEMO recommended". As built, X2F sends **plaintext, over clearnet**, so both XMPP servers read every notice and learn that the address belongs to an X2F user. Options:
   - (a) build OMEMO and SOCKS/Tor before turning it on;
   - (b) turn it on in plaintext over Tor to an X2F-run onion server, with honest copy;
   - (c) as built.

   Recommendation: (b) at minimum, (a) before marketing the feature as "Secure".
2. **Where X2F's alert account lives (M1).** Recommendation: on X2F's own onion-only XMPP server, never on a public one (whose operator would gather X2F's user list).
3. **Coalescing (M2).** May several changes that are waiting be sent as one message, with a minimum gap per recipient? The text never says how many changes there were. Recommendation: yes.
4. **Test-code abuse (M3).** Require account age or standing before the first test message, a per-domain cap, and a separate sending account for test codes? Recommendation: yes to all three.
5. **What counts as a change (owner defaults in LEAD-HANDOFF 8 Nov 21:05).** Logins, new sessions, a backup-code (recovery) login (`recovery_codes.used_at` is bookkeeping), trusted devices and login approvals send **nothing**. A thief who logs in and changes nothing triggers no Jabber message. Recommendation: at least a recovery-code login, and possibly any new full login, should send the same fixed sentence (or a "new login" sentence).
6. **Disputes.** Only the buyer is told, and also when the buyer opened the dispute. Should the seller be told when the buyer opens one? Should the opener be told at all?
7. **Maintenance notices (L6a).** Should timer-driven events (a hold ending, invites expiring) send a notice?

## Landing notes

- **Revert the revert first.** `wip/lead-launch-rules` merged this branch and then reverted it (`b28b6291`, `967ac03c`). Before Jabber lands, revert `967ac03c` on main (or wherever launch-rules has landed). Otherwise git treats the commits up to `96a1182d` as already merged and silently leaves them out.
- **Classify at landing (`changePaths.ts`).** Every table or column added by hold-v3, vendor/inactivity, the ban list, sessions, and terms-signature that has a foreign key to `accounts` must go in `CHANGE_TABLES` or `NOT_ACCOUNT_CHANGES`. A new change table also needs its `jabber_note_change` trigger in a **new** migration, not an edit to 331. `jabber-paths.test.ts` will fail until this is done, which is the intent: run it after each merge. Also check new tables that refer to accounts without a foreign key (L5): the test cannot see them.
- **Migration number.** 331 is chosen as clear of the 3xx numbers already taken (up to 324) on other branches. Re-check at landing. Also check the launch-rules 123 / chat-shred-2 123 clash, which is unrelated but lands in the same batch.
- **Tests did not run in this review** (Docker port error in the Postgres global setup, twice). Before landing, run `xmpp.test.ts`, `jabber-paths.test.ts`, `jabber.test.ts`, `coolingOff.test.ts`, and the web `jabberSetup.test.tsx`, one file at a time, plus semgrep on the new files.
- **Keep it dark.** Do not set `X2F_XMPP_*` or `X2F_JABBER_KEYS` in any deployment until owner questions 1-2 are answered.
