# Re-verify r2: wip/second-disputes-fixes ac55055d, 2026-11-18

**Verdict: APPROVE.** 0 blocking, 0 major, 0 minor, 2 info (one carried over). The full `npm run check`
at the head passed under the lock (it was the missing piece of the 17 Nov re-verify). The named suites and
both Playwright apps are green too. The merge of main b6f9cf0e drops no security check from late-funds or
from the disputes stack. The ruling-statement exemption is a test-list entry for a route only the web app
calls. No test was weakened.

Reviewer: independent security reviewer, read-only on code. `git fetch origin` first:
`origin/wip/second-disputes-fixes` = **ac55055d** (not moved since the brief), `origin/main` = **b6f9cf0e**.
Approved base: c084f2b6 (re-verify-second-disputes-fixes-2026-11-17.md: code OK, only the full check was
missing). Worktree: detached `/home/user/X2F/.claude/worktrees/rv-sdf-r2` at ac55055d, fresh `npm ci`,
node 24.22.1. One run under `~/x2f-comms/check.lock`, with the timeout inside the flock
(`flock check.lock timeout 20000 run.sh`). I did not touch dockerd. The worktree's node_modules were deleted
afterwards.

## Scope since c084f2b6

| Commit | What |
|---|---|
| 3044ad59 | flows.test: `GET /v1/trades/:code/ruling-statement` joins NOT_AUTH_CLIENT (test file only) |
| 101af7df | RED: a moderator's page in the shell has two `[data-primary]` (the rail's Clock out) |
| 58c913db | StaffShell: Clock out `variant="primary"` → `"secondary"` (one data-primary per screen) |
| e19e4628 | READY (message only) |
| e8e792e3 | merge origin/main b6f9cf0e (escrow-harden M1-M3 + late-funds re-verify N1/N2/gap (b)), 5 conflicts |
| ac55055d | READY (message only) |

## The merge e8e792e3

This is a criss-cross merge (two merge bases: 4f0afa14 and 544cf81c), so I checked the result against both
parents, file by file, instead of trusting the textual conflict list.

- **Every file touched by a main-only commit (e19e4628..b6f9cf0e, 30 files) is byte-identical to main's**,
  except 3 that both sides changed. That includes all of late-funds and escrow-harden:
  `packages/escrow/src/{party,verify,monero,engine,index}.ts`, `packages/trade/src/attestation.ts`,
  `apps/web/src/escrow/{runtime,store}.ts`, and the escrow and attestation tests. So late-funds' `after`
  (party.ts:30/57/135), re-verify N1 (party.ts:685, :741), N2 (:731), gap (b) (:668, :681, :799), the fee
  bound floor and mask cap (M2/M3) and the attestation's lower time bound (M1) are exactly main's.
- **The 3 two-sided files are true unions:**
  - `apps/moderation/src/watcher.ts`: main's late-funds I3 (`handle.builderOf(spend.txHash)` before
    `committedBuilder`) and the branch's review M4 (a mod-built sweep is named only by the executor's
    record) and M5 (`rulingRecorded`, `deskArmed`, `escrowAddress`) are all present.
  - `apps/web/src/escrow/adapters.ts`: main's `takenAt` (F5) and the branch's `getRulingStatement`.
  - `packages/trade/src/index.ts`: main's `ATTESTATION_CLOCK_SKEW_MS`, `attestationKeys` and `AttestationKey`
    exports, and the branch's ruling-statement exports.
- **The 5 textual conflicts (from `git show --remerge-diff`):**
  - `schema.test.ts` (3 lists): the branch's lists, i.e. main's plus `550_ruling_statements.sql`. Correct:
    the migration exists and no number is used twice.
  - `packages/staff/src/intent.ts`: the branch's `reset-staff-security … issuedAt?` kept. This was the
    17 Nov review's condition. It matches `ISSUED_AT_KINDS` (intent.ts:54-58, which still lists
    `reset-staff-security`). The file is identical to c084f2b6.
  - `apps/api/test/staff/routes.ts`: the one `POST /staff/v1/freezes/:id/lift` row kept once, unchanged.
    The file now equals main's.
  - `gate.test.ts` and `lien.test.ts`: the same literals with `as const`, the same meaning.
- **Everything the disputes stack defends is byte-identical to the approved c084f2b6.**
  `git diff c084f2b6 ac55055d` is empty for `apps/moderation/src/gate/` (verify, registry, store),
  `packages/trade/src/rulingStatement.ts`, `apps/api/src/trades/identity.ts`,
  `apps/api/src/internal/routes.ts`, `apps/web/src/escrow/policy.ts` and `packages/staff/src/`. So the
  following hold as approved:
  - the ruling statement and its domain `x2f/ruling-statement/v1\0`;
  - the `replayed` and `stale-round` refusals (verify.ts:279, :283);
  - gate D-2 (`LINK_MAX_LIFETIME_MS` store.ts:160, `link-too-long` registry.ts:165-167, cap at registry.ts:140);
  - gate D-3 (`inviteClosed`, `binding?.closed` skip at registry.ts:225, closing at :292/:410);
  - the D-032 owner reset gate.
