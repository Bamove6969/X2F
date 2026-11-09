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
