# Review: J-21 staff pages (wip/second-staff-pages c2975a31), 12 Nov 2026

Independent review for the cloud lead. Branch c2975a31 (merge-base = origin/main 6ebed537; 29 files,
+796/-60; migration 470). Scope: O-044 / Q13 owner Prices page, D-036 / Q60 per-person grant
checkboxes, T-017 moderator-only cancel figure, D-049 "Disputes: N won, M lost", R-028/G21 test.
Lens: permission checks on every staff route the branch touches or feeds. No code edits.

## Verdict

**READY to land**, with no blocking findings. The permission side is sound: J-21 adds no new staff
route, only fields on routes that are already in the privilege matrix with the right roles, and
the per-person boxes still go through the server-side tap. All the findings below are about
correctness or alignment with rulings (F1), or are owner questions and low-priority clean-ups.

## Checks I ran (detached worktree /home/user/X2F/.claude/worktrees/review-j21 at c2975a31)

- API: tradedTotal.test.ts, disputes/staff.test.ts, staff/members.test.ts, staff/matrix.test.ts:
  4 files, 177 passed, 1 todo, 0 failed.
- UI/packages: staff-web staffPages.test.tsx + shell.test.tsx, packages/staff roles.test.ts,
  web disputesLine.test.ts: 4 files, 107 passed, 0 failed.
- `tsc --noEmit` for apps/api and apps/staff-web: clean.
- Not run: the full suite, Playwright, Monero (claude2 reports them green on c2975a31).

## Permission audit (every staff route the branch touches or feeds)

| Route | Perm (declared = guarded) | Roles that reach it (matrix row) | J-21 change | OK? |
|---|---|---|---|---|
| GET /staff/v1/price-health | stats.read | owner | none (staff-web Prices page now reads it) | yes |
| GET /staff/v1/members | staff.manage | owner | + `grants` per member (GRANTABLE_PERMS only; [] for owner/invites) | yes |
| PUT /staff/v1/members/:id/grants | staff.manage | owner | none (UI now calls it) | yes: tap `set-grants` bound to the person and the exact sorted list, re-parsed server-side (exactKeys, GRANTABLE_PERMS only, no duplicates); `lockTarget` refuses the owner row (409 owner-protected) and removed members (404) |
| GET /staff/v1/disputes/:code | disputes.handle | owner, senior, mod | + `cancels: {buyer, seller}` | yes: disputes.handle is not grantable, so a helper holding tickets.handle or feedback.read is refused (403) |
| GET /staff/v1/me | self | every role | owner nav + `prices` | yes |

- `assertRoutePerm` (guard.ts) still makes startup fail for any staff route whose declared perm
  differs from its `requireStaff` perm. The matrix (test/staff/routes.ts) is unchanged because J-21
  adds no routes. It passed.
- New `NAV_PERM` + roles.test.ts: every menu item of every role maps to a perm that role holds, so
  the menu cannot offer a page whose data the API would refuse. The client shell routes only
  `me.nav` items, so a mod who opens /prices or /staff gets NOTHING_FOR_ROLE, and the API refuses
  the data anyway.
