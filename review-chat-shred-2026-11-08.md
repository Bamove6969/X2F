# Review: chat shred (tasks 1 and 2), wip/lead-chat-shred-2

- **Reviewer:** the lead's independent security reviewer. Read-only: nothing in the worktree was changed.
- **Worktree:** /home/flem/x2f/.claude/worktrees/agent-afd57a1181f304991
- **Branch and SHA:** `wip/lead-chat-shred-2` at `6bd6d27a31706862027b6408534836085285f573`. Confirmed, and the tree is clean.
- **Scope:** `git diff origin/main...HEAD`, 16 files: API migration 123 and moderation migration 007, `retention.ts`, chat and internal routes, moderation `main.ts` and `link.ts`, web `engine.ts`, `store.ts` and `serve.ts`, plus tests.
- **Tests run (3 of the 4 allowed), all pass:**
  - moderation `test/shred.test.ts`: 8/8
  - web `test/chatEngine.test.ts`: 28/28
  - api `test/chat.test.ts`: 51/51

## Verdict

**Not ready as is. There are 3 Important findings, and all are cheap to fix.**

- **What holds up:**
  - The shred is transactional and idempotent.
  - The purge writes its order and its marks atomically.
  - The 410 marks cannot be enumerated.
  - No log line carries a chat code.
- **What does not hold:**
  - Moderation's "whatever the API says" hold can be bypassed by an order that names no trade.
  - The device now hides, without saying so, lines it showed earlier when the server stops serving them.
  - A network failure during the first sync loses the chat's history for the rest of the session.

## Important

### I1. An order with `trade: null` (or a wrong trade) skips every dispute hold

- **Where:** `apps/moderation/src/main.ts:594`. The comment at `apps/moderation/migrations/007_chat_shred.sql:7-10` claims more than the code does.
- **How it works now:** `shredHold` returns null, so the chat is shredded, as soon as `trade === null` and the chat was attested 7 or more days ago. Moderation keeps no record of its own linking a chat to a trade:
  - `mod_chat_identities` and `signed_chats` are keyed by chat only.
  - The chat attestation holds the chat channel only.
  - So the `trade` field is pure API input. A different but closed trade code skips the holds the same way as null.
- **Scenario (compromised API):**
  - Trade T is disputed and moderation has seen it so (`mod_dispute_seen`).
  - Its chat C was attested before the take, which is normal, so it is older than 7 days.
  - The API deletes C's envelopes live and serves the order `{chat: C, trade: null}`.
  - Moderation destroys C's mod identity.
  - The API's 14-day WAL-G backups still hold C's v1 ciphertext. Before this branch, a restored backup plus the mod key would recover the evidence. After the shred it cannot.
  - This is exactly the "evidence destroyed mid-case" that the 007 comment and the design (section 5) say cannot happen. A buggy API that drops `trade_code` has the same effect.
- **Severity: Important, not Critical.**
  - A compromised API can already destroy the live ciphertext by itself, so what is lost here is the recovery path, not the only copy.
  - The devices no longer keep text (task 2), so the API's copy is the only one.
- **Cheap fix (about one day):**
  1. Add the linked chat code to each item on `GET /internal/v1/watch`: `left join chats c on c.trade_code = t.code`.
  2. Record it in `recordDisputes`: add a `chat` column to `mod_dispute_seen`, or a small `mod_chat_trade` table.
  3. In `shredHold`, look the dispute up **by chat**, and hold on either:
     - the chat being seen disputed within `CHAT_AFTER_DISPUTE_DAYS`, whatever `order.trade` says; or
     - `order.trade` disagreeing with the link moderation recorded.
  4. Disputes moderation raised itself (escalation reports) should be recorded the same way. Today only the watch list feeds the table.
- **Trust:** the link comes from the API, but it is captured while the dispute is live. That is the same trust as the dispute record the hold already relies on, so a later compromise cannot rewrite it.
- **Test to add:** a disputed trade's chat ordered with `trade: null`, and with a different closed trade, must be `held-dispute`.
- **If you do not fix it:** at least correct the 007 and `shredTick` comments and the design's section 5 claim.

### I2. A re-read hides, with no mark, a line the device showed earlier