- **Runtime auto co-sign still fails closed.** `apps/web/src/escrow/runtime.ts` is main's file and has
  no `ruling`, `'mod'` or `rulingAllowsCosign`. The tripwire `dispute-tripwires.test.ts` is green.

## The ruling-statement exemption (3044ad59) is web-only

- The commit changes only `packages/auth-client/test/flows.test.ts`: one NOT_AUTH_CLIENT entry and the
  reason in the list's comment. No API or client code changed.
- The route is `requireSession({ kinds: ['trader'], member: TRADE_READ })` (identity.ts:10, :106). It is
  participant-only via `roleInTrade`, and listed in frontDoor.ts:83 as "one of my own trades
  (participants only)". Its only caller is `apps/web/src/escrow/adapters.ts:166`. Nothing in staff-web or
  packages/staff calls it.
- The moderation side posts the statement over the internal link (`kind: 'ruling-statement'`), not this
  route. So listing it as a web-app route is accurate, and the "every route has its client method" rule
  still binds every other route.

## Clock out (101af7df, 58c913db)

- The RED test is added first. The fix changes one prop, and Clock out keeps its handler and its
  confirmation (`setClockingOut(true)`).
- `clockOut.test.tsx` has no assertion on its variant, so no test was changed to fit the fix.
- Not a security change. Its emphasis is marked `DESIGN: emphasis` for design.

## No test weakened

- **The branch's own test edits since c084f2b6 add lines only**, except:
  - the flows.test comment line, which was rewritten;
  - the `as const` swaps;
  - the freezes/lift row, which was moved, not removed.
- **Every other `-` test line since c084f2b6 is in a file now byte-identical to main.** Those are main's
  already-reviewed escrow-harden and late-funds edits, such as the attestation and escrow-helpers
  signature changes.
- No skip, todo or quarantine was added. The one `todo` in the vitest count is pre-existing.

## Tests run (all at ac55055d, one lock, 10:04-11:28 UTC on 18 Nov)

| Run | Result |
|---|---|
| `vitest --project @x2f/escrow` | **151/151** (19 files) |
| `vitest --project regtest` | **4/4** |
| `vitest --project regtest-verify` | **10/10** |
| `vitest --project @x2f/moderation` | **243/243** (16 files) |
| `vitest --project @x2f/moderation-regtest` | **2/2** |
| `npm run check` (exit 0) | typecheck clean; copy-lint clean; separation-check ok; `npm test` **7236 passed, 1 todo, 0 failed** (387 files); semgrep 0 findings (113 rules, 1334 files); `npm audit --omit=dev` 0 vulnerabilities |
| Playwright web (`-c apps/web/e2e/playwright.config.ts --trace off`) | **529 passed, 52 skipped, 0 failed** (4.6 min). The skips are the specs' own conditional skips; apps/web/e2e is identical to main |
| Playwright staff-web | **5/5**, including moderator.spec ModQueue and ModCase parity (the two `[data-primary]` failures are gone) |

**serve-boards (the known baseline red):** it did **not** fail in this run. `apps/web/test/serve-boards.test.ts`
is inside the 387 green files. I am noting it separately as asked; there is no red to attribute.

Other notes:
- The ECONNREFUSED 127.0.0.1:3000 lines and the FileHandle warnings in the check log are stderr noise from
  passing tests.
- The parity-pixel percentages in staff-web are "reported, not blocking", as on earlier heads.
- The plain `npm ci` printed "6 high severity vulnerabilities" for the full tree. The check's
  `--omit=dev` audit, which is the gate, found 0.

## Findings

- **I-1 (info, design):** Clock out in the staff rail is now the outlined secondary button. This is the
  branch's choice to meet the one-primary rule (marked `DESIGN: emphasis`, NEEDS_DESIGN_CLOCK_OUT). It
  needs a design decision before landing, not a security one.
- **I-2 (info, carried over):** X3-1r from 17 Nov. When the address holds an incident ID, the case/address
  match is the API's word. The real fix is owner question 2 below.

## Owner questions (carried over, unchanged)

1. D-1 / B1 residual: confirm each staff key from an invite or reset link with an owner `add-staff-key` tap? Recommended: yes.
2. Haveno F2 point 4: count a ruling tap only from a moderator the moderation service saw assigned? Recommended: yes for mainnet.
3. NF-1: a ruling's `dispute-buyer` payout books X2F's network-fee share like a release? Recommended: yes.
4. Wording: the X3-1 staff-site lines (`DESIGN: wording`) and Clock out's emphasis need design.
5. F1 key split, F3/F4, M-R2 `remove-owner-key`: unchanged.

## Merge-order conditions (unchanged from 17 Nov)

MIG-1 (land netfee only via second-netfee-fixes, 600) and the batch10a resolution rules (keep lien and ban
guards; keep `issuedAt?` on the three intents; schema lists 550 then 560-590) still apply. Landing on main
b6f9cf0e is a fast-forward (main is an ancestor of ac55055d).
