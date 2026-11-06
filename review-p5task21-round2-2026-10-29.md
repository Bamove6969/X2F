# Re-review: Plan 5 Task 21 fix round (round 2), 2026-10-29

Branch `origin/wip/lead-p5-task21` @78d32c3. It already merges the main line 1b2bb3a (Plan 3 Tasks 4 and 23), and the main line head is still 1b2bb3a, so the trial merge is a no-op. The package lock is unchanged from main. Round 1: `review-p5task21-2026-10-29.md`.

## Verdict: CHANGES REQUIRED (Important 1, Minor 6)

Every round-1 finding is fixed or recorded as a lead call (table below). The one new Important is that the fix round committed its own scratch directory. It takes one `git rm` to fix. Fix that and this is APPROVED WITH MINOR; no re-review is needed for that alone.

## Important

**N-I1. `.scratch/` is committed and would land on the main line.** d15259a and 78d32c3 add `.scratch/api.log`, `.scratch/web.log` (63 lines of an earlier red run: "cantDoThat-lint.test.ts (11 tests | 2 failed)"), `.scratch/tsc-api.log`, `.scratch/tsc-web.log` and four helper scripts (`.scratch/codes.ts`, `count.ts`, `p.ts`, `cdc.ts`), with local paths such as `/home/flem/x2f-worktrees/lead-p5-t21`. `.gitignore` has no `.scratch` entry (helper-common tells helpers to use `.scratch` inside worktrees, so other branches will commit it too). Failure: the merge puts stale red test logs and throwaway scripts on the main line, and the next helper that writes `.scratch/web.log` in its worktree gets a dirty tree or a conflict. Fix: `git rm -r --cached .scratch`, and add `.scratch/` to `.gitignore`.

## Round-1 findings, checked

| # | Builder's claim | Checked |
|---|---|---|
| I1 | `last-login-method` in CANT_DO_CODES; Methods uses CantDoThat | Yes. `cantDoCodes.ts`. Methods.tsx:81/94/111 (client precheck and 409) open CantDoThat with `from=last-login-method`. A test pins the code to `ApiErrorCode` and rejects `only-login`. security.spec now checks the popup and its link (e2e passes). |
| I2 | Judged per string; imports exempt nothing | Yes. `copy-lint.ts` judges each piece. Only the two home files and text written straight into `<CantDoThat title/body/from>` pass. Tests cover a type-only import, a bare import and an import plus a refusal. `already-waiting` moved into the text map. |
| I3 | Wider words; every code classified | Yes. REFUSAL_WORDS has the 13 extra forms (tested one by one). The classification test reads `ApiErrorCode`, `KeyRefusal`, every `.code ===`/`!==` and every `switch(…code)` case in `apps/web/src`: 0 unclassified, more than 60 known. `too-soon` (nudge) now opens CantDoThat in SellerRefund. |
| M1 | `touch: false`; copy softened; residual recorded | Yes. The route sets `touch: false`. The test moves the clock forward 60 s and checks `last_seen_at` is unchanged (not vacuous). The hint now says "We don't record who sent it". The residual and the shuffle option are in coordination.md as a lead call. |
| M2 | allowHeld exception documented and tested | Yes. `sessions.ts:199-202` comment. The test proves the session really is held (`/t/held-check` gives `recovery-hold`), then 202. |
| M3 | Count given back on a failed insert | Yes. try/catch in `form.ts`. The test renames the table, sends 5 times (500 each), then 5 sends pass. The bucket token is still spent, which is fine. |
| M4 | `(created_on, id)` cursor | Yes. A row comparison with `order by created_on desc, id desc`, consistent. The test pages a day holding more than 50 rows with nothing lost. |
| M5 | Tab, ZWNJ and ZWJ accepted; bidi, BEL and ZWSP refused | Yes. `HIDDEN = /(?![\n\t‌‍])[\p{Cc}\p{Cf}]/u`. Tests cover U+202E, U+2066, U+0007 and U+200B (400), plus a tab, Persian with ZWNJ and a ZWJ family emoji (202). The web shows a real 400 message (`FEEDBACK_BAD_TEXT`). |
| M6 | Signed-out told first; draft kept | Yes. A "Log in ... it is kept while you log in" line appears before the form, Send is disabled, and the draft is kept in sessionStorage and cleared on a successful send (tested). |
| M7 | Focus after Send | Yes. The "Feedback sent" h1 has `tabIndex=-1` and gets focus (tested). |
| M8 | Pragma only in real comments; counts capped | Yes. Comments are found outside string, template, JSX-text and regex ranges. Tests cover a pragma inside a string, inside JSX text and two lines away. Ratchets: todo ≤ 4 (all in `auth/refusals.ts`, owner named in coordination.md) and `not-a-refusal` ≤ 34. |
| M9 | Migration 306 | Yes. `306_feedback_form.sql`. Unique across `origin/wip/*` and `origin/claude/*`; no other 3xx file exists yet. coordination.md records 306 as taken. The e2e test name is fixed. |

## Attack on the new fault exemption (`TRY_AGAIN`, copy-lint.ts)

All 51 pieces in today's `apps/web/src` that carry refusal wording and are skipped by TRY_AGAIN are real faults: "Could not load ...", "Couldn't ... Try again", "Your device can't settle/confirm ...", and "Too many tries. Try again in" (`slow-down`, classified as not a refusal). **No real refusal slips through today.** The exemption is whole-piece and keyword-based, though, and probes show natural refusal copy passes (0 findings each):