- **Where:** `apps/web/src/chat/engine.ts:163`. The test at `apps/web/test/chatEngine.test.ts:349-350` asserts this behaviour as intended.
- **How it works now:** the device keeps no text, so a receipt whose envelope the server no longer serves (or serves with another signature) is filtered out of `lines`. The `gapBefore` marks were computed when each line was first taken, so nothing shows that a line went missing.
- **Scenario:**
  - The counterparty, or the API, wants a line gone: for example "send to account A", which the trader acted on.
  - The API deletes that envelope.
  - At the next worker start the trader's own app no longer shows it, and shows no gap.
  - The design's threat table (section 10) promises that drops are "shown as gaps".
  - The device still holds the receipt (sender, seq, time and signature), so it can prove the line existed. Before this branch it also kept the text.
- **Fix:** render each receipt that has no reopened text as a placeholder line, for example "A message you saw earlier is no longer on the server" with its sender and time, or at least set `gapBefore` on the next line. Change test 349-350 to expect the placeholder.

### I3. A network failure during the first sync loses the history for the whole session

- **Where:** `apps/web/src/chat/engine.ts:247-248`.
- **How it works now:**
  - `texts.set(rec.chat, shown)` runs before the cold read's loop.
  - If `listEnvelopes` throws partway (a Tor circuit drop, a 5xx), the chat already counts as warm.
  - Every later sync then reads only past `rec.cursor`.
  - The lines before the cursor that were not yet reopened stay hidden until the worker restarts.
- **Scenario:** over Tor, the first open of a long chat fails on page 2 of 4. The next tap shows only the first page plus new lines, with no indication, for the life of the tab. This is likely in normal use, not only under attack.
- **Fix:** mark the chat warm only after a cold read reaches `more === false`, or the cap. For example, keep a `complete` set, or build `shown` locally and `texts.set` it at the end, falling back to cold on the next sync. Add a test where `listEnvelopes` throws on the second page and the next sync still shows every line.

## Minor

### M1. The watch-list state `'closed'` does not exist

- **Where:** `apps/moderation/src/main.ts:599`.
- `TradeState` has no `'closed'` (`packages/trade/src/machine.ts:11-23`). The closed states are `released`, `refunded` and `cancelled` (`machine.ts:188`, `desk.ts:183`).
- So every trade on the list counts as "open". The list includes trades closed in the last 31 days (`WATCH_LIST_CLOSED_DAYS`).
- **Effect:**
  - Every undisputed trade chat, purged at close + 30 days, is held `open` until its trade leaves the list at close + 31 days.
  - This is safe (it holds too much), but the check does not do what it says.
  - The tests at `shred.test.ts:207,236,247` hide the bug by feeding the invented states `'closed'` and `'published'`.
- **Fix:** use the real closed set (export one shared `CLOSED` list) and real states in the tests.

### M2. A cold read accepts new lines placed below the cursor

- **Where:** `engine.ts:277-304`.
- **How it works now:** on a cold read, an envelope with id ≤ the old cursor and no receipt still goes through the saved guard. A compromised API can give a new line (a seq higher than any seen) an old id.
- **Effect:** at the next worker start the device shows that line back in the old part of the chat, with no gap. Before this branch, ids at or below the cursor were never read.
- **Fix:** everything at or below the cursor was already decided, so on a cold read skip any envelope with id ≤ `start` that has no receipt (`if (!past) continue;` before the open). This also removes the half-saved guard state for lines below the cursor.

### M3. The sweep runs on the first chat message, not when the worker starts

- **Where:** `apps/web/src/chat/serve.ts:53`.
- `make()` runs only on the first `chat-sync` or `chat-send`.
- A user who never opens a chat again never sweeps, so their purged chats' keys and receipts stay on the device.
- The design (section 5, item 2) says "at every app start".
- **Fix:** start the engine and the sweep when the escrow worker boots (`escrow/worker.ts:132`), behind a live session.

### M4. Held orders can block the shred list for everyone behind them

- **Where:** `apps/api/src/internal/routes.ts:421`.
- The list is served oldest first with a limit of 100. Held orders stay at the head and are served again on every pass.
- **Effect:**
  - If 100 or more orders are held at once, everything behind them waits until they clear. With M1 that happens on a busy day, about one day of delay.
  - A buggy API could hold the list for up to 90 days with dispute holds.
- **Fix:** have the API serve the orders least recently served first, like `chat_work_served`, or have moderation post a `chat-shred-held` report that moves the order back.

### M5. After 365 days a purged chat stays on the device forever (owner call)

