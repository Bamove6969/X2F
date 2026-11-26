/**
 * Which error codes are "can't do that" refusals, and their words (Plan 5 Task 21; owner,
 * 2026-10-29, spec 5.2). A refusal is X2F's own rule stopping this user (a limit, a hold, a
 * session that may not do this); each is shown with `CantDoThat`, whose feedback line invites the
 * user to say the rule could be better. Faults (network, a broken device, a typo, an expired step)
 * and the trade's own state ("the trade has moved on") are not refusals.
 *
 * Every error code the web knows is classified here, in CANT_DO_CODES or in NOT_REFUSAL_CODES
 * (apps/web/test/cantDoThat-lint.test.ts checks ApiErrorCode and every code the web compares
 * against), so a code a later task adds fails the check until someone decides which it is.
 *
 * This file is the refusal text map: tools/copy-lint.ts judges refusal wording everywhere else
 * piece by piece, and passes it here. A plain module (no React, no CSS) so the lint can read it.
 */
import { LAUNCH_TRADE_CAP_USD_CENTS } from '@x2f/trade';
import { formatDateTime } from './dates.js';

/** The launch cap as words ("$5,000"), from the one constant the API enforces. */
export const LAUNCH_CAP_TEXT = `$${(LAUNCH_TRADE_CAP_USD_CENTS / 100n).toLocaleString('en-US')}`;

export const CANT_DO_CODES = [
  // Plan 3 Task 5 (take; on the main line since 2026-10-29).
  'starter-limit',
  // Plan 4 Task 26: the account's own limit, approved by a senior moderator (the cap only, never why).
  'account-limit',
  'not-enough-trades',
  'own-offer',
  'already-waiting',
  'offer-busy',
  // Owner p11-6: the launch cap on one trade, at take and at post.
  'launch-cap',
  // Plan 3 Task 4 (post an offer).
  'trading-hold',
  'too-many-offers',
  // Plan 2: the account's login methods.
  'security-key-limit',
  'login-name-set',
  'last-login-method',
  // Owner, 26 Nov 2026 (no passwords): at least two kinds of login method (removing one below that,
  // ending sign-up without two, and a setup-only session's other routes).
  'two-methods-required',
  'method-not-allowed',
  'account-disabled',
  // A new device with nothing to approve it and no passkey, security key or PGP key (API only so
  // far, no words here).
  'approval-unavailable',
  // Notes on traders (review 2026-11-09 m4): the account's note cap (notesCantDoText).
  'too-many-notes',
  // Plan 3 Task 26: the nudge limit. Task 6: no more payment-time extensions.
  'too-soon',
  'no-extensions-left',
  // Plan 3 Task 37: blocking a trader the API refuses (400 yourself, 404 a closed account). The
  // API's own codes are bad-request and not-found; this one is the web's, for the popup's
  // feedback link.
  'cannot-block',
  // Plan 2 Task 16: the device limit when approving a new device (a login itself is never refused
  // by it since Task 17 review round 2), and the cap on login approvals an account may start in an hour. The API answers the cap
  // with 429 `slow-down` `{ reason: 'approvals' }`; this code is the web's, for the popup's
  // feedback link (a throttle on tries stays a `slow-down` fault).
  'too-many-devices',
  'too-many-approvals',
  // Plan 2 Task 18: team members (owner-only actions, a role a member lacks, the member limit,
  // and escrow signing, which stays on the account owner's device until Plan 3 Task 42).
  'owner-only',
  'forbidden',
  'too-many-members',
  'member-cannot-sign',
  // J-20 (owner p7-4, p7-11; review S-m4): a member outside their trade-size band, and a session
  // end past their working hours.
  'outside-trade-band',
  'past-working-hours',
  // Owner 2 Nov 2026: only vendor accounts post offers or have team members; switching to vendor
  // needs a passkey, security key or PGP key on the account.
  'not-vendor',
  'vendor-needs-key',
  // Plan 5 Task 3: rate (or skip rating) your last trade first (the rate-first gate, spec 5.1).
  'review-pending',
  // Plan 4 Task 25 (J-06): an active lien from a dispute (409 `lien` on post, relist, take and set-up).
  'lien',
  // Guessed for a refusal whose API task is not on the main line yet (Plan 4's trade ban): check it
  // when it lands.
  'trade-ban',
  // Plan 4 Task 4: a staff member's login hours (a staff login, and a staff session when the
  // window closes). Classified here for the error-code test; its words come with the staff web app
  // (Plan 4 Task 16).
  'outside-login-hours',
  // Plan 5 Task 10 on the staff API: the claim whose figure staff set is no longer live. Its words
  // come with the staff web app (Plan 4 Task 16).
  'not-live',
  // Plan 5 Task 10 (P5-A21, P5-A24): one live past-reputation claim per site, and a PGP key backs
  // one account. No popup words yet (Task 12's PastRepClaim screen); lead question.
  'site-claimed',
  'fingerprint-claimed',
  // Plan 4 Task 30: the account already has TICKET_OPEN_AT_ONCE support tickets not closed (Tickets.tsx).
  'too-many-tickets',
] as const;
export type CantDoCode = (typeof CANT_DO_CODES)[number];