- "You can only nudge once every 10 minutes. Try again later."
- "You can't post more than 2 offers per side. Try again once one ends."
- "Your account is on a trading hold, so you can't trade. Try again after the dispute."
- "You can't add another security key to your device list: the limit is 5." (`your device` matches anywhere)
- "Sorry, you're limited to 2 offers per side. Reload the page after removing one."

The code check is the backstop: such a sentence normally sits next to a `case 'code':` or `.code === 'code'` literal, which is still judged, and a new code fails the classification test. That keeps this Minor (N-M1).

## Minor

- **N-M1. Narrow TRY_AGAIN** (`tools/copy-lint.ts`, the `TRY_AGAIN` regex). Skip a piece only when it *starts* with a fault opener (`^(?:X2F )?(?:could(?:n['’]t| not)|your device (?:can['’]t|couldn['’]t))`), or when it also has no strong rule word (`sorry|limited|only|once every|too many|maximum|at most|hold|not allowed|not permitted|already have`). Add the five sentences above as test cases that must be flagged.
- **N-M2. Refusal text laundered through the text map.** Constants exported from `ui/cantDoCodes.ts` (`LAST_METHOD_MESSAGE`, `NUDGE_TOO_SOON`, `RECOVERY_SESSION_WALLETS`, `*CantDoText()`, and the `*_CODE` constants) carry no wording or code literal at the place they are used. So `if (e.code === LAST_METHOD_CODE) setError(LAST_METHOD_MESSAGE)` passes the lint (probe: 0 findings). Every current use is correct (Methods:111 and SellerRefund:203 go straight into CantDoThat attributes; Wallets/Quote/PostOffer show the same text inline only after the popup is closed, by design). Either flag a text-map identifier used outside a `<CantDoThat>` attribute, a `take/post/walletsCantDoText` return or a `refusal` state, or document the limit at the top of cantDoCodes.ts.
- **N-M3. Smaller lint gaps (probes).** A code in a template literal (`` c === `trading-hold` ``) and a code as a bare object key (`{ lien: '...' }`) are not seen by the lint or by the classification scan. A quoted Record key (`{ 'trading-hold': ... }`) is caught. These are unlikely in practice, so add them to the scan or skip them knowingly.
- **N-M4. `no-extensions-left` is in CANT_DO_CODES, but no screen routes it.** SellerRefund hides "Give 30 more min" once `canExtend` is false. If a second tab, or a stale view, posts `extend` and gets 409 `no-extensions-left`, `go()` falls into `setError(true)` and shows the generic try-again. That message tells the user to retry, and retrying never works. Route it to CantDoThat in `go('extend')`, or move the code to NOT_REFUSAL_CODES with that reason.
- **N-M5. The owner's offer-cap sentence is not used.** The owner gave "Sorry, you're limited to 2 offers per side ..." for the limit popup (owner answers, line 65). `postCantDoText('too-many-offers')` says "You have as many offers as you can post for now. ..." (Task 4's wording). The per-side cap is a later Plan 3 change, so this may be deliberate. If so, record it with a tripwire or a coordination line so the owner's sentence goes in when the 2-per-side cap lands.
- **N-M6. The feedback draft outlives the account in the tab.** `x2f.feedback-draft` (sessionStorage) is kept through log-out. Failure: on a shared device, A writes an anonymous draft, logs out, and B logs in in the same tab; B's form opens prefilled with A's text, and B can send it named. Clear the draft on log-out, or store it keyed to the signed-in account (the draft survives only the log-in round trip it exists for).

## Landing notes

- 78d32c3 already contains the main line 1b2bb3a; the main line has not moved since. There are no conflicts, and the lock is unchanged (no `npm ci` drift).
- The landing touches files Task 4/23 also own: `PostOffer.tsx`, `offerForm.ts`, `BuyerPay.tsx`, `PaidFlowSheet.tsx`, `SellerRefund.tsx`, `TradeRoom.tsx`, `refundRules.ts`. The changes there are pragma comments and the nudge popup only. pay/refund/post Playwright and vitest pass.
- `schema.test.ts`'s migration lists include `306_feedback_form.sql`. When Plan 5's 301-305 land, they sort before 306, so each lands as a one-line list edit; on an existing database they run after 306 (no dependency between them).
- `wallets.test.tsx` failed once in the full web run here ("?add=1 ... stays and shows the wait", "no input #confirm-password") and once in round 1 (a different case in the same file). It passed 3/3 on its own both times. It looks like a timing flake in its `settle()` under load, not this task. Worth a separate look: the file now flakes regularly in full runs.

## Test results (78d32c3; under `flock ~/x2f-comms/check.lock`)

- `npm ci` (npm 11.21.0): OK
- `tsc --noEmit`: apps/api 0 errors, apps/web 0 errors, packages/auth-client 0 errors
- `copy-lint`: "apps/web/src is clean"
- api vitest (feedbackForm, purge, logs, schema): 4 files, **107/107 passed**
- web vitest (full `@x2f/web`): 58 files, **845/846**. 1 failure in `wallets.test.tsx` (above), which passed **3/3** run on its own.
- Playwright (feedback, post, quote, wallets, pay, security, refund): **121/122** (3.6 min). 1 failure: `pay.spec.ts:327` "the warned cancel and the seller's room at 360x640 fit" timed out after 5 s waiting for "Waiting for mira.k to pay". The error snapshot shows that text on screen, so it rendered late under load. pay.spec run on its own: **18/18 passed**. Task 21 changes only pragma comments in BuyerPay/PaidFlowSheet, so I read it as a load flake. The webServer exited with each run.
