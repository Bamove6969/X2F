# Re-verify: wip/second-disputes-fixes c084f2b6 (on wip/lead-disputes-stack 1cff3d66), 2026-11-17

**Verdict: NOT READY (procedural only).** On the code, every finding of the 16 Nov review that this
branch was meant to fix is fixed, and I found no new security defect. But the reviewers' rule is that
the head's full `npm run check` must pass under the lock before APPROVED, and **it did not run**: it waited
2 h for `~/x2f-comms/check.lock` behind other reviewers' runs and was killed by the session's 2 h limit
before it started (its log is empty). moderation-regtest did not run either (it is one of the projects
inside `npm test`). Re-run `npm run check` at c084f2b6. If it is green, this is **APPROVED** with no
code change needed.

I did not commit this file; someone else committed an in-progress draft of it to comms as c8eacc79 while my test run was waiting. This final version is uncommitted on top of that. Reviewer: independent security reviewer, read-only on code. I ran `git fetch
origin` first. `origin/wip/second-disputes-fixes` = **c084f2b6**, its parent stack
`origin/wip/lead-disputes-stack` = **1cff3d66** (unchanged), `origin/main` = **4f0afa14**,
`origin/wip/lead-batch10a` = **846d83ba**. I worked in a detached worktree (`/home/user/wt/rv-sdf`) at
c084f2b6 with a fresh `npm ci` (node 24.22.1). The only test run was queued under `~/x2f-comms/check.lock` with the
timeout inside the flock, and it never started (see Tests run). I did not touch dockerd. The worktree and its node_modules were removed
afterwards.

Read first (origin/comms 06f8ccad): review-disputes-stack-2026-11-16.md and its 2026-11-13 original,
review-ruling-payout-2026-11-12.md, review-multisig-vs-retoswap-2026-11-12.md, and the to-lead.log
lines for the disputes stack (17:38 16 Nov review, 22:46 16 Nov READY).

Same threat model as the disputes-stack review: the API and its database are fully compromised;
`gate.bin`, MOD_KEYSTORE_KEY, MOD_SIGNING_SECRET, the staff-site build and the owner's and honest staff's
keys are not.

## Scope

Seven commits on 1cff3d66 (11 files, +255/-9). Nothing in apps/api, apps/web, packages/trade or
apps/moderation/src/gate/verify.ts changed, so the ruling statement, its domain, the replayed/stale-round
refusals and the runtime co-sign path are byte-identical to the approved 1cff3d66.

