# Review: wip/third-design-fixes-a @ f068665b (C11), 2026-11-02

Scope: `git diff origin/wip/second-design-devices..f068665b`, the branch's own changes: DisputeRuling copy, the shot-58 fixture, CantDoThat moved to the design v2 dialog, the invite control disabled at 3/3, and the Post offer tab hidden by mayPostOffers. Worktree: ~/x2f-worktrees/review-third-c11 (detached; nothing committed).

## Verdict

**Merge after I1 is settled.** The code is clean and every test passes. One copy finding is real. The new DisputeRuling lines ("Sent to …", "The XMR has already moved") match the spec and plan (A1 dropped), but the web app's own co-sign gate still holds the payout until the appeal window closes. Nothing executes rulings yet either. So the screen states something the code does not do. The fix needs a lead call, because changing the gate is a rule change, not copy.

The touch swipe-to-close does not work on a real touch device (M1). It does not block anything, because OK, the scrim and Escape all still close the dialog.

## Checks run

- Web unit tests (vitest, apps/web): **81 files, 1138 tests passed.** `tsc --noEmit` is clean and copy-lint is clean.
- Playwright, `--workers=1 X2F_CHROMIUM_PATH=/usr/bin/chromium` under `flock ~/x2f-comms/check.lock`: feedback, team, dispute (and dispute-room), login, security, myOffers. **98 passed, 0 failed.**
- A probe spec (since deleted) sent a real CDP touch drag of 150 px down from the grab handle. Events seen: `pointerdown, pointercancel`. The dialog stayed open. This is the evidence for M1.
- Trial merge of the main line (origin/claude/compassionate-johnson-k95ssr @850052d) via `git merge-tree`: **clean, no conflicts.** Main adds only its merge commit over devices 4e65c4c, which this branch already contains. No worktree was touched.

## Rule changes

None beyond copy and UI:
- The ruling and appeal text changed. `rulingAllowsCosign` and `rulingFinal` (apps/web/src/screens/dispute/rules.ts) are **unchanged**. That is the root of I1.
- Team: the invite control is now inert at the limit. The server still refuses with 409 too-many-members, and the popup stays as a fallback (team.spec "a 4th member is refused …" still passes).
- Tab bar: hiding the tab is UI only. The server still refuses a Trades-only member: `apps/api/src/offers/routes.ts:366,373` (`requireSession({ … member: 'offers' })`). A member who opens /post directly still gets the CantDoThat refusal (team.spec:418 passes).

## Findings

### Important

**I1. The ruling copy says the coins have moved, but the app's code would still hold them for the appeal window.**
- Copy:
  - `apps/web/src/screens/dispute/DisputeRuling.tsx:176` shows "Sent to Cake Wallet, address ending …k3Fz." as soon as the ruling is published.
  - `apps/web/src/screens/dispute/rules.ts:265-279` (`appealSentText`) says "The XMR has already moved".
  - `overturnLien` describes a lien on the receiver.
- Code:
  - `apps/web/src/screens/dispute/rules.ts:316-333`: `rulingAllowsCosign` returns false unless `rulingFinal(d, now)`.
  - `rulingFinal` (rules.ts:201-206) is true only for round 2, or for round 1 past `appealUntil` **with no appeal**.
  - So the winner's device will not co-sign the moderator's payout until the 48 h window closes. While an appeal is pending it will not co-sign until round 2, which contradicts "has already moved".
  - The tests lock in the old rule: `apps/web/test/dispute.test.tsx:190-191` ("final − 1 ms → false", "appealed → false").
  - The executor itself is not built either (apps/moderation has no gate or executor; tripwire NEEDS_PLAN_4_MOD_COSIGN). Today nothing sends coins at the ruling or at any other time.
- Spec and plan agree with the new copy:
  - Plan 4 Revision 2026-10-29, "A1 dropped" (docs/superpowers/plans/2026-10-15-plan-4-staff.md:1142).
  - `packages/staff/src/dispute.ts:34-36` ("executed now").
- DisputeView also carries no executed or payout-seen flag. Even once A1 is wired, "Sent to …" would show before the transaction exists.
- Fix (the lead decides the order):
  - (a) Bring `rulingAllowsCosign` in line with A1 dropped: round 1 published, with or without an appeal, through `cosignPolicy`. Update dispute.test.tsx:186-191 to match. Wire it with Plan 4 Task 13. This is a security-gate change, so it needs the lead's sign-off, not just a copy review.
  - (b) Until then, word the destination as what will happen, e.g. "Goes to Cake Wallet, address ending …k3Fz." (COPY-UNSIGNED). Show "Sent" only once the API reports the payout executed.

