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
  // Owner, 16 Nov 2026: the authenticator app goes only with a password (@x2f/accounts
  // METHOD_PARTNERS): no TOTP enrolment without a password, no password removal while TOTP is on.
  | 'totp-needs-password'
  | 'password-has-totp'
  // Owner, 16 Nov 2026: a password does not stand alone (TOTP or a PGP key, passkey or security key with it).
  | 'password-alone'
  // Review M2: a password-only account's setup-only session, outside the routes that add a second method.
  | 'second-method-required'
  | 'webauthn-failed'
  // Owner 25 Nov security-key report: a key name outside checkKeyName (@x2f/accounts), with its `reason`.
  | 'key-name-invalid'
  | 'security-key-limit'
  | 'origin-refused'
  | 'address-invalid'
  | 'address-integrated'
  | 'wallet-exists'
  | 'terms-not-accepted'
  | 'terms-required'
  // Owner, 8 Nov 2026: the signature given with the Terms (src/termsSignature.ts). Since owner demo
  // note #187 a trader's routes send these only for a signature that was sent; staff and team join still require one.
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
  // Plan 4 Task 25 (J-06): a lien's block on trading; owner option b (16 Nov 2026): no lien blocks now.
  | 'lien'
  // Lien recovery (owner 16 Nov 2026): a lien already has a rate change request waiting.
  | 'request-pending'
  // Review M2: complied (a lien repaid directly) while a trade still carries a signed recovery for it.
  | 'lien-recovery-in-flight'
  // Review B1: the take would reserve a lien recovery other than the one the buyer's quote showed.
  | 'lien-recovery-changed'
  // Q2/B2: a creditor's recovery address another account holds as a wallet.
  | 'recovery-address-refused'
  | 'trading-paused'
  | 'too-many-offers'
  // Plan 3, Task 6: the trade events route and the state machine's refusals.
  | 'event-not-allowed'
  | 'wrong-state'
  | 'wrong-party'
  | 'too-early'
  | 'too-late'
  // Plan 4 Task 12 (A6): the seller's payment proof for a `seller-sends-xmr` ruling.
  | 'proof-invalid'
  | 'proof-replayed'
  | 'proof-pending'
  | 'node-unavailable'
  | 'no-extensions-left'
  | 'not-releasable'
  | 'total-changed'
  // Plan 3, Task 5: taking an offer and the poster's wallet.
  | 'own-offer'
  | 'out-of-range'
  | 'not-enough-trades'
  | 'wallet-not-ready'
  // Owner 17 Nov 2026 (note #6 Q1): a one-time wallet cannot be made the default.
  | 'wallet-one-time'
  | 'already-waiting'
  | 'ad-busy'
  | 'price-changed'
  | 'starter-limit'
  // Plan 4 Task 26: the caller's own account limit (a senior moderator approved it); carries the cap only.
  | 'account-limit'
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
  // Design build task 4 (chat membership keys): the signed key record.
  | 'bad-key-record'
  | 'key-exists'
  // Chat membership design task 9: the moderator's read (a re-wrap) and countersigned message, as the moderation process refuses them.
  | 'device-not-certified'
  | 'not-on-case'
  | 'not-disputed'
  | 'no-grant'
  | 'replayed'
  | 'stale-countersign'
  | 'bad-countersign'
  | 'gate-unavailable'
  // Chat membership design task 8: staff device certification.
  | 'device-exists'
  | 'device-limit'
  | 'no-key'
  | 'chat-keyed'
  // Design build task 6: the dispute grant.
  | 'grant-required'
  | 'bad-grant'
  | 'grant-not-needed'
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
  // P-012/P-013 (proof/blurCheck.ts): a trade announced too many proofs; @x2f/proof BlurCheckError codes (400).
  | 'too-many-proofs'
  | 'comment-on-yes'
  | 'comment-too-long'
  | 'comment-bad-character'
  | 'review-exists'
  // Plan 5, Task 19: review disputes (reviews/routes.ts, staff/reviewDisputes.ts).
  | 'not-disputable'
  | 'review-disputed'
  | 'dispute-decided'
  // Plan 5, Task 14: proof storage (proofs/routes.ts); its 409 too-many-proofs is declared above (blur check).
  | 'proof-exists'
  | 'not-requested'
  | 'review-pending'
  // Plan 5 Task 5: @x2f/reputation's BadgeError codes (badge settings), answered as 400.
  | 'new-is-fixed'
  | 'not-earned'
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
  // J-20 (owner p7-4, p7-11; review S-m4): a member's action on a trade or offer outside their
  // trade-size band, and a session end asked for past the member's working hours.
  | 'outside-trade-band'
  | 'past-working-hours'
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
  // Plan 4 Task 27: a trade ban refuses posting and taking (409); a site ban refuses the trader app
  // but the notice and what finishes open trades (403, with kind, reasonCode, until); a second
  // standing ban of a kind (409); D-017's term rules (409).
  | 'trade-ban'
  | 'banned'
  | 'already-banned'
  | 'lifetime-required'
  | 'lifetime-not-allowed'
  // Owner G4 (7 Nov): adding or removing an owner key needs taps by both owner keys.
  | 'both-owner-keys-required'
  // Owner G3 (review P-m1): a staff passkey that reports a security-key model is that key again.
  | 'passkey-is-security-key'
  // Plan 4, Task 6: owner first-run setup.
  | 'setup-locked'
  | 'owner-needs-pgp'
  // Plan 5 Task 10 on the staff API: the past-rep claim is no longer live (revoked, removed, rejected).
  | 'not-live'
  // Plan 5 Task 11 (P5-A23): a moderator approves only after ticking that the archive shows the full fingerprint.
  | 'confirm-fingerprint'
  // Review M2 (lead call): and that the archived page is the trader's profile on the claimed site.
  | 'confirm-profile'
  // Review M3 (lead call): a moderator never approves a claim backed by one of their own login keys.
  | 'reviewer-own-key'
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
  // Review p4t22 M1 (e): a second approval for a ruling the moderation gate does not refuse `needs-second`.
  | 'not-refused'
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
  | 'jabber-event-always-on'
  // Plan 4 Task 33 (D-041): the clock-out needs a pre-approved payout address of one's own.
  | 'address-required'
  | 'address-unknown'
  | 'address-exists'
  | 'too-many-addresses'
  // Security review S2: the clock-out pays exactly the sheet's signed quote.
  | 'quote-invalid'
  | 'quote-expired'
  | 'quote-changed'
  // Plan 4 Task 19, re-review 3 m1: a training case changed after the curator opened it.
  | 'case-changed';

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
