# Re-verify: batch 10a round 2, wip/lead-batch10a 846d83ba..ea5fc7bd (security), 17 Nov 2026

**Verdict: APPROVE on the code, with the tests not yet run.** I read every changed line and found no way past the ban gate, no leak in the trades list, no stale, missing or duplicated ban from the session query, no weakened flows check and no lost change in the merges.

**None of my targeted tests ran.** The run waited 2 h on ~/x2f-comms/check.lock behind several full `npm run check` runs. The 2 h background limit then stopped it without the lock ever being taken (log rv10a-r2-api.log is 0 bytes). By that limit's rule I did not restart it. So there are **0 counts** from me.

- **Before landing, these must pass:**
  - the cloud runner's full check at ea5fc7bd;
  - my probe file comms/rv10a-r2-probe.test.ts.txt, saved as apps/api/test/staff/zz-rv10a-probe.test.ts (it has not run anywhere yet).
- **Open points:** one open question (OQ-1, bound-session renewal) and one minor (M-1, the freeze view). Neither blocks landing.

- **Scope:** `git log 846d83ba..ea5fc7bd`, 7 commits:
  - 46780469: the ban read in the session query;
  - a1a75df1: the ban gate;
  - 141db95a and ea5fc7bd: the flows.test exemptions;
  - b7a6b113: docs only;
  - eb4f9bf1 and e4581c83: the tripwire-2 and tripwire-3 merges.
- **What I read:** every changed line in apps/api/src, apps/web/src/session/useSession.ts, apps/web/e2e/banned.spec.ts, packages/auth-client/test/flows.test.ts, and the new describe in apps/api/test/staff/bans.test.ts. I also read the handlers the widened gate now lets through: proofs/routes.ts, proof/blurCheck.ts, the freeze route in disputes/routes.ts, auth/deviceBound.ts and trades/list.ts.
- **Inputs:** batch10a-2026-11-12.md section 7, review-proof-tripwire-3-2026-11-13.md, and the round-1 reviews on comms.
- **Worktree:** /home/user/X2F/.claude/worktrees/rv-batch10a-r2, detached at ea5fc7bd. Its node_modules was removed afterwards.

## 1. a1a75df1: the ban gate

### Gate and handler, route by route

For each route the call opened, I checked how `siteBanAllows` (banState.ts) matches it, and whether the handler stays inside the trade the gate looked at.

| Route | Gate scope | Handler scoping (why passing the gate on trade A cannot reach trade B) |
|---|---|---|
| GET /v1/account/freeze | ACCOUNT (`hasUnfinished`) | `where h.account_id = $1`: only the caller's own freezes |
| GET /v1/trades | ACCOUNT | The caller's own trades, plus `and (not $7 or UNFINISHED_SQL)` while banned |
| POST /v1/account/session/proof, /challenge | ACCOUNT | Only `req.auth.sessionId`: the caller's own session cookie |
| GET /v1/trades/:code/blur-checks | TRADE (a party, and the trade is unfinished) | `sideOf(code)`, then asks `where trade_code = code and side = …` |
| POST /v1/trades/:code/blur-checks/:proofId | TRADE | `delete … where trade_code = code and proof_id = … and side = …` |
| POST /v1/trades/:code/proofs/:proofId/blur-check | TRADE | `isStoredProof(c, code, proofId, side)`; any other id is 404 |
| GET /v1/trades/:code/proofs/:id | TRADE | Party check on `code`; `readableProof` has `trade_code = $2` |
| PUT /v1/trades/:code/proofs/:id | TRADE. The gate runs in the onRequest hook too, before the body is read | `for update` on the party's row of `code`; the kind and state rules are unchanged |

- **Code spelling:** the gate and every handler normalise the code with the same `normalizeTradeCode`.
- **Route spelling:** `req.routeOptions.url` is the registered spelling: `proofs/:id` for GET and PUT, `proofs/:proofId/blur-check` for the announce. The regexes match these, and the blur-check regex accepts both param names. HEAD maps to GET.
- **The regexes are anchored.** By reading ALWAYS, ACCOUNT, TRADE and CHAT against the routes the trader app registers, no other route matches.
  - The probe's first test makes this mechanical: it puts every trader route through `siteBanAllows` with params on an open, a closed and a third party's trade.

### Trying to get past the gate (from the code; the probe pins each)

- **Someone else's trade, a finished trade, an unknown code:** `unfinishedTrade` requires both party and UNFINISHED_SQL. Every TRADE route is therefore 403 `banned`.
  - The builder's test covers this for all four new trade routes plus PUT, on a closed trade, a third party's trade and a random code.
