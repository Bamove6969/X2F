# Review: wip/lead-trades-list 8bf9adbf (D-005: GET /v1/trades and My trades), 12 Nov 2026

This is an independent review. I made no code edits. I used a throwaway detached worktree at
8bf9adbf (`npm ci`) and removed it afterwards. Every test run went under
`flock ~/x2f-comms/check.lock`. The diff against main 6ebed537 is 16 files, +1197/-10, in 5 commits
(251af175 and 802f2f1d red, 6825a3df WIP, 10db6dc7 READY, 8bf9adbf e2e).

## Verdict

**Not ready to land yet: one blocking item (B1), then approve once it and M1 are fixed.**

- **B1:** the new route is missing from the front-door matrix, so the API's front-door test fails
  on the branch.
- **M1:** a cursor that matches the format but holds an impossible date answers 500 instead of 400.

The access model is sound:

- A caller only ever sees their own account's trades.
- A team member sees each part (open or completed) only with the box for that part.
- Paging is stable.
- Each row carries only fields the trade room already shows that party, with the other trader by
  public name only.

No test was weakened.

## Tests run (under the lock, on 8bf9adbf)

| File | Result |
|---|---|
| api tradesList.test.ts | 6/6 passed |
| api frontDoor.test.ts | **1 failed** (B1): "every session-guarded route … is behind requireInside or is listed as own-data-only" |
| api coolingOff.test.ts, teamAbilities.test.ts, team.test.ts | passed |
| web tradesList.test.tsx, ui.test.tsx, wideShell.test.tsx | passed |
| Total (8 files) | 272 passed, 1 failed |
| `tsc --noEmit` apps/api, apps/web | exit 0 |
| Cursor probe (scratch test, not committed) | well-formed cursors with impossible dates → **500** (M1) |

**Not run: Playwright.** The box has no browsers installed. I read trades.spec.ts and the
shell.spec.ts change instead (see "E2E spec" below).

The READY commit lists the *web* frontDoor test as run, not the API's `apps/api/test/frontDoor.test.ts`.
That explains how B1 got through.

## Findings

### B1 (blocking; matrix): `GET /v1/trades` is not listed in `OWN_DATA_READS`

- **What is wrong:** the route runs behind `requireSession({ ...FINISH_OPEN_TRADES, member: TRADE_READ })`.
  That is a session guard but not `requireInside`. The front-door rule (review 2026-11-08 F2) says
  every such GET must be listed in `apps/api/src/auth/frontDoor.ts` `OWN_DATA_READS` with its reason.
  The tripwire fails as a result:
  `expected [ 'GET /v1/account/alerts', …(33) ] to deeply equal [ …(32) ]`.
- **Fix:** add a row, for example
  `'GET /v1/trades': 'my own account's trades (buyer or seller), newest first; members by the trades boxes per part; the other side by public name only'`.
- **Other lists:** nothing else needs a row. The hold and live-session lists cover writes only, and
  the team ability list did not change.

### M1 (minor; cursor validation): an impossible date in a well-formed cursor is a 500, not a 400

- **What is wrong:** `decodeCursor` checks the shape only (`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}`).
  The value then goes into `$4::timestamp`, and Postgres raises on it.
- **Probe results:** these cursors all answered 500:
  - `2026-02-30T10:00:00.000000|<code>`
  - `2026-13-01T…`
  - `2026-01-01T25:61:61…`
  - `0000-01-01…`
- **Impact:** low (no data leaks; it produces log noise and a misleading 500 for a client bug).
- **Fix:** before querying, reject a date that does not round-trip. Parse it as UTC, check
  `Number.isFinite`, and compare the formatted value back to the input. Add the four cases to the
  existing "refuses a bad … cursor" loop.

### m1 (minor; nav): a member with no trades box still gets a My trades tab that only leads to refusals

- **What is wrong:** `BottomNav` and `DesktopShell` show My trades to every session. A team member
  with only the Offers boxes gets 403 on both tabs: CantDoThat, then CantDoThat again, then /sell.
  The BottomNav comment cites design review 2026-11-01 shot 26: "no tab that only leads to a
  refusal". That is why Post offer is hidden from members who may not post (`postOffers`).
- **Fix:** gate My trades the same way. Pass `trades: mayReadTrades(session)` (owner, or a member
  holding `trades-see-active` or `trades-see-history`) and add a ui and wideShell case.
- **What already works:** the screen handles the case correctly (the e2e "refused both tabs" test
  pins it). Only the entry point is wrong.

### m2 (minor; robustness): the row link is built from an unchecked API string

- **What is wrong:** `trades/api.ts` `item()` accepts any non-empty `code`, and `TradeRow` links to
  `` `/trade/${t.code}` `` without encoding it.
- **Impact:** a lying API could send `../settings` and move the click elsewhere in the app. There is
  no cross-origin effect, and the room itself re-checks the code.
- **Fix:** in the parser, require the trade-code format (`normalizeTradeCode(code) === code`, as the
  room does), and use `encodeURIComponent` in the link.

