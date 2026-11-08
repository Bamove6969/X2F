/**
 * Moderator rulings (Plan 3 Task 10): the only path to `settle` as the moderator besides the
 * guarded auto-refund and buyer-cancel refund. Plan 3 accepts NO ruling: this verifier refuses every
 * input. Plan 4 replaces it with verification of a staff hardware-key signature over the ruling,
 * inside this service. Nothing in this plan calls `settle` on a ruling's behalf.
 */
export function verifyRuling(_r: unknown): false {
  return false;
}