- **A finished trade's proof through the open trade's code:**
  - GET …/OPEN/proofs/<closed trade's proof id> is 404, because `readableProof` is keyed on code and id.
  - The blur-check announce is 404, because `isStoredProof` is keyed on code and side.
  - Answering is 404, because the ask's delete is keyed on the code.
  - The closed trade's own URL is 403 `banned`.
- **Offers, posting, taking, My offers, PATCH an offer:** these match no list, so they are 403 `banned`. The builder's fourth test pins this.
- **Everything else is still 403 `banned`.** The gate's lists did not change apart from the 7 additions, so all of these still fall through to `return false`:
  - the chat list (`GET /v1/chats`) and new chats (`POST /v1/chats`);
  - payouts and wallet writes;
  - settings, profile, blocks and notes;
  - team, review and past-rep;
  - nudges outside an unfinished trade.
- **Nothing unfinished:** every ACCOUNT route, the 3 new ones included, needs `hasUnfinished`. Only the five ALWAYS routes pass. The builder's second test checks freeze, the list and the proof pair against an idle banned account.
- **Races:**
  - *A ban placed mid-request:* the ban is read in the session query, so a request already past that query is served as unbanned. The old separate read had the same window, one query later. Not a regression.
  - *A ban lifted:* the next request's session query finds no row, so `siteBanned` is unset and the list is full.
  - *A ban placed between two list calls:* the next call is restricted.
  - *A timed ban past `until` but not yet settled* (`ended_at` null): the lateral join reads `until > now`, so the gate is off and the list is full. This is the same as the old `activeBans`.
  - *A trade closing between the gate and the handler:* what is left (reading a proof, answering or announcing a blur check) finishes something and starts nothing. PUT checks the state again under the row lock, so a `proof` on a closed trade is 409 `wrong-state` regardless of the gate.
- **`siteBanned`:** it is set only when `row.kind === 'trader'` and a site ban is in force, so team members' sessions are covered (they are rows of the team account). The list passes it as a bound boolean, and UNFINISHED_SQL is a constant, so there is no injection.

### The trades list leaks nothing more

