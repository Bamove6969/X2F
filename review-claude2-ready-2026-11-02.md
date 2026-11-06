# Review: claude2's three ready branches (2026-11-02)

Reviewer: review agent for the lead. Main line `origin/claude/compassionate-johnson-k95ssr` @ b6835ee.
All three branches fork from 5bfb450. Each one was reviewed as its own diff (`git diff 5bfb450..<tip>`)
in a fresh detached worktree (`~/x2f-worktrees/review-c2-{cap,login,sel}`, npm ci). Tests ran on the
trial merge of b6835ee into each branch, left uncommitted and aborted afterwards. A fourth throwaway
worktree, `~/x2f-worktrees/review-c2-all`, holds local merge commits of all three on b6835ee; it is
detached, unpushed and can be deleted. Nothing was committed to a branch or pushed. Every check ran
under `flock ~/x2f-comms/check.lock`. Logs: `~/x2f-worktrees/rvc2-*.log`.

## Trial merges

| Branch | Merge of b6835ee | Notes |
|---|---|---|
| wip/second-api-cap-dispute @83f814f | clean | auto-merged rules.ts, cantDoCodes.ts, dispute.spec.ts, dispute/myOffers tests, coordination.md |
| wip/second-design-loginapprove-v2 @3e9a906 | clean | auto-merged ui.css (main's C11 sheet handle and the v2 kit rules sit side by side) |
| wip/second-design-selection @22a36eb | clean | none |
| Branch pairs | clean | `git merge-tree` reports no conflict for any pair; all three merge onto b6835ee in sequence |

## Recommended landing order

1. **second-design-loginapprove-v2**: green, no behaviour change. Land as is, or with M1 (contrast) folded in.
2. **second-design-selection**: after the one-line test fix (I1). Its test is red at its own tip.
3. **second-api-cap-dispute**: last, after I1 (seller copy) and an answer to Q1/Q2. These are the server rules, and the owner should see the dispute-timing questions first. The cap half could land by itself today if the lead wants.

The three branches are independent, so the order only sets risk. The two visual branches go first
because they are green or a one-line fix. The rules branch waits on owner wording and answers.

---

## 1. origin/wip/second-api-cap-dispute @83f814f (C2-A1, server rules)

### Verdict
**APPROVE WITH CHANGES.** The cap is correct and race-safe on every path that puts an offer live. The
dispute timer is enforced on the server with the server's clock. Before landing, fix I1: the seller is
still told the buyer can only ask a moderator once the seller's time runs out. Also put Q1 to the owner:
a flat 30 minutes also applies to bank wires, which have a 24-hour confirm window.

### Checks
| Check | Result |
|---|---|
| typecheck (all workspaces) | pass |
| copy-lint | clean |
| vitest `@x2f/api` + `@x2f/trade` + `@x2f/web` (real Postgres) | 151 files, 2919 passed, 1 todo |
| Playwright pay, post, myOffers, dispute, dispute-room, release (`--workers=1`, `/usr/bin/chromium`) | 105 passed (2.6 min) |
| Probe: maintenance during the 30-minute wait (temporary test, deleted) | confirms M1: marked paid at 40, maintenance 45-105, the buyer may dispute at 106 (confirmBy moved 160 to 220) |

### What I checked (cap)
- **Every path that makes an offer live is capped.**
  - POST `/v1/offers` goes through `assertMayPost` (routes.ts:466).
  - PATCH relist goes through `assertMayPost` with `except = id` (routes.ts:520).
  - The bulk turn-on `POST /v1/account/offers/status` counts the same way in its loop (routes.ts:703-710).
  - There is no offer edit route and no other `insert into offers` or `update offers set status` in apps/api/src.
  - "Unpause" is the PATCH or bulk relist.
  - Team members act as the team account (`AuthContext.accountId` is the team's, sessions.ts:34-37), so their offers count toward the owner's 3.
- **Race.** Each of the three paths takes the account row `for update` first (`lockAccountLive`) and counts inside the same transaction. Two simultaneous posts are serialized. The existing test "six concurrent posts ... create exactly three" still runs on real Postgres and passes. The lock is per account, so the per-side count (posts in different markets) is covered the same way.
- **Count semantics.** Live and paused offers count; removed offers do not, and cannot come back (PATCH 404s a removed offer). Bulk uses one snapshot, so switching statuses inside the loop does not change the count. That is correct because paused offers already count.
- **Settings keys.** `offers_max_per_side` uses the same 1..1000 rule; a missing or bad row means 3. The old `offers_max_per_market` and `offers_max_total` keys are no longer read (tested with both set to 100). No migration is needed (owner_settings has no seed or allow-list). coordination.md tells Plan 4 to seed the new key and drop the old ones.
- **409 shape.** POST and PATCH return `{ error: 'too-many-offers', perSide }`. The bulk result keeps `refused: 'too-many-offers'`. `too-many-offers` was already classified in cantDoCodes; no new code.

### What I checked (dispute timer)
- The rule is on the server: `onDispute` in packages/trade/src/machine.ts:417, applied through the API's `applyEvent` with `deps.clock()` (disputes/routes.ts:224). A client can't send a time.
- `paidAt` is set to the server's `now` at mark-paid (machine.ts:505).
- The web reads the same constant: `TIMERS.buyerDisputeAfterPaidMin` in rules.ts:68 and BuyerPay.tsx:507. It only hides the button; the API still decides.
- Boundaries are tested in the machine (29:59.999 and 29:59 too-early, 30:00 opens, the seller at once) and in the API (29:59 gives 409 `too-early` and writes no event; 30:00 opens before confirmBy).
- `DisputeOpen`'s "time ran out" flag now shows only after `confirmBy`.

### Findings

**I1. The seller's confirm-window tip still says the buyer must wait for the window to run out.**
- Where: apps/web/src/screens/trade/SellerConfirm.tsx:371-373: "Instant apps like Zelle get 2 hours; bank wires get up to 24. If time runs out, {buyer} can ask a moderator to step in."
- Problem: The buyer can now open a dispute 30 minutes after marking paid. The seller gets a dispute while their screen still shows, say, 1 h 30 min "to confirm". This is the one place the seller learns the rule, and it is now wrong in a money flow.
- Fix: Reword it, for example "{buyer} can ask a moderator to step in from 30 minutes after marking paid" (COPY-UNSIGNED, owner wording). Add a unit test that pins the sentence to `TIMERS.buyerDisputeAfterPaidMin`.
- Also: termsText.ts:75 ("within the times the trade screen shows") is still true.

**M1. Maintenance does not freeze the buyer's 30-minute wait.**
- Where: machine.ts:417 measures from `paidAt`, which `onResume` never shifts (machine.ts:384-404). Every other deadline (`confirmBy`, `payBy`, ...) is moved by the length of the pause.
- Effect: a buyer marks paid at minute 40 and maintenance runs from 45 to 105. The buyer can then dispute at 106, though the seller had 5 working minutes, because neither side can act during a pause (`WHILE_PAUSED`). The probe confirms this.
- Fix (no new column): measure from the pause-adjusted paid time, `confirmBy - confirmWindowMin`. That equals `base(t, paidAt)` moved by any pause. So the rule becomes `now < addMin(confirmBy, TIMERS.buyerDisputeAfterPaidMin - t.confirmWindowMin)`. Alternatively, add a `disputeFrom` deadline that `onResume` moves.
- The web needs the same change: rules.ts:66-69 and BuyerPay.tsx:507 should use `confirmBy - window + 30`, or the API view should carry `disputeFrom`. Add a machine test with a pause inside the 30 minutes.

**M2. The cap number is hard-coded in the web copy, while the API cap is an owner setting.**
- Where: cantDoCodes.ts:221 `OFFER_CAP_LINE = 'You can have 3 buying and 3 selling offers.'`, used in the PostOffer and My offers CantDoThat and the My offers footnote.
- Problem: if the owner sets `offers_max_per_side` to 5, the refusal still says 3. The API already returns `perSide` on the POST and PATCH 409.
- Fix: build the sentence from `perSide` when the 409 carries it (fall back to `OFFER_CAP_DEFAULTS`). For the footnote, either accept the default or add the cap to `GET /v1/account/offers`.
- Alternatively, record that changing the setting needs a copy change too (coordination.md).

**N1. Old accounts already over the cap keep their live offers.**
- Before this branch an account could have up to 3 offers per market and 20 in all. Those offers stay live. Only relisting is refused, because paused offers count.
- Bulk turn-on with 5 paused selling offers refuses all 5, not the first 3. That matches the "no grandfathering" counting rule.
- If anything is live in production, decide whether to pause the extras on deploy (Q3).

**N2. The bulk route still selects `method_id, currency` for the count, which is no longer needed.**
- Where: routes.ts:683.
- `method_id` is still needed for `isAvailable`; `currency` is not. Cosmetic.

**N3. Stale comment.**
- Where: DisputeEntry.tsx:1-4 still says "within 90 days" for the refunded case (it has been 48 hours since 10-29).
- Not this branch's text, but the branch edited that comment.

### Questions (owner / lead)
- **Q1 (owner, money rule).** The owner said 30 minutes "is a minimum: Interac can take up to 30 min, others similar or longer" (owner-answers-2026-10-30-lead-window.md:81). The branch uses a flat 30 minutes for every method, including bank wires (confirm window up to 24 h, profiles.ts:85). Should the buyer's wait be per method, for example the profile's own minimum, or `min(confirmWindow, max(30, method wait))`? As built, a SEPA or wire buyer can dispute 30 minutes after sending money that normally takes hours to land.
- **Q2 (lead).** Does a pause (maintenance) stop the 30 minutes (M1)? I assume yes, as with every other trade clock.
- **Q3 (lead).** Are there live accounts over 3 per side? If so, should they be paused on deploy, or left (N1)?
- The branch's own open item: the trading-hold end time was not built (coordination.md C2-A1 last line).

---

## 2. origin/wip/second-design-loginapprove-v2 @3e9a906 (LoginApprove v2 + kit)

### Verdict
**APPROVE (land first).** There is no behaviour change in the login approval. Everything is green on the merge with b6835ee, including the app-wide Sheet and Notice changes. One contrast miss (M1) on the new "Your number" chip in the day theme can go in with it or right after.

### Checks
| Check | Result |
|---|---|
| typecheck | pass |
| copy-lint | clean |
| vitest `@x2f/web` (merged with b6835ee) | 83 files, 1174 passed |
| Playwright login, security, team, myOffers, feedback, dispute, dispute-room | 101 passed (1.8 min) |
| All three branches merged on b6835ee: vitest api + trade + web | typecheck and copy-lint pass; 153 files, 2940 passed, **1 failed** (only selection-ink, selection I1) |

### What I checked
- **Same API calls.** In ApproveOnDevice.tsx and LoginApprove.tsx, only classNames, `header="compact"`, a chip in place of the kicker span, `data-tone` attributes, the `tertiary` variant for "Not now" and `x2f-link--strong` changed. No handler, request, poll or state changed. The number-match radios, block and chooser logic are untouched.
- **a11y.**
  - The heading levels and focus targets are the same (the h2 keeps `tabIndex=-1` and its ref).
  - "Your number" is still read before the number.
  - The Notice keeps its role (`alert` for caution).
  - The new 150 ms transitions are turned off under `prefers-reduced-motion`.
  - The strong link gets a 44 px hit area.
  - Contrast below (M1).
- **The app-wide changes on other screens:**
  - `.x2f-sheet__title` changes 600 to 700 with -0.01em tracking, sheet tops get radius 16 and a 1 px top line, and the wide dialog padding goes from 32 to 28. All 16 `<Sheet>` users pick this up, including main's new CantDoThat v2 dialog (its handle CSS uses only the phone padding, which is unchanged).
  - The caution Notice is now a 10% wash with a 30% border and the triangle icon. It is used in MyOffers, DisputeOpen, SellerConfirm, ApproveOnDevice and LoginApprove. Text is ink on the wash: 12.4:1 night, 15.8:1 day. The icon: 8.4 / 5.2:1.
  - **Disabled buttons app-wide** change from a transparent fill with a line outline to a surface-raised fill with no outline. This is not in the branch brief; see N1. It includes main's C11 "invite disabled at 3/3". Muted text on raised: 6.0 / 5.5:1.
  - Removed: `.x2f-kicker` and the `info-circle` icon. Nothing else in the merged tree uses either; typecheck passes.
  - `.x2f-h2`, the `.x2f-choice` tile look and `.x2f-sheet__kicker` are used only by the LoginApprove screens.
  - `.x2f-flow__footer` now has a ground fill (FlowScreen: LoginApprove and Devices). The desktop card resets it to transparent.
- The e2e change (myOffers.spec.ts:194) follows the new 30% caution border. It doesn't weaken the check: it still compares the border to the caution token.

### Findings

**M1. The "Your number" caution chip fails AA in the day theme.**
- Where: ApproveOnDevice.tsx:192, ui.css:1149 and the number card gradient at ui.css:1120-1134.
- The chip text is 13 px / 600, so it needs 4.5:1. In the day theme, caution `#8a5a00` on the chip's 14% wash over the card's 14% gradient top measures **4.05:1** on the phone and **3.56:1** on the desktop card (surface-raised). Night passes (5.5 / 4.9:1).
- The sheet's "New login" chip on plain surface passes (4.86:1).
- Fix (any one): drop the chip's own wash inside `.x2f-number-card`; start the gradient below the chip; or add a darker day-only `--x2f-caution-ink`, for example `#6f4800`, for caution text on washes. Update tokens.json's caution usage note.

**N1. The disabled-button restyle is app-wide and not in the brief.**
- Where: ui.css:59-65.
- It probably matches v2 section 10. Note it in the branch report or in coordination.md so the reshoot owners know every disabled button changed (for example Team invite at 3/3, PostOffer and Wallets). None of the reshoots in this branch show them.

**N2. Line length.**
- Where: ApproveOnDevice.tsx:10-11 and LoginApprove.tsx:12-13.
- The new comment lines run past the file's usual width. Cosmetic.

### Questions
- None that block landing. Design may want to confirm the app-wide disabled look (N1).

---

## 3. origin/wip/second-design-selection @22a36eb (C2-D2, no orange for selection)

### Verdict
**APPROVE AFTER ONE TEST FIX (I1).** The CSS is right and both themes have high contrast. The branch's own guard test is red at its tip, because it still expects the bottom-nav tab to be orange. That tab was already ink at 5bfb450, which the branch merged. The dispute reason radios are still orange on purpose (owned by claude3 at the time); C11 has now landed, so they can follow (Q1).

### Checks
| Check | Result |
|---|---|
| typecheck | pass |
| copy-lint | clean |
| vitest `@x2f/web` (merged with b6835ee) | **1 failed**, 1159 passed: `selection-ink.test.ts` "no selected-state rule uses the orange accent" |
| Playwright quote, setup, team, security, myOffers, wallets, browse-buy, browse-sell | 171 passed (2.8 min) |

### What I checked
- **Every selected state in the CSS.** Searched all `aria-checked`, `aria-selected`, `aria-pressed`, `aria-current`, `:checked`, `[data-on]` and `__on` rules. The ones still using `--x2f-monero*`:
  - `.dispute-reason[data-on]` and `input:checked` (dispute.css:190, :205): deliberately left (OWNED_ELSEWHERE).
  - The radio's orange focus ring (dispute.css:209).
- No TSX inline style uses a monero token.
- The kit Choice and Switch were already ink on main.
- `accent-color` now has one rule, ink in base.css (checkboxes and radios). The four per-screen orange `accent-color` lines are gone.
- **Contrast.**
  - The 2 px ink ring against surface-raised: 13.4:1 night, 15.6:1 day.
  - The ring against surface or ground: 15 to 18:1.
  - The quote wallet's ink radio dot on raised: same numbers.
  - The setup step bar (`start__seg[data-on]`, now ink) on raised: same.
  - Chromium picks a contrasting check glyph for an ink `accent-color` in both themes.
- **The guard test** (`selection-ink.test.ts`) pins every orange use to an allow-list: the primary action, links, the XMR unit and the hold. That is useful going forward.

### Findings

**I1. `selection-ink.test.ts` fails at the branch tip and on the merge.**
- Where: apps/web/test/selection-ink.test.ts:50 lists `ui/ui.css .x2f-bottom-nav__tab[aria-current='page']` as a selected state that is still orange. That rule is ink at 5bfb450 (ui.css:445-450), and the branch merged 5bfb450 in 22a36eb.
- Received: only the two dispute.css selectors.
- Fix: delete line 50 and rerun the web units.

**M1. Selected chips go from a 1 px to a 2 px border, so wrapped chip rows shift by 2 px on tap.**
- Where: Wallets.css:183, browse.css:120, setup.css:402.
- The base chip border is 1 px (`box-sizing: border-box`, fixed height), so the selected chip grows 2 px wider and its neighbours move.
- Fix: give the selected state `box-shadow: inset 0 0 0 1px var(--x2f-ink)` on top of an ink 1 px border, or a 2 px transparent border on the base chip.
- `.x2f-quote__wallet` and `.x2f-start__choice` already have 2 px base borders, so they don't move.

**N1. The 2 px ink selection ring matches the 2 px ink focus ring.**
- Where: base.css:28-35, offset 2 px.
- A keyboard user tabbing through a chip group can confuse a focused, unselected chip with a selected one. The offset and the raised fill tell them apart, so this is acceptable. Worth one look in the reshoots.

**N2. The setup progress bar is not a selection.**
- Where: setup.css:87.
- It changes from orange to ink. That is fine under "orange only for the one primary", but it is a progress state. Mention it to design.

### Questions
- **Q1 (lead).** C11 (claude3's dispute screens) has landed. Should the dispute reason radios (dispute.css:190, :205, :209) go ink in this branch, or as a follow-up? The guard test makes the follow-up a one-line allow-list change.

---

## Summary for the lead

| Branch | Verdict | Blocking |
|---|---|---|
| second-design-loginapprove-v2 | Approve, land 1st | none (M1 day contrast fix recommended) |
| second-design-selection | Approve after fix, land 2nd | I1: one stale line in its own test (red today) |
| second-api-cap-dispute | Approve with changes, land 3rd | I1 seller tip copy (owner wording); Q1 per-method wait (owner); M1 pause freeze recommended |
