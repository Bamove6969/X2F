# Review: wip/lead-p5t11-past-rep @ 56b82d4b (Plan 5 Task 11, moderator review of past-reputation claims)

Reviewer: independent helper (rev-p5t11), 20 Nov 2026, 06:25 BC time.
Base: origin/main 54104057 (the merge base). Commits: e887b557 (red tests), 91597402 (api), af73275b (staff-web), 56b82d4b (docs).

## Verdict

**APPROVE once M1 is fixed. No blockers.** M2 and M3 are owner questions and can follow in a later change.
The API side is tight. Every guard I removed failed a test, except one UI gate (m1). A concurrent probe showed that only one decision wins.

Not run: the full `npm run check` and the Playwright spec `apps/staff-web/e2e/pastrep.spec.ts`; I was told to run targeted vitest only. The 13 Nov reviewer rule still needs the lead's full check before landing.

## Tests run (targeted, `nice -n 10`, outside the lock)

- `@x2f/api`: `test/staff/pastrep.test.ts`, `matrix.test.ts`, `login.test.ts`, `members.test.ts`: 4 files, 243 passed.
- `@x2f/staff`: `packages/staff/test/roles.test.ts`: 94 passed.
- `@x2f/staff-web`: `test/pastRep.test.tsx`, `test/shell.test.tsx`: 2 files, 23 passed.
- `tsc --noEmit` for apps/api and apps/staff-web: clean. `copy-lint`: clean. semgrep is not installed on the box, so `tools/semgrep/pastrep-no-fetch.yml` did not run. By reading: `staff/pastrep.ts` imports no network module and calls no fetch.

### Removing the guards (each change reverted afterwards)

| Change | Result |
|---|---|
| `staff/pastrep.ts:168`: drop `status = $2` from the conditional UPDATE | 2 failed (a second approve and a revoke of a signed claim now succeed) |
| `:192`: drop the `fingerprintSeen !== true` check | 1 failed (P5-A23 test) |
| `:208`: revoke under `review` instead of `revoke` | 3 failed (mod revoke, matrix row, route/perm listing) |
| `:168`: drop the `tradesSeen <= claimed_trades` clause | 1 failed |
| `:135`: list under perm `self` | 4 failed (helper test, matrix GET and HEAD, listing) |
| `:180`: put "archive" into the log detail | 3 failed (no-link assertion in approve, reject and revoke) |
| `:152`: add a `challenge` field to the list item | 1 failed (exact item shape) |
| `PastRep.tsx:201`: plain `<a target=_blank>` instead of `ExternalLink` | 1 failed (rel assertion) |
| `PastRep.tsx:267`: Approve not gated on the tick | **0 failed** (see m1) |

Concurrency probe (a temporary test, not committed): two mods approving and a senior rejecting the same signed claim at once, 5 rounds. Every round gave `[200, 409, 409]` and exactly one `pastrep.*` log entry.

## Focus checklist

- **Permissions.** `reputation.review` is held by owner, senior and mod. The new `reputation.revoke` is held by owner and senior only, is not grantable (`GRANTABLE_PERMS` unchanged) and is excluded from helpers. All four routes sit in the matrix (`apps/api/test/staff/routes.ts:123-128`), and `assertRoutePerm` refuses a route without a declared perm. A helper gets 403 on every route. `NAV` and `NAV_PERM` are updated with tests. Staff accounts cannot hold claims: the trader routes are `requireSession({ kinds: ['trader'] })` (`pastrep/routes.ts:105`).
- **State transitions.** One conditional UPDATE `where id and status = from` (`staff/pastrep.ts:165-171`). The loser gets 409 `wrong-state`, an unknown claim 404, and a too-large `tradesSeen` 400. Approve and trader-remove, and revoke and figure-save, are covered by the same status predicates.
- **Audit log.** Exactly one entry per decision, in the same `withTx` (`:164-185`). The detail is `{claimId, accountId, site[, trades]}`: no link, fingerprint or reason. A failed decision logs nothing.
- **What the routes return.** The list has no key text, signature, challenge or PGP user ID, and the decision answers are `{id, status[, verifiedTrades]}`. The trader's display name is there, never the login name.
- **No fetch.** Covered by the semgrep rule and by the spy test (`pastrep.test.ts:251`), which spies on fetch, dns.lookup, dns.resolve and http/https request/get. The client uses `ExternalLink` with `target=_blank rel="noreferrer noopener"`, https only.
- **One key, two accounts.** The `past_reputation_one_account_per_key` trigger (`migrations/304_past_reputation.sql:46-63`) fires on `update of status`, so approve re-checks it under the advisory lock. A key may claim again after a revoke (J-21 test).
- **Self-review.** Nothing prevents it; see M3.
- **Copy.** Every new string is under `COPY-UNSIGNED` (`PastRep.tsx:11`, `StaffShell.tsx` label). No "!" or emoji. "At most the N the trader claimed." carries a `not-a-refusal` marker. See m2 for one inaccurate line.

