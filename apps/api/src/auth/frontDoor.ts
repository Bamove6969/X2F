import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { requireSession } from './sessions.js';

/**
 * The front door (owner, 8 Nov 2026): "No one gets to make it past the front door and see behind
 * the curtains without signing an agreement, creating an account and logging in. There are no free
 * tours for outsiders."
 *
 * Every route that answers with marketplace or user data (offers and their counts, prices, profiles,
 * reviews, news, the site banner) runs behind `requireInside`: a live full session of a trader
 * account on the current Terms. A team member passes as the account they work for (their session
 * is a row of that account). Without one: 401 `not-authenticated`, a recovery session 403
 * `recovery-session`, stale Terms 403 `terms-required` (the web sends that to the Terms screen), and
 * never any data.
 *
 * It does not touch the session (`touch: false`): reading lists and prices, some of them polled,
 * must never keep an idle session alive in an open tab (review 2026-10-27, I1).
 */
export const requireInside = requireSession({ kinds: ['trader'], touch: false, member: 'any' });

/**
 * The account behind `requireInside`, or null for anyone else. For the one route that answers both
 * sides of the door (`GET /v1/site`: a bare maintenance flag outside, the banner inside). Any 401 or
 * 403 counts as outside; anything else is thrown.
 */
export async function insideAccount(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  try {
    await requireInside.call(app, req, reply);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
  return req.auth?.accountId ?? null;
}

/** True when a route's preHandler (one hook or a list) includes `requireInside`. */
export function runsInside(preHandler: unknown): boolean {
  const hooks = Array.isArray(preHandler) ? preHandler : [preHandler];
  return hooks.includes(requireInside);
}

/**
 * Every GET route behind a session that is not `requireInside`, with the reason it may be: each
 * answers only the caller's own account, trades, chats or settings, never other traders' data
 * (review 2026-11-08 F2). `test/frontDoor.test.ts` fails when a session-guarded GET is neither.
 */
export const OWN_DATA_READS: Readonly<Record<string, string>> = {
  'GET /v1/account/me': "who I am: my display name, login methods, session level and Terms state (read on stale Terms and recovery to route me)",
  'GET /v1/account/alerts': 'my own security alerts',
  'GET /v1/account/approvals': 'my own pending new-device login approvals',
  'GET /v1/account/approvals/:id': 'one of my own pending new-device login approvals',
  'GET /v1/account/blocks': 'the traders I blocked, when, and my own private note on each (S-093)',
  'GET /v1/account/chat-keys': "my own account's sealed chat-key envelopes for my own devices (a strong session of the account owner only; ciphertext the API cannot open)",
  'GET /v1/account/freeze': "my own account's active trading freezes (D-016): since when, and my own disputed trade (my side, its amount and the partner's public name)",
  'GET /v1/account/hold': "my own account's hold, waiting changes and my session's drafts (hold model v3; a team member only by the hold rights, never the lead's device names)",
  'GET /v1/account/jabber': 'my own Jabber alert set-up (the masked address, its state); never another account',
  'GET /v1/account/jabber/events': 'which events send my own Jabber notices (W-021); never another account',
  'GET /v1/account/methods': 'my own login methods',
  'GET /v1/account/notes/:displayName': "my own account's private notes on a trader (the account owner, or a member with the notes-view box); the notes themselves, never the trader's data",
  'GET /v1/account/nudges': 'my own nudge setting',
  'GET /v1/account/offers': 'my own offers (read on stale Terms too, to turn them off)',
  'GET /v1/account/past-rep': 'my own imported past reputation',
  'GET /v1/account/profile/traded-total': 'my own traded-total display setting',
  'GET /v1/account/push': 'my own push subscription state and the VAPID public key',
  'GET /v1/account/security/devices': 'my own trusted devices',
  'GET /v1/account/sessions': 'my own sessions',
  'GET /v1/chats': 'my own chats',
  'GET /v1/chats/:chat': 'one of my own chats (participants only)',
  'GET /v1/chats/:chat/attestation': 'one of my own chats (participants only)',
  'GET /v1/chats/:chat/envelopes': 'one of my own chats (participants only)',
  'GET /v1/events': 'my own live events (per account and per trade, no marketplace broadcast)',
  'GET /v1/reviews/pending': 'reviews I still owe for my own trades',
  'GET /v1/team': "my own team's members (account owner only)",
  'GET /v1/team/audit': "my own team's audit log (account owner only)",
  'GET /v1/team/permissions': 'the static abilities catalogue (groups, boxes, presets, hard rules): no account data; read on stale Terms too, so a member sees what their boxes mean before agreeing',
  'GET /v1/trades/:code': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/attestation': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/confirmations': 'one of my own trades (participants only)',
  // P-012/P-013 (proof-check, classified at the batch 9 merge): my own side's blur-check asks.
  'GET /v1/trades/:code/blur-checks': 'one of my own trades (participants only): my side\'s blur-check asks',
  'GET /v1/trades/:code/dispute': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/review': 'one of my own trades (participants only)',
  'GET /v1/wallets': 'my own payout wallets',
  'GET /v1/wallets/rule': 'my own wallet rule',
};

/**
 * Every route other than GET (and HEAD) behind a session that is not `requireInside`, with the reason
 * it may be: each writes only to the caller's own account, trades, chats or settings, and answers
 * only with the result of that write (or the caller's own data), never other traders' data (review
 * 6a5949a6 F2b). `test/frontDoor.test.ts` fails when a session-guarded write is neither here nor
 * behind `requireInside`. The live-session and hold checks are classified separately (auth/hold.ts).
 */
export const OWN_DATA_WRITES: Readonly<Record<string, string>> = {
  // Login methods and security settings (my own account).
  'PUT /v1/account/password': 'sets or changes my own password; no data back',
  'POST /v1/account/pgp/start': 'an add-key challenge for my own account, encrypted to the key I sent',
  'POST /v1/account/pgp/finish': 'adds a PGP key to my own account',
  'POST /v1/account/webauthn/start': 'registration options for my own account',
  'POST /v1/account/webauthn/finish': 'adds a passkey or security key to my own account',
  'POST /v1/account/totp/start': 'an authenticator enrolment secret for my own account',
  'POST /v1/account/totp/finish': 'turns on the authenticator for my own account',
  'POST /v1/account/recovery-codes': 'new recovery codes for my own account',
  'DELETE /v1/account/methods/:type/:id': 'removes one of my own login methods',
  'POST /v1/account/login-name': 'changes my own login name',
  'PUT /v1/account/security/one-device': 'my own one-device setting',
  // Session length (owner, 2 Nov 2026) and the idle reminder (owner Q75): the calling person's own
  // session and their own preference (a member's on their own login account).
  'PUT /v1/account/session/length': "my own session's length; answers my own session's length and end",
  'POST /v1/account/session/extend': "extends my own session after a confirm with my own login method; answers my own session's length and end",
  'PUT /v1/account/idle-reminder': 'my own idle reminder; answers it',
  // Owner 2 Nov 2026: Trader and Vendor accounts.
  'PUT /v1/account/type': 'switches my own account to a vendor account; answers its type',
  'POST /v1/confirm/password': 'a confirm token bound to my own session',
  'POST /v1/confirm/pgp/start': 'a confirm challenge bound to my own session, for my own key',
  'POST /v1/confirm/pgp/finish': 'a confirm token bound to my own session',
  'POST /v1/confirm/webauthn/start': 'confirm options bound to my own session, for my own keys',
  'POST /v1/confirm/webauthn/finish': 'a confirm token bound to my own session',
  // Sessions, approvals, alerts, push and the Terms (my own account).
  'POST /v1/account/approvals/:id': 'my decision on one of my own new-device login approvals',
  'DELETE /v1/account/sessions/:id': 'ends one of my own sessions',
  'DELETE /v1/account/recovery-sessions/:id': 'cancels one of my own backup sessions',
  'POST /v1/account/push': 'my own push subscription',
  'DELETE /v1/account/push': 'drops my own push subscriptions',
  'POST /v1/account/alerts/:id/seen': 'marks one of my own alerts seen',
  'POST /v1/account/terms': 'my own acceptance of the current Terms (a member: their own login account)',
  // Owner rule p5-7: my own Jabber alert set-up (the address is sealed; a test code proves it).
  'POST /v1/account/jabber/test': 'sends a test code to a Jabber address I typed, for my own account; answers the masked address',
  'POST /v1/account/jabber/verify': 'proves my own typed Jabber address with its test code; answers my set-up state',
  'PUT /v1/account/jabber/enabled': 'switches my own Jabber alerts on or off; answers my set-up state',
  'PUT /v1/account/jabber/events': 'turns one event of my own Jabber notices on or off (W-021); answers my event list',
  'DELETE /v1/account/jabber': 'removes my own Jabber set-up; no data back',
  // J-23 groundwork: the chat-key courier between my own devices (a strong session of the account owner only).
  'POST /v1/account/chat-keys': "stores a sealed chat-key envelope for one of my own devices; answers its id and expiry",
  'DELETE /v1/account/chat-keys/:id': "marks one of my own account's chat-key envelopes collected; no data back",
  // Hold model v3: my own account's changes waiting their 24 h, and its replaced recovery code.
  'POST /v1/account/hold/changes/submit': "submits my own session's drafts; answers their count and date",
  'POST /v1/account/hold/changes/approve': "approves my own account's waiting changes now (a strong session); answers the outcome",
  'DELETE /v1/account/hold/changes': "cancels my own account's waiting changes; no data back",
  'DELETE /v1/account/hold/changes/:id': "cancels one of my own account's waiting changes; no data back",
  'POST /v1/account/recovery-code/reveal': "shows my own account's new recovery code once, to the session allowed to read it",
  // Settings and social rows (my own account).
  'PUT /v1/account/nudges': 'my own nudge setting',
  'POST /v1/account/blocks': 'a block row of mine; no data back (404 for a name that is not a trader)',
  'DELETE /v1/account/blocks/:displayName': 'removes a block row of mine; no data back',
  'PUT /v1/account/blocks/:displayName/note': "my own private note on a block row of mine (S-093); answers that note",
  'POST /v1/account/notes': "a private note row of my own account on a trader (the account owner, or a member with the notes-add box); answers that note",
  'DELETE /v1/account/notes/:id': "removes one of my own account's note rows (account owner only); no data back",
  'PUT /v1/account/profile/traded-total': 'my own traded-total display setting',
  'POST /v1/account/past-rep/start': 'a past-rep challenge for my own claim',
  'POST /v1/account/past-rep/finish': 'my own past-rep claim',
  'DELETE /v1/account/past-rep/:id': 'removes my own past-rep claim',
  'POST /v1/method-suggestions': 'a method suggestion row of mine; no data back',
  'POST /v1/feedback': 'a platform-feedback row; no data back',
  'POST /v1/feedback/form': 'a feedback row; no data back',
  // Wallets and offers (my own).
  'POST /v1/wallets': 'adds my own payout wallets; answers them',
  'DELETE /v1/wallets/:id': 'removes one of my own payout wallets',
  'PUT /v1/wallets/:id/default': 'chooses which of my own payout wallets the trade screen picks first',
  'POST /v1/offers': 'posts my own offer; answers its id',
  'PATCH /v1/offers/:id': 'pauses, removes or relists my own offer (403 wrong-party for anyone else\'s)',
  'POST /v1/account/offers/status': 'turns my own offers on or off',
  // Trades and chats (participants only).
  'POST /v1/offers/:id/take': 'opens my own trade on a listed offer; answers its code and locked price',
  'POST /v1/trades/:code/events': 'an event in one of my own trades (participants only); answers its view',
  'POST /v1/trades/:code/wallet': "the poster's payout wallet for one of my own trades, from my own wallets",
  'POST /v1/trades/:code/identity': 'my identity for one of my own trades (participants only)',
  'POST /v1/trades/:code/chat': 'the chat of one of my own trades (participants only)',
  'POST /v1/trades/:code/dispute': 'opens a dispute on one of my own trades (participants only)',
  // P-012/P-013 (proof-check, classified at the batch 9 merge): the blur check on my own trades.
  'POST /v1/trades/:code/proofs/:proofId/blur-check': 'counts my own proof on one of my own trades for the blur-check sample (participants only); answers only whether to ask',
  'POST /v1/trades/:code/blur-checks/:proofId': 'my anonymous blur-check answer on one of my own trades (participants only); no data back',
  'POST /v1/trades/:code/appeal': 'appeals a ruling on one of my own trades (participants only)',
  'POST /v1/trades/:code/review': 'my review of one of my own finished trades',
  'POST /v1/trades/:code/review/skip': 'skips my review of one of my own finished trades',
  'POST /v1/nudges': 'a nudge to the other party of one of my own trades; answers its state',
  'POST /v1/chats': 'opens my own pre-trade chat on a listed offer; answers its code and my role',
  'POST /v1/chats/:chat/identity': 'my chat identity key for one of my own chats',
  'POST /v1/chats/:chat/envelopes': 'an encrypted line in one of my own chats',
  // My own team (account owner only).
  'POST /v1/team/invites': 'an invite to my own team; answers its id, code and deadline',
  'PATCH /v1/team/members/:id': "changes a member's boxes (abilities) in my own team",
  'DELETE /v1/team/members/:id': 'removes a member from my own team',
  'PUT /v1/team/members/:id/limits': "sets a member's trade-size band and working hours in my own team (J-20)",
};

/**
 * Every trader API route that runs without a session, with the reason it must. Each one serves the
 * front door: logging in, creating an account, getting back in, the Terms text to read before
 * agreeing, or a bare "up / maintenance" answer. Nothing here returns marketplace or user data.
 * `test/frontDoor.test.ts` fails when a route is added without a session guard and is not listed.
 */
export const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  'GET /healthz': 'liveness probe; answers { ok: true } only',
  'GET /v1/site': 'outside the door: only whether the site is in maintenance (and its kind); the banner and trading pause need a session',
  'POST /v1/logout': 'ends whatever session the cookie names; no data back',
  'GET /v1/terms': 'the Terms and Privacy text and version, read before agreeing at sign-up',
  'GET /v1/pgp/signing-key': "X2F's own public signing key, to check the signed sign-up and login challenges",
  'POST /v1/register/name-check': 'create an account: the live "is available" tick for the login name (rate limited per device and site wide, auth/nameCheck.ts); answers { available } only',
  'POST /v1/register/password': 'create an account (password)',
  'POST /v1/register/pgp/start': 'create an account (PGP)',
  'POST /v1/register/pgp/finish': 'create an account (PGP)',
  'POST /v1/register/webauthn/start': 'create an account (passkey or security key)',
  'POST /v1/register/webauthn/finish': 'create an account (passkey or security key)',
  'POST /v1/login/password': 'log in',
  'POST /v1/login/pgp/start': 'log in',
  'POST /v1/login/pgp/finish': 'log in',
  'POST /v1/login/webauthn/start': 'log in',
  'POST /v1/login/webauthn/finish': 'log in',
  'POST /v1/login/second-factor': 'log in (second step)',
  'POST /v1/login/backup': 'account recovery: recovery code or authenticator backup login',
  'POST /v1/login/approval/:id/poll': 'log in on a new device: waits for the approval from a logged-in device (needs the secret approval id)',
  'POST /v1/login/approval/:id/cancel': 'log in on a new device: gives up waiting',
  'POST /v1/team/invite': "team member sign-up: opens an invite by its secret code (shows only what that invite says)",
  'POST /v1/team/join/start': 'team member sign-up (needs the secret invite code)',
  'POST /v1/team/join/finish': 'team member sign-up (needs the secret invite code)',
  'POST /v1/team/join/second/webauthn/start': 'team member sign-up, second login method',
  'POST /v1/team/join/second/webauthn/finish': 'team member sign-up, second login method',
  'POST /v1/team/join/second/pgp/start': 'team member sign-up, second login method',
  'POST /v1/team/join/second/pgp/finish': 'team member sign-up, second login method',
};