### Minor

**M1. Swipe down to close does not work on a touch screen.**
- `apps/web/src/ui/Sheet.tsx:118-127` listens for `pointerdown` and `pointerup` only.
- `.x2f-sheet` (`apps/web/src/ui/ui.css:263`) has `overflow-y: auto` and no `touch-action`. On a real touch drag the browser takes the pan and fires `pointercancel`, so `pointerup` never comes. The probe confirmed this: the dialog stayed open.
- The unit test (`apps/web/test/CantDoThat.test.tsx`, the "follows the v2 board" test) passes only because it sends synthetic mouse-style pointer events.
- It does not steal scroll, since there is no preventDefault, so scrolling inside the sheet is safe.
- Fix:
  - Put the drag on the handle, with `touch-action: none` on a ≥44 px-tall handle hit area.
  - Or use touch events (`touchstart`/`touchend`) with the scrollTop===0 check.
  - Add a Playwright check with `hasTouch` and a CDP `Input.dispatchTouchEvent` drag, like the probe.
  - Also reset `dragFrom` on `pointercancel`.

**M2. On the wide dialog, a mouse drag of 64 px or more closes the dialog.**
- `apps/web/src/ui/Sheet.tsx:118-127`: `handle` is still true in the `wide="dialog"` form, where the handle is hidden (ui.css:589).
- A user selecting the refusal text with a downward mouse drag closes it.
- Fix:
  - Ignore `e.pointerType === 'mouse'`.
  - Or only arm the drag when it starts on the handle.

### Nits

**N1. The message is read out twice.**
- `apps/web/src/ui/CantDoThat.tsx:65`: the message is `role="alert"` and also the dialog's `aria-describedby`.
- Many screen readers read it twice on open: once as the description, once as the alert. Before this branch it was only an alert.
- Fix: drop `role="alert"` now that the dialog describes itself. Check feedback.spec:48 (`popup.getByRole('alert')`) and the unit tests that query `[role="alert"]`.

**N2. The Post offer tab can flash for members.**
- `apps/web/src/App.tsx:61,68` with `apps/web/src/session/member.ts:25-28`: `mayPostOffers` is true while the session loads.
- A Trades-only member sees the Post offer tab appear and then vanish on each cold load.
- This is acceptable, because the server refuses anyway. If it matters, hide the tab while `status === 'loading'`.

**N3. The appeal window's hour count comes from `ruledAt`.**
- `apps/web/src/screens/dispute/DisputeRuling.tsx:69`: "(48 h)" is computed as `appealUntil − ruledAt`.
- That is correct only if `ruled_at` is the publish time. With two-person approval, if `ruled_at` were set at proposal time it would read "(49 h)" or similar.
- Confirm that the API sets `ruled_at` at publish (apps/api/src/disputes/routes.ts:148). If not, send `appealWindowH` from the API.

**N4. The team-full popup has an unsigned title.**
- `apps/web/src/ui/cantDoCodes.ts:175-176`: `CANT_DO_TITLE.teamFull` "Your team is full" is marked COPY-UNSIGNED.
- It now shows only as the server fallback. Add it to the copy sign-off list.

## Checked and fine

- CantDoThat as a dialog:
  - `role="dialog"`, `aria-modal`, and `aria-labelledby` pointing at the h2 (the title is still labelled when `lead` is set).
  - Default title "You can't do that yet".
  - No X button. OK is the one `data-primary`.
  - Escape works (handled on the panel, which has focus). The focus trap still works with only one or two focusables (link and OK).
  - Focus returns to the opener on close (Sheet.tsx:68-74, unchanged).
  - The info tile and the handle are `aria-hidden`. The feedback link keeps its tap padding.
- The full-team invite uses `aria-disabled` plus `aria-describedby` pointing at the note, so the control stays focusable and explains why it is disabled. No request is sent (team.spec:153).
- The lien sentences match spec Revision 2026-10-29c "Liens" (an overturned ruling puts the lien on whoever received the coins; a lien blocks trading). They are empty for after-refund and no-action outcomes, because `paidSide` is null for those.
- The parity KNOWN_EXCEPTIONS entries for the two superseded board lines carry clear reasons.
- The cancel flow is not touched, as stated.

## Questions for the lead

1. I1: should C11 hedge the copy now ("Goes to …"), or should A1 be wired into `rulingAllowsCosign` first, with the copy waiting for that? Changing the co-sign gate is a money and security rule, so it may need the owner's confirmation even though the plan already records "A1 dropped".
2. Should "Sent to …" wait for an executed flag from the API? DisputeView has none today.
