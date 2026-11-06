# Re-review round 2: Plan 3 Task 40 (foldable phones), 2026-10-30

Branch `origin/wip/lead-p3-task40` @ c820fbc (fixes b5b2973, d973a1f; docs a824133, c820fbc; main line 414e722 merged in 314a926). Read-only reviewer, detached worktree `~/x2f-worktrees/rv-t40r2` (now removed). Answers `review-task40-2026-10-29.md`.

## Verdict: APPROVED WITH MINOR (0 Important, 5 Minor)

Every round-1 item is fixed in the code and pinned by tests. I checked the code, not the commit messages. The fixes add no regression of Important weight.

## Trial merge with the main line (d48033f, Task 36 My offers)

`git merge-tree origin/claude/compassionate-johnson-k95ssr c820fbc` gives one conflict, in `docs/coordination.md` only: the Task 36 section and the Task 40 section are both appended at the end. Keep both.
- `apps/web/src/App.tsx` auto-merges: Task 36 adds a route and Task 40 changes the shell.
- My offers (MyOffers.tsx, myOffers.spec.ts) does not key on a breakpoint, matchMedia or `wide`, so the move of the wide layout from 1024 px to 1000 px does not touch it.
- `apps/web/test/app-routes.test.ts` guards duplicate routes. Run tsc and vitest after the real merge, as usual.

## Test runs (one at a time under the lock, worktree @ c820fbc)

| Command | Result |
|---|---|
| `tsc --noEmit -p apps/web` | pass |
| vitest fold, css-collisions, app-routes | 3 files, 13 passed |
| vitest buyerPay, payModel, payRoom, pay-tripwires, tradeFund, tradeRoom, tradeRoomEscrow, tradeRoom-tripwires, logout-tripwire, usePush, fold, css-collisions | exit 0, all passed |
| Playwright `--workers=1` fold.spec + shell.spec (X2F_CHROMIUM_PATH=/usr/bin/chromium) | 28 passed (fold 24, shell 4), **0 skipped**. The pinned Chromium reports `(device-posture: folded)` under CDP `devicePosture`, so the cover tests really ran. |

## Round-1 findings

- **I1, verified fixed.**
  - `Panes` no longer hides `main` in `cover`. fold.css only makes `.x2f-panes` a flex column, with the glance first.
  - The room still passes `glance={broken ? null : …}` (TradeRoom.tsx:278), so on an integrity failure the screen's alert is the first content in every layout, including cover.
  - TradeGlance no longer shows the API's `escrowChip`. It shows the device's own `stoppedText` / `refusalText` (TradeGlance.tsx:19, 32-36).
  - e2e coverage:
    - cover + stopped escrow shows the warning on the card (fold.spec:300);
    - `participants-mismatch` alert is visible at 390, 840, 1100, 412x430, cover and tabletop (fold.spec:308).
  - Focus order in cover: the card holds no controls, then the room. The card is checked to have no `a/button/input/select/textarea`.
- **I2, verified fixed.**
  - `cover` now needs `(device-posture: folded) and (max-width: 599px) and (max-height: 479px)` (fold.ts:38). Segments are checked first in `foldLayoutOf`.
  - Fallback on browsers without the Device Posture media feature: an unknown media feature makes the whole query false, so they get `phone`, never `cover`. That is the safe direction.
  - Even when the query matches, the room stays under the card (Panes.tsx, fold.css), so a misdetection costs one card's height.
  - e2e coverage: 412x430 split screen and 500x450 window both stay `phone`, with the primary visible and enabled (fold.spec:335). The 360x640 → 360x360 keyboard shrink keeps the layout, the focused input and typing (fold.spec:346).
- **I3, verified fixed.**
  - `.x2f-sheet-layer` keeps `inset: 0` in every layout (ui.css:247), and the backdrop is `inset: 0` inside it. Only the panel (`> .x2f-sheet`) is narrowed, and only under `@media (horizontal-viewport-segments: 2)` (fold.css:176-186) or in `three`, which exists only with segments.
  - The layer is a flex column with the default `align-items: stretch`. An explicit width therefore left-aligns the panel in pane A, and `width: auto; margin-left: fold-b` fills pane B. Tabletop caps the panel's `max-height` to the bottom half.
  - Focus trap and Escape in Sheet.tsx are unchanged.
  - e2e coverage: at 800 px without a hinge, the backdrop and dialog are ≥ 799.5 px wide and three points behind the sheet hit the layer (fold.spec:149). With a hinge the dialog stays left of it (fold.spec:195), and in tabletop it stays below the hinge (fold.spec:256).