While the caller is site-banned, the list returns only their own trades that are open, or closed with a dispute not closed.
- **`status=completed`:** only the disputed ones (builder's test), or none when there are none.
- **Paging:** the filter is in the same `where` as the cursor and the `limit + 1` read, so `next` cannot step past it.
- **Fields:** unchanged, and the same ones the trade room already shows (counterparty display name, amounts, state, times).

### Bound-sessions renewal (the builder's open point): confirmed, OQ-1

- **Order of checks:** in `requireSession` the S-085 bound-cookie check (401 `session-proof-required`, sessions.ts ~503) runs before the ban gate (~517). The proof pair is in ACCOUNT.
- **Effect, once `deviceBoundSessions` is on:** a site-banned person with nothing unfinished gets 403 `banned` when the app tries to renew.
  - Their ban notice stops loading after BOUND_TTL_MS (10 minutes) and the app falls back to the login. Each fresh login gives another 10 minutes.
  - The same happens to someone whose last trade finishes while the page is open.
- **Not a security hole:** the pair only renews the caller's own cookie and starts nothing.
- **Why it is a question:** moving the pair to ALWAYS changes what a banned person experiences, so it is OQ-1 below. The flag is off today, so it does not block landing.

### M-1 (minor, information only)

- **The finding:** while banned, the freeze read returns each freeze's dispute: code, incident ID, side, amount and partner name. It does so even when the freeze came from a trade that has since finished. The trades list, by contrast, is restricted to "no other history".
- **The impact:** this is the account's own data, and lead call 1 allowed the freeze read as it is. It is an inconsistency, not a leak about anyone else. See M-1 below.

## 2. 46780469: the ban read in the session query

- **No duplicated session row:** the lateral subquery has `limit 1`, so it adds at most one row per session row. The left join keeps sessions that have no ban. Also, migration 560's `account_bans_one_standing` (unique on `(account_id, kind)` where not ended and not lifted) allows at most one matching row anyway.
- **No stale ban:** the filter is exactly the old `activeBans(...).find(kind === 'site')`: kind `site`, `ended_at` and `lifted_at` null, `until` null or `> $2`.
  - `$2` is `deps.clock()`, the same clock as before. It is now read just before the query rather than just after, a difference of microseconds.
  - A trade ban cannot come through, since the kind is `site` only. A trade ban alone still does not gate anything (the gate tests `site_ban_reason`).
- **No missing ban:** every trader request still runs the session query. The gate condition is `row.kind === 'trader' && site_ban_reason !== null`, and `reason_code` is `not null` with a check constraint in migration 560, so a standing site ban always shows.
  - The 403's reason and end come from the same row: `reason_code` and `until`.
  - A member's session joins on `s.account_id`, which is the team account, as before.
- **`siteBan()` is removed.** It had no other caller. `activeBans` stays for the trade-ban refusals.

## 3. 141db95a and ea5fc7bd: the flows.test exemptions

Every new entry is a route that only apps/web calls. There is no auth-client method for any of them: `grep` of packages/auth-client/src finds none.

| Entry | The web caller I found |
|---|---|
| GET /v1/account/ban | apps/web/src/screens/account/AccountBanned.tsx:107 |
| GET /v1/trades | apps/web/src/screens/trades/api.ts:83 |
| GET /v1/trades/:code/proofs/:id\|:proofId | apps/web/src/screens/proof/ChatProof.tsx:66 |
| PUT /v1/trades/:code/proofs/:id\|:proofId | apps/web/src/proof/upload.ts:224 |
| POST /v1/account/session/proof, /challenge | apps/web/src/session/deviceKey.ts:180, 156 |
| POST /v1/trades/:code/proofs/:id\|:proofId/blur-check (spelling only, from 846d83ba) | apps/web/src/api/blurCheck.ts:23 |

- **Each entry names its calling module** in a comment.
- **The test's checking power is unchanged.** In 846d83ba..ea5fc7bd only the list and its header comment changed. The three `it` bodies (flows.test.ts:180-200) are untouched:
  - every method reaches its own route;
  - every route has a method or an exemption;
  - the exemptions all exist, sorted and once each.
- **The spelling `:id|:proofId` is pinned:** a wrong spelling would fail "lists only routes that exist".
- **No new trade-off:** an exemption covers its route for any later caller too. That is how the list already worked for the earlier web-only routes.

## 4. eb4f9bf1 and e4581c83: the tripwire merges

- **Parents:** eb4f9bf1 = b7a6b113 + ef27cf31; e4581c83 = eb4f9bf1 + ff051b73. These are the approved SHAs.
- **eb4f9bf1:** its tree (9aa35c3b) equals `git merge-tree --write-tree` of its parents, so there is no hand edit.
- **e4581c83:** the only combined-diff hunk is apps/web/src/session/useSession.ts.
  - Against our side, the resolution adds tripwire-3's `forgetLocalSession` import.
  - It replaces `setSessionGoneListener(sessionEnded)` with a listener that runs `forgetLocalSession()` and then `sessionEnded()`.
  - `sessionEnded` still calls `stopProofRefresh()` (device-bound), and `load()` still calls `startProofRefresh()`.
  - Both sides' behaviour is kept and nothing is lost. Doing the forget first is right: drafts, sent-proof ids and chat snapshots are cleared before the screens switch to signed out.
- **Tests:** the web tests for this (sessionForget.test.tsx, the deviceKey tests) are in the cloud full check, not in my targeted list.

## Counts

| Run | Result |
|---|---|
| API (under `flock ~/x2f-comms/check.lock timeout 3000`): staff/bans, the reviewer probe, sessions, sessionLength, tradesList, news, banList, deviceBound, proofs, blurCheck | **Did not run.** Queued 08:01 UTC (01:01 BC). The background limit stopped it at about 10:01 UTC (03:01 BC), still waiting for the lock. Not restarted. |
| auth-client flows.test (same script, after the API run) | **Did not run** (the same job). |
| Typecheck, lint, Playwright | Not attempted; they are the cloud runner's full check. |

**Reviewer probe** (comms/rv10a-r2-probe.test.ts.txt; it has not run). It has 5 tests:
1. A sweep of every trader route through `siteBanAllows`, for an open trade, a closed trade, a third party's trade and an idle account.
2. A closed trade's proof reached through the open trade's code, plus lowercase codes.
3. The list restricted when the ban is placed and full when it is lifted, `limit=1` paging, and a timed ban past its end but not settled.
4. A trade ban and a site ban together: the 403 carries the site ban's reason and end, and the session row count is unchanged.
5. An HTTP sweep of every trader route on a closed trade's code. It writes a list of the routes that were not banned to `$RV_PROBE_OUT.http`, for review.

## Open questions

- **OQ-1 (lead or owner): should the proof pair be in ALWAYS?** That is, should a site-banned person with nothing unfinished keep their ban notice past 10 minutes once bound sessions are on? Recommendation: yes, move `POST /v1/account/session/proof(/challenge)` to ALWAYS. It renews only the caller's own cookie and starts nothing. It does not block landing while the flag is off.
- **M-1 (lead): the freeze read and the trades list disagree.** While banned, the freeze read can name a finished trade's dispute, which the trades list hides. Recommendation: accept it, since it is the account's own freeze notice. Trimming it would change what users see.
- **To the lead:** before landing, run my probe and the targeted list above, or rely on the cloud full check plus the probe. I could not get the lock in 2 h.