- After `CHAT_PURGED_MARK_DAYS` (365) a purged chat answers 404, so a device that comes back later keeps:
  - its record with the chat-identity secrets, which open nothing;
  - its receipts: the ids, times, seqs and signatures.
- Keeping the 365-day membership tags is a retention rule that affects users, and the owner said "system wide". Per the "no important calls without the owner" rule, put the number to the owner.
- A suggested option: a client rule that erases a record when its chat 404s and has been idle longer than the longest retention (90 days plus margin). A block's 404 can be told apart only by time, so this needs the owner's yes.

### M6. Older device records are protected less, and IndexedDB erase is not forensic

- **Records from before receipts:** a record upgraded from v1 has `sig: null`. A re-read then checks only the sender and seq, so a counterparty working with the API can swap in a second envelope it signed with the same seq.
  - Probably no such records exist in production, since everything is on the Monero test network. The design asks the lead to confirm.
- **Erasure:** `store.delete` and the v1 rewrite are logical. Leftover data on the browser's disk can keep the old ciphertext until compaction, and the wrapping key stays in the same database.
  - This is an honest residual, worth one line in the docs.
  - Optional: rotate the wrapping key after the upgrade and after a sweep that erased something.

### M7. The proof test proves less than its comment says

- **Where:** `shred.test.ts:154-157`.
- **Shows:** the live database has no logical row naming the chat or its mod keys after the shred.
- **Does not show:**
  - The `boxSecret` hex check proves nothing: the identity is stored sealed with AES-GCM, so that hex never appears in the dump, even before the shred.
  - Deleted rows can survive on disk (in dead tuples and the WAL) until vacuum, and in moderation-DB backups. The design knows this; it is epoch keys, task 14.
- The design's own test ("a backed-up purged envelope no longer opens") is satisfied only for the live database.
- **Fix:**
  - Run the dump check before the shred as well, to show what changed.
  - Change the comment to "nothing in the live database".
  - Note the backup window in the docs.
- Logs are clean. The log lines carry only `{ reason }` and never a code, on the moderation side, at `routes.ts:436`, and in fastify, whose request logging is off (`app.ts:172`).

### M8. `mod_dispute_seen` keeps trade codes 30 days past the owner's 90

- `MOD_DISPUTE_SEEN_DAYS` is 120: 90 plus 30.
- These are codes only, with no content, but they outlive the owner's "90 days after the dispute closes".
- A margin of a few days would be enough, since the API purges at 90 days.

### Note: the cost of timing over Tor

- **A cold re-read every time the worker starts:**
  - 100 envelopes per page. Each Tor round trip is about 1 to 3 seconds.
  - A 300-line chat is about 4 to 6 calls in a row (chat, attestation, 3 to 4 pages), about 5 to 15 seconds before old lines show.
  - The cap allows up to 1,000 old pages.
- **The sweep:** one `getChat` per stored chat, one after another, in the background. 50 chats means about 1 to 2 minutes of Tor traffic after the first open.
- **To soften it:**
  - Show the newest page first, then fill in backwards.
  - Run the sweep checks a few at a time in parallel.
  - Test the timing on a phone over Tor (the design flags this as `[unsure]`).

## Confirmed safe

- **The purge writes its order and marks atomically.** One CTE statement under `x2f_purge` does the delete, the order and the marks (`retention.ts` deleteChats). It runs after the existing row locks and the fresh re-read, so no chat is ever gone without its order and marks. The new grants are minimal: insert, plus select on the conflict-key columns.
- **The shred is transactional and idempotent.** Both deletes run in one transaction with rollback. The report is sent after the commit, so a failed report is simply retried and the deletes then find nothing. The API answers a repeat or unknown report with 201. The tests cover both.
- **No attacker can stop shredding for good.** Only a compromised API, which can simply stop serving orders, or one that keeps the watch list unreadable, can do it. Traders cannot, except with real disputes, whose holds end after 90 days.
- **The report path does not leak the chat code.** `{kind, chat}` goes only to the API, which already knows the code. No log line holds a chat or trade code.
- **The 410 versus 404 difference reveals nothing.** The tag is `sha256(chat|account)`, computed from the caller's own session. A stranger, or any unknown code, gets the same 404 after the same one extra query. Only a former member learns "purged", which they already knew.
- **The marks table cannot be enumerated.** A chat code has about 82 bits, and once the shred order is gone the code exists nowhere else. Confirming a guess needs both the code and the account id.
- **The device erases its copy on every route that can answer 410.** That covers `getChat`, the attestation, the envelope list, identity registration and posting a message (through `ChatSendFailed.cause`). A purged chat makes no new identity, because `getChat` runs before `ensureIdentity`. A 404 keeps the record, as the block design needs.
- **Same-seq substitution is blocked for v2 receipts.** Each receipt holds the Ed25519 envelope signature, and the guard is strictly increasing per sender. A replay at a new id, or another envelope with the same seq, is refused (test 353).
- **The v1 upgrade drops the text and saves the record back on first load.** This applies to both stores.
- **The device stores no message text.** Test 327 checks this.

