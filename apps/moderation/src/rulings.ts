/**
 * Moderator rulings. Plan 3 accepted none; Plan 4 Task 13's ruling gate (`gate/`) now decides:
 * `gateCheck` accepts a ruling only when its whole signature chain checks out (the taps against the
 * owner-rooted registry, the two-person rule on this process's own recorded value, the taps against
 * the stored ruling, R37), and names the only payouts the moderator key may co-sign, computed from
 * the addresses this process recorded at escrow setup.
 *
 * NEEDS_TASK_14: nothing calls `settle` on a ruling's behalf yet. The executor (Plan 4 Task 14,
 * `gate/execute.ts`) runs `gateCheck` for each final ruling and settles once.
 */
export { gateCheck } from './gate/check.js';