### I1 (info; boxes): the list enforces "See active" and "See history" separately, but the trade room does not

- **What the list does:** it gives open trades only with `trades-see-active` and completed ones only
  with `trades-see-history`. That matches the boxes' wording, and the tests pin it.
- **What the room does:** `GET /v1/trades/:code` (`readTrade`, `member: TRADE_READ`) accepts either
  box for any trade. So a member with only See active trades can still open a completed trade's
  room by its code (from a push notification or an earlier link).
- **Status:** this was already on main and is not this branch's doing. The list is stricter than the
  room. To make the boxes mean exactly what they say, the room should apply the same split. That is
  the lead's call.

### I2 (info; paging semantics)

- **How paging works:** keyset over `(taken_at, code)`, descending, using `taken_at` to the
  microsecond (`to_char … .US`, compared through `at time zone 'UTC'`).
- **What is safe:** trades taken after page 1 appear only at the top on a fresh load, never inside a
  later page, so there are no duplicates. Ties are broken by code, and the tests pin that with three
  same-minute pairs at limits 1, 2 and 3.
- **The one edge:** a trade that closes between "Show more" calls moves out of Open and is not shown
  twice; it appears in Completed on the next load. That is acceptable.
- **The cursor itself:** it is not bound to the account or the tab. That is harmless, since it is
  only a position: the `where` clause still restricts the query to the caller's own trades.

### I3 (info; sessions)

- **Which sessions are allowed:** the list uses the room's own session set
  (`FINISH_OPEN_TRADES`: trader sessions, including recovery and held ones). So a recovery or held
  session can list completed trades too, not only open ones.
- **Why it is acceptable:** it matches `GET /v1/trades/:code`, which those sessions can already
  read, and there is no new data. Noted so the lead can confirm.

## The checks requested

- **Only the caller's own trades:** yes. The query filters
  `(t.buyer_account_id = $1 or t.seller_account_id = $1)` with `$1 = req.auth.accountId`, which for
  a team member is the team account. `role` is derived per row. A stranger's trade is never listed
  (tested).
- **Team-member abilities per tab:** yes.
  - The route guard is `member: TRADE_READ`, so a member with neither box gets 403.
  - `partsFor` then filters by box, and asking for a part without its box is 403 `forbidden`.
  - With no `status`, only the parts the member may read are returned.
  - Tested for active-only, history-only, both, and Offers-only. See I1 for the room.
- **Cursor validation and stable paging:**
  - Base64url, at most 128 characters, a strict inner format, and the code must be normalised.
    Length, alphabet and garbage are refused with 400 (tested). The exception is M1.
  - Paging is stable (I2).
  - `limit` must be 1..100 as an integer string, and duplicate or array query values are 400.
- **No other trader's private data:**
  - The fields are code, role, state, amount, fiat total, currency, the counterparty's
    `PUBLIC_NAME_COLUMN`, takenAt and closedAt.
  - Not included: the fee, addresses, payment instructions, tx hash and login name. The test also
    checks that the response body contains none of these words or the seeded addresses.
  - The web parser keeps only `counterparty.displayName`.
  - The R36 retention deletion leaves no stub (tested).
- **Matrix rows:** missing (B1). Nothing else is needed.
- **E2E spec trades.spec.ts (read, not run):**
  - It covers both phone viewports (`PHONE_VIEWPORTS` 390x844 and 360x800), `expectPhoneLayout`, and
    44 px targets on the tabs, row links, Show more and the five-tab bar.
  - It covers the row wording, Show more following the cursor, the tab kept in the URL across a
    reload, a row opening the room, both empty tabs, a failed load with Try again, a failed Show more
    keeping the rows, a member refused Open (OK moves to Completed), and a member refused both tabs
    (ends on /sell, no loop).
  - The stubs follow the API's shape, and the API test checks that shape against the real route.
  - Gap: no case for a member who lacks both boxes seeing (or not seeing) the tab entry (m1).
  - Note: the stub codes (`K7Q2-9XPA`) are not real trade-code format. If m2's parser check is
    added, the e2e fixtures need real codes.
- **No weakened tests:**
  - The existing tests changed only to add "My trades" to the expected nav lists (ui.test.tsx ×3,
    wideShell.test.tsx ×3, e2e shell.spec.ts ×1). One wideShell title was reworded to say so.
    Nothing was removed or loosened.
  - parity.spec.ts's rail check compares the Desktop board's texts (which have no My trades) and
    `missingTexts`, so the added link does not affect it, and it is unchanged.
  - Red commits came first: 251af175 for the API and 802f2f1d for the web.

## To land

1. B1: add the `OWN_DATA_READS` row, then rerun `apps/api/test/frontDoor.test.ts`.
2. M1: reject impossible cursor dates with 400, and add the probe cases to the test.
3. Recommended: m1 (gate the nav entry) and m2 (check the code format and encode the link).
4. Lead's call: I1 (apply the per-part boxes in the trade room too).
