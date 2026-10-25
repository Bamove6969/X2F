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
