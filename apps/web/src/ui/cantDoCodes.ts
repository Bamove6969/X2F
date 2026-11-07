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

export const CANT_DO_CODES = [
  // Plan 3 Task 5 (take; on the main line since 2026-10-29).
  'starter-limit',
  'not-enough-trades',
  'own-offer',
  'already-waiting',
  'offer-busy',
  // Plan 3 Task 4 (post an offer).
  'trading-hold',
  'too-many-offers',
  // Plan 2: a backup login and the account's login methods.
  'recovery-session',
  'recovery-hold',
  'security-key-limit',
  'login-name-set',
  'last-login-method',
  'method-not-allowed',
  'account-disabled',
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
  // Plan 2 Task 17 review round 2 (N-I3, N-M3): a session whose login waits may not log a stronger
  // one out, answer a strong login, or hide the hold's warnings.
  'weak-session',
  // Plan 2 Task 18: team members (owner-only actions, a role a member lacks, the member limit,
  // and escrow signing, which stays on the account owner's device until Plan 3 Task 42).
  'owner-only',
  'forbidden',
  'too-many-members',
  'member-cannot-sign',
  // Plan 5 Task 3: rate (or skip rating) your last trade first (the rate-first gate, spec 5.1).
  'review-pending',
  // Guessed for refusals whose API tasks are not on the main line yet (Plan 4's lien and trade
  // ban): check them when those land.
  'lien',
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
] as const;
export type CantDoCode = (typeof CANT_DO_CODES)[number];

/** Every other code the web knows, with why it is not a "can't do that" refusal. */
export const NOT_REFUSAL_CODES: Readonly<Record<string, string>> = {
  // Plan 4 Tasks 5 and 7: staff-API answers traders never get (their words come with the staff web
  // app, Plan 4 Task 16).
  'tap-invalid': 'a staff security-key tap (staff app only)',
  'invite-invalid': 'a staff invite link that is used, expired or cancelled (staff app only)',
  'security-key-required': 'a staff sign-up step: a security key must be added (staff app only)',
  'two-factors-required': 'a staff sign-up step: a second login method must be added (staff app only)',
  'owner-protected': "the owner's own account in staff management (staff app only)",
  'owner-needs-two-keys': 'the owner keeps at least two security keys (staff app only)',
  'bad-request': 'a malformed request (a fault)',
  'not-found': 'nothing there',
  'unsupported-media-type': 'a fault',
  internal: 'a server fault',
  busy: 'the server is busy (try again)',
  'display-name-invalid': 'an input check on a typed name',
  'display-name-reserved': 'an input check on a typed name',
  'display-name-taken': 'an input check on a typed name',
  'login-name-invalid': 'an input check on a typed name',
  'names-unavailable': 'an input check on a typed name',
  'names-same': 'an input check on a typed name',
  'password-weak': 'an input check on a typed password',
  'password-leaked': 'an input check on a typed password',
  'key-unreadable': 'an input check on a pasted key',
  'key-too-large': 'an input check on a pasted key',
  'key-private': 'an input check on a pasted key',
  'key-multiple': 'an input check on a pasted key',
  'key-weak': 'an input check on a pasted key',
  'key-expired': 'the pasted key itself is expired',
  'key-revoked': 'the pasted key itself is revoked',
  'key-no-encryption': 'an input check on a pasted key',
  'key-not-yet-valid': 'the pasted key itself is not valid yet',
  'key-no-signing': 'an input check on a pasted key (past reputation: it cannot sign)',
  'key-in-use': 'an input check on a pasted key',
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
  'origin-refused': 'a CSRF guard (a fault)',
  'address-invalid': 'an input check on a typed address',
  'address-integrated': 'an input check on a typed address',
  'wallet-exists': 'an input check (already linked)',
  'terms-not-accepted': 'sends the person to the Terms',
  'terms-required': 'sends the person to the Terms',
  'price-unavailable': 'the price feed is down (a fault)',
  'price-changed': 'the market moved (re-quote)',
  'method-unavailable': 'a catalog fact (the method is off the list); Suggest a method covers it',
  'no-wallet': 'sends the person to Add a wallet',
  'trading-paused': 'maintenance, with its own message (Plan 3 emergency stop)',
  'out-of-range': 'an input check on the amount',
  'ad-busy': 'someone else is taking the offer (try again)',
  'wallet-not-ready': 'pick another wallet (the wait is explained on Wallets)',
  'event-not-allowed': 'the trade state machine (the trade has moved on)',
  'wrong-state': 'the trade state machine (the trade has moved on)',
  'wrong-party': 'the trade state machine (not this side)',
  'too-early': "the trade's own clock",
  'too-late': "the trade's own clock",
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
  'wrong-channel': 'a device check (a fault)',
  'wrong-sender': 'a device check (a fault)',
  'chat-unavailable': 'the trade has no chat (cannot happen since Task 5\'s offer key; a fault)',
  'mod-not-allowed': "a device check: a moderator line outside a dispute is not shown (the chat's own rule)",
  'bad-message': 'a device check on a received line (a fault)',
  'bad-text': 'an input check on the typed message',
  'too-large': 'an input check on the typed message',
  // Escrow device codes (apps/web/src/escrow), compared on `.code` too.
  'address-mismatch': 'an escrow safety check on this device',
  'bad-outcome': 'an escrow safety check on this device',
  'daemon-unavailable': 'the Monero node is unreachable (a fault)',
  equivocation: 'an escrow safety check on this device',
  'settled-elsewhere': 'the escrow already settled',
  stopped: 'the escrow stopped (a fault)',
  'wrong-terms': 'an escrow safety check on this device',
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
  devices: "That device can't be logged out from here",
  chat: "This chat can't open",
  team: "This can't be done on the team",
  // Design build review 7 Nov: a title that says why (CantDoThat titles). COPY-UNSIGNED
  teamOwnerOnly: 'Only the owner can do this',
  teamWeak: 'Needs a Strong login',
  // COPY-UNSIGNED: the design review's title for shot 19 (too-many-members, now a server fallback).
  teamFull: 'Your team is full',
} as const;

