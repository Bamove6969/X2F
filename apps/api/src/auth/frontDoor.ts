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
  'GET /v1/account/blocks': 'the traders I blocked',
  'GET /v1/account/methods': 'my own login methods',
  'GET /v1/account/nudges': 'my own nudge setting',
  'GET /v1/account/offers': 'my own offers (read on stale Terms too, to turn them off)',
  'GET /v1/account/past-rep': 'my own imported past reputation',
  'GET /v1/account/profile/traded-total': 'my own traded-total display setting',
  'GET /v1/account/push': 'my own push subscription state and the VAPID public key',
  'GET /v1/account/security/devices': 'my own trusted devices',
  'GET /v1/account/security/logout-timer': 'my own logout timer',
  'GET /v1/account/sessions': 'my own sessions',
  'GET /v1/chats': 'my own chats',
  'GET /v1/chats/:chat': 'one of my own chats (participants only)',
  'GET /v1/chats/:chat/attestation': 'one of my own chats (participants only)',
  'GET /v1/chats/:chat/envelopes': 'one of my own chats (participants only)',
  'GET /v1/events': 'my own live events (per account and per trade, no marketplace broadcast)',
  'GET /v1/reviews/pending': 'reviews I still owe for my own trades',
  'GET /v1/team': "my own team's members (account owner only)",
  'GET /v1/team/audit': "my own team's audit log (account owner only)",
  'GET /v1/trades/:code': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/attestation': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/confirmations': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/dispute': 'one of my own trades (participants only)',
  'GET /v1/trades/:code/review': 'one of my own trades (participants only)',
  'GET /v1/wallets': 'my own payout wallets',
  'GET /v1/wallets/rule': 'my own wallet rule',
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
