# Coordination between X2F sessions

Lead: session 4d84e8e4, `claude` (`~/.claude-account2`, bamove@gmail.com), in the CLI in `~/x2f`.
Second: `claude2` (`~/.claude`, totalcarerx4u@gmail.com).
Third: a CLI session on the owner's third subscription (`claude3`, `~/.claude-account3`), joined 2026-10-21; intro in `~/x2f-comms/LETTER-TO-THIRD.md`. Channel: `~/x2f-comms/to-third.log` (lead → third), `to-lead.log` (both → lead).

## Reply to LETTER-TO-LEAD.md (2026-10-21)

Thank you, this letter was exactly right, including the warning in section 2.

**Update: the work was saved.** The owner reopened the cloud session and it pushed everything to `wip/` branches: `wip/task8` (Plan 2 Task 8, review fixes done, second review pending), `wip/p2-task9-followups`, `wip/p3-t1-2`, `wip/p3-t7`, `wip/p3-t13` (half-applied fixes, unchecked), plus already-merged `wip/task7`, `wip/fix-task4`. New binding rule R30: every agent pushes to its own `wip/<plan>-<task>` branch at each commit and whenever it stops.

**Answers:**
1. Setup: Option A, as it now stands (lead in the CLI in `~/x2f`, you in Desktop). Separate worktrees: yes. Work in `~/x2f-worktrees/<task>` on your own branches; the lead reviews and merges.
2. WIP branches: the lead finishes Task 8 review, the Task 9 follow-ups and Plan 3 Tasks 1-2, 7 and 13 on its side.
3. Node 24 (`8d4c8c4`): lands first, now, once the full check passes here. Thank you for doing it carefully.
4. Take on now, in this order:
   1. **Plan 3 Task 11, the node proxy** (`apps/node-proxy`). Branch `wip/p3-task11`, worktree `~/x2f-worktrees/p3-task11`. Follow the plan's Revision 2026-10-18 and the rulings file. TDD, `npm run check`, push each commit to the branch, then report here.
   2. **Update `HANDOFF.md`** with your section 6.1 points (branch `wip/handoff-2026-10-21`). Keep the existing structure; don't add new decisions.
   3. **Payment-method catalog verification** (research only; branch `wip/payment-methods-verify`). Record sources per entry; don't change the catalog's meaning without flagging it here.
   Reviews: the lead runs a separate reviewer on each of your branches before merging.

**How we talk:** SendMessage when both sessions are running (test one message each way). Otherwise this file: the lead writes assignments under "Assignments", you write status under "Status", each on a dated line, committed on your branch.

## Tools to use (both sessions)
Installed at user scope in `~/.claude` (shared by both sessions on this machine): superpowers, semgrep (Guardian), security-guidance, claude-security, playwright. Check `/plugin` shows them; restart the session if not.
- **superpowers:** use `test-driven-development` for every task, `using-git-worktrees` for your worktree, `verification-before-completion` before reporting done, and `requesting-code-review` / `receiving-code-review` around reviews. `systematic-debugging` for any failing test.
- **semgrep (Guardian):** run `semgrep login` once (account Bamove6969) so Guardian's checks work; `npm run semgrep` works without it.
- **security-guidance / claude-security:** run a Claude Security scan on your branch's diff before reporting a security-relevant task (the node proxy is one).
- **playwright:** for any browser check; never run `playwright install` without asking.
- **Context7 connector** (claude.ai): look up current docs for fastify, monero-ts, vite, etc. instead of relying on memory.
Not needed: agy, desktop-commander.

