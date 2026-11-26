/**
 * A team member's own trade steps: the contract the member trade room (web) follows.
 *
 * Owner 26 Nov 2026 18:41 UTC (Jess): "funding the escrow for sellers, yes as power granted to them
 * by team lead ... and also ... allow them to upload proof and click payment sent ... Each of those
 * are separate abilities that can be granted or taken away." Plus the owner question trades-release
 * (Release coins). Four separate boxes, each ticked or unticked by the account holder only
 * (`PATCH /v1/team/members/:id { abilities, confirmToken }`), none in any preset or role.
 *
 * Every step below also needs the box that reads the trade (See active trades `trades-see-active`
 * for an open trade, See trade history for a closed one), runs inside the member's working hours and
 * trade-size band, and writes the member's own team-log row (`team_audit`, actor_kind 'member', the
 * trade's code and amount) in the step's transaction. Without the step's box: 403 `forbidden`.
 * A trade rule refusal (wrong side, wrong state) is 409 `<rule>` as for the account owner.
 *
 * 1. Fund the escrow (`trades-fund`, row 23; seller side). Needs Hold trade keys (`trades-escrow-keys`).
 *    a. Confirm token, bound to this trade, from the member's own passkey / security key or PGP key:
 *       `POST /v1/confirm/webauthn/start { action: { kind: 'fund-trade', tradeCode } }` → `{ challengeId, options }`,
 *       `POST /v1/confirm/webauthn/finish { challengeId, response }` → `{ confirmToken }`
 *       (or `POST /v1/confirm/pgp/start { action }` / `.../finish { challengeId, code }` → `{ confirmToken }`).
 *       `tradeCode` is the stored (normalized) code, as `GET /v1/trades/:code` returns it.
 *       Single use, 5 minutes, this session only.
 *    b. `POST /v1/trades/:code/events { type: 'fund-started', confirmToken }` → 200 the trade view.
 *       No token → 403 `confirm-required` `{ action: 'fund-trade' }`; a token for another trade, action
 *       or session, used or expired → 403 `confirm-invalid`; one earned with a recovery code → 403
 *       `method-not-allowed`. Log row `fund-started` with `detail.confirmedWith`.
 * 2. Release coins (`trades-release`, row 22; seller side). Needs Hold trade keys.
 *    Same as 1 with `kind: 'release-trade'` and `{ type: 'release-started', confirmToken }`.
 *    Log row `release-started` with `detail.confirmedWith`.
 * 3. Upload payment proof (`trades-upload-proof`, row 68; buyer side). No keys, no confirm.
 *    `PUT /v1/trades/:code/proofs/:id?kind=proof`, `application/octet-stream`, the sealed proof
 *    (`@x2f/proof` encryptProof; 40 bytes to PROOF_MAX_CIPHERTEXT) → 204. `:id` from newProofId().
 *    Only `kind=proof` (evidence and the unblurred copy: 403 `owner-only`); the seller side is 403
 *    `wrong-party`; states secured | paid | refund_requested | disputed (409 `wrong-state`).
 *    Log row `proof-uploaded` (no proof id or size). Reading proofs back stays the owner's.
 * 4. Mark "I've paid" (`trades-mark-paid`, row 16; buyer side). No keys, no confirm, no proof needed.
 *    `POST /v1/trades/:code/events { type: 'mark-paid', fiatCents: '<the trade total, decimal string>' }`
 *    → 200 the trade view (409 `total-changed` if the total moved). Log row `mark-paid`.
 *
 * Unchanged hard rules: a member never takes an offer, accepts a trade (the poster's wallet step) or
 * registers a trade identity (403 `member-cannot-sign`, perms.ts `ownerDeviceOnly`), never confirms
 * payment received, and no step waits or holds. Ticking Release coins or Fund the escrow without
 * Hold trade keys is 400 `release-needs-trade-keys` / `fund-needs-trade-keys` (abilities.ts
 * `ABILITY_REQUIRES`; migration 870's check).
 */

/** The four member trade boxes of the owner's 26 Nov answer, with the confirm action each needs (or null). */
export const MEMBER_TRADE_STEPS = [
  { box: 'trades-fund', route: 'POST /v1/trades/:code/events', event: 'fund-started', confirm: 'fund-trade' },
  { box: 'trades-release', route: 'POST /v1/trades/:code/events', event: 'release-started', confirm: 'release-trade' },
  { box: 'trades-upload-proof', route: 'PUT /v1/trades/:code/proofs/:id', event: null, confirm: null },
  { box: 'trades-mark-paid', route: 'POST /v1/trades/:code/events', event: 'mark-paid', confirm: null },
] as const;
