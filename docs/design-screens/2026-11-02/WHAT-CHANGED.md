# Reshoot 2 Nov 2026 (wip/lead-design-results)

Only the shots this branch changes, night and day, 412x915, made by `apps/web/e2e/design-shots.spec.ts`
(`X2F_DESIGN_SHOTS=1 X2F_DESIGN_SHOTS_DATE=2026-11-02`). Test fixtures only.

- 39 the buyer after I've paid: BuyerPaidWaiting board (status, time left to confirm, what happens next, Your payment folded, Nudge, dispute with when, no-cancel line).
- 48 the buyer's refunded trade: Refunded board, time-ran-out variant (fixture now satoshi_ghost, timeline in order).
- 60 News, 62-63 Feedback, 64 Block confirm sheet: their boards.
- 04, 05, 12, 13, 14-18: dates now "6 Nov 2026, 15:00 UTC" (one formatter, ui/dates.ts).
- 36, 37, 38, 40-43: durations with mono digits and body-face units ("1 h 52 min").
- 61, 65: unchanged screens, reshot with their tests.

## Reshoot 6 Nov 2026 (after merging main 55bc70f9 and the ui.css fix)

Same command and size. A My offers merge had left `.x2f-timer__label {` open with no body, so every
rule after it in ui.css was dead (tick box, action bar, select card, timer value/ring, inline action,
footnote, field label, the bell's desktop hiding and more). That is fixed, so many shots move back
to what the CSS says:
- 31-35 My offers: an "off" card is transparent with a dashed border (main's rule); the selected
  "off" card keeps the dashed border with the ink ring. Main's committed shots predate that rule.
- 39, 48, 60, 62-64: their boards with the kit parts (I2): Feedback's kind is the ChoiceGroup cards,
  Refunded "X2F fee: None" and the Decision 7 lead naming the seller, Block's danger-outline.
  62 is now full page: FlowScreen's footer is not pinned, so Send is below a 915 px screen.
- 04, 05, 12-18, 36-43: dates and durations as before; 04's CantDoThat sheet is main's new one.
- New here: devices' 01-03, 06-08, 10, 11, 11w, 30 (they match main's LoginApprove v2 shots apart
  from clock times; the wide header is about 10 px taller because of the Site news bell), and the
  date-format shots 45 (seller cancel), 58-59 (dispute room and ruling, "10:14 UTC").
- Devices' "Log out all other devices" spans its panel again: this branch's
  `.x2f-panel > .x2f-button { align-self: flex-start }` is now scoped to the trade room.
- 51-56 (fold) are not reshot: they are fold's shots. In this session, 56 (tabletop) rendered the
  desktop layout under `data-fold="tabletop"` on three runs after one run gave the tabletop layout;
  left for the fold branch.
