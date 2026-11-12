# Security review: freeze D-013..D-016 (wip/lead-freeze b05777cf), 12 Nov 2026

Independent security review for the lead (disputes and staff powers). Branch b05777cf on main
6ebed537 (13 files, +371/-36). Worktree /home/user/X2F/.claude/worktrees/freeze. No code edits.

## Verdict

**READY to land.** No must-fix. No path can still place a freeze through a ruling. The new
read route returns only the caller's own active freezes, with no reason, no placer and nothing
about the partner beyond the public name. FrozenWatch cannot loop. The existing freeze route is
unchanged. There are two medium findings. F1 is mostly a gap that was already on main, which this
branch makes visible. F2 is a small redirect edge. Neither blocks.

## Checks run

- Runner, API: disputes/staff, staff/keyTap, frontDoor, disputes/trader: 4 files, 97 passed,
  1 todo, 0 failed.
- Runner, packages/staff (all 8 files): 207 passed, 0 failed.
- Runner, web: accountFrozen, frontDoor: 2 files, 88 passed, 0 failed.
- semgrep (p/typescript, p/nodejs, p/secrets, tools/semgrep) on the 13 changed files: 0 findings.
- dockerd was not touched.

## 1. No freeze through a ruling

- **Machine** (packages/staff dispute.ts `validAction`): only `none`, or a trade/site ban with
  the exact keys, passes, so `{kind:'freeze'}` is `invalid-action` at propose (tested).
  `AccountAction` no longer has a freeze variant, so code that builds one no longer typechecks.
  `actionPerm` maps anything other than `none` to `accounts.ban`.
- **Signed intent** (apps/api staff/keyTap.ts `accountAction`): only `none` with exactly
  `['kind']`; everything else must be a trade or site ban with `kind`, `until` and `reasonCode`.
  `freeze` is refused at `taps/start` (tested).
- **Replays of old signed intents.** A tap is consumed by comparing the intent the route rebuilds
  from its request against the stored one. That rebuild goes through the same parser, which now
  refuses `freeze`, so an unconsumed pre-deploy tap with a freeze ruling can never be consumed.
  Taps are short-lived anyway. No API or moderation route consumes ruling taps yet (no
  propose/approve route exists; `applyDispute` is called only for assign, reply, appeal and
  window-closed). No executor anywhere acts on `accountAction.kind === 'freeze'`. A grep of apps/
  and packages/ finds no `'freeze'` kind literal left, apart from the separate freeze route's
  `trading_holds.kind`.
- **staff-web**: there is no ruling card and no freeze option in staff-web/src.
- **Defence in depth (L1, low).** The machine's `approve` does not re-check the stored draft's
  action; it is checked only at `propose`. A `disputes.ruling` row written before D-015 that
  carries `freeze` and is `awaiting-approval` would still be approvable (as `accounts.ban`) once
  approve routes exist. No route could have written such a row, so the risk is near zero.
  Recommendation: call `validAction` again at approve, or check once that no
  `disputes.ruling->'accountAction'->>'kind' = 'freeze'` row exists before the approve route
  lands.

## 2. GET /v1/account/freeze

- **Who.** `requireSession({ ...FINISH_OPEN_TRADES })` with no `member`: trader accounts only,
  so a team-member session is 403 `owner-only` and staff kinds are refused. Recovery (backup)
  and held sessions are allowed by design, so the notice shows during a recovery hold. A
  recovery session can already read the account's trades, with partner and amount, through
  FINISH_OPEN_TRADES, so this adds nothing new for a code thief. Accepted.
- **What.** It selects only `created_at`, plus the trade's code, side, amount, the dispute's
  `incident_id` (already shown to both traders, G37) and the partner's `PUBLIC_NAME_COLUMN`.
  `reason`, `placed_by`, `lifted_by` and `side` (the stored column) are never selected. The
  trade join requires the caller to be a party (`seller = h.account_id or buyer = h.account_id`).
  Only rows with `lifted_at is null` and `kind = 'freeze'` for `$1 = req.auth.accountId` are
  returned. The partner reads `[]` (tested). The test's `toEqual` on the full body pins the
  key set.
- **Listed** in OWN_DATA_READS with an accurate description. The frontDoor test passes.
- **Every `trading_holds` writer** is the staff freeze route, so the `kind='freeze'` filter
  and the take/offer refusals (which have no kind filter) agree.
