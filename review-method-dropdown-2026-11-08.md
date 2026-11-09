# Review: live-method picker on Main / BuyMain (owner 2026-11-08)

- Branch: origin/wip/lead-method-dropdown, head ac907739 (merge base main 687ae821)
- Reviewer: independent (Opus), read-only
- Verdict: **APPROVED WITH CHANGES** (one Minor a11y fix recommended; nothing blocking)

## Checks run

- `npm test -- --project @x2f/web`: 89 files, 1278 tests passed.
- `tsc --noEmit` (apps/web): clean.
- Playwright `browse-buy.spec.ts browse-sell.spec.ts` (1 worker): 44 passed, 1 failed:
  `browse-buy.spec.ts:189` (360x800 BuyMain parity), the live list had not loaded within 5 s (page snapshot shows header only).
  It passed when I reran the phone tests 3 times (18/18). It is a flake, and the old line had the same wait (`main a` first), so this change did not cause it.

## Does it do what the owner asked

Yes. The owner asked for "a drop down of all the currently available selected payment method in chosen currency". The live section is now one card:
- a button "Payment method: <name>" (`aria-haspopup="dialog"`, `aria-expanded`) opens a Sheet (a bottom sheet on the phone, a centred 520 px dialog on desktop);
- the sheet lists every method in `live` for the current side and currency as radios, each with the same line as before (count and best rate).

The row under the button links to `/{side}/{id}?currency={cur}` for the method shown.

## Correctness (verified in code)

- Counts and rates come from the same `sub()` and the same `load.lists.live` as before (MethodList.tsx:83-84, 157-160). Nothing is cached in the picker. It gets `live` and `value` on every render.
- Currency change: `sections` is empty until the new currency's lists land (MethodList.tsx:69), so the card unmounts and old numbers never show with the new currency. `picked` is just an id. `methodShown` (MethodPicker.tsx:17-19) keeps the method if it is live in the new currency and falls back to `live[0]` if not. The non-null `!` at MethodList.tsx:157 is safe because the `pick` section exists only when `live.length > 0`.
- Link: `withCurrency(`/${side}/${encodeURIComponent(m.id)}`)` is the same builder the rows use. The e2e tests check `/sell/CASH_APP?currency=USD` and `/buy/<id>?currency=USD`.
- Nothing lost from the old list:
  - search still lists every hit as plain rows, including live ones;
  - "All payment methods" still excludes the live ids, and those stay reachable through the picker;
  - the no-match empty state and Suggest are unchanged;
  - with no live method there is no card (unit test).
- Privacy: no new data. Everything shown was already in the list rows.

## Accessibility

Good:
- a real button;
- the Sheet is `role=dialog` + `aria-modal`, labelled by its title;
- the radiogroup is labelled;
- Tab is trapped inside the sheet, and focus goes back to the button on close (e2e checks both tap and keyboard);
- Escape closes;
- arrow keys change the choice without closing (detail-0 click check), and Enter/Space close the sheet;
- rows are 52 px and options are 44 px or more (e2e measures them);
- the link's name is "<method> <line>" through `aria-labelledby`.

## Findings

### Minor

1. **Keyboard focus lands on the sheet panel, not on the checked radio.** MethodPicker.tsx:78 passes no `initialFocus`, so `Sheet` focuses the panel (Sheet.tsx:74-75). A keyboard user has to Tab past "Close" before the arrow keys do anything. The keyboard e2e test hides this by calling `.focus()` on the Zelle radio directly (browse-sell.spec.ts:92).
   Fix: add `initialFocus="input:checked"` (the API already exists and is used by ReleaseWarning and CancelFinalSheet). Then change the test to press Enter on the button and assert the checked radio is focused, with no manual `.focus()`.
2. **No integration test for picked-then-currency-change.** `methodShown`'s fallback is unit-tested (methodPicker.test.tsx), but no MethodList test checks the full path: pick Cash App in USD, switch to EUR, and confirm the card falls back to SEPA with EUR numbers (and keeps a method that is live in both). Optional; the logic is small.
3. **Flaky phone test** (browse-buy.spec.ts:189). It uses the default 5 s wait for the first list load. This was already the case before the branch, but noting it because it failed once in this run.

No Critical or Important findings. None of the tests were weakened. Each removed "first live row contains Zelle / line / href" assertion was replaced by stronger role-based ones: button name + `aria-haspopup`, exactly one link, link name + href.

## User-facing strings added

- "Payment method: " (visually hidden prefix on the picker button, read as "Payment method: Zelle").
- No other new text. The sheet title and radiogroup label reuse `liveTitle` ("Buyers paying in USD" / "Sellers taking USD"), the option notes reuse `liveRow`, and "Close" is the Sheet's existing label.