- The cancel figure does not leak into public answers. `traderSummaries` has no cancel key (pinned by
  a test that checks the summary's key set and by a regex over trade view, offers and /me bodies).
  `cancelFigures` is called only from the staff case view. `account_traded_totals` has no other
  reader in apps/api/src or apps/moderation/src.
- dispute_rulings is written only when a ruling is published (207_disputes.sql), so the new public
  won/lost counts never reveal a ruling that is still waiting for approval.

## Findings

**F1 (medium; aligns with owner rulings R-011/R-012; coordinate with the reputation and appeals
jobs).** `WON_DISPUTES_SQL` (and the existing `LOST_DISPUTES_SQL`, which feeds Clean record) counts
the latest ruling round that exists. While an appeal is pending (disputes.status 'appealed', no
round-2 row yet), the profile shows the round-1 result. R-011 says "appeal holds it, then the result
decides", and R-012 says "totals follow the final binding outcome". The D-049 test covers an appeal
only after its round-2 ruling. Recommendation: count a dispute in won/lost only when no appeal is
pending (exclude disputes whose current status is 'appealed'). Apply the same rule to the lost
count, and so to Clean record. Leave it to the reputation job (R-011/R-012 hooks) so it is built
once. Not a blocker for J-21.

**F2 (owner question, already raised by claude2; I agree).** `disputes` is now on every public
`TraderSummary`. That covers offer cards (GET /v1/offers poster), the trade view's counterparty and,
later, the profile. So the counts are public through the API from landing, even though no screen
shows them yet. D-049 is "profiles show"; the owner was "leaning yes" (owner-answers-2026-10-28
line 145), and this is a lead default. Recommendation: confirm D-049 with the owner and, at the
same time, whether offer cards may carry the counts. If profile-only, move the field to the
profile endpoint (Plan 5 Task 12) instead of the shared summary.

**F3 (owner question, already raised; my notes).** Who a cancel counts against (tradedTotal.ts
`countCancel`): the buyer for their own cancel, the seller for a walk-away, the proposer of an
accepted mutual cancel, and the buyer for a seller's cancel after the time to pay ran out (auto-refund).
Nobody is counted for a setup time-out, a funding lapse (including `lapse-refund`, where the seller
started funding and did not finish) or a system cancel. The owner's words were "all cancel types
grouped into ONE cancel figure" (owner-answers-2026-10-30-lead-window line 83). That can also be
read as every cancelled trade the account took part in. Recommendation: ask the owner both points
together: (a) count only the side that ended it (as built) or every party; (b) whether a seller's
funding lapse counts against the seller. I checked the code logic, and it is right for each case it
claims: the closing event is read after it is inserted in the same transaction; it is idempotent
through `trade_totals_counted` (kind 'cancel'); `dispute_by is null` keeps a dispute-settling
refund a completed trade, consistent with `COMPLETED_TRADES_SQL`; and refunded → cancelConfirmedAt
does not change state, so nothing is counted twice.

**F4 (low).** Migration 470 renames buyer_cancels → cancels and moves the old 'buyer-cancel' marks
to 'cancel', but adds no backfill. On any database with trades still inside the 30-day window,
earlier walk-aways, mutual cancels and pre-funding buyer cancels are missing from the figure.
Before launch this probably makes no difference. If a staging or production DB with real trades
exists, add a one-off backfill (replay `countCancel` for trades still stored) or accept the gap
on purpose. On ordering: the migrator applies unapplied files in name order, so 470 runs after
the already-applied 490/500 on an existing DB. That is fine; 470 does not depend on them.

**F5 (low; comment/behaviour mismatch).** In `listMembers` (staff/members.ts), the comment says
role-held grants "are not repeated here", but the code only filters to GRANTABLE_PERMS. A senior
who has a stored `feedback.read` (for example, ticked as a mod and then promoted) gets it back in
`grants`. The Staff page shows that box ticked and fixed for a senior, so the owner cannot clear
it there. After a demotion to mod the stored grant still applies, because `set-role` does not touch
grants (this behaviour was already on main). The mod row then shows it ticked, so it is visible
and can be unticked. Recommendation: fix the comment, and either keep this as is (the grant was the
owner's choice) or ask the owner whether a role change should clear the per-person boxes. Low.

**F6 (low; doc drift for T-017).** The spec (2026-10-14-x2f-design.md lines 313 and 483: "Profiles
show a neutral cancel rate", "Stats: ... cancel rate") and the Plan 5 text (P5-A9, `cancelRatePct`
in TraderProfile, Profile "trades cancelled") still describe a public cancel rate.
`packages/reputation` still exports `cancelRatePct`, which nothing uses. claude2 already listed the
Profile/ModCase design conflicts. Recommendation: the docs pass updates spec 2.3/5.x and the plan
for T-017, and `cancelRatePct` is removed or marked as superseded.

**F7 (info; performance).** Each summary row now runs two correlated subqueries over dispute_rulings
⋈ trades, each with an OR across buyer and seller. An offer list with N posters does 2N such
scans. That is fine at current scale; it belongs in Plan 5 Task 20's running totals, as the
comment says.

**F8 (info; interpretation).** "Seen ONLY by moderators" is built as everyone with disputes.handle:
the owner, senior moderators and moderators. I read that as intended (the owner and seniors are
moderators plus more). Stated here so the lead can confirm.

## UI notes (no finding)

- StaffGrants: the draft is sorted the same way the server sorts it, so the tap binding matches.
  Save stays disabled until something changes. A refused save puts the stored boxes back. The owner
  and invites get no boxes. All copy is marked COPY-UNSIGNED / DESIGN: not drawn.
- Prices: reads once on opening and again on Reload (it never polls). A failed load shows the fault
  notice instead of an empty page. Owner only, through the nav and the API.
- The G21 pastrep test is test-only and does what its title says (an unproven claim is refused,
  a proven claim is B's, and A cannot take the key back while B's claim is live).

## Money / keys / logins / disputes

There is no money movement and no change to login. The per-person boxes are tapped staff-permission
changes; that existing route is unchanged and its intent binding was re-checked above. The case view
gains a moderator-only stat. Dispute counts become public (F1, F2). Security review: nothing beyond
the above.