/** Every other code the web knows, with why it is not a "can't do that" refusal. */
export const NOT_REFUSAL_CODES: Readonly<Record<string, string>> = {
  // Trade key backup (owner, 26 Nov 2026): the person's own key did not unlock or cannot be used; they pick another key on the same screen.
  'no-prf': 'the chosen passkey or security key cannot make a backup key (no PRF); the person picks another key (inline on the trade key backup section)',
  'bad-unlock': 'the key or pasted text did not open the trade key backup; the person tries again or picks another key (inline)',
  // Lien recovery (review B1, provisional owner answers 17 Nov 2026).
  'lien-recovery-changed': 'the lien recovery the quote showed moved before the take; the quote reads it again and asks for a fresh tap (inline, like price-changed)',
  'recovery-address-refused': "a creditor's recovery wallet that another account holds; they pick another wallet (inline on the liens screen)",
  // Plan 4 Tasks 5 and 7: staff-API answers traders never get (their words come with the staff web
  // app, Plan 4 Task 16).
  'tap-invalid': 'a staff security-key tap (staff app only)',
  // Owner demo note #94: the key test's own results (KeyTestError in @x2f/auth-client, never an API
  // answer), said inline by screens/auth/KeyTest.tsx; nothing was refused.
  'other-key': 'a key test answered by another key than the one just added (KeyTest.tsx, inline)',
  'not-listed': 'a key test for a key the confirm options did not list (KeyTest.tsx, inline)',
  // Plan 4 Task 12 (J-06): the staff ruling routes.
  'reason-too-short': "a ruling's reason under 40 characters (staff app only)",
  'same-person': 'a ruling approved by its own proposer (staff app only)',
  'account-action-unavailable': 'an account action on the ruling card (staff app only)',
  'dispute-paused': 'a ruling while maintenance pauses the dispute (staff app only)',
  'invite-invalid': 'a staff invite link that is used, expired or cancelled (staff app only)',
  'security-key-required': 'a staff sign-up step: a security key must be added (staff app only)',
  'two-factors-required': 'a staff sign-up step: a second login method must be added (staff app only)',
  'owner-protected': "the owner's own account in staff management (staff app only)",
  'owner-needs-two-keys': 'the owner keeps at least two security keys (staff app only)',
  'all-three-methods-required': 'a moderator keeps a security key, a PGP key and a passkey (staff app only)',
  // Plan 4 Task 33 (D-041): the staff clock-out and payout addresses (staff app only).
  'address-required': 'the staff clock-out sheet asks for a payout address (staff app only)',
  'address-unknown': 'a payout address that is not the staff member\'s or was removed (staff app only)',
  'address-exists': 'a payout address the staff member already added (staff app only)',
  'too-many-addresses': 'the cap on a staff member\'s payout addresses (staff app only)',
  'quote-invalid': 'a staff clock-out sheet that is not this session\'s (staff app only)',
  'quote-expired': 'a staff clock-out sheet shown too long ago: it is shown again (staff app only)',
  'quote-changed': 'a staff clock-out sheet whose pay changed meanwhile: it is shown again (staff app only)',
  // Plan 4 Task 19 (re-review 3 m1): the training case changed after the curator opened it.
  'case-changed': 'a training case that changed after the curator opened it: reload and review again (staff app only)',
  'both-owner-keys-required': "a change to the owner's keys is tapped with both owner keys (staff app only)",
  'passkey-is-security-key': 'a staff passkey must be another device than the security key (staff app only)',
  // Plan 5 Task 11 (P5-A23): the moderator's fingerprint tick box on the past-reputation page.
  'confirm-fingerprint': 'an input check: the moderator must tick that the archive shows the fingerprint (staff app only)',
  'confirm-profile': "an input check: the moderator must tick that the archive is the trader's profile on the site (staff app only)",
  'reviewer-own-key': "a moderator's approval of a claim backed by their own login key (staff app only; the staff app shows it with CantDoThat)",
  'bad-request': 'a malformed request (a fault)',
  // S-085 device-bound sessions: handled by the API client (renew the bound cookie and retry, or end the session), never shown.
  'session-proof-required': "a bound session's short-lived cookie ran out: the client renews it with the device key",
  'session-proof-invalid': 'this browser could not prove the session key: the session ends',
  'not-bound': 'the session has no device key: nothing to renew',
  // Hold model v3: the drafts submitted are not the ones there are (another tab changed them): reload and review again.
  'changes-changed': 'a state conflict: the list changed since it was reviewed',
  'not-found': 'nothing there',
  'unsupported-media-type': 'a fault',
  // Plan 5 Task 15: a picked proof image that can't be read (ProofInputError); shown as PROOF_CANT_USE.
  unsupported: 'an input check on the picked proof image',
  // Proof review M2: a proof's post got no answer (it may have been stored); shown as PROOF_SEND_UNCERTAIN.
  uncertain: 'a fault: no answer, so the send may have gone through',
  internal: 'a server fault',
  busy: 'the server is busy (try again)',
  'trade-tag-invalid': 'an input check on a typed name',
  'trade-tag-reserved': 'an input check on a typed name',
  'trade-tag-taken': 'an input check on a typed name',
  'login-name-invalid': 'an input check on a typed name',
  'names-unavailable': 'an input check on a typed name',
  'names-same': 'an input check on a typed name',
  'key-unreadable': 'an input check on a pasted key',
  'key-too-large': 'an input check on a pasted key',
  'key-private': 'an input check on a pasted key',
  'key-multiple': 'an input check on a pasted key',
  'key-weak': 'an input check on a pasted key',
  'key-expired': 'the pasted key itself is expired',
  'key-revoked': 'the pasted key itself is revoked',
  'key-no-encryption': 'an input check on a pasted key (owner demo note #144: a sign-only key)',
  'key-encryption-inactive': 'an input check on a pasted key (owner demo note #144: its encryption subkey expired or was revoked)',
  'key-encryption-unusable': "an input check on a pasted key (security review of #144: its encryption subkey isn't validly signed)",
  'key-not-yet-valid': 'the pasted key itself is not valid yet',
  'key-no-signing': 'an input check on a pasted key (past reputation: it cannot sign)',
  'key-in-use': 'an input check on a pasted key',
  'key-unavailable': 'an input check on a pasted key (owner 2 Nov 2026: a key on the ban list, never named as such)',
  'challenge-expired': 'an expired step (start again)',
  'code-invalid': 'a wrong code',
  'credentials-invalid': 'a wrong login',
  'slow-down': 'a security throttle on tries (wait and try again)',
  locked: 'a security throttle on tries (wait and try again)',
  'not-authenticated': 'signed out (log in)',
  'wrong-account-kind': 'a route for another kind of account',
  'confirm-required': 'asks for a confirm, then goes on',
  'confirm-invalid': 'an expired confirm (confirm again)',
  'webauthn-failed': 'the authenticator failed (a fault)',
  // Owner 25 Nov security-key report: a key name outside checkKeyName (@x2f/accounts).
  'key-name-invalid': 'an input check on a typed key name',
  'origin-refused': 'a CSRF guard (a fault)',
  'address-invalid': 'an input check on a typed address',
  'address-integrated': 'an input check on a typed address',
  // Owner 26 Nov: the staff fee-sweep destination must be X2F's fee wallet (staff app only).
  'not-fee-wallet': 'an input check on a typed address (staff)',
  'wallet-exists': 'an input check (already linked)',
  'terms-not-accepted': 'sends the person to the Terms',
  'terms-required': 'sends the person to the Terms',
  // Plan 4 Task 27: a site ban sends the person to the ban notice (screens/account/AccountBanned.tsx).
  banned: 'sends the person to the ban notice',
  'already-banned': 'a staff ban action (staff app only)',
  'lifetime-required': 'a staff ban action: D-017 term rules (staff app only)',
  'lifetime-not-allowed': 'a staff ban action: D-017 term rules (staff app only)',
  // mod-rules: D-070 moderator methods and D-064's channel check (staff app only).
  'moderator-methods-required': 'a moderator keeps a PGP key and a passkey (staff app only)',
  // Owner, 8 Nov 2026: the signature given with the Terms; the pad never sends these.
  'signature-required': 'an input check on the Terms signature',
  'signature-invalid': 'an input check on the Terms signature',
  'signature-too-large': 'an input check on the Terms signature',
  // Owner rule p5-7: the Jabber set-up.
  'jabber-unavailable': 'the deployment has no Jabber sending account yet (a missing feature, not a rule)',
  'jabber-address-invalid': 'an input check on a typed Jabber address',
  // W-021 review F1: the page shows these boxes disabled and never sends the request.
  'jabber-event-always-on': 'a security Jabber notice that stays on; its box is disabled, so the page never asks',
  // J-08 pay-details (ChatPanel's payErrorText, PayDetailsError and ChatFailed codes): the boxes' own input checks and a wait.
  'not-ready': 'the escrow is not secured yet, so the payment details wait (ChatFailed; a wait, not a rule)',
  'missing': 'an input check on a payment-details box (PayDetailsError)',
  'one-of': 'an input check on a group of payment-details boxes (PayDetailsError)',
  'too-long': 'an input check on a payment-details box (PayDetailsError)',
  'bad-value': 'an input check on a payment-details box (PayDetailsError)',
  'bad-chars': 'an input check on a payment-details box (PayDetailsError)',
  'price-unavailable': 'the price feed is down (a fault)',
  'price-changed': 'the market moved (re-quote)',
  'method-unavailable': 'a catalog fact (the method is off the list); Suggest a method covers it',
  'no-wallet': 'sends the person to Add a wallet',
  'trading-paused': 'maintenance, with its own message (Plan 3 emergency stop)',
  // Plan 4 Tasks 5 and 8: staff-API answers (a security-key tap, the owner's banner limit) that
  // traders never get, and maintenance, which the app shows as the Maintenance screen.
  'banner-too-long': "an input check on the owner's banner (staff app only)",
  maintenance: "the site is in maintenance: the Maintenance screen with the owner's message",
  'out-of-range': 'an input check on the amount',
  'ad-busy': 'someone else is taking the offer (try again)',
  'wallet-not-ready': 'pick another wallet (the wait is explained on Wallets); Make default is never offered on a waiting wallet',
  'wallet-one-time': 'an input check: the app never offers Make default on a one-time wallet',
  'event-not-allowed': 'the trade state machine (the trade has moved on)',
  'wrong-state': 'the trade state machine (the trade has moved on)',
  'wrong-party': 'the trade state machine (not this side)',
  'too-early': "the trade's own clock",
  'too-late': "the trade's own clock",
  // Plan 4 Task 12 (A6): the seller's payment proof for a ruling.
  'proof-invalid': 'an input check on the payment proof (the tx and key do not show the payment)',
  'proof-replayed': 'an input check on the payment proof (that tx was already used, or predates the dispute)',
  'proof-pending': 'a wait: the proof sent earlier is waiting for its confirmations',
  'node-unavailable': "X2F's Monero node could not be asked (a fault; try again)",
  'not-releasable': 'the escrow is not unlocked yet (wait)',
  'total-changed': 'the trade grew (re-read and confirm)',
  'identity-exists': 'a device step already done (a fault)',
  'identity-conflict': 'a device step already done (a fault)',
  'bad-proof': 'a device check (a fault)',
  'attestation-refused': 'a device check (a fault)',
  'trade-closed': 'the trade has ended',
  'dispute-exists': 'a dispute is already open on this trade (the trade state)',
  'no-shared-context': 'nudges are only for a shared trade (the button is not offered)',
  // Plan 5 Task 3: reviews.
  'not-reviewable': 'the trade cannot be rated (its state: not released, or a dispute not yet over)',
  'review-exists': 'already rated (a double submit)',
  // Plan 5 Task 19: review disputes. The Dispute button shows only on a review that can still be
  // disputed, so each is a race or a stale screen, never X2F's rule refusing the user.
  'not-disputable': 'the review was removed or is on hold (its state)',
  'review-disputed': 'already disputed (a double submit or a stale screen)',
  'dispute-decided': 'a moderator already decided this review dispute (staff only)',
  'bad-shape': 'an input check on the review form',
  'bad-stars': 'an input check on the review form',
  'bad-phrase': 'an input check on the review form',
  'duplicate-phrase': 'an input check on the review form',
  'bad-trade-badge': 'an input check on the review form',
  'duplicate-trade-badge': 'an input check on the review form',
  'note-too-long': 'an input check on the typed note',
  'note-multiline': 'an input check on the typed note',
  'note-bad-character': 'an input check on the typed note',
  'note-personal-details': 'an input check on the typed note (remove personal details)',
  'neutral-with-details': 'an input check on the review form',
  // Plan 5 Task 10: past reputation, checks on what the trader pasted or a step already used.
  'bad-site': 'an input check on the picked site',
  'bad-url': 'an input check on the pasted archive link',
  'bad-signature': 'an input check on the pasted signature',
  'wrong-text': 'an input check: the pasted signature is not of the issued text',
  'wrong-key': 'an input check: the pasted signature is not by the claimed key',
  'challenge-used': 'a step already done (start again)',
  'approval-ended': 'the login request itself already ended (approved, blocked or timed out): its own state, not a rule',
  // Plan 3 Task 20 (encrypted chat): the chat's own protocol and state, never a rule about the user.
  'chat-not-ready': 'the chat is still being secured (wait)',
  'stale-seq': 'a device step out of order (the engine re-syncs; a fault)',
  // Design build task 4 (chat membership keys): the chat's signed key record; device faults or races, never refusals.
  'bad-key-record': 'a device check on the chat key (a fault)',
  'key-exists': 'the other side made the chat key first (the engine reads it)',
  'no-key': 'the chat has no key yet (the engine makes one)',
  'grant-required': 'the dispute needs the chat key grant (the app adds it and asks again)',
  'bad-grant': 'a device check on the dispute grant (a fault)',
  'grant-not-needed': 'no fallback grant is needed (the engine moves on)',
  // Design build task 9: the moderation process's refusals of a moderator's read or message; staff app only.
  'device-not-certified': 'a staff answer: this staff device is not confirmed (staff app only)',
  'not-on-case': 'a staff answer: the moderation process does not see this person on the case (staff app only)',
  'not-disputed': 'a staff answer: the moderation process does not see the trade disputed (staff app only)',
  'no-grant': 'a staff answer: no trader has handed the chat key to the moderator yet (staff app only)',
  replayed: 'a staff answer: that moderator message was already sent (staff app only)',
  'stale-countersign': 'a staff answer: the moderator message was signed too long ago (staff app only)',
  'bad-countersign': 'a staff device check on the moderator message (a fault; staff app only)',
  'gate-unavailable': 'a staff answer: the moderation process has no ruling gate (staff app only)',
  // Design build task 8: staff device certification; staff app only, never a trader answer.
  'device-exists': 'a staff answer: that staff device key is already certified (staff app only)',
  'device-limit': 'a staff answer: the staff member already has 3 certified devices (staff app only)',
  'chat-keyed': 'a staff answer: the dev-only moderator send cannot write to a keyed chat (staff app only)',
  // Plan 5 Task 15: @x2f/protocol's open() on an envelope sealed past this reader (the unblurred copy for the moderator); the chat engine keeps an `away` receipt, nothing is shown.
  'not-for-me': 'a chat envelope addressed to someone else (the moderator); never shown',
  'wrong-channel': 'a device check (a fault)',
  'wrong-sender': 'a device check (a fault)',
  'chat-unavailable': 'the trade has no chat (cannot happen since Task 5\'s offer key; a fault)',
  'chat-purged': 'the chat was erased on its retention schedule (its own state, not a rule about the user; the device erases its copy)',
  'mod-not-allowed': "a device check: a moderator line outside a dispute is not shown (the chat's own rule)",
  'bad-message': 'a device check on a received line (a fault)',
  'bad-text': 'an input check on the typed message',
  'too-large': 'an input check on the typed message',
  // Escrow device codes (apps/web/src/escrow), compared on `.code` too.
  'address-mismatch': 'an escrow safety check on this device',
  'bad-outcome': 'an escrow safety check on this device',
  // AttestationError('bad-time'): issuedAt in this device's future or before the take (review F5).
  'bad-time': 'an escrow safety check on this device',
  'daemon-unavailable': 'the Monero node is unreachable (a fault)',
  equivocation: 'an escrow safety check on this device',
  'settled-elsewhere': 'the escrow already settled',
  stopped: 'the escrow stopped (a fault)',
  'wrong-terms': 'an escrow safety check on this device',
  // Plan 4 Task 30: support tickets. A closed ticket is its own state (the trader opens a new one);
  // another staff member holding a ticket is a staff answer.
  'ticket-closed': 'the ticket was closed (its own state; TicketThread.tsx offers a new ticket)',
  'ticket-taken': 'a staff answer: another staff member has taken the ticket (staff app only)',
  // D-059 (J-14, ported): the trade is paused for a staff check (its own state: the trade room shows
  // it paused, never why; lead default, owner question pending); a staff answer on a report.
  'trade-held': 'never sent to a trader (review of feat/lockout, item 5): system paths only; a party gets wrong-state, as on any paused trade',
  'account-locked': 'a staff answer: the report cannot close while its account is locked (staff app only)',
};