| Commit | What |
|---|---|
| bb39977d | RED: D-3 (reset leaves an open invite) and D-2 (no gate bound on a link's lifetime) |
| 490ea8da | D-3 fix: a reset closes the person's invite bindings |
| 42f0ca26 | D-2 fix: `LINK_MAX_LIFETIME_MS`, enforced in step 0 and in steps 1/1b |
| 5cf6226c | RED: X3-1 |
| d9af7c02 | X3-1 (a) + (b): ModCase checks the case against the address; `code` labelled from the signed code |
| d694d89e | RED: staff.css unclosed @media |
| 0bb3b4d0 | staff.css: the missing `}` |
| c084f2b6 | READY (commit message only) |

## Every finding of review-disputes-stack-2026-11-16

| Finding | Status at c084f2b6 | Evidence |
|---|---|---|
| Merge defect: staff.css unclosed `@media` | **Fixed.** `}` added after `.x2f-staff-case` (staff.css:376); `.x2f-staff__badge` now top level. | New `staffCss.test.ts` (brace balance, badge outside any at-rule, `.x2f-staff-case` still inside); new PW test at 1280/800 px. |
| X3-1 (a) case vs address | **Fixed for code addresses.** `caseMatchesAddress(param, c)`: a param that normalizes as a trade code must equal `normalizeTradeCode(c.code)` (the same normalizer the gate's tapChallenge uses, now re-exported from @x2f/staff). Mismatch: a danger notice, and `openTap` never calls `setTap`, so `taps/start` is never called (propose and approve). | `moderator.test.tsx` X3-1 test: other code → no dialog, no `taps/start`, for both propose and approve; lower-case dashed form of the same code → dialog opens. |
| X3-1 (b) label | **Fixed.** `code` label is ``the trade on this page, ${codeText(c.code)}``, from the signed value. The old `incident D-7RWD` assertion was replaced by a stricter one (contains the grouped code, does not contain the incident id). | moderator.test.tsx |
| D-1 (owner question) | **Open, owner.** Unchanged, as intended; still fail-safe (no staff-site caller for `create-invite` or `reset-staff-security`). | `KEY_TAP_CALLERS` unchanged |
| D-2 link lifetime | **Fixed.** See below. | 2 new gate tests |
| D-3 reset vs open invite | **Fixed.** See below. | the reviewer's PoC is now a gate test |
| MIG-1 | **Unchanged (merge-order).** This branch adds no migration. Condition stands: land netfee only via second-netfee-fixes (600). | |
| NF-1 | **Unchanged (merge requirement + owner money call).** Not in scope of this branch. | |
| Info: deleted RED runtime test (abb3dfb1), pin-owner without `{ lock: true }`, unlink-then-`wx` gate.lock | **Unchanged** (not asked for in this round). | |

## D-032 owner reset gate, re-checked with D-2 and D-3

`apps/moderation/src/gate/registry.ts`, `apps/moderation/src/gate/store.ts`.

**D-3.** When step 1b first applies an owner-tapped reset it now, besides dropping `s.creds` and closing
the person's earlier reset links, closes every `g.invites` binding whose `accountId` is that person and
sets `s.inviteClosed = true`. Step 1 skips a closed binding before reading the API (`if (binding?.closed)
continue`), and nothing in the file ever sets `closed = false` again. Within the same sync step 1 runs
before 1b, so a key step 1 re-adds there is wiped by `s.creds = []`. I checked the other ways back in:
- A new invite naming the same account: refused `invite-account` (`taken` counts closed bindings too, and
  the person is in `g.staff`).
- An invite id equal to a reset id, either order: refused (`invite-is-reset` / `reset-refused`), unchanged.
- Every `g.staff` entry was created by step 1 after its binding, so the person's invite binding always
  exists to be closed; there is no staff entry without one.
- The new test also registers a fresh key on the old invite after the reset and restores the staff row:
  neither the old key nor the late key can rule; the reset link's key can.

**D-2.** `LINK_MAX_LIFETIME_MS = 24 h + 5 min + 2 min`.
- Step 0 spends and refuses (`link-too-long`) a fresh `create-invite` or `reset-staff-security` tap whose
  signed `expiresAt − issuedAt` exceeds it; a non-parsable `expiresAt` also fails (`!(NaN <= x)`).
- Steps 1 and 1b close a link at `min(expiresAt, issuedAt + LINK_MAX_LIFETIME_MS)`, so a link already
  bound in an older gate.bin is capped too; a tap without `issuedAt` gives NaN and closes (fail-closed).
- Honest flow is not refused: `issuedAt` is the API's own start time of the tap (`stampIssuedAt`);
  the API's `linkOf` accepts `expiresAt ≤ post time + INVITE_TTL_MS (24 h) + INVITE_CLOCK_SKEW_MS (5 min)`,
  and the post must come within `KEY_TAP_TTL_MS` (2 min) of the start. So the honest maximum is exactly
  the bound. Tests cover 2099, bound+1 ms (refused) and exactly the bound (accepted), for both kinds.
- `issuedAt` is already capped at now + 2 min (`issued-in-future`), so no link can stay open more than
  about 24 h 9 min after the gate first sees its tap.

**Table, as in the 16 Nov review, at c084f2b6:**

| Question | Answer |
|---|---|
| Forge (API, senior, no tap) | **No**, unchanged: only a verified tap by a pinned owner key counts. |
| Replay (nonce, second tap, finished/expired/superseded link) | **No**, unchanged; an expired link now also means "past issuedAt + 24 h 7 min". |
| Re-point (`reset-rebound`, `invite-rebound`) | **No**, unchanged. |
| Reset the owner / a removed person / re-enable | **No**, unchanged. |
| Race with invites | **No**: id collisions refused both ways (unchanged), and now the person's own invite closes on reset (D-3). |
| Keep a link open forever | **No** (D-2). |

D-1 (the API knows every link token, so it can register its own key through an open invite or reset
link) is still the real residual. D-2 now limits that window to about a day; it does not close it.

## Ruling statement and domain separation

Unchanged since 1cff3d66 (no diff in packages/trade, apps/api, apps/web or gate/verify.ts). I re-read the
prefixes: `x2f/ruling-statement/v1\0` (packages/trade/src/rulingStatement.ts:48), `x2f/attestation/v1\0`
(attestation.ts:134), `x2f/api-internal/v1\0` (internalAuth.ts:12), `x2f/relay-register/v1\0` and
`x2f/relay-close/v1\0` (apps/moderation/src/link.ts:73-74, apps/relay/src/admin.ts:8). Distinct, each
NUL-terminated, none a prefix of another. Holds. F1 (one online key for all five) stays an owner question.

## Replayed and stale-round refusals

Unchanged: `apps/moderation/src/gate/verify.ts:279` refuses `replayed` (a ruling id seen before with
another code or round) and :283 `stale-round` (an unseen ruling at or below the highest round authorised
on that trade code), both before the tap agreement check. Covered by the gate suite in the full check
below.

## Runtime auto co-sign still fails closed

`apps/web/src/escrow/runtime.ts` has no mention of `ruling`, `'mod'` or `rulingAllowsCosign`, so
`context()` never carries a ruling and `ruled` is false for every mod-built set. The tripwire
`apps/web/test/dispute-tripwires.test.ts:25` still fails if the runtime ever names `'mod'` or
`rulingAllowsCosign`. Nothing co-signs a ruling. Holds.

## No test weakened

Every `-` line in the test diff: one assertion (`expect(dd('code')).toContain('incident D-7RWD')`)
replaced by two stricter ones, and `gateWorld.hire` gained an optional `expiresAt` (default unchanged).
No test removed, skipped or loosened.

## New findings

- **X3-1r (info):** (a) is strict only when the address holds a trade code. When the address holds an
  incident ID (the API resolves those at `/disputes/:code` too), the match compares with the API's own
  `incidentId` field, so it is the API's word. (b) still puts the signed code itself in the dialog's
  label, so the moderator sees what is signed. The queue and "take next" links use the API's `code`, so
  the address itself is the API's word in normal use: the real fix stays owner question 2 (signed
  assignment). This is what the 16 Nov review asked for in (a) ("when that parameter is a code").
- **PW (info, from the READY note, not re-run here):** staff-web Playwright ModQueue/ModCase parity
  reports two `[data-primary]` since main's Clock out button; the READY note says the base fails the same
  way. A design call before landing, not security.

## Tests run

**Nothing ran.** `flock ~/x2f-comms/check.lock timeout 7000 npm run check` at c084f2b6 (fresh `npm ci`,
node 24.22.1, 0 vulnerabilities from the install) sat in the lock queue from start to finish. At least
five other jobs held or waited on the lock: escrow runs, `rv-seckey-all.sh`, `rv-eh-run.sh`, `rvnf-run.sh`,
another full check and single-file probes. flock is not FIFO. The run was killed at the 2 h limit of the
background task while still waiting, so typecheck, copy-lint, separation-check, every vitest project
(including `@x2f/moderation`, `@x2f/moderation-regtest`, `@x2f/staff-web` and `@x2f/api`), semgrep and the
audit **did not run**. I did not restart it, as the limit's note says.

For reference only, not verified by me: the 22:46 16 Nov READY note reports moderation+logchain+staff+trade
1009/0, moderation-regtest 2/0, escrow 104/0, regtest 4/0, regtest-verify 10/0, node-proxy 34/0, api 2757/0,
staff-web 95/0, web 2121/0, tsc and copy-lint clean. moderation's 1006 → 1009 and staff-web's 93 → 95 match
the three new gate tests and the two new staff-web unit tests (X3-1, staffCss).

To do: re-run `npm run check` at c084f2b6 under the lock (it includes moderation-regtest), with a waiter
that can outlive 2 h, or at a quiet time.

## Trial merges

Run with `git merge-tree --write-tree`; nothing was written to any branch.
- **Onto main 4f0afa14: clean.** main is an ancestor of c084f2b6 (`origin/main` is still 4f0afa14), so
  landing is a fast-forward.
- **Onto origin/wip/lead-batch10a 846d83ba: 7 conflicts, the same 7 as at 1cff3d66 on 16 Nov:**
  `apps/api/src/chat/routes.ts`, `apps/api/src/offers/routes.ts`, `apps/api/src/trades/take.ts`,
  `apps/api/test/schema.test.ts`, `apps/web/src/ui/cantDoCodes.ts`, `docs/coordination.md`,
  `packages/staff/src/intent.ts`. None of this branch's own files (registry.ts, store.ts,
  packages/staff/src/index.ts, ModCase.tsx, modModel.ts, staff.css, the tests) conflicts.
  The resolution rules of the 16 Nov review still apply:
  - keep both the lien guard and the ban guard in chat, offers and take;
  - in `intent.ts`, keep `issuedAt?` on `reset-staff-security`, `add-owner-key` and `settings`, and add
    batch10a's `ban-account`/`lift-ban`. I confirmed the hunk: batch10a's side drops `issuedAt?` from
    all three.
  - It matters more now. Step 0's new D-2 check (`link-too-long`) and `linkClosesAt` both read the reset
    tap's `issuedAt`. The runtime stamp comes from `ISSUED_AT_KINDS`, which does not conflict, so dropping
    the type field is a typecheck and readability hazard rather than a runtime one. Keep it anyway.
  - The merged `schema.test.ts` lists need 550, then 560-590.
  - Tests on the merged tree: not run (the conflicts need the lead's resolution).

## Owner questions

1. **D-1 / B1 residual (carried over):** confirm each staff key the gate takes, from an invite or a reset
   link, with an owner `add-staff-key` tap after comparing the key check code? Recommended: yes, before
   the gate goes live with staff or offers resets. D-2 now limits the window to about a day.
2. **Haveno F2 point 4 (carried over):** a ruling tap counts only from a moderator the moderation service
   itself saw assigned (a signed `assign`/`take-case`)? Recommended: yes for mainnet. X3-1 (a)/(b) are
   the cheap part and are done.
3. **NF-1 (carried over):** does a ruling's `dispute-buyer` payout book X2F's network-fee share like a
   release? Recommended: yes.
4. **Wording (design):** the two new staff-site lines (the mismatch notice and "the trade on this page,
   …") are draft copy, marked `DESIGN: wording` and covered by ModCase's `COPY-UNSIGNED` doc comments
   (ModCase.tsx:62, :97). They need design's wording before staff use them.
5. Carried over unchanged: F1 key split, F3/F4, M-R2 `remove-owner-key`.

## Cleanup

The detached worktree `/home/user/wt/rv-sdf` and its node_modules were removed after the review
(`git worktree remove --force`, then `prune`). The trial merges used `merge-tree` only, so there is
nothing to abort. Nothing was committed or pushed. This file is uncommitted in the comms worktree.