/** What a refused take says (spec 2.3: a starter-limit names only the caller's own stage and cap). */
export function takeCantDoText(code: CantDoCode, o: { stageName: string | null; capText: string | null; maxOpen: number | null; minTrades: number }): string {
  switch (code) {
    case 'starter-limit':
      // No stage: the limit is the other side's, which is never named (Task 5 sends nothing about it).
      if (o.stageName === null) return 'This trade is above a trading limit right now. Try a smaller amount or another offer.';
      if (o.maxOpen !== null) return `Your account is on ${o.stageName} limits: at most ${o.maxOpen} open ${o.maxOpen === 1 ? 'trade' : 'trades'} at once. Finish one first.`;
      return `Your account is on ${o.stageName} limits${o.capText === null ? '' : ` up to ${o.capText} per trade`}. Try a smaller amount.`;
    case 'own-offer':
      return 'This is your own offer.';
    case 'not-enough-trades':
      return `This offer needs at least ${o.minTrades} completed ${o.minTrades === 1 ? 'trade' : 'trades'}.`;
    case 'trading-hold':
      return 'Your account is on a trading hold while a dispute is open, so it cannot start trades.';
    case 'already-waiting':
      return 'You already have a trade on this offer waiting to be funded.';
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

/** What a refused chat open says (Task 20: today only 409 own-offer, a poster on their own offer). */
export function chatCantDoText(code: CantDoCode): string {
  return code === 'own-offer' ? 'This is your own offer.' : "You can't open this chat right now.";
}

/** What a refused Post offer says. */
export function postCantDoText(code: CantDoCode): string {
  switch (code) {
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so you can't post offers until it's resolved.";
    case 'too-many-offers':
      return 'You have as many offers as you can post for now. Remove one you no longer need, then post this one.';
    // Plan 2 Task 18: a team member without the Offers role.
    case 'forbidden':
    case 'owner-only':
      return teamCantDoText(code);
    default:
      return "Your account can't post this offer right now.";
  }
}

/** 403 `recovery-session`: a backup login cannot change where coins are paid (Plan 2). */
export const RECOVERY_SESSION_WALLETS =
  "You logged in with a backup, so you can't add wallets in this session. Log in with your usual method to add one.";

/** What a refused wallet add says, for the codes that have Wallets-specific words (else null). */
export function walletsCantDoText(code: CantDoCode): string | null {
  return code === 'recovery-session' ? RECOVERY_SESSION_WALLETS : null;
}

/** The code for the account's only login method. */
export const LAST_METHOD_CODE = 'last-login-method' satisfies CantDoCode;

/** 409 `last-login-method` (and the client's own check before asking): the account's only way to log in. */
export const LAST_METHOD_MESSAGE = 'That is your only way to log in. Add another login method before removing this one.';

/** 409 `no-extensions-left` (Plan 3 Task 6): the payment time was already extended as often as allowed. */
export const NO_EXTENSIONS_LEFT = 'This trade has had all the extra time it can get. Cancel and get your refund, or keep waiting for the payment.';

/** What a refused extend says, for the codes that have their own words (else null). */
export function extendCantDoText(code: CantDoCode): string | null {
  return code === 'no-extensions-left' ? NO_EXTENSIONS_LEFT : null;
}

/** The nudge limit's code. */
export const NUDGE_TOO_SOON_CODE = 'too-soon' satisfies CantDoCode;

/** 429 `too-soon` on a nudge (Plan 3 Task 26). */
export const NUDGE_TOO_SOON = 'You can nudge once every 10 minutes.';

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
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so your offers stay off until it's resolved.";
    case 'too-many-offers':
      return n === 1
        ? 'You have more offers in this market than the limit allows now. Remove one you no longer need, then turn this one on.'
        : 'You have more offers in some markets than the limit allows now. Remove ones you no longer need, then turn these on.';
    default:
      return "Your account can't turn these offers on right now.";
  }
}