export function isCantDoCode(code: unknown): code is CantDoCode {
  return typeof code === 'string' && (CANT_DO_CODES as readonly string[]).includes(code);
}

/** The form's address for a refusal code (an unusable code is left off). */
export function feedbackHref(from: string | null | undefined): string {
  return typeof from === 'string' && /^[a-z0-9-]{1,40}$/.test(from) ? `/feedback?from=${from}` : '/feedback';
}

// ---------------------------------------------------------------------------------------------
// The words. Spec wording where there is any; COPY-UNSIGNED otherwise.

/** CantDoThat's title on each screen that shows refusals. COPY-UNSIGNED */
export const CANT_DO_TITLE = {
  take: "This trade can't start",
  post: "This offer can't be posted",
  wallets: "Wallets can't be added",
  methods: "That login method can't be removed",
  nudge: "You can't nudge yet",
  extend: "You can't give more time",
  block: "You can't block this trader",
  myOffers: "Some offers can't be turned on",
  // Design session 2 Nov 2026: a Turn on that a trading hold refused for every offer. COPY-UNSIGNED
  myOffersHold: "You can't turn offers on during a trading hold",
  login: "You can't log in here yet",
  approve: "This login can't be let in",
  chat: "This chat can't open",
  team: "This can't be done on the team",
  accountType: "You can't switch to a vendor account",
  // Design build review 7 Nov: a title that says why (CantDoThat titles). COPY-UNSIGNED
  teamOwnerOnly: 'Only the owner can do this',
  // COPY-UNSIGNED: 'forbidden' is a role issue, not an owner-only one (lead's review, 7 Nov).
  teamRole: "Your role doesn't include this",
  // COPY-UNSIGNED: the design review's title for shot 19 (too-many-members, now a server fallback).
  teamFull: 'Your team is full',
  // Job 1c (owner S-094, p7-8): notes on traders. COPY-UNSIGNED
  notes: "This note can't be saved",
  // J-14 (D-059): the compromised form's own budget or its per-name daily cap. COPY-UNSIGNED
  compromised: "This report can't be sent yet",
} as const;

