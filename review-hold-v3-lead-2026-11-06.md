# Lead security review: wip/lead-hold-v3 b0bc72c4. CHANGES REQUIRED. 1 Critical. Doesn't land until closed.
Merge main d687cf30 first: conflicts app.ts (keep tradePublish and sessionRealm), auth/pgp.ts and auth/webauthn.ts imports (keep realmOf, TRADER_LOGIN_KINDS and stagedReply; drop heldReply, pushHoldStarted), schema.test (016 plus 202, 203, 205).
CRITICAL 1: recovery.ts:207-231, :261-268, :275-286. backupSession doesn't clear trusted_devices (hold.ts:321 does); revealDue accepts any full session. A password thief on a trusted device can reveal the new recovery code after the hold ends by time, then use it. Fix: delete trusted_devices in backupSession; reveal only for a strong session or the waited recovery session. Tests for the whole chain.
IMPORTANT
2. Any trader can stop the site-wide purge: 016_hold_v3.sql:26,33, challenges.ts:86: FK set null vs CHECK forbidding a draft with null session_id. Before-delete trigger or delete drafts before the purge. Test it, and account deletion.
3. Web has no submit, cancel, reveal, pendingChanges, recoveryCodeToShow or hold-changes-*. Do NOT land without the web on v3: an owner must see and cancel queued changes, and see a new recovery code.
4. Permanent freeze on a funded trade: held.ts:90-98,103; machine.ts:474. Both parties held, or hold end during maintenance. Decide resume per trade when the last open row goes.
5. "Disputes stay open" is false: held.ts:14; machine.ts:188,455. open-dispute and walk-away fail while paused. Allow both while paused; add tests. Check with the owner's rule; the lead will confirm.
6. A thief can block a strong login's discard: approval.ts:268, :324: the 429 rolls it back. Return a refusal outcome and throw after commit.
7. Wallet and member removal skip the hold: wallets/routes.ts:362, team/members.ts:210-218. Owner must rule; leave as built until then.
8. Q81: PGP login takes a key with no username, but the owner said username and PGP. Owner must confirm.
MINOR: cancel leaves other sessions' drafts (holdChanges.ts:175, :195). describeChange gives wallets a count only: show each address's last 6. Rate limit stage, submit, cancel (alert list shows 50, account.ts:458). Mod extend/end routes. /appeal and /dispute allow held recovery sessions (disputes/routes.ts:215, :247). A take racing the hold can miss a held_trades row. hold-changes-applied sends no push.
READY overstated: main merged is stale; Monero projects weren't run.