## Re-verify 0d7e65f8 (cloud lead reviewer, 8-9 Nov)

- **Reviewer:** independent security re-verifier, read-only on the code (worktree /home/user/X2F/.claude/worktrees/chat-shred-2, clean, head `0d7e65f8`).
- **Scope:** `git diff 6bd6d27a 0d7e65f8` (commits `fb352557` moderation/API, `7ad097cc` web), read against the whole branch where needed.
- **Tests:**
  - web `test/chatEngine.test.ts`: **31/31 pass**.
  - moderation `test/shred.test.ts` and api `test/chat.test.ts`: **did not run**. Three attempts each died in globalSetup with `docker port ... no public port '5432/tcp' published`. The box's Docker is publishing no ports right now (the dockerd log shows `net=host`). Other helpers' DB suites fail the same way at the same time, so this is infrastructure, not the branch. They must be rerun before landing.
  - `tsc --noEmit` on apps/moderation, apps/api and apps/web: clean.

### Verdict

**APPROVED WITH MINOR.** I1, I2, I3, M1, M2, M4 and M8 are closed, and M3 is closed for every practical case. The fixes create no new Critical or Important. One new Minor (N1) is a gap left by the I1 fix, and it is cheap to close. Approval depends on the two DB-backed test files passing once Docker works.

### Findings I1-I3, M1-M8

- **I1: closed for the scenario reviewed.**
  - The API's watch list now names each trade's chat: `left join chats c on c.trade_code = t.code` (apps/api/src/internal/routes.ts:323). `chats.trade_code` is unique and set only once, from null (106_chat.sql:17; chat/routes.ts:183 `... and trade_code is null`), so honest relinking cannot happen.
  - `recordingLink` (apps/moderation/src/main.ts:582) records every watch read into `mod_chat_trade` and keeps the first link it sees: `on conflict (chat) do update set last_seen_at` only (main.ts:625ff). It also records moderation's own escalation reports before it sends them. `ESCALATIONS` (main.ts:26) matches the API's `escalate` kinds exactly (internal/routes.ts:253-262). The watcher, the shred pass and every report go through this wrapped link (main.ts:228).
  - `shredHold` (main.ts:648-667) looks the dispute up by the recorded link and the order's trade together (`= any`), so `trade: null` or another closed trade is `held-dispute`. A disagreement with the link is held as `mismatch` (main.ts:663). The shred deletes the link in the same transaction as the keys (main.ts:490).
  - Tests at shred.test.ts:231, 266 and 283 cover null, another trade, first-seen pinning, a list that drops the chat, and escalations. They could not be run (see above).
- **I2: closed.** A receipt that the read went past and could not reopen (envelope gone, or a different signature) now renders as a placeholder line with `missing`, its sender and its time (engine.ts:170, 185; ChatPanel.tsx:51, 221-236). The API has no per-envelope delete, so a placeholder appears only after tampering. Test chatEngine.test.ts:340.
- **I3: closed.** The per-chat session is stored only at the end of a read that went through (engine.ts:339). A throw leaves the chat cold, so the next sync reads from id 0 again and reopens the lines it already took from their receipts. Test :370.
- **M1: closed.** `CLOSED_STATES` is exported from packages/trade/src/machine.ts:189 and used at main.ts:667 and desk.ts:183. The tests now use the real states, including `lapsed` as open (shred.test.ts:329ff).
- **M2: closed.** On a re-read, an envelope at or below the cursor with no receipt is skipped before it is opened (engine.ts:301). Test :388.
- **M3: closed in practice.**
  - The engine is made when serveChat starts in the worker, and it sweeps at once (serve.ts:60). A 401 stops the sweep (engine.ts:393), and it is retried on the next chat message (serve.ts:70).
  - Residual: a user whose session is not live when the worker starts, and who then never opens a chat, is not swept in that worker. That is acceptable.