/**
 * Plan 4 Task 27: a trade ban on take and post. COPY-UNSIGNED. The plan wants the ban's reason and
 * end on this popup too; the popup texts take only the code today (lead question), so it points to
 * the notice that has them.
 */
export const TRADE_BAN_TEXT = 'Your account has been banned from trading for now. Trades you already started carry on. See Account banned for the reason and when it ends.';

/** The general reasons a ban shows (Revision 2026-10-29b, lead default list). COPY-UNSIGNED */
export const BAN_REASON_TEXT = {
  terms: 'Breaking the Terms of Service',
  'trade-problems': 'Problems in trades',
  abuse: 'Abuse of other traders',
  'account-security': 'Account security',
} as const;
export type BanReasonCode = keyof typeof BAN_REASON_TEXT;

/** What a 409 `trade-ban` carries (lead call, Task 27 Q4): the general reason and the end (null: lifetime). */
export interface TradeBan {
  reasonCode: BanReasonCode;
  until: string | null;
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The ban in a refusal's extra fields, or null when the API sent none (or nonsense). */
export function tradeBanOf(extra: Record<string, unknown> | undefined): TradeBan | null {
  if (!extra || typeof extra.reasonCode !== 'string' || !Object.hasOwn(BAN_REASON_TEXT, extra.reasonCode)) return null;
  const until = extra.until;
  if (until !== null && (typeof until !== 'string' || !ISO_MS.test(until) || !Number.isFinite(Date.parse(until)))) return null;
  return { reasonCode: extra.reasonCode as BanReasonCode, until };
}

/** The trade-ban popup with the reason and the end, else the general words. COPY-UNSIGNED */
export function tradeBanText(ban: TradeBan | null): string {
  if (ban === null) return TRADE_BAN_TEXT;
  const reason = `Reason: ${BAN_REASON_TEXT[ban.reasonCode]}. Trades you already started carry on.`;
  return ban.until === null
    ? `Your account is permanently banned from trading. ${reason}`
    : `Your account is banned from trading until ${formatDateTime(new Date(ban.until))}. ${reason}`;
}

/** What a refused take says (spec 2.3: a starter-limit names only the caller's own stage and cap). */
export function takeCantDoText(
  code: CantDoCode,
  o: { stageName: string | null; capText: string | null; maxOpen: number | null; minTrades: number; ban?: TradeBan | null },
): string {
  switch (code) {
    case 'starter-limit':
      // No stage: the limit is the other side's, which is never named (Task 5 sends nothing about it).
      if (o.stageName === null) return 'This trade is above a trading limit right now. Try a smaller amount or another offer.';
      if (o.maxOpen !== null) return `Your account is on ${o.stageName} limits: at most ${o.maxOpen} open ${o.maxOpen === 1 ? 'trade' : 'trades'} at once. Finish one first.`;
      return `Your account is on ${o.stageName} limits${o.capText === null ? '' : ` up to ${o.capText} per trade`}. Try a smaller amount.`;
    case 'account-limit':
      // COPY-UNSIGNED (Plan 4 Task 26: the trader sees their own cap only, never the reason).
      return `Your account has a limit${o.capText === null ? '' : ` of ${o.capText}`} per trade. Try a smaller amount.`;
    case 'launch-cap':
      // COPY-UNSIGNED (owner p11-6: the launch cap; design writes the final words).
      return `For now, one trade can be worth at most ${LAUNCH_CAP_TEXT}. Try a smaller amount.`;
    case 'own-offer':
      return 'This is your own offer.';
    case 'not-enough-trades':
      return `This offer needs at least ${o.minTrades} completed ${o.minTrades === 1 ? 'trade' : 'trades'}.`;
    case 'trading-hold':
      return 'Your account is on a trading hold while a dispute is open, so it cannot start trades.';
    case 'lien':
      return "Your account has a lien from a dispute, so it can't start trades until you pay back what the ruling says you owe."; // COPY-UNSIGNED (J-06, owner D-008: no trading until the lien is repaid)
    case 'trade-ban':
      return tradeBanText(o.ban ?? null);
    case 'already-waiting':
      return 'You already have a trade on this offer waiting to be funded.';
    case 'review-pending':
      return RATE_FIRST.inline;
    case 'offer-busy':
      // The poster's own open-trade limit; nothing says whose limit or how many (Task 5 review M6).
      return "This offer can't take more trades right now. Try again later or pick another offer.";
    // Plan 2 Task 18: a team member's take (review I2: refused until Plan 3 Task 42).
    case 'member-cannot-sign':
    case 'forbidden':
    case 'owner-only':
      return teamCantDoText(code);
    default:
      return 'Your account cannot start this trade right now.';
  }
}

/** Plan 5 Task 6: the rate-first gate's code (409 on a take, and on the poster's wallet pick). */
export const REVIEW_PENDING_CODE = 'review-pending' satisfies CantDoCode;

/**
 * The rate-first gate (spec 5.1; owner 2026-11-01: "submit a review or tap Skip to complete the
 * trade and clear it"): the sheet that opens when a take or a wallet pick meets `review-pending`
 * (RateFirstSheet.tsx), and the line left on the quote once it is closed. The title is the lead's
 * brief's words; all COPY-UNSIGNED.
 */
export const RATE_FIRST = {
  title: 'Rate your last trade to continue', // COPY-UNSIGNED (lead's brief, Plan 5 Task 6)
  body: 'Each completed trade needs a rating, or a tap on Skip review, before your next trade starts.', // COPY-UNSIGNED
  inline: 'Rate your last trade, or skip rating it, before you start a new one.', // COPY-UNSIGNED
  /** Over the card while more than one trade waits. COPY-UNSIGNED */
  count: (n: number): string => `${n} trades to rate`,
} as const;

/** What a refused chat open says (Task 20: today only 409 own-offer, a poster on their own offer). */
export function chatCantDoText(code: CantDoCode): string {
  return code === 'own-offer' ? 'This is your own offer.' : "You can't open this chat right now.";
}

/**
 * The offer cap the API enforces (owner 6 Nov 2026, Q31: 3 buying and 3 selling offers per
 * account; apps/api/src/offers/routes.ts OFFER_CAP_DEFAULTS), said in the My offers footnote. The
 * refusals themselves (PostOffer's and My offers' CantDoThat for `too-many-offers`) open with the
 * owner's limit words (`offerLimitLine`, O-028): PostOffer with the 409's own numbers (review M2),
 * My offers' bulk turn-on (whose per-offer result carries no cap) with this default. COPY-UNSIGNED
 */
export const OFFER_CAP_LINE = 'You can have 3 buying and 3 selling offers.'; // COPY-UNSIGNED

/**
 * The offer caps a 409 `too-many-offers` carries (cap-dispute review M2: the caps are owner
 * settings, not fixed numbers). The API sends `{ buy, sell }` on POST and PATCH (owner Q31: the
 * settings `offers_max_buy` and `offers_max_sell`, apps/api/src/offers/routes.ts OFFER_CAP_KEYS).
 */
export interface OfferCaps {
  buy: number;
  sell: number;
}

/** The caps from a refusal's extra fields, or null when the API sent none (or nonsense). */
export function offerCapsOf(extra: Record<string, unknown> | undefined): OfferCaps | null {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 1000;
  return extra && ok(extra.buy) && ok(extra.sell) ? { buy: extra.buy, sell: extra.sell } : null;
}

/**
 * O-028 (owner 28 Oct 2026, Q14): the limit pop-up opens in the owner's words, "Sorry, you're
 * limited to N offers per side ..." (his number then was 2; the cap is 3 + 3 since Q31, and owner
 * settings may set each side apart). CantDoThat adds his feedback line and link, and the feedback
 * form's thank-you is his too (screens/Feedback.tsx FEEDBACK_THANKS). COPY-UNSIGNED
 */
export function offerLimitLine(caps: OfferCaps | null): string {
  const { buy, sell } = caps ?? { buy: 3, sell: 3 };
  if (buy === sell) return `Sorry, you're limited to ${buy} ${buy === 1 ? 'offer' : 'offers'} per side: ${buy} buying and ${sell} selling.`;
  return `Sorry, you're limited to ${buy} buying and ${sell} selling ${sell === 1 ? 'offer' : 'offers'}.`;
}

/** What a refused Post offer says; `caps` from the API's refusal (offerCapsOf). */
export function postCantDoText(code: CantDoCode, caps: OfferCaps | null = null, ban: TradeBan | null = null): string {
  switch (code) {
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so you can't post offers until it's resolved.";
    case 'lien':
      return "Your account has a lien from a dispute, so you can't post offers until you pay back what the ruling says you owe."; // COPY-UNSIGNED (J-06)
    case 'trade-ban':
      return tradeBanText(ban);
    case 'too-many-offers':
      return `${offerLimitLine(caps)} Remove one you no longer need, then post this one.`; // COPY-UNSIGNED (O-028)
    case 'launch-cap':
      // COPY-UNSIGNED (owner p11-6: the launch cap; design writes the final words).
      return `For now, one trade can be worth at most ${LAUNCH_CAP_TEXT}. Lower your offer's maximum to ${LAUNCH_CAP_TEXT} or less.`;
    // Plan 2 Task 18: a team member without the Offers role; J-20: an offer outside their band.
    case 'forbidden':
    case 'owner-only':
    case 'outside-trade-band':
      return teamCantDoText(code);
    case 'not-vendor':
      return NOT_VENDOR_POST_TEXT;
    default:
      return "Your account can't post this offer right now.";
  }
}

/** The code for the account's only login method. */
export const LAST_METHOD_CODE = 'last-login-method' satisfies CantDoCode;

/** 409 `last-login-method` (and the client's own check before asking): the account's only way to log in. */
export const LAST_METHOD_MESSAGE = 'That is your only way to log in. Add another login method before removing this one.';

/** Owner, 26 Nov 2026: the code for an account short of two kinds of login method. */
export const SECOND_METHOD_CODE = 'two-methods-required' satisfies CantDoCode;

/** What a setup-only session is told, above Login methods. COPY-UNSIGNED */
export const SECOND_METHOD_TITLE = 'Add a second way to log in';
export const SECOND_METHOD_MESSAGE =
  'Your account needs at least two ways to log in. Add a security key, a passkey, a PGP key or the authenticator app below. Until then you can only add one, write down your recovery code, or log out.';

/** Sign-up reached its end with fewer than two kinds (409 `two-methods-required` from onboarding/end). COPY-UNSIGNED */
export const SECOND_METHOD_SIGNUP = 'Your sign-up needs at least two ways to log in. Add a second one: a security key, a passkey, a PGP key or the authenticator app.';

/** 409 `two-methods-required` when removing a method (and the client's own check before asking). COPY-UNSIGNED */
export const SECOND_METHOD_REMOVE = 'Your account needs at least two kinds of login method. Add another one before removing this.';

/** 409 `no-extensions-left` (Plan 3 Task 6): the payment time was already extended as often as allowed. */
export const NO_EXTENSIONS_LEFT = 'This trade has had all the extra time it can get. Cancel and get your refund, or keep waiting for the payment.';

/** What a refused extend says, for the codes that have their own words (else null). */
export function extendCantDoText(code: CantDoCode): string | null {
  return code === 'no-extensions-left' ? NO_EXTENSIONS_LEFT : null;
}

/** The nudge limit's code. */
export const NUDGE_TOO_SOON_CODE = 'too-soon' satisfies CantDoCode;

/** 429 `too-soon` on a nudge (Plan 3 Task 26). */
export const NUDGE_TOO_SOON = 'You can nudge once every 15 minutes.';

/** The block's refusal code (Plan 3 Task 37). */
export const CANNOT_BLOCK_CODE = 'cannot-block' satisfies CantDoCode;

/** A block the API refuses: 400 (yourself) or 404 (the account was closed) on POST /v1/account/blocks. COPY-UNSIGNED */
export const CANNOT_BLOCK = 'That trader cannot be blocked.';

/**
 * My offers (Plan 3 Task 36): why ticked offers stayed off, in CantDoThat. `n` is how many offers
 * the refusal kept off. COPY-UNSIGNED
 */
export function myOffersCantDoText(code: CantDoCode, n: number): string {
  switch (code) {
    case 'not-vendor':
      return 'Only vendor accounts can turn offers on. Switch to a vendor account in Settings, Account type.';
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so your offers stay off until it's resolved.";
    case 'lien':
      return 'Your account has a lien from a dispute, so your offers stay off until you pay back what the ruling says you owe.'; // COPY-UNSIGNED (J-06)
    case 'too-many-offers':
      // C2-A1: the cap is per side now (owner 2026-11-01), not per market; O-028: the owner's
      // limit pop-up words (the bulk result carries no cap, so the default 3 + 3). COPY-UNSIGNED
      return n === 1
        ? `${offerLimitLine(null)} Remove one you no longer need, then turn this one on.`
        : `${offerLimitLine(null)} Remove ones you no longer need, then turn these on.`;
    // J-20 review F2: a team member turning on an offer outside their band. COPY-UNSIGNED // DESIGN: wording
    case 'outside-trade-band':
      return n === 1
        ? 'This offer is outside the trade sizes the account owner set for you, so it stays off. Ask the account owner to turn it on.'
        : 'These offers are outside the trade sizes the account owner set for you, so they stay off. Ask the account owner to turn them on.';
    default:
      return "Your account can't turn these offers on right now.";
  }
}

/** The short line under each offer a CantDoThat refusal kept off (the popup gives the reason in full). COPY-UNSIGNED */
export function myOffersCantDoRow(code: CantDoCode): string {
  switch (code) {
    case 'not-vendor':
      return 'Stayed off: only vendor accounts can turn offers on.';
    case 'trading-hold':
      return 'Stayed off: your account has a trading hold.';
    case 'lien':
      return 'Stayed off: your account has a lien.'; // COPY-UNSIGNED (J-06)
    case 'too-many-offers':
      return 'Stayed off: over the offer limit.'; // C2-A1: per side, not per market. COPY-UNSIGNED
    case 'outside-trade-band':
      return 'Stayed off: outside the trade sizes set for you.'; // J-20 review F2. COPY-UNSIGNED // DESIGN: wording
    default:
      return 'Stayed off.';
  }
}

/**
 * My offers' other lines about an offer that is off or hidden: not "can't do that" refusals
 * (maintenance, a missing wallet, a method off the catalog, an offer gone; NOT_REFUSAL_CODES), so
 * they are said in the row with no popup. Kept here beside the refusal words they sit next to.
 * COPY-UNSIGNED
 */
export function myOffersRowText(code: string): string {
  if (isCantDoCode(code)) return myOffersCantDoRow(code);
  switch (code) {
    case 'trading-paused':
      return 'Trading is paused for maintenance, so this offer stays off for now. Try again soon.';
    case 'no-wallet':
      return 'Add a payout wallet before turning offers on.';
    case 'method-unavailable':
      return "This payment method isn't available right now, so this offer stays off.";
    case 'not-found':
      return 'This offer was removed.';
    default:
      return "Something went wrong and this offer wasn't changed. Try again.";
  }
}

/**
 * My offers during a moderator's trading hold (design session 2 Nov 2026), COPY-UNSIGNED. The hold
 * has no end date in the API (trading_holds has only created_at and lifted_at; a lead API
 * follow-up), so the agreed "until the hold ends on <date>" clause is said without its date.
 */
export const MY_OFFERS_HOLD = {
  title: 'Your offers are paused during a trading hold',
  body: 'Nobody can see or take them until the hold ends. Trades already started carry on.',
  popup: 'They stay paused until the hold ends. Trades already started carry on.',
} as const;

/** The trading hold's code (a dispute's hold on the account); My offers reads it to show the hold state. */
export const TRADING_HOLD_CODE = 'trading-hold' satisfies CantDoCode;

/** Why a live offer is hidden (Task 36 review M4, `hidden` on GET /v1/account/offers), as its status line. COPY-UNSIGNED */
export const MY_OFFERS_HIDDEN = {
  'trading-paused': 'On, hidden while trading is paused',
  'trading-hold': 'On, hidden while your account has a trading hold',
  'lien': 'On, hidden while your account has a lien', // COPY-UNSIGNED (J-06, owner D-008)
  'trade-ban': 'On, hidden while your account is banned from trading', // COPY-UNSIGNED (Plan 4 Task 27)
  'review-pending': 'On, hidden until you rate your last trade', // COPY-UNSIGNED (Plan 5 Task 3 review M3)
  'method-unavailable': "On, hidden: this payment method isn't available right now",
  // COPY-UNSIGNED (J-16; Task 34 review M4): none of the offer's currencies has a market price now.
  'no-price': 'On, hidden: no market price for its currencies right now',
} as const;
export type MyOffersHidden = keyof typeof MY_OFFERS_HIDDEN;

// ---------------------------------------------------------------------------------------------
// Plan 2 Task 16: new-device approval. COPY-UNSIGNED (Plan 3 Task 41).

/** The device limit's code. */
export const TOO_MANY_DEVICES_CODE = 'too-many-devices' satisfies CantDoCode;
/** The hourly cap on login approvals (the web's code for 429 `slow-down` `{ reason: 'approvals' }`). */
export const TOO_MANY_APPROVALS_CODE = 'too-many-approvals' satisfies CantDoCode;
/** 429 `slow-down` `{ reason: 'approvals' }`: too many login approvals asked for in an hour. */
export const TOO_MANY_APPROVALS =
  'Your account has asked for too many login approvals in the last hour. Wait a while, then log in again, or use a backup.';

/** Plan 4 Task 30: TICKET_OPEN_AT_ONCE tickets not closed (409 `too-many-tickets`). */
export const TOO_MANY_TICKETS_CODE = 'too-many-tickets' satisfies CantDoCode;
/** COPY-UNSIGNED */
export const TOO_MANY_TICKETS = {
  title: "You can't open another ticket yet",
  body: (n: number) => `You can have ${n} tickets open at a time. Close one you no longer need, or wait for X2F to answer.`,
} as const;

/** The member limit's code (Plan 2 Task 18). */
export const TOO_MANY_MEMBERS_CODE = 'too-many-members' satisfies CantDoCode;

/**
 * Team members (Plan 2 Task 18): what a team refusal says, on the Team screen and on any screen a
 * member was refused on. `max` is the member limit the API sent with `too-many-members`.
 * COPY-UNSIGNED
 */
/** The team refusal's title: who may do it, or why this device can't (design build review 7 Nov). */
export function teamCantDoTitle(code: CantDoCode | string): string {
  if (code === 'owner-only') return CANT_DO_TITLE.teamOwnerOnly;
  if (code === 'forbidden') return CANT_DO_TITLE.teamRole;
  if (code === TOO_MANY_MEMBERS_CODE) return CANT_DO_TITLE.teamFull;
  return CANT_DO_TITLE.team;
}

export function teamCantDoText(code: CantDoCode, o: { max?: number } = {}): string {
  switch (code) {
    case 'owner-only':
      return 'Only the account owner can do this. Team members work on offers or trades, as their roles allow.';
    case 'forbidden':
      return "Your team role doesn't include this. The account owner can change your roles.";
    case 'not-vendor':
      return 'Team members are only for vendor accounts. Switch to a vendor account in Settings, Account type, then invite.';
    case 'too-many-members':
      return `A team can have at most ${o.max ?? 3} members. Remove one before inviting someone new.`;
    case 'member-cannot-sign':
      return "Starting or accepting a trade, and securing or releasing coins, stay on the account owner's device for now. Ask the account owner to do this step.";
    // J-20 (owner p7-4). COPY-UNSIGNED // DESIGN: wording
    case 'outside-trade-band':
      return 'This is outside the trade sizes the account owner set for you. Ask the account owner to do this step.';
    // J-20 (owner p7-11, review S-m4). COPY-UNSIGNED // DESIGN: wording
    case 'past-working-hours':
      return 'Your working hours end before then, so your session cannot run that long.';
    default:
      return "This can't be done on the team right now.";
  }
}

/**
 * Job 1c (owner S-094, p7-8): what a refused note says. `max` is the account's note cap the API
 * sent with `too-many-notes`. COPY-UNSIGNED // DESIGN: wording
 */
export function notesCantDoTitle(code: CantDoCode): string {
  if (code === 'owner-only') return CANT_DO_TITLE.teamOwnerOnly;
  if (code === 'forbidden') return CANT_DO_TITLE.teamRole;
  return CANT_DO_TITLE.notes;
}

export function notesCantDoText(code: CantDoCode, o: { max?: number } = {}): string {
  switch (code) {
    case 'too-many-notes':
      return `Your account has ${o.max ?? 500} notes, the most it can keep. The account owner can delete old notes to add more.`;
    case 'owner-only':
      return 'Only the account owner can delete a note. Team members can add notes, as their boxes allow.';
    case 'forbidden':
      return "Your boxes don't include notes on traders. The account owner can tick them for you.";
    default:
      return teamCantDoText(code);
  }
}

// ---------------------------------------------------------------------------------------------
// Owner 2 Nov 2026: Trader and Vendor accounts (board BecomeVendor). COPY-UNSIGNED.

/** Only vendors post offers. */
export const NOT_VENDOR_CODE = 'not-vendor' satisfies CantDoCode;
/** Switching to vendor needs a passkey, security key or PGP key on the account. */
export const VENDOR_NEEDS_KEY_CODE = 'vendor-needs-key' satisfies CantDoCode;

/** 403 `not-vendor` on Post offer, and what Post offer shows a trader instead of the form. */
export const NOT_VENDOR_POST_TEXT = 'Only vendor accounts can post offers. Traders take offers that vendors post. Switch to a vendor account in Settings, Account type.';

/** 403 `vendor-needs-key` on the switch. */
export const VENDOR_NEEDS_KEY_TEXT = "You can't switch to a vendor account yet. The account holder needs a passkey, security key or PGP key.";

/** What a refused switch to vendor says (CantDoThat on Settings, Account type). */
export function accountTypeCantDoText(code: CantDoCode): string {
  switch (code) {
    case 'vendor-needs-key':
      return VENDOR_NEEDS_KEY_TEXT;
    case 'method-not-allowed':
      return 'Switching to a vendor account needs your passkey, security key or PGP key to confirm.';
    case 'owner-only':
      return teamCantDoText(code);
    default:
      return "Your account can't switch to a vendor account right now.";
  }
}

// ---------------------------------------------------------------------------------------------
// Security keys (owner demo 13 Nov 2026: "Unable to add security key").

/** 403 `method-not-allowed` when a security key is added: the server turned this key's model away (staff, owner and member allowlists). */
export const KEY_MODEL_REFUSED_CODE = 'method-not-allowed' satisfies CantDoCode;
/** What setup, Backup and Settings say for it (screens/auth/keyErrors.ts). COPY-UNSIGNED */
export const KEY_MODEL_REFUSED_TEXT = "This key model isn't accepted yet. Use a different security key.";

