# Review round 2: Plan 2 Task 18 (team members), wip/lead-p2-task18 @6d6b8c8: APPROVED WITH MINOR

Reviewer: claude2 main session, read only (2026-10-30). Scope:
- the fix round 698039b, a973bbe, f51da49, the main-line merge e9e211e (5c4d35b), 2a08210 (docs) and 6d6b8c8 (44 px role rows, 24 px link tap box);
- each round-1 finding in `review-task18-2026-10-30.md`;
- the lead's security focus.

Test runs were in my own detached worktree `~/x2f-worktrees/rv-t18r2` @6d6b8c8, under `flock ~/x2f-comms/check.lock`, one at a time, after `npm ci`. The worktree was removed afterwards.

## Verdict: APPROVED WITH MINOR

- No Important finding.
- Every round-1 Important (I1, I2) and Minor (M1–M9) is fixed, and the missing e2e now exists.
- 4 Minors below. None blocks landing.

## Round-1 findings checked

- **I1 fixed.**
  - `events/bus.ts`: `memberSinks`. `publish` counts the owner's own streams only, and `delivered` is true only when the owner has a stream open. Members together can hold at most `perAccount - 1` slots.
  - `events/routes.ts:75` passes `{ member }`.
  - `take.ts` and `tradePublisher` still push when `publish(...) === 0`. Because only owner streams are counted, a member's tab no longer suppresses the owner's push.
  - Web: `App.tsx` `LiveAccepted({ member })` shows a notice sheet, never the AcceptedSheet.
  - Tests at team.test.ts:432, 447, 456 and 466 cover the bus, the slot and the push, including over the API.
- **I2 fixed (lead decision).**
  - `perms.ts` `ownerDeviceOnly` guards three routes: take (`take.ts:222`), `POST /v1/trades/:code/wallet` (the same `requireTrader`) and the identity route (`identity.ts:16`).
  - `fund-started` joined MEMBER_SIGNING_EVENTS, and the Tasks 38–39 events are audited.
  - On the web, `TradeRoom.tsx:241-242` waits for the session, so the escrow worker never boots on a member's device, and shows `MemberRoom`.
- **Tripwire.** NEEDS_PLAN3_TASK42_MEMBER_KEY (team.test.ts:750-770) reads only local files (`readFileSync`, `existsSync`, `readdirSync` under ROOT). There is no git and no remote, so it checks the local tree only. The web tripwire is the same.
- **M1 fixed.** `audit.ts` `auditMember` re-reads the member row `for share` inside the action's transaction and checks `ACTION_ROLE`. The table is a typed Record, so a new action that forgets its role fails tsc.
  - A removal or role change, both of which UPDATE that row, therefore either waits for the action or makes it roll back with 401 or 403.
  - Tests: :551 and :560.
- **M2 fixed.** `members.ts:213-216` closes every session's streams when Trades is dropped. Test :510.
- **M3 fixed.** The route-scan test (:643) has an EXEMPT list (feedback form, identity) and asserts the routes it must see. See n4.
- **M4 fixed.**
  - TRUNCATE is refused by a trigger.
  - `member_account_id` is now `on delete set null`, and a check keeps a live member's login from being deleted.
  - The limit (an owner role can disable the triggers) is stated in 015 and in the NEEDS_PLAN7 tripwire.
- **M5 fixed.** Migration 199's `after delete on trades` trigger is `security definer` with a fixed search_path and clears `trade_code`. The regex tripwire is gone.
- **M6 fixed.**
  - Removal deletes the member's login account (`deleteMemberLogin`, which only touches `kind='member'` rows); test :405.
  - The `purgeTeamLeftovers` retention job (:713) leaves an in-progress join alone: `createAccount` and the `member_account_id` update share one transaction, and `startMember` pushes `invite_expires_at` out to the end of the setup, so the job never closes a running sign-up.
- **M7 fixed.** A member's `GET /v1/wallets` drops `address` and keeps `addressEnd` (test :257).
- **M8 fixed.** The comment is corrected, and an API test refuses a member's discoverable passkey.
- **M9 fixed.**
  - (a) The invite confirm binds the name (`actionInput.ts` TEAM_NAME, `routes/team.ts:149`).
  - (b) A member's final-alert-seen is checked and audited but never sets `final_alert_delivered` (`trades/routes.ts` ~123).
  - (c) `kind='member'` sessions are refused (`sessions.ts:281-283`; test :697).
  - (e) The WebAuthn credential is stored inside the winning join transaction (`verifyWebAuthnRegistrationOnly`).
  - (d) still needs the lead or owner (Terms acceptance by members). It is unchanged and was not asked for.