## Findings

### Blockers

None.

### Major

**M1. Approved claims past the 100th can never be revoked from the page.**
- The list is oldest first with `limit 100` and no paging, cursor or search (`apps/api/src/staff/pastrep.ts:57`, `:145`).
- The signed queue drains, so the cap is fine there. Approved claims only grow.
- Once 100 exist, the newest approved claims are missing from "Approved claims" (`apps/staff-web/src/screens/PastRep.tsx:139-171`). Those are the ones most likely to need a revoke.
- Fix (engineering): page the `approved` list with a cursor, or order approved newest first, and add a display-name filter. Add a test with more than 100 approved claims.

**M2. The evidence link hides its URL. Owner question.**
- The moderator sees only "Open the archived profile" (`PastRep.tsx:201`), never the address.
- The archive host is checked (P5-A20), but the archived *original* site is not.
- A trader can archive a fake "LocalMonero" profile on their own domain. The Wayback raw mode (`/web/<ts>id_/…`) also drops the toolbar that shows the original URL.
- The moderator then compares a fingerprint on a page that only looks like the site.
- Recommendation: show the full URL as mono text next to the link, with the archived original host picked out. Optionally add a second tick, "The archived address is the real <site> site".
- This changes what staff see, so it is the owner's call.

**M3. A moderator can approve their own alt's claim. Owner question.**
- Staff accounts are separate from trading accounts (spec 6.x), so the database has no link between them. Nothing stops a moderator approving a claim filed by their own trader account, with `tradesSeen` up to the claimed figure.
- The backstops are a senior's revoke and the log, which names the reviewer.
- One cheap, exact check exists. A staff login can use PGP, and nothing stops a past-rep claim using a key that is a staff member's login key (`pastrep/routes.ts` never reads `pgp_keys`). Refusing an approve when the claim's fingerprint is one of the reviewer's own `pgp_keys` would catch the careless case.
- Recommendation for the owner:
  1. Add that check, and in Task 10 refuse a claim whose key is any staff or owner login key.
  2. Decide whether claims above some size need a second reviewer or a senior.

### Minor

**m1. Removing the tick gate on Approve fails no test.**
- `pastRep.test.tsx:83-90` and `e2e/pastrep.spec.ts:70-72` assert "disabled" only before the trades field is filled, never "trades filled, not ticked".
- The client always sends `fingerprintSeen: true` (`apps/staff-web/src/api.ts:259`), so the UI gate is the only thing that carries the tick's meaning.
- Add the assertion: trades `1240`, unticked, Approve disabled.

**m2. One message blames another moderator for every lost claim.**
- `PastRep.tsx:92-93` shows "Another moderator already decided this claim." for `wrong-state`, `not-found` and `not-live`.
- The trader can also have removed the claim, or a senior revoked it while a figure was being saved.
- Suggest "This claim changed meanwhile. The list is up to date again." (COPY-UNSIGNED).

**m3. A revoke overwrites the approver.**
- `reviewer_id` and `decided_at` are overwritten (`staff/pastrep.ts:166`), so the row loses who approved.
- The log keeps both actors, so this is fine if intended. Say so in the doc comment, or keep `approved_by` separately.

**m4. The log detail goes beyond the plan.**
- It adds `accountId` (`staff/pastrep.ts:180`, `log/actions.ts:180-182`), where the plan's Files line says `{ claimId, site, trades }`.
- This is harmless and useful for audit: the trader's account id, not a PGP user ID. The lead should note it as a deliberate change from the plan.

**m5. Lead defaults that the owner question list should carry:**
- revoke also needs a reason of 10 or more characters (the plan gives no minimum) (`:94-98`, `:210`);
- the 500-character cap (`:55`);
- `tradesSeen <= claimedTrades` (`:115-117`);
- moderators see `verifiedUsdCents` in the list without `reputation.verify` (`:150`).

**m6. The profile line is not tested here.**
- The plan's Step 1 wants a test that the approved claim shows "Verified: 1,240 trades on LocalMonero (PGP proof)" on the profile, and that revoking removes the badge.
- Nothing reads past rep into profiles yet (`traders/summary.ts:241` `pastRep: []`), so the test checks only that stats and badges do not move, plus the USD sum after a revoke.
- Carry it to Task 12 explicitly, as an `it.todo` or a tripwire, so it is not lost.

**m7. A cast hides the role type.** `role: req.staff.role as never` (`staff/pastrep.ts:182`) hides a type mismatch; type `decide`'s `req` with `StaffRole`.

## Owner questions (for the lead's page 11)

1. M2: show the archive URL and original host on the moderator page (recommended yes), and add a second tick for the original site.
2. M3: block a reviewer approving a claim backed by their own login key (recommended yes); refuse past-rep keys that are staff or owner login keys; decide whether large claims need a senior or a second reviewer.
3. m5 defaults: reason minimum for revoke, the 500-character cap, the trades ceiling, and moderators seeing the verified dollar figure.