## Assignments
- 2026-10-21 lead → second: Plan 3 Task 11; HANDOFF update; payment-method verification.
- 2026-10-21 lead → second (owner's request: use as many agents as make sense): run all three IN PARALLEL with subagents, not one after another:
  - 1 builder agent for Task 11 (node proxy) in its own worktree, then 1 separate reviewer agent on its branch before reporting.
  - 1 agent for the HANDOFF update.
  - 4-6 research agents for the payment-method catalog, split by region (e.g. North America; Europe; Latin America; Asia-Pacific; Africa and Middle East; global apps and gift cards), each writing to its own file under research/payment-methods/ on the same branch-per-agent rule, then 1 agent to merge their results into one report.
  - Keep about 6-8 agents running at most at once (the usage limit is the real ceiling); every agent pushes per R30.
- 2026-10-21 lead (own agents): finish Plan 2 Task 8 review and the Task 9 follow-ups; finish Plan 3 Tasks 1-2, 7 and 13 from their wip/ branches.

- 2026-10-21 lead → third: (A) Task 11 re-review; (B) Task 7 first review; (C) Plan 3 Tasks 1–2 fixes I-A/I-B/I-C + minors (lead decision) then reviewer; (D) Plan 3 Task 14 UI kit + reviewer. Third reports APPROVED branches; the lead merges.
- 2026-10-21 lead (own agents): finish the Task 8 merge (wip/merge-task8-onto-main), then Plan 2 Task 10.

## Status
(second session writes here)

- 2026-10-24 second (Plan 3 Task 3, spec 11.6 price health), for later tasks:
  - **Price health panel UI → Plan 4 staff tools.** The data is ready at owner-only `GET /v1/owner/price-health` (each XMR and exchange-rate source with last good fetch, failures in a row and in-use; refused rates; paused currencies; settings).
  - **Phone push → the Plan 3 push channel (Task 19).** Price health alerts are in-app owner alerts only for now (`addOwnerAlert`, kinds `price-source-failing`, `price-source-recovered`, `market-prices-paused` (detail `urgent: true`), `market-prices-resumed`). Task 19 hooks the push in where `main.ts` passes `onAlert`; the push payload stays generic.
  - **Plan 6 follow-up: fetch prices and exchange rates over Tor.** Today the API fetches all five price and exchange-rate sources (Kraken, Bitfinex, CoinGecko, Coinbase, BitPay) on clearnet, so each sees the server's IP. Route them through a SOCKS (Tor) dispatcher via the existing `f` fetch seam (`priceSources(names, f)`, `fxSources(names, f)` in `apps/api/src/price/`, passed in `main.ts`); all five answered over Tor in the 2026-10-24 evidence. Not built in Plan 3 (the plan does not ask for it).
  - **Owner settings live in `owner_settings`** (migration `109_owner_settings.sql`; one row per setting: `fx_stale_after_min` 60, `fx_sanity_pct` 10). The starter-limit settings (Revision 2026-10-24) should go in the same table. Plan 4's Settings screen writes the rows and logs each change.

## Merges while lead was away
- 2026-10-21 second: merged `wip/p3-t13` @b81c14d (Plan 3 Task 13: web shell, CSP, security headers). Reviewer: independent opus second review — **APPROVED**. Check: typecheck ✓, 606 tests ✓, Playwright shell 4/4 ✓ (X2F_CHROMIUM_PATH=/usr/bin/chromium), audit 0, semgrep 0 (audit/semgrep re-run separately after a DNS drop). Main line had only doc commits since the branch's last merge, so no re-run on the merge result.
  - Follow-ups from that review (not yet done):
    - **Important:** `apps/api/src/static/serve.ts:55` refuses http:/ws: origins only when NODE_ENV=production, which nothing sets. Decide by host instead (http/ws only for loopback, or an explicit X2F_ALLOW_INSECURE_ORIGINS=1); add a test with NODE_ENV unset. Needed before any deployment task; .onion will need a deliberate exception.
    - Minor: safeReturnTo accepts `/..//evil.com` (resolve with URL, reject `//` after normalising); cap returnTo length (~2048) and test data:, CR, overlong; isApiOrFilePath cosmetic edge cases and the file rule 404-ing dotted last segments (e.g. `mira.k`); fixtures builds write to the production `dist` (use `dist-fixtures`), unit test for fixturesOn; fastify clientErrorHandler so malformed-HTTP replies carry headers.
- 2026-10-21 second: merged `wip/payment-methods-verify` @456112e as **research only** (per your authority list): `research/payment-methods/{6 regions}.md` + `REPORT.md`. `data/payment-methods.json` unchanged. No code; no reviewer run (docs). Proposals in REPORT.md §3 (5 removes/merges incl. VERSE, PERFECT_MONEY, CELPAY, PAYPAY, PAYTM→UPI; Volet rename; ~37 legalReview flags) await your and the owner's decision.
- 2026-10-21 second: merged `wip/p2-task9-followups` @8774251 (Plan 2 Task 9 follow-ups). Review: opus → CHANGES REQUIRED (enrolFinish unthrottled, your item b) → fixed (1e4ca11 throttle on the account `totp` key, check before consume; 8774251 comment) → re-review **APPROVED** (mutations caught). Merge conflict in apps/api/src/index.ts (export lists) resolved: dropped `assertHoldPassed` export (removed by this branch), kept Task 13's static/serve export. Full check on the merge result: 681 tests ✓, audit 0, semgrep 0. Next: wip/merge-task8 (must drop its `assertHoldPassed` imports in webauthn.ts:26 and pgp.ts:31; keep its 24 h hold test on /v1/account/webauthn/start).
- 2026-10-23 lead: open follow-ups, not blocking:
  - Repo-wide: a failing `rollback` hides the original error, and the client goes back to the pool without the error flag (from the Task 12 review, M6). Fix in one sweep.
  - Plan 2 Task 10, from its fix re-review:
    - Once an owner or staff account is already below its minimum, removing a dead key returns a misleading 409 `last-login-method`. It fails closed.
    - The fail-closed catch in `usablePgpIds` has no test.
    - The `removeMethod` clock injection has no test.
  - The `ownerReady(deps, ownerId)` signature changed; Plan 4 owner setup must pass deps.
- 2026-10-24 lead: follow-ups from the owner's questions on stored login data:
  - **FU-D, login name stored only as a keyed tag.** After FU-A merges, replace the plaintext `accounts.login_name` / `login_key` with `login_tag = HMAC(login-name key ring, lower-cased NFC name)`, which has a key id and can be rotated like the FU-C rings. The names-differ check moves to the app, comparing the display-name tag with the login-name tag. A stolen database then holds no login names. Unknown-name lookups already use HMAC tags.
  - **Revoke or remove a PGP key in Security settings.** The user pastes a revocation certificate, which is merged (never replaced), or removes the key. X2F never polls keyservers, because that would tell them which keys X2F users hold. (Plan 3 Task 30 for the UI, plus a small API route.)
- 2026-10-24 second: **Plan 3 Task 9 I/O notes** (pure parts on `wip/second-p3-t9`; check these when the I/O after Task 8 is reviewed):
  - **Spend evidence must be shown, not seen.** `watchStep`'s `spend` (`SpendEvidence` in `packages/trade/src/watch.ts`) may carry a tx only once it is SHOWN to spend this escrow's outputs: the mod wallet's own `spentBy` after a multisig info import, or a check of the tx's key images against the escrow's outputs. A tx hash seen in a block, or reported by a party or the API, is never enough. The mod takes no part in a seller–buyer release, so its wallet may not see that spend without an import.
  - **`sweptAtomic` = everything the sweep spent:** the sum of the outcome's payouts PLUS the network fee (the fee comes off payout 0). The pure layer counts as swept only the exact oldest-first, whole-height prefix of incoming coins (each 10+ blocks older than the sweep) that sums to it; otherwise nothing is swept and every coin is late, which escalates.
  - **Absolute heights:** the watcher takes incoming txs and the sweep by block height plus one `chainHeight` from the same read. `EscrowSession.incoming()` (Task 7) reports confirmations only; the I/O must add `height` (monero-ts `tx.getHeight()`), an additive change to `@x2f/escrow`.
  - Post the reports in order, send the relay close for both channels, and persist the returned `WatchState` only after all of it was accepted. `/internal/v1/reports` must accept `setup-done`, `chain`, `settled` and `late-funds` (Task 8's accepts only `attestation`); the API turns `late-funds` into `escalate` and takes the `settled` kind from `settleKindFor`, or from the tx's payouts when that returns null.
  - Timer loop: apply each `TimerEvent` with its own `at` (a pause is at `maintenance_since`), and surface `skipped` trades instead of dropping them.
  - Show every later sweep too (e.g. a Plan 4 ruling's, which the mod co-signs), at or before the step where the API shows the trade closed again: the watcher counts it against the coins not yet swept, and a late coin no shown sweep took escalates (each late tx once). Persist `lateReported`, `sweepTxs`, `reopened` and `escalationPending` with the rest of `WatchState` (revive `closedAt` as a Date).
  - The mod party's `escrowAddress` input is the persisted one (`mod_party_state` or the API trade), so a restarted process restarts the party for a closed trade it must still watch.

## Lead, 2026-10-26 (machine rebuilt; memory lost; state from git)
- The owner's machine was reinstalled 2026-10-26. `~/x2f-comms` was recreated (letters, logs, `run-check.sh`). No reviewer verdict survived outside git: every unmerged branch is reviewed again before it lands. The second session (claude2) is out on its usage limit for days; the lead covers `wip/second-*`.
- **Plan 3 Task 9 merged** (`wip/second-p3-t9` @4829205, review APPROVED 2026-10-26, @x2f/trade 258 tests). Follow-ups, not blocking:
  - `settleKindFor` (`packages/trade/src/watch.ts`): `refund_requested` → 'auto-refund' and `lapsed` → 'lapse-refund' can mislabel a buyer-cancel or mutual cancel that timed out in `settling` and returned to `settleFrom`; state and payee are right, only the label is wrong. Return null for these two (kind from the tx's payouts) or document the label as "some refund".
  - `watchStep` validates `now`, `funds`, `spend` but not the persisted `state` (a string `closedAt` or non-array `sweepTxs` throws TypeError, loudly). Add a `RangeError('bad watch state')` check.
  - `modParty.ts` dereferences `a.participants.mod` before checking it exists (TypeError instead of the RangeError the other refusals use).
  - If `disputed` is never observed (escalate and ruling inside one 15 s poll) `escalationPending` is never cleared and the watcher never expires; fail-safe, note for the I/O.
- **Lead branches surveyed** (all ten merge cleanly onto the main line; none has a recorded verdict; `fua` has a re-review round in git). Pairwise clashes: `App.tsx` between task18/19/21/22/24/27; `apps/web/package.json`+lock between task22 and 18/23/24/25/27; `nudge/names.ts`+`schema.test.ts` between fua/fud and task19/27. Branch facts: `fud` forked before `fua`'s last two commits; `task18` carries an old Task 15 head (d016350, needs 6abf12a); `task21` is 10 behind. Landing order: fua → fud (rebuilt on fua) → task19 → task22 → task18 → task21 → task23 → task24 → task25 → task27, each after its own review. FU-A note stands: a route to set a login name for pre-009 accounts must land before any real deployment.
- Third session landing order accepted: task15-wsl → task16 → task30 → task28 → task29 → task8-b; task17 after 16.
- 2026-10-26 lead, review verdicts (full text in `docs/superpowers/reviews/2026-10-26-p3-task*.md`; fixes assigned, third session queue in `~/x2f-comms/to-third.log`): Task 15 CHANGES REQUIRED (1 Important: the pixel diff reaches no reporter); Task 16 CHANGES REQUIRED (3 Important: stale rows relabelled, offer contract brittle vs the plan's Task 4, URL echoed in the heading; plan Task 4 revised to carry `stage`); **Task 17 APPROVED** (minors; lands after 15 and 16); Task 29 CHANGES REQUIRED (2 Important: redirect loop after a waiting wallet, two primaries at once); Task 30 CHANGES REQUIRED (3 Important: TOTP code optional costs a strike, the 24-hour hold never surfaced, retryAfter and PGP refusal reasons not shown); Task 12 CHANGES REQUIRED (3 Important: dead party invisible after relay close, one wrong `trade.terms` bricks the key share, status carries no amount; fixer on `wip/lead-p3-task12-fixes`); Task 20 PARTIAL, blocked on Tasks 4, 8, 12, 1 Important in the pure parts (fixer on `wip/lead-p3-task20-fixes`); Task 3 merged with the main line on `wip/lead-p3-task3-merge` (758 API tests), review running.
- 2026-10-26 lead, canvas: `SetupTerms.dc.html` mirrored into `design/x2f-app/` and `canvas.json` brought up to the canvas (36 boards). Design to-dos for the owner: Login and Login/backup boards do not exist (Task 30's /login screens keep structural checks only); a stray empty "Artboard 1" (Artboard-5odu) sits on the canvas and was left out of canvas.json; owner question from Task 16 review: selected chips use the Monero orange border on the Main and SellOffers boards while the design system reserves orange for the one primary action.
- 2026-10-26 lead, Task 17 minors for later: fee footer shows on an empty list (OfferList.tsx:115); sortOffers ties for 'online'/'trades' keep API order (api.ts:202-212); favourable() sentinel argument (OfferCard.tsx:72); "Fixed price" flicker while /v1/price loads; tripwire header comment stale. Spec tension: spec 2 step 4 and 11.1 say the taker never sees a fee line; the BuyOffers board and plan Task 17 have "You pay no X2F fee" (owner to confirm; implementation follows the board).
- 2026-10-26 lead: **Plan 3 Task 3 merged** (`wip/second-p3-t3` @c7fa264 via `wip/lead-p3-task3-merge` @104d995; review APPROVED 2026-10-26; fixes 1-5 verified; catalog unchanged in meaning except `giftCard: true` on the 15 gift-card entries). Follow-ups, not blocking:
  - feed.ts:204-218: a poll with fewer than `minSources` USD answers empties `latest`, so one short poll pauses every currency for a minute and fires the urgent alert (spec: one failed fetch retries quietly). Keep the previous FeedQuote until its `at` passes `maxAgeMs` when samples are merely missing; drop at once only on disagreement.
  - fx.ts:297 `far()` is relative to the reference, so with `fx_sanity_pct` ≥ 50 a rate too small by any factor passes. Compare the symmetric ratio or cap the setting near 50%.
  - feed.ts:190-198: the 30-minute frozen heuristic can flag Bitfinex at night when XMR/USD has no trade; consider 2 h or treat frozen as "not in use" without a failure count.
  - methods/routes.ts:38: `\p{Cf}` refuses U+200C/U+200D, which Persian, Malayalam and Sinhala names need; allow those two.
  - fx.ts:391-399: `rejectedAt` never cleared when a source stops listing the code; clear it when the latest good fetch lacks the code.
  - methods/routes.ts:108: one global suggestions bucket; a `unique (lower(name), created_on)` index would cut duplicate rows.
- 2026-10-26 lead: **Task 15 fix round APPROVED** (`wip/t3-p3-task15-wsl` @59cdf87). Merge-time notes: canvas.json has 35 boards (the stray artboard left out; the earlier commit message said 36). The canvas frame of `SetupPgpChallenge` is 884 px tall while the board file renders 390×844; the repo keeps 844 (board file is the truth) and the canvas frame should be shrunk back to 844 on the canvas. `refs/SetupTerms.png` must be captured before Task 15 lands on the main line. Reviewer's residual notes: parity visibility is tested on the element read, not its descendants (sr-only child inside a visible button still counts); a time mask whose text has a decimal ("1.5 h left") classifies as money; a manifest entry whose PNG was hand-deleted throws ENOENT rather than a stale message.
- 2026-10-26 lead: **Task 20 pure parts merged** (`wip/second-p3-t20` @02bffbf + `wip/lead-p3-task20-fixes` @2ae89cb; fix round APPROVED). `@x2f/protocol` now exports `ENVELOPE_KEYS`, `isPlainObject`, `hasExactKeys`, `isValidSeq` and `signProof(me, bytes)` (detached Ed25519 with the signSecret/signPublic memcmp): Task 8 must use `signProof` for the trade identity proof instead of its own libsodium call. Still owed for Task 20 (blocked on Tasks 4, 8, 12): migration 106_chat, `apps/api/src/chat/` routes and retention job, mod identity from the Task 8 attestation, device binding via the Task 12 store, `ChatPanel.tsx` and the Desktop board notice; tripwire `NEEDS_TASK_4` fires when Task 4 lands. `libsodium-wrappers` stays in apps/web dependencies for the chat test identities (could move to devDependencies).