- **e2e:** `apps/web/e2e/team.spec.ts` (550 lines) exists. I did not run Playwright: the lead says every check is green at 6d6b8c8.

## Security focus (checked)

- **Escalation to owner powers.** `requireSession` is still owner-only when `member` is left out.
  - The full list of member-allowed guards: offers (`offers`, and the browse viewer `any`), `trades` on trades routes, events, disputes, wallets GET and the identity read, and `any` on `/v1/account/me` and the feedback form.
  - Everything else stays owner-only:
    - wallets add/remove;
    - team routes;
    - login methods, Settings > Security, sessions and the Devices list, logout timer, login name;
    - confirm-it's-you, so a member can never get a confirm token;
    - blocks, nudges, push and alerts.
  - The main-line merge (Tasks 36–40, FU-D, reputation) added no member-allowed route except the confirmations GET (read only, `trades`).
- **Removal races.** Mid-request: M1 above. Mid-trade: the trades belong to the account, not the member. When a member is removed, their sessions are revoked and their streams closed after the commit (`removeMember`). Role drop: M2 above.
- **Privacy.**
  - Members see only `addressEnd`.
  - The audit detail holds ids and the dispute reason only.
  - A removed member's login (name, PGP keys, security keys, passkeys) is deleted.
  - `/v1/account/me` shows a member only their own methods.

## Minor

**n1. A wrong migration number in a comment** (`apps/api/src/team/audit.ts:7`). The comment says trade codes are cleared by "migration 116's trigger on `trades`". The trigger is in **199_team_audit_trades.sql**; 116 is Tasks 38–39's `fund_started`. A reader hunting for the R36 guard opens the wrong file. Fix: say 199.

**n2. A member's in-flight `confirm-cancel` writes before the live member check** (`apps/api/src/trades/routes.ts:168-179` against `:184`).
- For `confirm-cancel`, `recordReturnConfirmed` runs in its own write, before `applyEvent` and before `auditMember`'s `for share` re-check.
- Scenario: the owner removes a Trades member while the member's confirm-cancel request is past the gate. The event is refused and rolled back (M1), but `cancel_confirmable_at` (the 48 h start) has already been written.
- Impact is small: that write records X2F's own node count, which the watcher would record anyway (cancelReturn.ts). It is still the one member-route write that M1 does not cover.
- Fix: move the count into `applyEvent`'s transaction, or document the exemption next to it.

**n3. The member room offers none of the steps a Trades member may still take** (`apps/web/src/screens/trade/TradeRoom.tsx:242`, `MemberRoom` at :254).
- `perms.ts` and the lead's I2 decision say members "still mark paid, cancel, dispute and chat on the trades the owner's device set up".
- But `MemberRoom` shows only the StatusCard and "Waiting for the account owner's device. It sets up, secures and releases this trade." So in the web a member can do nothing on a trade, and the API allows more than the UI shows.
- If members should mark paid, note that the Tasks 38–39 two-step I've paid fixes the amount on the device that taps. The owner's device would then learn of paid only from the view (`paidRecorded` false), and the escrow already handles that case.
- Fix: either record in Plan 2 Task 18 and coordination.md that, until Task 42, members act on trades in the web only through the dispute screen or not at all (lead decision), or add the mark-paid, cancel and dispute actions to `MemberRoom` with tests. Not a security issue: the server rules hold either way.

**n4. The route-scan test only sees `app.<verb>('...')` registrations** (`apps/api/test/team.test.ts:656`).
- A member-allowed route registered on a differently named Fastify instance, through `app.route({...})`, or with a path held in a variable would not be scanned, and its missing `auditMember` would go unnoticed.
- Every route today matches, and the test's must-see list catches a refactor of the known ones.
- Fix: also match `\b\w+\.(get|post|put|patch|delete)\(` and `\.route\(`, or assert that the number of member-allowed routes found equals the number in a written list.

## Test runs (@6d6b8c8, rv-t18r2, under check.lock, one at a time)

- `npm ci` (npm 11.21.0): OK.
- `vitest run --project @x2f/api` on team, events-route, schema, purge and wallets tests: **5 files, 176/176 passed**.
- `tsc --noEmit -p .` in apps/api and apps/web: both exit 0.
- `vitest run --project @x2f/web` on team.test.tsx, team-tripwires.test.ts and tradeRoomEscrow.test.tsx: **3 files, 19/19 passed**.
- Not run: Playwright `team.spec.ts` and `login.spec.ts`, and the full check (the lead's helper ran them at 6d6b8c8).