- **M4: closed.** Orders are served never-served first, then least recently served, and `served_at` is updated in the same statement (internal/routes.ts:428-434; migration 123 adds `served_at`). The internal listener runs as the API owner role, so `x2f_purge` needs no new grant. Test chat.test.ts:792.
- **M5, M6, M7: left open as the lead asked.** M5 is still an owner call.
- **M8: closed.** `MOD_DISPUTE_SEEN_DAYS = CHAT_AFTER_DISPUTE_DAYS` (main.ts:24). The row delete (`< cutoff`, main.ts:462-463) and the hold (`>= cutoff`, main.ts:660) use the same boundary, so a row is never deleted while it still holds. Test shred.test.ts:309.

### New findings

**N1 (Minor). A link can expire while its dispute is still being refreshed.**
- **Where:** main.ts:463 with recordLinks (main.ts:625ff).
- **How it works now:**
  - `mod_chat_trade.last_seen_at` is refreshed only when a watch item names the chat. An item with `chat: null` is skipped.
  - `mod_dispute_seen` is refreshed by the trade's `disputed` state, which needs no chat, and by moderation's own escalations.
  - The two rows expire separately at 90 days.
- **Scenario:**
  - The API is compromised during a dispute that lasts longer than 90 days.
  - From day X it lists trade T as `disputed` with `chat: null`, or moderation keeps escalating T.
  - At X+90 the link row is deleted, while T's dispute row is still fresh.
  - An order `{chat: C, trade: null}`, or one naming another closed trade, then has no candidates, or only an undisputed one. No mismatch is raised, and C's mod keys are shredded mid-case. This is the I1 outcome, after a 90-day wait.
- **Severity:** it needs a long compromise and a dispute longer than 90 days, so Minor.
- **Fix (one line):**
  - Expire a link only once its trade has no dispute row: `delete from mod_chat_trade m where m.last_seen_at < $1 and not exists (select 1 from mod_dispute_seen d where d.trade = m.trade)`. This stays bounded, because dispute rows themselves go at the same cutoff.
  - Or, in recordLinks, refresh `last_seen_at` by trade for every listed trade, whether or not it names a chat.
  - Add a test: a disputed trade listed with `chat: null` for more than 90 days, then an order with `trade: null`, must be `held-dispute`.

**N2 (Minor, copy rule). The new user-visible strings have no `COPY-UNSIGNED` marker.**
- **Where:** `MISSING_LINE` (ChatPanel.tsx:51) and the `' Sent '` / time suffix (ChatPanel.tsx:226-229).
- They carry only `not-a-refusal`. The wording is the owner's call.
- **Fix:** add `COPY-UNSIGNED` to both, and list the line for the owner's copy pass.

**Note (no action needed). An escalation is recorded as a dispute before the API accepts it.**
- `escalating` runs before `raw.report` (main.ts:582ff). If the API refuses an escalation, for example `wrong-state` on a trade already closed, that trade's chat keys are still held 90 days instead of 30.
- This errs toward safety, which is the right direction. It is mentioned only because it is a retention number.

**Note (no action needed). A cold read capped below the cursor drops lines without a gap mark.**
- A cold read that stops at `MAX_TOTAL_PAGES` (1,000 pages, about 100k lines) while still below the cursor records `reached` below the cursor. Warm reads then start at the cursor, so receipts between the two are neither reopened nor shown as placeholders.
- This only matters for chats of that size, so it can wait. A cheap fix: on a warm read, start at `min(session.reached, cursor)`.

### Checked and safe (no new problems)
- **The watch list's new `chat` field:**
  - It is parsed defensively (link.ts:167-176).
  - It is never logged.
  - It produces at most one row per trade, because `trade_code` is unique.
  - Moderation keeps it only until the shred, or for 90 days.
- **Honest API orders never hit `mismatch`.** The order's `trade_code` is taken from `chats.trade_code` at purge time. That column can never be rewritten, and the trade cannot be deleted first (foreign key).
- **The shred pass now reads the watch list on every pass that has orders** (main.ts:466-471). If the read fails, only orders that name a trade are held (`unknown`). A pre-trade chat with no recorded link still shreds without the read, which is right.
- **The cold re-read after I3 cannot double-take a line.** Lines already taken have receipts and are only reopened. The guard state and the cursor are saved per line as before.
- **Migration numbering (to renumber at landing, not a finding):**
  - API `123_chat_shred.sql` clashes with `123_pay_window.sql` on `wip/lead-launch-rules`.
  - Moderation `007_chat_shred.sql` clashes with `007_internal.sql` on `origin/wip/third-p4-task11`.
  - Both migrations here are unreleased and were edited in place. Renumber whichever lands second.

