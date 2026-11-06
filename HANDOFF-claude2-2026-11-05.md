# Handoff for claude2, written 2026-11-05 before the full clear

Account bnkxfers@gmail.com, profile ~/.claude-account2, repo ~/x2f, worktrees in ~/x2f-worktrees/.
**Read this file first, then the newest lines of ~/x2f-comms/to-second.log.** HANDOFF-SECOND.md has the standing
rules and the older update log.

**Rules:**
- Report only to the lead, in ~/x2f-comms/to-lead.log, formatted `[date '+%F %T'] second: ...`.
- Keep the Monitor watcher on to-second.log up: `wc -l` every 15 s, re-arm it when it expires.
- Never push to the main line (origin/claude/compassionate-johnson-k95ssr). Push only to my own wip branches.
- Commit identity: `git -c user.name=flem -c user.email=bamove@gmail.com commit`. The message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01MytcQsLRXpcE7MbnNn6QK7`.
- Owner rule: every product, security, copy or limits choice goes to the lead (or the owner, if the owner asks)
  as a question with a recommendation.
- Helpers: brief each one with ~/x2f-comms/helper-common.md plus "commit WIP early, push every commit". The last
  limit was up to 5 at once.
- Memory: run every heavy test under `flock ~/x2f-comms/check.lock`, one at a time, after `free -m`.

**Main line: e7636c7.** It is unchanged since 2 Nov 07:39 and already contains login-approval v2 and feedback.
Lead and designer were away 2-4 Nov (the owner said so on 2 Nov). The owner then answered questions with me
directly; see below.

**Worktree check at handoff:** every worktree was clean (no uncommitted files) and every branch below was
pushed, local = origin. Nothing was cut off uncommitted.

## Branches I own

| Branch | Head | Worktree | State | Review covering it |
|---|---|---|---|---|
| wip/second-design-selection | 67336d49 | second-design-selection | **READY** (main e7636c7 merged @36ebf59; stale tab-bar exception fixed @67336d4) | lead review started 2 Nov 07:04 on 22a36eb, result never posted; since then only the main merge + 1 test fix |
| wip/second-api-cap-dispute | 0b767251 | second-api-cap | **READY** (= 83f814f + main e7636c7 merge, nothing else) | lead review started 2 Nov 07:04 on 83f814f, result never posted |
| wip/second-design-offers-v2 | 8252e887 | second-design-offers-v2 | **READY** after fix round 1 | ~/x2f-comms/review-offers-v2-2026-11-02.md = APPROVED WITH MINOR on 86c58ec3; fixes M1-M7 @3dbd82e3 + reshoot @8252e887, NOT re-reviewed |
| wip/second-price-feeds | f1dea13d | second-price-feeds | **READY** after fix round 1 (from main e7636c7) | ~/x2f-comms/review-price-feeds-2026-11-02.md = APPROVED WITH MINOR on 526650a6; fixes M1-M4, M6 @f1dea13d, NOT re-reviewed |
| wip/second-p3-task34 (API) | c2d1006c | second-t34 | **fix round 1 done**; lands ONLY together with the web branch | ~/x2f-comms/review-task34-multicurrency-api-2026-11-02.md = APPROVED WITH MINOR on 667e5edd; fixes @e78143f9 (red @c586cc1e); c2d1006c = docs only (owner answer #1) |
| wip/second-p3-task34-web | 499a78ba | second-t34-web | **FIX ROUND CUT OFF** (see below) | ~/x2f-comms/review-task34-multicurrency-web-2026-11-02.md = CHANGES REQUIRED on 871a19e5 |
| wip/second-docs-1030-answers | e286489b | second-docs1030 | WAITING ON OWNER (docs pass) | - |
| wip/second-p3-task9-io | 7346fc00 | second-t9io | OWNER HOLD (watcher idea) | round 3 done; held landing on wip/lead-land-t9io-held |
| wip/second-p3-task9-view | 99ba09fc | second-t9view (local branch w2-t9view) | OWNER HOLD | - |
| wip/second-p3-task10 | 305124b7 | second-t10 | OWNER HOLD | round 4 APPROVED WITH MINOR; R4-M1/M2 follow-up after the hold lifts, on a new branch from main |
| wip/second-design-loginapprove-v2 | 3e9a906d | second-design-la-v2 | LANDED (in main e7636c7) | - |
| devices, myoffers-flake, p2-fud | - | second-design-devices, second-flake, second-fud | LANDED | - |

Not mine, don't touch:
- second-t20rest (claude3's)
- second-t24 and second-t27 (landed history)
- second-land-t18 (the lead's)
- lead-p7-retention

## Cut off: Task 34 web fix round (wip/second-p3-task34-web)

The helper (a8968185eefabd39d) hit the 5 h limit on 2 Nov, and the reboot followed.

**Pushed before the cut-off, all UNCHECKED: no test run is recorded after these:**
- ae90af1e: merge of the API fix round e78143f9.
- 7c5b6bb5: My offers reads hidden 'no-price' (API M4).
- 499a78ba: hand merge of offers v2 8252e887.
  - PostOffer keeps the several-currencies structure, with v2's cards, kit titles and icon button.
  - The currency chips get their own selector (web review M8 = done).
  - v2's PostOffer shot fills Band 1.

**Not merged yet:** API docs commit c2d1006c (docs only, harmless).

**NOT done yet (exact next step: one helper in second-t34-web, red tests first, push every commit):**
1. Run tsc web first; the merges are untested.
2. **I1:** unticking down to one currency silently drops the typed per-currency instructions, so the trade signs
   EMPTY instructions. Fix: keep the remaining currency's text (move it into the shared set). Also fix the test at
   postOfferFlex.test.ts:209, which asserts the loss.
3. **I2:** unticking a currency leaves its text behind, and loadDraft then rejects the whole draft. Fix: clear
   the text, and make loadDraft tolerate stale per-currency keys. Test the setup / Add-a-wallet round-trips.
4. **Minors:**
   - M1: a 10-method cap on the web, with an inline message.
   - M2: focus moves to the bad band after a failed post.
   - M3: the currency tabs get roving tabindex, arrow keys and aria-controls.
   - M4: the shared Checkbox for "Same for all currencies".
   - M5: an XMR amount between two bands snaps to the band its fiat total falls in; never "Too high" inside the
     offer's range.
   - M6: the band error is announced once, not on every keystroke.
   - M7: mark the two missing COPY-UNSIGNED strings.
5. **"Add a band":** hide it behind `BANDS_ENABLED = false`, so the form matches the API's standing rule:
   multi-band is refused until Task 35. Owner question #30 is pending.
6. **Owner answer #2 (below) changes how methods and currencies are picked:** a method + currency picker with
   plus buttons. It was given after the review. Do NOT build it before the lead or design confirms the layout;
   finish I1/I2/minors on the current UI first.
7. **Checks**, one at a time under the lock:
   - tsc web
   - full web vitest
   - copy-lint
   - Playwright: post, browse-buy, browse-sell, quote, myOffers, parity, shell, design-shots 61-72 (reshoot the
     changed shots)
   - then a fresh reviewer (not the author) for round 2.

## Landing order and dependencies

1. **selection, cap-dispute, price feeds: independent.** Each is from main e7636c7, with no migrations.
   - Selection and offers v2 both touch the selection/chip styles. After selection lands, offers v2 needs a main
     merge.
   - Then rerun selection-ink.test.ts and offersV2.test.tsx: selection-ink's OWNED_ELSEWHERE list and v2's chip
     rules may clash.
2. **offers v2 next.** It must land BEFORE Task 34, because the Task 34 web branch already contains it.
3. **Task 34 LAST: API + web TOGETHER, never the API alone.**
   - The API now requires `currency` on take and the new post shape, so today's main-line web would get 400s.
   - Migration **117_flex_offers.sql** belongs to Task 34; dev databases that ran an earlier 117 must be dropped
     and recreated (docs/coordination.md).
   - Task 34 and cap-dispute change the same cap code with the same names (`perSide: 3`, `offers_max_per_side`).
     Merge main by hand after cap-dispute lands.
   - Price feeds and Task 34: the price feeds' `route` field is optional, so it should merge cleanly. Still run
     tsc + api vitest after that merge.
4. **Held, don't merge anywhere:** task9-io, task9-view, task10.

## Owner answers collected, not yet in code

- **#1 band coverage = CORRECT as built** (2 Nov). 200-500 covers 200.00-500.99, and the top band ends at its max.
  Recorded in the design note @c2d1006c. No code needed.
- **#2 (2 Nov, verbatim intent):** how a vendor pairs payment methods and currencies.
  - The screen has a dropdown for the payment type and, beside it, a dropdown for that type's currency.
  - A plus sign above or below adds another currency dropdown for that payment type, up to 5 per method.
  - Or the reverse: the currency first, then the payment type, with plus signs adding more payment types for that
    currency.
  - "The method that makes the most sense will be chosen."
  - So: methods CAN be limited to some currencies (the API already has the optional per-method `currencies`
    list).
  - **Not built. Needs the layout choice (method-first vs currency-first) from the lead/design.**
  - My recommendation: method-first, because instructions are per method and vary by currency within a method
    (e.g. a bank transfer in USD vs EUR). Max 5 currencies per offer overall stays.
- **Older decisions** (in the design note "Owner decisions (2026-11-02)"):
  - market +/- % only;
  - whole-unit bands, next band = max + 1;
  - instructions per method + currency;
  - max 5 currencies;
  - no-USD-price refusal via CantDoThat;
  - holds have no end time (a mod lifts them);
  - the freeze rule goes into the lead's Plan 4.

## Open owner questions (numbers as I gave them to the owner on 2 Nov; rec = my recommendation)

**Task 34**
- 3: migration removes old fixed-price offers. Rec: remove them; the alternative is market +0%.
- 4: an unpriced currency's offer detail opens with no rate, and the popup shows on Trade. Rec: yes.
- 5: no-usd-price popup wording. Proposed: "There's no market price for {currency} right now, so this trade
  can't start. This is usually temporary. Try again soon, or pick another currency." Rec: sign it off.
- 6: My offers flags an offer as partly hidden when one of its currencies is unpriced. Rec: yes.
  - The fully-hidden case 'no-price' is built.
- 7: limits of 10 bands per currency, 10 methods, 1000 characters per instruction. Rec: keep.
- 8: expand the 109-method catalog. Rec: its own task after Task 34 (legal check).
- 30: >1 band per currency. Rec: keep the API refusal until Task 35 and hide Add a band.
- 31: method add as a dropdown + cards. Rec: OK for now, design confirms (affected by #2).
- 32: board vs API limits (margin ±10% vs ±50%; method change -5..+10% vs ±20%; 5 vs 10 bands). Rec: API matches
  the board.
- 33: min trades per band as a 0/5/10/50 select. Rec: keep.
- 34: currency chips: follow the board (USD, EUR, GBP, CAD, AUD + More). Rec: yes.
- 35: My offers shows every method name (needs an API methodName). Rec: yes.
- 36: a gift card limited to its country's currency. Rec: yes.
- 37: a team member WITHOUT the Offers role sees payment instructions on the offer detail (existing,
  routes.ts:661/934). Rec: no; Offers role only. This is a privacy call.
- 38: a blank per-currency instructions box posts empty text. Rec: refuse it.
- 39: copy the FlexOffer-Post board in for parity. Rec: yes.

**Price feeds** (full options in docs/superpowers/specs/2026-11-02-price-feeds.md as OC1-OC6)
- 9 (OC1): which sources to enable. Rec: the direct route now; coinpaprika after a Tor shape check.
- 10 (OC2): max disagreement. Rec: 3%, with no price past it.
- 11 (OC3): daily sources. Rec: no.
- 12 (OC4): which currencies. Rec: keep the 45.
- 13 (OC5): users see the feed used. Rec: no.
- 29 (OC6): owner alert when a currency moves to a backup route. Rec: yes, owner-only.

**Cap / dispute**
- 14: cap copy "You can have 3 buying and 3 selling offers." / "Stayed off: over the offer limit." Rec: sign off.
- 15: fixed "3" on screen. Rec: keep until Plan 4 Settings.
- 16: the 30 min dispute wait doesn't pause in maintenance. Rec: leave it.
- 17: My offers footnote "Each offer can cover several currencies." Rec: hide until Task 34 lands.

**Looks**
- 18: link hover colour. Rec: ink.
- 19: XMR unit colour. Rec: orange until design.
- 20: Buy/Sell tab 2px ink border. Rec: yes.
- 21: disabled/sheet-title v2 look app-wide. Rec: keep.
- 22: remove the fixed-price switch. Rec: yes, done in the Task 34 web branch.
- 23: board items not built on the offers screens (Market price card + currency select, per-method icons, section
  counts, Site news link, Deposit row, empty-search heading + Post an offer). Rec: designer.
- New kit looks from offers v2 for design to confirm:
  - the Notice 'info' tone;
  - the 12px radius on every .x2f-icon-button (focus ring shape).

**Devices wording**
- 24-28: team card when empty, "unless you switch them off", "2 of 1 devices", the "Back to log in" label, the
  session-length clause. Rec: designer.

**Other, from reviews**
- Offers v2 N1-N3: the offer list and quote titles are spans; the boards use h1. Rec: an a11y follow-up.
- npm audit: 7 advisories (1 high follow-redirects, fast-uri, glob), from main's lockfile, not my branches. The
  lead's call.

## Test caveats

- **run-check.sh** logs `exit=0` even when npm test fails, and stops before audit/semgrep: read the log, and run
  those two separately.
- **Cap-dispute:** run-check's root `npm test` was killed for low RAM, so packages/relay/moderation/node-proxy
  vitest never ran on that branch (it doesn't touch them).
  - api 1463 + 1 todo, web 1175, PW 115, semgrep 0.
- **Load flakes:**
  - api password.test.ts "Argon2 slots full 503" (passes alone);
  - setup.spec.ts:733;
  - attestation-flow.test.ts:283 (claude3's).
- **Price feeds:** round 1's red run was never observed; round 2's red tests were seen failing (7).
  - api 1505 + 1 todo.
- **Task 34 web @871a19e5:** design-shots 61-63 were skipped; the full web vitest (1190) ran before the last
  quote fix.
- **Last green counts:**
  - selection: web 1177 + the fixed test, PW 450 passed / 46 skipped;
  - offers v2 @8252e887: web 1189, PW 150, shots 66-72;
  - Task 34 API @e78143f9: trade 348, api 1493 + 1 todo.

## Helpers

None running. Every helper from 2 Nov has finished or was cut off. The cut-off one (Task 34 web,
a8968185eefabd39d) left nothing uncommitted. Start the next step fresh from its pushed head 499a78ba.
