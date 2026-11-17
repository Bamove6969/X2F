/**
 * Moderator rulings. Plan 3 accepted none; Plan 4 Task 13's ruling gate (`gate/`) now decides:
 * `gateCheck` accepts a ruling only when its whole signature chain checks out (the taps against the
 * owner-rooted registry, the two-person rule on this process's own recorded value, the taps against
 * the stored ruling, R37), and names the only payouts the moderator key may co-sign, computed from
 * the addresses this process recorded at escrow setup.
 *
 * Plan 4 Task 14: the executor (`execute.ts`) runs `gateCheck` for each disputed trade's round-1
 * escrow ruling and settles what it authorises, once.
 */
export { gateCheck } from './gate/check.js';
