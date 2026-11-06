# Review round 2: Plan 3 Task 20 "rest" (chat: offer chats, trade chat, nudges, block wiring)

- Branch: `origin/wip/second-p3-task20-rest`. Reviewed first at 82c3e62 (a22b20c + the da2d3c9 merge), then, on the lead's order, at the new head **e614c21** (claude3: hand merges of 41acc5c and f13f574, Task 40 foldables). The verdict is for e614c21.
- Main line: f13f574 (contains 41acc5c). e614c21 contains the main line; `git merge-tree --write-tree origin/claude/compassionate-johnson-k95ssr e614c21` is clean (a2ec4b2). (82c3e62 against 41acc5c had one docs-only conflict in coordination.md; e614c21 resolved it.)
- Round 1: `~/x2f-comms/review-task20rest-2026-10-29.md` (f94acbe). Reviewer: read-only, 2026-10-30.

## Verdict: CHANGES REQUIRED

2 Important, 6 Minor. All of round 1 and the lead's 13:27 order are done and tested in code, and the
API side holds up: every chat route goes through the block check, the open-trade exception cannot be
borrowed (the linked trade must be the same pair's own trade, a take refuses a blocked pair, a closed
trade restores the block), and the retention / schema hand merges dropped nothing. Both Importants
come from the last hand merge (e614c21, TradeRoom.tsx took main's side): the chat e2e is red, and on
the wide (desktop) layout the trade chat's `#chat` links open nothing.

## Tests (detached worktree ~/x2f-worktrees/rv-t20r2, `npm ci`, every run under flock check.lock, one at a time)

At e614c21:
- tsc --noEmit: apps/api, apps/web, apps/moderation, packages/trade clean.
- api vitest (chat, nudge, nudge-delivery, purge, schema, block-tripwires, blocks, take, limits, retention, security-review, events, events-route): 13 files, 270/270.
- moderation + trade vitest: 14 files, 315/315.
- web vitest, full: 71 files, 1029/1029.
- **Playwright e2e/chat.spec.ts: 0/2 (both fail, see I1).** With the locator changed to the chat sheet (a local copy, `chatrv.spec.ts`, not committed) still 0/2: the sheet opens, but it holds the fixtures build's board stand-in chat (`installPayFixtures` → `setTradeChat(BoardChat)`, fixtures/payChat.tsx:51), not TradeChatPanel, so no real line ever appears. See I1.

At 82c3e62 (+ a trial merge of 41acc5c): tsc clean (api, web, moderation, trade, reputation); api vitest 11 files 231/231.

## Round-1 items

- **I1(a) verified.** Quote.tsx:255-264: the Chat button is `aria-disabled`, described by "Chat opens once the trade starts." (shown on tap); inbox + poster notice recorded as owed in coordination.md.
- **M1 verified.** engine.ts: `gapBefore: r.message.seq > (prev ?? -1) + 1`, so a first line above seq 0 shows the gap.
- **M2 recorded** (coordination.md, known limit of the moderator's evidence).
- **M3 verified.** ChatPanel.tsx: composer `readOnly` + `aria-disabled` while sending (never `disabled`) and refocused after a send (:167-173); only new lines from the other side are announced, in a hidden `role="status"` (:93-105, :224-226); each line reads "Name: text" (:215); the list is `tabIndex=0`, labelled "Messages" and kept at its newest line (:144-149, :195); waiting states in a status box (:227-229); chat.css `.x2f-chat__hidden` is the full pattern (clip, clip-path, nowrap, margin -1px).
- **M4 recorded** (retention, FK question, device copy). See also "Plan 7 seam" below.
- **M5 verified.** routes.ts:287 and :303 pass the viewer to `traderSummaries`; chat.test "hides the other side's online status from a trader they blocked".
- **M6 recorded** (intended for now; revisit with M4c and Plan 6's shared-device mode).
- **M7 verified.** limits.ts `KeyedBuckets`, CHAT_OPEN_BUCKET 20/h (reopen free), CHAT_POST_BUCKET 30/min, 429 `slow-down` + `retryAfterSeconds`, after the 404 and readiness checks; bounded key map with prune. Tests in chat.test and limits.test. ("slow-down" shows "You're sending messages too fast…".)
- **M8 verified.** Snapshot `more`; the panel shows "Loading more messages…" and re-syncs at once only while a sync still finds new lines (ChatPanel.tsx:115-116), so M10's pinned cursor cannot loop.
- **M9, M10 recorded** (coordination.md).

## The lead's 2026-10-29 13:27 order

- **Verified: a nudge from an offer chat linked to an open trade gets through a block.** nudge/wiring.ts:32-46 `chatSharedContext` answers `'open-trade'` when the chat is linked to a trade with `closed_at` null, `true` for a pre-trade chat, `false` for a chat whose trade closed or for anyone outside the pair; `productionNudgeWiring` (:60-64) runs the trade check first. nudge.test "under a block, a nudge from a chat linked to an open trade gets through like a trade nudge; a pre-trade chat's is dropped" (202 either way, nothing delivered for the pre-trade chat: no tell for the blocked sender).
- **Verified: chat API block checks.** routes.ts: `roleInChat` (:123) runs `assertNotBlocked` on every `/v1/chats/:chat*` route unless the linked trade is open; `POST /v1/chats` (:245) is the same 404 as an unknown offer, before `own-offer` and before the budget; `GET /v1/chats` (:281-282) leaves blocked chats out with the same open-trade exception; `POST /v1/trades/:code/chat` (:203) refuses a blocked pair once the trade closed. NEEDS_TASK_20_BLOCK retired; chat.test "blocks (Task 37)" covers all four.
- **Verified: chat UI block action.** ChatPanel.tsx:188 `BlockAction` under the notice, re-sync after a block, 404 → composer gone + "This chat has been closed."; NEEDS_TASK_20_BLOCK_UI retired (apps/web/test/block-tripwires.test.ts). Still valid after e614c21: ChatPanel is unchanged by the fold merge and the panel (with its BlockAction) is what the room's pane, the `#chat` sheet, BuyerPay's sheet and DisputeRoom all render.
- **Abuse of the open-trade exception: none found.** The exception keys on `chats.trade_code`, set only by `linkChatToTrade` (take.ts:306, in the take's transaction; and `POST /v1/trades/:code/chat` for a caller who is that trade's buyer or seller), and only for a chat with the same offer, buyer and seller as the trade. So nobody can link a chat to someone else's trade, and a stale (closed) trade restores the block. The take refuses a blocked pair (take.ts:247), so a blocked person cannot open a fresh trade to get the chat back. Notes N1/N2 below.
- **CantDoThat compliance.** The chat's codes are classified as faults/protocol state in `NOT_REFUSAL_CODES`; the one refusal (409 `own-offer`) opens CantDoThat (`CANT_DO_TITLE.chat`, `chatCantDoText`); the block refusal is BlockAction's existing CantDoThat. copy-lint passes in the web run.

## Hand merges

- **414e722 (666b6ea), d48033f (9af736a), 27e96df (a22b20c), da2d3c9 (82c3e62), 41acc5c (67f0d47): sound.** Checked with `git show --remerge-diff`. retentionJobs.ts: `[purgeExpired, purgeRemovedWalletAddresses, purgeTradeAddressesJob, purgeNudges, purgeChatsJob, purgeFeedbackForm]` (purgeChats then purgeFeedbackForm; nothing dropped), purge.test matches. schema.test: all three lists carry both `012_login_tags.sql` and `106_chat.sql`, matching the migrations directory exactly. quote-tripwires.test.ts deleted: both sides had retired their last tripwire (main NEEDS_TASK_20 → branch's chat; branch NEEDS_TASK_5 → main's take), right. chat.test: the `chat-unavailable` case was dropped because Task 5's `trades_offer_fk` makes it impossible (the 23503 catch at routes.ts:216 is now dead but harmless). coordination.md: nothing from main dropped; branch lines updated (NEEDS_TASK_20_LINK done, nudges, block UI).
- **f13f574 (e614c21): App.tsx sound, TradeRoom.tsx lost behaviour (I1, I2).** App.tsx keeps `setTradeChat(TradeChatPanel)` at module load with main's fold Layout (fine). TradeRoom.tsx took main's side: the branch's `#chat` section (TradeChatPanel under the screen, any layout) is replaced by main's `ChatHash` + the side pane, both fed by the seam (`useTradeChat()`, so the real TradeChatPanel). Phone, cover: `#chat` opens a Sheet; two/three/tabletop: the chat sits in the side pane and `#chat` focuses it; disputed: the room shows no chat, DisputeRoom renders TradeChatPanel itself. What was lost is below.

## Important

### I1. The real-browser chat e2e is red at e614c21, and the room can no longer reach the real chat in a fixtures build

`apps/web/e2e/chat.spec.ts:118-125`, `:154`; `apps/web/src/screens/trade/TradeRoom.tsx:270-272`; `apps/web/src/fixtures/payChat.tsx:51`.

Two things broke at the TradeRoom hand merge. (a) The spec locates `#chat`; nothing has `id="chat"` now (at 390x844 `ChatHash` puts the chat in a Sheet), so both tests fail with "element(s) not found". (b) Worse, pointing the spec at the sheet does not help (checked, 0/2): the room now takes its chat from the seam (`useTradeChat()`), and the e2e runs on a fixtures build, where `installPayFixtures` replaces `setTradeChat(TradeChatPanel)` with the board's stand-in `BoardChat` (the error context shows the dialog "Chat with mira.k" with the board's canned lines "Escrow is funded…" / "On it, sending now." and a "Nudge" button). The branch's old `#chat` section rendered `TradeChatPanel` directly, so it was the one place a fixtures build showed the real engine. chat.spec is the only test of the chat in a real browser (worker, IndexedDB identity, pinned moderation key, CSP); with it red or rewritten away, that coverage is gone. claude3 did not re-run e2e after this merge, and the main line must not take a red spec.

Fix (lead's call): drive chat.spec through a route that renders `TradeChatPanel` directly, e.g. a `disputed` seller view (DisputeRoom.tsx:9 imports TradeChatPanel itself, not through the seam), locating its chat section; or let the fixtures build keep the real chat when the spec asks for it (an init-script flag read by `installPayFixtures`, e.g. `window.__x2fRealChat`, so it skips `setTradeChat(BoardChat)`), then locate `page.getByRole('dialog', { name: /Chat with/ })`. Update the header comment (line 1, "the room's `#chat` section"). Run chat.spec, fold.spec and dispute specs before landing.

### I2. On the wide (desktop) layout the trade chat's `#chat` links open nothing

`apps/web/src/screens/trade/TradeRoom.tsx:333`: `if (!wanted || chatPane || layout === 'wide') return null;` and `chatPaneFor` (:306-308) gives no pane on `wide` (`hasPanes` is two/three/tabletop only, fold.ts:53). The links stay visible there (`data-chat-link` is hidden only while a pane shows): SellerRefund.tsx:63 and release/slots.tsx:42 (SellerConfirm/Released) point at `/trade/<code>#chat`.

Failure scenario: a seller on a laptop (≥1000 px, the wide layout) whose buyer has not paid opens SellerRefund and taps Chat to ask "did you send it?". The address gets `#chat`, nothing opens, and there is no other way to the trade chat from that screen. Same for the seller in `paid`/`settling`/`released`. Before e614c21 the branch's own `#chat` section showed the panel in every layout; on main alone this never showed because no real chat was installed. fold.test.tsx:48 ("shows only the screen … in the wide layout") pins main's choice, which was made without a real chat behind the seam.

Fix: let `ChatHash` open its Sheet in the wide layout too (drop `|| layout === 'wide'`; a screen that draws its own wide aside, BuyerPay, does not use `#chat` links), or give the wide room the chat aside; add a 1280x800 case in fold.test / chat.spec. Lead's call which; either way record it in coordination.md (the Task 40 note says `#chat` works "on a phone and on the cover screen" only).

## Minor

- **m1. purgeChats can delete a chat that changed after it was judged due.** `apps/api/src/chat/retention.ts:67-70`: the delete re-checks only "not disputed". A pre-trade chat read as 7 days idle, then linked by a take (take.ts:306) or written to in the gap, is still deleted: the new trade loses its pre-trade history (the room then makes a fresh chat) or a just-accepted line vanishes. The window is milliseconds every 10 minutes, so rare. Fix: in `deleteChats`, `select … for update` the doomed rows (same query as the scan) and re-run `due` on the fresh facts before deleting, or add the pre-trade condition to the delete (`and (c.trade_code is not null or coalesce(c.last_message_at, c.created_at) <= $2)` with the cutoff).
- **m2. The API chat block tripwire was deleted instead of kept as a guard.** `apps/api/test/block-tripwires.test.ts`: the take's check stays as a permanent "must call assertNotBlocked" assertion; the chat one was removed. A later chat route that forgets the check now passes. Fix: keep `expect(unchecked(sources(SRC + 'chat')).filter((f) => /routes/.test(f))).toEqual([])` as a permanent check (it is green now).
- **m3. `#chat` into a pane focuses nothing while the chat is still opening.** TradeRoom.tsx:316-331 `focusChatPane` looks for an input/textarea in the side pane once; ChatPanel renders its textarea only at phase `ready` (ChatPanel.tsx:246), after the resolve, identity and attestation round trips. With the real panel (the fold e2e uses the fixture chat, which has `#msg` at once) the focus is never moved. Fix: ChatPanel takes a `focusComposer` hint (or listens for a `x2f-chat-focus` event) and focuses its textarea when it mounts.
- **m4. coordination.md has stale chat lines.** The Task 20 section still says "Task 5 (lead) … Until then … 409 `chat-unavailable`" (Task 5 landed; the case is impossible now) and, in the Blocks note, "says 'This chat is no longer available.'" while the code (ChatPanel.tsx:47) says "This chat has been closed." (the same note's last sentence). Fix both sentences.
- **m5. The envelope budget is taken before the body is checked.** routes.ts:361 takes from CHAT_POST_BUCKET before `checkChatEnvelope`, so malformed posts (400/413) also use the sender's own budget. Harmless (own budget only) but surprising in a 429 after a client bug; move the `take` after the check, or say so in the header comment.
- **m6. Plan 7 seam (wip/lead-p7-retention, uncommitted in ~/x2f-worktrees/lead-p7-retention).** Its `RETENTION_JOBS` has no `purgeChatsJob` (it starts from the pre-Task-20 list) and its purge.test list likewise; whoever lands second must keep `purgeChatsJob` (before `purgeFeedbackForm`, and before `purgeTradesJob`, which deletes a trade's chat by `trade_code` and must find the grants of 106: `delete on chats` for x2f_purge is there). Its `packages/trade/src/chat.ts` edit (CHAT_AFTER_CLOSE_DAYS = DISPUTE_KEEP_DAYS, imports `./retention.js`) touches the same file as this branch's `chatIdentityProofValid` (different hunks; `index.ts` exports from both). The device copy (M4c) is still owed in either plan.

## Notes, not findings

- N1. The open-trade exception lasts as long as `closed_at` is null, which includes a lapse with funds still in the escrow. A blocked counterparty can keep writing and nudging until the trade closes. This is lead decision (a) as written; the blocker's way out is to finish the trade (or a dispute).
- N2. A pre-trade chat answers 404 the moment it is blocked, so the blocked person sees "This chat has been closed." right after a conversation, sooner than any 7-day purge could explain. That is a tell of the block, inherent in Task 37's 404 choice for chats. Acceptable; say so in the Block copy if the owner wants it honest.
- `POST /v1/trades/:code/chat` on an open trade under a block links and shows the pair's earlier pre-trade chat (hidden by the block until then). Same two people, same offer; fine.
- Privacy: the chat live event carries the chat code only and goes to the two traders; a nudge's push is the generic one; no route logs a chat code or ciphertext (chat.test "never logs"). Nothing new leaks through the block paths (a dropped nudge answers the same 202).