## Re-verify 0d7e65f8 -> 7bbda3ab (N1, N2, migration renumber; cloud lead reviewer, 9 Nov)

- **Scope:** `git diff 0d7e65f8 7bbda3ab` (commits `90af6b81` N1 + N2, `7bbda3ab` migration 007 -> 008). Worktree /home/user/X2F/.claude/worktrees/chat-shred-2, clean.
- **Tests:** moderation `test/shred.test.ts` **13/13 pass** (Docker works again; this also clears the "did not run" condition of the previous re-verify for this file). api `test/chat.test.ts` was not in this brief and was not run.

### Verdict

**APPROVED.** N1 and N2 are closed. The fix adds no new way to skip a hold. The renumbered migration does not depend on `007_internal`.

### N1: closed
- **The fix:** apps/moderation/src/main.ts:465. A link row is deleted only when its own 90 days are past (`last_seen_at < cutoff`) *and* its trade has no `mod_dispute_seen` row (`not exists ... d.trade = m.trade`).
- **Why this closes the 90-day scenario:**
  - In the same pass, dispute rows are deleted first with the same `cutoff` (main.ts:461-462).
  - `shredHold` holds on `last_seen_at >= at - CHAT_AFTER_DISPUTE_DAYS` (main.ts:662), and `MOD_DISPUTE_SEEN_DAYS = CHAT_AFTER_DISPUTE_DAYS` (main.ts:24).
  - So a dispute row that still exists after the delete is exactly one that still holds. While the dispute row exists, the link cannot be deleted, so the link stays a candidate. An order `{chat: C, trade: null}`, or one naming another closed trade, gets `held-dispute`.
  - This holds whether the dispute is kept fresh by `disputed` items with `chat: null` or by moderation's own escalations (main.ts:582ff), because both write the same table.
- **No new hold-skip:** the change only keeps rows longer and never deletes more than before. A kept link can only add a candidate (`dispute`) or a `mismatch` hold (main.ts:663-664), and both are holds. The shred's own delete of the link (main.ts:492) is unchanged and runs only after `shredHold` returned null.
- **Still bounded:** a link outlives its 90 days only while its trade's dispute row exists. That row goes 90 days after the dispute was last seen. The link then goes on the next pass whose pull succeeds. `mod_dispute_seen.trade` is the primary key, so the `not exists` is an index lookup.
- **Test:** shred.test.ts:329. It fails without the fix, by my reading: at day 100 + 1 ms the link (last seen day 10) would be deleted, so `trade: null` gets no candidates and `other` (released) passes every hold, and both orders shred. With the fix both are `held-dispute`, the link and the identity survive, and both rows go together at day 220.
  - Nit (no action): the clock in this test goes backwards. The disputes are recorded at day 130 and the shred runs at day 100, so `last_seen_at` is ahead of `now`. The assertions still prove the point (the link is 90 days old and is kept). A monotonic version would record the disputes at days 50 and 90 only.

### N2: closed
- `COPY-UNSIGNED` is now on `MISSING_LINE` (apps/web/src/chat/ChatPanel.tsx:50) and on the `" Sent <time>."` suffix (ChatPanel.tsx:228). The wording is unchanged. Both still need the owner's copy pass.

### Migration 007 -> 008: fine
- `7bbda3ab` is a pure rename (no content change). `git grep` finds no other reference to `007_chat_shred` or `008_chat_shred`.
- `origin/wip/third-p4-task11:apps/moderation/migrations/007_internal.sql` creates only `used_log_entries` and `mod_chat_seq`. `008_chat_shred.sql` creates only `mod_dispute_seen`, `mod_chat_trade` and an index on `mod_chat_trade`. The table sets are disjoint, neither file references the other's tables, and there are no foreign keys between them.
- The runner (apps/moderation/src/keystore.ts:56-75) applies every file not yet in `mod_schema_migrations`, in name order, not "everything above the highest applied". So a database that got 008 before Task 11 lands will still apply 007_internal later, with no problem.
- Only caveat (not a finding): a dev or test database that already applied the old `007_chat_shred.sql` would try 008 and fail on `create table mod_dispute_seen`. Neither migration is released, so recreate such databases.
