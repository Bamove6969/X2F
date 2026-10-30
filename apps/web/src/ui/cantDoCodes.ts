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
  // Plan 2 Task 18: team members (owner-only actions, a role a member lacks, the member limit,
  // and escrow signing, which stays on the account owner's device until Plan 3 Task 42).
  'owner-only',
  'forbidden',
  'too-many-members',
  'member-cannot-sign',
  // Guessed for refusals whose API tasks are not on the main line yet (Plan 5 Task 3's review
  // pending, Plan 4's lien and trade ban): check them when those land.
  'review-pending',
  'lien',
  'trade-ban',
] as const;
export type CantDoCode = (typeof CANT_DO_CODES)[number];

/** Every other code the web knows, with why it is not a "can't do that" refusal. */
export const NOT_REFUSAL_CODES: Readonly<Record<string, string>> = {
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
  team: "This can't be done on the team",
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
    default:
      return 'Your account cannot start this trade right now.';
  }
}

/** What a refused Post offer says. */
export function postCantDoText(code: CantDoCode): string {
  switch (code) {
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so you can't post offers until it's resolved.";
    case 'too-many-offers':
      return 'You have as many offers as you can post for now. Remove one you no longer need, then post this one.';
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

/** Why a live offer is hidden (Task 36 review M4, `hidden` on GET /v1/account/offers), as its status line. COPY-UNSIGNED */
export const MY_OFFERS_HIDDEN = {
  'trading-paused': 'On, hidden while trading is paused',
  'trading-hold': 'On, hidden while your account has a trading hold',
  'method-unavailable': "On, hidden: this payment method isn't available right now",
} as const;
export type MyOffersHidden = keyof typeof MY_OFFERS_HIDDEN;

/**
 * Team members (Plan 2 Task 18): what a team refusal says, on the Team screen and on any screen a
 * member was refused on. `max` is the member limit the API sent with `too-many-members`.
 * COPY-UNSIGNED
 */
export function teamCantDoText(code: CantDoCode, o: { max?: number } = {}): string {
  switch (code) {
    case 'owner-only':
      return 'Only the account owner can do this. Team members work on offers or trades, as their roles allow.';
    case 'forbidden':
      return "Your team role doesn't include this. The account owner can change your roles.";
    case 'too-many-members':
      return `A team can have at most ${o.max ?? 3} members. Remove one before inviting someone new.`;
    case 'member-cannot-sign':
      return "Releasing or securing coins stays on the account owner's device for now. Ask the account owner to do this step.";
    default:
      return "This can't be done on the team right now.";
  }
}
