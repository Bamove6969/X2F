# Re-verify (trade-room part): `wip/lead-bans` 2ac92021, bans review MF1 and S1

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. Read-only on code. Detached worktree `rv-bans3`, fresh `npm ci`, removed afterwards; dockerd not restarted. One throwaway mutation of `banState.ts` was run and reverted.

**Scope.** Only MF1 (the site-ban gate per trade and chat) and S1 (the way back into the trade). Another reviewer's `re-verify-bans-2026-11-12.md` covers MF2 and S2-S6 at 105fc09d and was still in progress (placeholders) when I started. Two of its placeholders are answered here: the MF1 mutation check and the e2e defect.

**Commits:**

| Commit | What |
|---|---|
| 5b151773 | RED tests |
| 105fc09d | the fix |
| 2ac92021 | READY: changes only `apps/web/e2e/banned.spec.ts`, the URL regex in 3 places |

So the code at 2ac92021 is 105fc09d's.

## Verdict: PASS for MF1 and S1 at 2ac92021

## MF1: fixed at the cause, and the refused half is pinned
`siteBanAllows` (apps/api/src/banState.ts) now checks the specific trade or chat, not the route template:
- **Trade routes** (`GET /v1/trades/:code[/attestation|confirmations|dispute]`, `POST …/events|wallet|identity|chat|dispute|appeal`) pass only when `params.code`, normalised, is one of the account's trades that is open or has a dispute not `closed`. The review routes are not in the list.
- **Chat routes** (`GET /v1/chats/:chat[/attestation|envelopes]`, `POST …/envelopes|identity`) pass only for a chat of the account's that is joined to such a trade. An offer chat (`trade_code` null) never matches the join. Chat codes come from `newTradeCode()`, so `normalizeTradeCode` parses them.
- **`GET /v1/chats`** (the list) and `POST /v1/chats` (a new offer chat) are refused.
- **`POST /v1/nudges`** passes only when the body's `context` is such a trade or its chat. The nudge handler still checks that the recipient shares that context.
- The gate runs inside `requireSession`, after body parsing, so `req.body` is the parsed one. `HEAD` is mapped to `GET`.

**Red at 5b151773:** the MF1 test fails, but on its *allowed* nudge line (the old gate refused every nudge). So that run alone doesn't show the refused half bites.

**Mutation check.** I put the old route-wide semantics back in `banState.ts`: trade and chat routes passing on account-wide `hasUnfinished`, and `GET /v1/chats` added to the account list. Then I ran the MF1 tests:
- "MF1: an open trade opens only itself and its chat; a closed trade, its chat, an offer chat and the chat list stay 403 banned" **fails on the refused half**: `GET /v1/trades/<closed trade>` returned the full trade view (`expected false to be true`). So that test pins the per-trade check.
- "MF1: a closed trade whose dispute is still open …" still passed under the mutation. Once that dispute closes, nothing is unfinished account-wide, so it can't tell the two gates apart. That's fine: the first test carries MF1.

I reverted the mutation before the next run.

## S1: the person can get back into the trade and stay there
- **API:** `GET /v1/account/ban` returns `unfinished: [{ code, dispute }]` under a site ban (newest first). The account-wide reads the shell and the room need pass while something is unfinished: events, wallets (read), alerts, news, methods, price, currencies, hold, push, chat-keys, approvals.
- **Web:** `AccountBanned` lists each unfinished trade, linking `/trade/:code`, or `/trade/:code/dispute` when its dispute is open.
- **Inventory of what the room calls.** The trade room, the escrow runtime, the chat transport and the dispute screen call these, and every one passes the gate for an unfinished trade:
  - `GET /v1/trades/:code`, `/attestation`, `/confirmations`, `/dispute`;
  - `POST /v1/trades/:code/events`, `/identity`, `/wallet`, `/chat`, `/dispute`, `/appeal`;
  - `GET /v1/chats/:chat`, `/attestation`, `/envelopes`; `POST /v1/chats/:chat/envelopes`, `/identity`;
  - `POST /v1/nudges` with the trade's context;
  - `/v1/events`, `/v1/methods`, `/v1/account/chat-keys`, `/v1/account/me`.

  `GET /v1/site` is public (no session), so the gate never sees it. The room never calls the chat list; the only `/v1/chats` call in the web is `POST` for an offer chat, which is correctly refused. So nothing in the room is answered 403 `banned`, which is what would send the person back to the notice (`api/client.ts:158`).
- **Red at 5b151773:**
  - `bans.test` "S1, S3, S4": `GET /v1/news` was 403.
  - `bans.test` "S1: the notice lists …": `unfinished` was missing.
  - web `accountBanned.test` "review S1": no link was rendered.

  All pass at 2ac92021.

### The e2e (`apps/web/e2e/banned.spec.ts`): the defect, and its fix in 2ac92021
- The client sends a 403 `banned` to `/account/banned?returnTo=<here>`. At **105fc09d** the spec expected `/\/account\/banned$/`, so tests 1 and 2 failed at their first URL check. I ran it: 2 failed, 1 passed; `Received string: "…/account/banned?returnTo=%2Fsell"`. Test 3's `not.toHaveURL(/\/account\/banned$/)` passed vacuously, because a URL with a query never ends in `banned`.
- **2ac92021** changes the three patterns to `/\/account\/banned(\?|$)/`, so test 3 is now a real check. Run at 2ac92021: **3/3 passed**.
- At 5b151773 the same two tests fail on that same URL line, before they reach the trade link. So the e2e was never red for S1's own reason; the API and unit tests above are S1's red pins.
- **Note, not blocking:** the spec stubs the API, not the real gate. Every `/v1/**` call is 403 `banned` except the trade's own routes, events and `chats/*`, which answer 404. So "the room stays open" only shows the room makes no off-list call within 500 ms while its trade read 404s. It doesn't show a working room under the real gate. The API tests and the call inventory above cover that. Waiting on a specific request instead of `waitForTimeout(500)` would make it firmer.

## Tests run (serialised runner)

| Run | Result |
|---|---|
| At 2ac92021, `apps/api` `staff/bans.test.ts` + `banList.test.ts` | 47/47 passed |
| At 2ac92021, `apps/web` `accountBanned.test.tsx` + `tradeBanText.test.ts` | 7/7 passed |
| At 2ac92021, Playwright `e2e/banned.spec.ts` (`--workers=1 --trace off`) | 3/3 passed |
| Mutation (route-wide gate back), `bans.test` `-t MF1` | 1 failed (the refused half, as above), 1 passed |
| RED at 5b151773, `bans.test` `-t "MF1\|S1"` | 3 failed: MF1, "S1, S3, S4", "S1: the notice lists" |
| RED at 5b151773, `accountBanned.test` | 1 failed: "review S1" |
| RED at 5b151773, `banned.spec` | 2 failed (the URL-regex defect) |
| At 105fc09d, `banned.spec` | 2 failed (the same URL-regex defect, fixed in 2ac92021) |

Not run: MF2 and S2-S6's tests beyond these files (the other reviewer's scope), the rest of the suites, `npm run check`.