- **Test gap T1:** no test for the 403 of a team-member session, or that a backup/held session
  reads it. Add one.

## 3. FrozenWatch (apps/web AccountFrozen.tsx, App.tsx)

- **No loop.** The effect depends on `[enabled, navigate]`, not on the pathname, so it runs once
  per login or page load. It marks the freeze as shown (`since`, in sessionStorage plus an
  in-memory set) before it navigates. FROZEN_PATH's route only goes home when the state is null,
  and it never navigates back to itself. A failed call or a malformed answer resolves to null,
  meaning no notice. A team member's session never asks (`memberOf(session) === null`).
- **F2 (medium, UX/safety): it can pull the person off a live trade page.** It skips only
  FROZEN_PATH and `/trade/:code/dispute`. But a disputed trade's room `/trade/:code` (and
  `?view=chat`) shows the dispute through its slot (App.tsx comment, Task 27). Any open trade
  page, including one where the frozen person must still release or pay, is also left on the
  first load. The show-once state is per tab (sessionStorage), so every new tab or new browser
  session navigates once. It does not hide the dispute for good ("Go to your dispute" is the
  notice's primary). Recommendation: also skip any `/trade/...` path, and show the notice later
  or on the next page that is not a trade page.

## 4. The existing freeze route's gates

`POST /staff/v1/disputes/:code/freeze` (staffRoutes.ts) is not in the diff. Its gates are
unchanged and covered by the passing staff tests:
- disputes.handle;
- `mayWork` (assignee, senior or owner; R37 on appeal);
- not when closed or already frozen;
- not while maintenance pauses the timers (g62);
- `no-reply` needs 48 h of silence from that side since the round opened or their last message,
  plus the maintenance shift;
- `ignored-ruling` only for the seller in `complying` once `complyBy` has passed without
  compliance;
- lift (`on:false`) only by a moderator who may work the case.

## Findings

- **F1 (medium; mostly already on main, made visible here): a freeze that outlives its trade has
  no notice and no lift.**
  - After the R36 whole-record delete, the route returns `dispute: null`. `parseFreeze` skips
    such entries (it needs a dispute for the board), so a person frozen only by such a freeze
    gets **no notice at all**. They just see take or post refused.
  - Worse, and already on main: the only lift is `POST /staff/v1/disputes/:code/freeze` with
    `on:false`, which needs the trade (`caseTrade` gives 404 once it is purged). No account-level
    lift exists; staff/holds.ts covers recovery holds only. A freeze placed for an ignored ruling
    whose trade is then purged becomes **permanent with no staff path**, against D-014 ("mods
    lift it").
  - Recommendation:
    - (a) An account-level lift for staff (`accounts.freeze`, logged, by freeze id).
    - (b) A notice variant for an orphaned freeze, pointing to support (copy and design question).
    - (c) Alternatively, keep a freeze's dispute record alive past R36 until it is lifted. That is
      an owner question, because it touches R36.
- **F2 (medium):** FrozenWatch leaves trade pages (above).
- **L1 (low):** re-validate the account action at approve (above).
- **T1:** member/backup/held tests for the new route (above).

## Must-fix list

None for this branch. Recommended before launch: F1(a). Owner/design questions: F1(b) or (c).

## Re-verify at ac3ab777 (12 Nov 2026)

Fix commit ac3ab777 (on b05777cf): staffRoutes.ts +66, dispute.ts +4, AccountFrozen.tsx +24,
plus tests (staff.test.ts +106, matrix row, dispute.test.ts +9, accountFrozen.test.tsx +45).

**Verdict: F1(a), F2, L1 and T1 are closed. The branch is READY to land.** F1(b)/(c) (a notice for
an orphaned freeze, or keeping the record past R36) remain owner and design questions.

### Checks

- Runner: disputes/staff + staff/matrix: 2 files, 135 passed, 1 todo, 0 failed.
- Runner: packages/staff: 8 files, 208 passed.
- Runner: web accountFrozen: 1 file, 11 passed.
- semgrep on the 7 changed files: 0 findings.
- dockerd was not touched.

### F1(a): `POST /staff/v1/freezes/:id/lift`

- **Guard and matrix.** It requires `disputes.handle` (declared and guarded, so `assertRoutePerm`
  holds), and the matrix row is `allowed: MODERATORS`. Helpers get 403 (tested).
- **Id parsing is safe.** An anchored, case-insensitive UUID regex runs before any query; anything
  else is 404 `not-found`, the same answer as an unknown id (tested with both). The id is used only
  as a bound parameter. The row must be `kind = 'freeze'`, and a row with no dispute is 404 too.
  That leaves a 102-era freeze with no dispute unliftable here, but no code writes such rows.
- **While the case exists, a plain moderator cannot lift unless they are the assignee.** The route
  runs `withDispute` (the dispute row is locked) and then `mayWork`: the assignee, a senior or the
  owner, with R37 applied to an appealed case. Anyone else gets 403 `forbidden-case`, the freeze
  stays, and this is tested with a second mod. The lift writes under the dispute lock, re-locks the
  freeze row (`for update`), and gives 409 `wrong-state` if it was already lifted (tested). The log
  entry is on the case's trade code and the person is added to `seen`, the same as the case route.
- **Once the case is gone: only a senior or the owner, with no R37 check.** I judge this safe.
  R37 keeps round-1 staff out of an *appeal*. With the dispute record gone there is no appeal to
  protect, and there is no assignee to defer to. Lifting only gives trading back. It cannot move
  money, rule, or reveal anything, and the frozen account is a trader, never a staff account, so
  nobody can lift their own freeze. Limiting it to seniors and the owner is the stricter choice
  (plain mods are refused; tested). The lift runs in its own transaction with the same `for update`
  and 409.
- **Race.** `has_case` is read before the transaction. If the case is purged in between,
  `withDispute` finds no record and answers 409 (`DisputeRuleError('wrong-state')`), and nothing is
  written; a retry takes the senior-only path. The reverse cannot happen, because codes are never
  reused. This fails closed.
- **Log entry without a trade code: correct.** `tradeCode: null` (the column is nullable and the
  index is partial). Any trade code would point at a record that R36 has deleted. The detail is
  `{accountId, side}` and the actor is the senior; tested exactly.
  - Optional minor: add the freeze id to the detail, so a reader of the audit can tie the entry to
    the `trading_holds` row. That needs a log-schema key. The row's own `lifted_by`/`lifted_at`
    already record it, so this is not needed.
- **Nothing new for traders.** The freeze simply leaves `GET /v1/account/freeze` (tested).

### L1: approve re-checks `validAction`

- `approve` (only, not `send-back`) now returns `invalid-action` when the stored draft's action
  fails `validAction(…, now)`. That covers a pre-D-015 `freeze` draft, any malformed shape, and a
  ban whose `until` has passed. The check runs before `canApprove` and changes nothing, so it fails
  closed.
- It is harmless: send-back stays possible (tested), so a stale draft is cleared and re-proposed.
  `{kind:'none'}` always passes.
- A new side effect: a short timed ban can lapse while it waits for approval, which forces a send
  back and a new proposal and costs time against the ruling deadline. That is correct (approving
  a ban that has already ended would be wrong), and it shows up as a refusal, not silently.

### F2: FrozenWatch

- `stayOn` covers FROZEN_PATH, `/trade`, and every `/trade/...` path (room, chat via the pathname,
  dispute). On those pages the watch keeps the state in `waiting` and does not mark it shown. A
  second effect opens the notice on the first page that is not a trade page, marks it shown first,
  and clears `waiting`. There is no loop: it opens once, and the shown check runs again before it
  navigates. A cleanup (logout or remount) clears `waiting`.
- **The new test really mounts outside the routes.** `<FrozenWatch enabled />` is a sibling of
  `<Routes>` inside one `MemoryRouter`, with the real `AccountFrozenRoute` at FROZEN_PATH, as in
  App.tsx. It covers:
  - the dispute page, the room, `?view=chat` and another code: each stays put and the API was read;
  - clicking from the room to `/sell`: the notice heading renders;
  - a later page load at `/sell`: the notice does not open again.

### T1

T1 is covered: a team member gets 403 `owner-only`; a backup session, and then a held one, read
the freeze.

### Still open

- F1(b)/(c): owner and design questions.
- Optional: the freeze id in the lift log detail.
