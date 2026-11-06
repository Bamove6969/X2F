import type { KeyRefusal } from '@x2f/accounts';

/** Every error code the API answers with, for all plans. Plan 3 appends its codes here. */
export type ApiErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'unsupported-media-type'
  | 'internal'
  | 'busy'
  | 'display-name-invalid'
  | 'display-name-reserved'
  | 'display-name-taken'
  | 'login-name-invalid'
  | 'names-unavailable'
  | 'names-same'
  | 'login-name-set'
  | 'password-weak'
  | 'password-leaked'
  | KeyRefusal
  | 'key-in-use'
  | 'challenge-expired'
  | 'code-invalid'
  | 'credentials-invalid'
  | 'slow-down'
  | 'locked'
  | 'not-authenticated'
  | 'account-disabled'
  | 'wrong-account-kind'
  | 'confirm-required'
  | 'confirm-invalid'
  | 'recovery-session'
  | 'recovery-hold'
  | 'method-not-allowed'
  | 'last-login-method'
  | 'webauthn-failed'
  | 'security-key-limit'
  | 'origin-refused'
  | 'address-invalid'
  | 'address-integrated'
  | 'wallet-exists'
  | 'terms-not-accepted'
  | 'terms-required'
  // Plan 2 Task 16: new-device approval.
  | 'approval-ended'
  | 'too-many-devices'
  // Plan 2 Task 17 (review round 2 N-I3, N-M3): a session whose login waits may not end, vet or
  // hide what a stronger login does.
  | 'weak-session'
  // Plan 3 (Task 3 onwards).
  | 'price-unavailable'
  // Plan 3, Task 4: posting and relisting offers.
  | 'method-unavailable'
  | 'no-wallet'
  | 'trading-hold'
  | 'trading-paused'
  | 'too-many-offers'
  // Plan 3, Task 6: the trade events route and the state machine's refusals.
  | 'event-not-allowed'
  | 'wrong-state'
  | 'wrong-party'
  | 'too-early'
  | 'too-late'
  | 'no-extensions-left'
  | 'not-releasable'
  | 'total-changed'
  // Plan 3, Task 5: taking an offer and the poster's wallet.
  | 'own-offer'
  | 'out-of-range'
  | 'not-enough-trades'
  | 'wallet-not-ready'
  | 'already-waiting'
  | 'ad-busy'
  | 'price-changed'
  | 'starter-limit'
  | 'offer-busy'
  // Plan 3, Task 8: participant identities and the moderation attestation.
  | 'identity-exists'
  | 'identity-conflict'
  | 'bad-proof'
  | 'attestation-refused'
  | 'trade-closed'
  // Plan 3, Task 20: the encrypted chat.
  | 'own-offer'
  | 'chat-not-ready'
  | 'stale-seq'
  | 'wrong-channel'
  | 'wrong-sender'
  | 'chat-unavailable'
  // Plan 3, Task 27: a second dispute on one trade.
  | 'dispute-exists'
  // Plan 3, Task 26: the nudge sender's own limits.
  | 'too-soon'
  | 'no-shared-context'
  // Plan 5, Task 3: reviews and the rate-first gate.
  | 'not-reviewable'
  | 'review-exists'
  | 'review-pending'
  // Plan 5, Task 3: @x2f/reputation's ReviewError codes, answered as 400 (reviews/routes.ts checks
  // at compile time that every ReviewErrorCode is listed here).
  | 'bad-shape'
  | 'bad-stars'
  | 'bad-phrase'
  | 'duplicate-phrase'
  | 'bad-trade-badge'
  | 'duplicate-trade-badge'
  | 'note-too-long'
  | 'note-multiline'
  | 'note-bad-character'
  | 'note-personal-details'
  | 'neutral-with-details'
  // Plan 2, Task 18: team members.
  | 'owner-only'
  | 'forbidden'
  | 'too-many-members'
  | 'member-cannot-sign'
  // Plan 4, Task 4: staff login hours (a login, or an open session, outside the window).
  | 'outside-login-hours'
  // Plan 5 Task 10 on the staff API: the past-rep claim is no longer live (revoked, removed, rejected).
  | 'not-live'
  // Plan 5, Task 10: past reputation claims.
  | 'bad-site'
  | 'bad-url'
  | 'bad-signature'
  | 'wrong-text'
  | 'wrong-key'
  | 'challenge-used'
  | 'site-claimed'
  | 'fingerprint-claimed';

/** An error the client may see: the handler replies `{ error: code, ...extra }` with `status`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly extra: Record<string, unknown> | undefined;

  constructor(status: number, code: ApiErrorCode, extra?: Record<string, unknown>) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
