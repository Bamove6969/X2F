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
  // Hold model v3: a new device with nothing to approve it and no passkey, security key or PGP key,
  // the staged changes are not the ones reviewed, too many changes, the trade partner's account has
  // a temporary problem (never "hold" to the partner). No semicolon inside this type: the web's
  // cantDoThat-lint reads the union up to the first one.
  | 'approval-unavailable'
  | 'changes-changed'
  | 'too-many-changes'
  // Notes on traders (review 2026-11-09 m4): the account's notes are at NOTES_PER_ACCOUNT.
  | 'too-many-notes'
  | 'counterparty-unavailable'
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
  // Owner, 8 Nov 2026: the signature given with the Terms (src/termsSignature.ts).
  | 'signature-required'
  | 'signature-invalid'
  | 'signature-too-large'
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
  // Plan 4 Task 25 (J-06): an active lien from a dispute; the debtor cannot trade until it is repaid.
  | 'lien'
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
  // Owner p11-6: the launch cap on one trade's USD value (trades/launchCap.ts), at post and take.
  | 'launch-cap'
  | 'offer-busy'
  // Plan 4, Task 5: a security-key tap that is missing, expired, used, another account's or for another intent.
  | 'tap-invalid'
  // Plan 4, Task 8: the banner's 140 characters, and the trader API during maintenance (503).
  | 'banner-too-long'
  | 'maintenance'
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
  // Design 2026-11-08 section 5: a chat purged under the caller (its member mark); the device erases its copy.
  | 'chat-purged'
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
  // Owner 2 Nov 2026: Trader and Vendor accounts (only a vendor posts offers or has a team; the
  // switch needs a passkey, security key or PGP key), and the ban list (a banned PGP key).
  | 'not-vendor'
  | 'vendor-needs-key'
  | 'key-unavailable'
  // Plan 4, Task 4: staff login hours (a login, or an open session, outside the window).
  | 'outside-login-hours'
  // Plan 4, Task 7: staff invites and the owner's protections.
  | 'invite-invalid'
  | 'security-key-required'
  | 'two-factors-required'
  | 'owner-protected'
  | 'owner-needs-two-keys'
  // Owner G3 (7 Nov): a moderator holds a security key, a PGP key and a passkey. Not answered since
  // D-070 (owner p11-19, 9 Nov), which made the security key optional: see the next code.
  | 'all-three-methods-required'
  // D-070 (owner p11-19): a moderator or senior moderator holds a PGP key and a passkey.
  | 'moderator-methods-required'
  // D-064: ending a recovery hold `via: 'secure-jabber'` on an account with no Jabber address proven before the hold.
  | 'no-secure-jabber'
  // Owner G4 (7 Nov): adding or removing an owner key needs taps by both owner keys.
  | 'both-owner-keys-required'
  // Owner G3 (review P-m1): a staff passkey that reports a security-key model is that key again.
  | 'passkey-is-security-key'
  // Plan 4, Task 6: owner first-run setup.
  | 'setup-locked'
  | 'owner-needs-pgp'
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
  | 'fingerprint-claimed'
  // Plan 4, Task 11: the moderator's case work. `forbidden-case`: not the assignee (nor a senior
  // moderator or the owner), or involved in round 1 of an appealed case; `freeze-not-allowed`: the
  // party has not ignored the dispute or the ruling; the moderation process's own answers.
  | 'forbidden-case'
  // Plan 4 Task 12 (J-06): the ruling routes.
  | 'reason-too-short'
  | 'same-person'
  | 'account-action-unavailable'
  | 'freeze-not-allowed'
  // Lead call Q1: a ruling while maintenance pauses the dispute.
  | 'dispute-paused'
  | 'no-chat'
  | 'no-proof'
  | 'moderation-unavailable'
  // Owner rule p5-7: secure Jabber account-change alerts.
  | 'jabber-unavailable'
  | 'jabber-address-invalid'
  // W-021 review F1: a security notice can't be turned off (owner to rule).
  | 'jabber-event-always-on';

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
