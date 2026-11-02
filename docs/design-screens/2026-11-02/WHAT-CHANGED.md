# Reshoot 2 Nov 2026 (wip/lead-design-results)

Only the shots this branch changes, night and day, 412x915, made by `apps/web/e2e/design-shots.spec.ts`
(`X2F_DESIGN_SHOTS=1 X2F_DESIGN_SHOTS_DATE=2026-11-02`). Test fixtures only.

- 39 the buyer after I've paid: BuyerPaidWaiting board (status, time left to confirm, what happens next, Your payment folded, Nudge, dispute with when, no-cancel line).
- 48 the buyer's refunded trade: Refunded board, time-ran-out variant (fixture now satoshi_ghost, timeline in order).
- 60 News, 62-63 Feedback, 64 Block confirm sheet: their boards.
- 04, 05, 12, 13, 14-18: dates now "6 Nov 2026, 15:00 UTC" (one formatter, ui/dates.ts).
- 36, 37, 38, 40-43: durations with mono digits and body-face units ("1 h 52 min").
- 61, 65: unchanged screens, reshot with their tests.