/** The short line under each offer a CantDoThat refusal kept off (the popup gives the reason in full). COPY-UNSIGNED */
export function myOffersCantDoRow(code: CantDoCode): string {
  switch (code) {
    case 'trading-hold':
      return 'Stayed off: your account has a trading hold.';
    case 'too-many-offers':
      return 'Stayed off: over the offer limit for this market.';
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
  'review-pending': 'On, hidden until you rate your last trade', // COPY-UNSIGNED (Plan 5 Task 3 review M3)
  'method-unavailable': "On, hidden: this payment method isn't available right now",
} as const;
export type MyOffersHidden = keyof typeof MY_OFFERS_HIDDEN;

// ---------------------------------------------------------------------------------------------
// Plan 2 Tasks 16-17: new-device approval and the 24-hour hold. COPY-UNSIGNED (Plan 3 Task 41).

/** The device limit's code. */
export const TOO_MANY_DEVICES_CODE = 'too-many-devices' satisfies CantDoCode;
/** The hourly cap on login approvals (the web's code for 429 `slow-down` `{ reason: 'approvals' }`). */
export const TOO_MANY_APPROVALS_CODE = 'too-many-approvals' satisfies CantDoCode;
/** The 24-hour hold's code (a held backup session, or the account's hold). */
export const HOLD_CODE = 'recovery-hold' satisfies CantDoCode;

/**
 * 403 `recovery-hold`: the account's 24-hour hold after a login with only one way of proving it's
 * you, or a backup login (Plan 2 Task 17; owner 2026-10-29 14:12: PGP alone does not end it).
 * `when` is "until Tue 3:05 PM" or "for a day".
 */
export function holdText(when: string): string {
  return `Your account is on a 24-hour hold after a login with only one way of proving it's you, so new trades, wallet changes and login changes wait ${when}. Trades already open can still be finished. Logging in with a passkey, a security key, or your password and authenticator code from before the hold ends it.`;
}

/**
 * 403 `recovery-hold` on the login screen (review round 3 R3-M3): this login was refused a session
 * because it waits, and the hold is still running. `when` is "until Tue 3:05 PM" or "for a day".
 * It says what this login cannot do and what the reader can do, whatever methods the account has
 * (the login screen does not know them); review round 4 R4-M3: a backup login spends a recovery
 * code and pushes the hold's end out to 24 hours from then. COPY-UNSIGNED
 */
export function holdLoginText(when: string): string {
  return `This login can't get in ${when}. Your account is on a 24-hour hold after a login with only one way of proving it's you, and a login like this one waits until the hold ends. If you had a passkey, a security key, or an authenticator code set up before the hold, log in with it now: that ends the hold. If not, wait and log in again when the hold ends. With a recovery code you can use a backup login in the meantime to finish trades already open. A backup login uses up that recovery code and makes the hold last 24 hours from then.`;
}

/** 429 `slow-down` `{ reason: 'approvals' }`: too many login approvals asked for in an hour. */
export const TOO_MANY_APPROVALS =
  'Your account has asked for too many login approvals in the last hour. Wait a while, then log in again, or use a backup.';

/** The code of a session whose login waits (Plan 2 Task 17 review round 2). */
export const WEAK_SESSION_CODE = 'weak-session' satisfies CantDoCode;

/**
 * 403 `weak-session`: this device logged in with only one way of proving it's you, so it cannot
 * log out a device that logged in more strongly (or any device during the 24-hour hold), nor
 * answer a login made with a passkey or two ways.
 */
export const WEAK_SESSION_TEXT =
  "This device logged in with only one way of proving it's you, so it can't log out devices that logged in more securely, or answer their logins. Do this from a device where you logged in with a passkey, a security key, or your password and authenticator code.";

/** 403 `recovery-hold` when approving a new device during the hold; blocking it still works. */
export function holdApproveText(when: string): string {
  return `${holdText(when)} New devices can't be let in until then, but you can still block this login.`;
}

/** The member limit's code (Plan 2 Task 18). */
export const TOO_MANY_MEMBERS_CODE = 'too-many-members' satisfies CantDoCode;

/**
 * Team members (Plan 2 Task 18): what a team refusal says, on the Team screen and on any screen a
 * member was refused on. `max` is the member limit the API sent with `too-many-members`.
 * COPY-UNSIGNED
 */
/** The team refusal's title: who may do it, or why this device can't (design build review 7 Nov). */
export function teamCantDoTitle(code: CantDoCode | string): string {
  if (code === 'owner-only' || code === 'forbidden') return CANT_DO_TITLE.teamOwnerOnly;
  if (code === 'weak-session') return CANT_DO_TITLE.teamWeak;
  if (code === TOO_MANY_MEMBERS_CODE) return CANT_DO_TITLE.teamFull;
  return CANT_DO_TITLE.team;
}

export function teamCantDoText(code: CantDoCode, o: { max?: number } = {}): string {
  switch (code) {
    case 'owner-only':
      return 'Only the account owner can do this. Team members work on offers or trades, as their roles allow.';
    case 'forbidden':
      return "Your team role doesn't include this. The account owner can change your roles.";
    case 'too-many-members':
      return `A team can have at most ${o.max ?? 3} members. Remove one before inviting someone new.`;
    case 'member-cannot-sign':
      return "Starting or accepting a trade, and securing or releasing coins, stay on the account owner's device for now. Ask the account owner to do this step.";
    // Owner 1 Nov 2026: inviting a member and changing roles need a strong login (API 403 weak-session).
    case 'weak-session':
      return "This device logged in with only one way of proving it's you, so it can't invite team members or change their roles. Do this from a device where you logged in with a passkey, a security key, or your password and authenticator code.";
    default:
      return "This can't be done on the team right now.";
  }
}