- **M1, verified fixed.** The longhand regex, colour functions (oklch/oklab/lab/lch/color-mix/hwb) and common named colours are banned. A self-test checks that the regex catches the longhands (fold.test.tsx:148-164). fold.css passes.
- **M2, verified fixed.** trade.css:38-56 applies `height: 100dvh` and the scrolling body for `data-fold='two'|'three'`, and fills the segment in tabletop. Nothing changes for `wide`. Not pinned by an e2e at ≥ 1000 px with segments (see m5).
- **M3, verified fixed.** `ChatButton` closes its sheet when `useChatPane` turns true, and renders `open && !paned` (BuyerPay.tsx:343-360). e2e: the draft moves to the side pane, with one `#msg` and no dialog (fold.spec:170).
- **M4, verified fixed (better than asked).** The primary Chat is no longer marked `data-chat-link`. In panes it stays visible and moves focus to the chat pane (`focusChatPane`). The rule in the TradeRoom.tsx header says so. e2e: fold.spec:181.
- **M5, verified fixed.** `logOut` calls `forgetKeptText()` after `clearFeedbackDraft()` (usePush.ts:104-107). Every log-out button goes through `logOut`. If `POST /v1/logout` throws, neither draft is cleared; that matches the feedback draft and is acceptable.
- **M6, verified fixed.** The fold.css header now names the top-level rules.

Scope items from round 1 are recorded as follow-ups in Plan 3 Task 40 and in coordination.md (a824133, c820fbc): Fold-Offers, the tri-fold's third pane, the app-wide cover card, tabletop for other screens and the dispute room, Fold parity, the 1000–1023 px check, and Task 20's `useKeptText`. Acceptable as lead defaults.

## New findings (all Minor)

- **m1. Duplicate live-region alert in tabletop and cover.**
  - Code: TradeGlance.tsx:33 renders the stopped-escrow sentence with `role="alert"`, and the room's own notice renders the same sentence with `role="alert"` too (BuyerPay.tsx:508, :662).
  - Scenario: the escrow stops while the phone is in tabletop. A screen reader announces "…Don't send any money until it runs again." twice.
  - Fix: drop the role on the glance's copy (plain `<p>`). The main pane's alert is the one announcement, and the glance is a visual summary.
- **m2. The glance shows refusals regardless of phase and role.**
  - Code: TradeGlance.tsx:19 uses `refusalText(escrow.refusal)` with no `done`/`settled-without-device` check, unlike SellerRefund/BuyerRefund (BuyerPay.tsx:624 `done || stopped ? null : …`).
  - Scenario: a refusal stays set after the trade settled without the device. The card says "Your device couldn't settle this trade. Open a dispute." while the room says it is done.
  - The sentences are also buyer-worded ("after you paid", "Don't send any money") and are shown to a seller.
  - Fix: compute the warning as the screens do. Return null when `phase === 'done' || phase === 'settled-without-device'`, and use the role's sentence, or the general one for a seller.
- **m3. The flip cover's room has a dead Chat link.**
  - Code: TradeRoom.tsx:332, `if (!wanted || chatPane || layout === 'wide' || layout === 'cover') return null;`.
  - This was right while cover hid the room. Now the room is visible under the card, so SellerRefund's `#chat` link (SellerRefund.tsx:63, not hidden in cover by fold.css) changes the hash and nothing opens.
  - Fix: drop `layout === 'cover'` from the condition. In cover the sheet behaves as on a phone.
  - Add an e2e test: in cover, tapping SellerRefund's Chat opens the dialog.
- **m4. Focus drops to `<body>` when the Chat sheet closes on unfold.**
  - Code: BuyerPay.tsx:345-347 closes the sheet. Sheet.tsx:36's cleanup then focuses `before`, the header Chat button, which is now `display: none` under `[data-chat-link]`. The focus lands on `<body>`.
  - Scenario: a keyboard or screen-reader user typing in the sheet unfolds the phone. The focus is lost, although the same draft is right there in the side pane.
  - Fix: when the sheet closes because `paned` turned true, call `focusChatPane()` after close, for example in the effect via `requestAnimationFrame`, or in a `useLayoutEffect` after Sheet's cleanup.
- **m5. Glance content differs from the boards, and the cover detection may be unreachable on real devices. Record both rather than change code now.**
  - The fix removed the board's status pill from the glance (Fold-Tabletop.dc.html:25-27, "Waiting for your payment" / "Paid · waiting for …"; round 1 had filled it with the API escrow chip) and the cover's "Open your phone to keep going." (Fold-Cover.dc.html:43).
  - Both removals are reasonable: the API chip was the I1 problem, and the sentence is wrong now that the room stays under the card. Still, Claude Design owns the looks, and there is no `NEEDS_DESIGN_*` tripwire or design note.
  - Fix: add a line to the Plan 3 Task 40 follow-ups / coordination.md (or a `NEEDS_DESIGN_FOLD` tripwire) asking the design for a state pill from `view.state` and the role (not the escrow chip) and for the cover's wording now that the room is below.
  - Detection: the Device Posture spec defines `folded` as a device that is partly folded (book or laptop posture). The spec does not say what a closed flip's outer screen reports, and Chrome on Android very likely reports `continuous` there. The cover layout may therefore never turn on in practice (it fails safe to `phone`).
  - Note it next to the "app-wide cover card" follow-up so that work starts from a real-device check.
  - Also not pinned: M2's paned phone scroll at ≥ 1000 px with segments. A 1000x840 vertical-hinge test asserting `[data-primary]` stays in the viewport would cover it.

## Landing notes

- Resolve the coordination.md conflict by keeping both sections, then run tsc and vitest (web) plus fold, shell and myOffers e2e on the merge.
- m1–m4 are one-line fixes each; they can go in at landing or as a follow-up. m5 is documentation only.
