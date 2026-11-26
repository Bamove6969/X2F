/**
 * The live-session check (review rounds 3 to 5, the class of R3-I1 and R4-I1): a route that acts
 * with the calling session as its authority re-checks, inside the transaction that writes and under
 * the account lock, that the session is still live (`requireLiveSessionInTx`). The route lists say
 * which routes do (`LIVE_SESSION_ROUTES`) and why the others need not (`LIVE_SESSION_EXEMPT`); the
 * tripwire in test/coolingOff.test.ts keeps every session route classified.
 *
 * There are no 24-hour holds any more (owner, 26 Nov 2026: no passwords, and no holds of any
 * kind), so this file is all that is left of hold.ts.
 */
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { CHAT_KEY_WRITE_ROUTES } from './chatKeyRouteList.js';
import { JABBER_WRITE_ROUTES } from '../jabber/routeList.js';

/** Locks the account row for the rest of the caller's transaction (no key update: sessions and alerts can still reference it). */
export async function lockAccount(db: Queryable, accountId: string): Promise<void> {
  await db.query('select 1 from accounts where id = $1 for no key update', [accountId]);
}

/** A deadlock (40P01) or serialization failure (40001): the transaction must fail and run again. */
export function concurrencyFailure(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === '40P01' || code === '40001';
}

export async function withTx<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/** The calling session as `requireLiveSessionInTx` read it under the account lock. */
export interface LiveSession {
  kind: string;
  level: string;
  onboarding_until: Date | null;
  created_at: Date;
}

/**
 * The one check of the class of review rounds 3 and 4 (R3-I1, R4-I1: an action by a session the
 * owner's proof has just revoked). Inside the transaction that performs a route's write and before
 * it: takes the account lock (`lockAccount`; every revocation of another session takes the same lock,
 * so this check is exact against it) and answers 401 `not-authenticated` unless the
 * calling session is still live (not revoked, not expired) and of this account. `requireSession`
 * read the session before the transaction, so a request in flight across a revocation would
 * otherwise act for a dead session. Returns the session as read under the lock. Every route in
 * `LIVE_SESSION_ROUTES` calls it; a caller that needs
 * the approval lock takes it first (lock order: approvals, then account).
 */
export async function requireLiveSessionInTx(db: Queryable, auth: { accountId: string; sessionId: string }, now: Date): Promise<LiveSession> {
  await lockAccount(db, auth.accountId);
  const { rows } = await db.query<LiveSession>(
    `select a.kind, s.level, s.onboarding_until, s.created_at
       from sessions s join accounts a on a.id = s.account_id
      where s.id = $1 and a.id = $2 and s.revoked_at is null and s.expires_at > $3`,
    [auth.sessionId, auth.accountId, now],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  return row;
}

/**
 * Routes that change a login method, a payout wallet or a security setting: each calls
 * `requireLiveSessionInTx` in its transaction before writing.
 */
export const SECURITY_CHANGE_ROUTES: readonly string[] = [
  'POST /v1/account/pgp/finish',
  'POST /v1/account/webauthn/finish',
  'POST /v1/account/totp/finish',
  'POST /v1/account/recovery-codes',
  'DELETE /v1/account/methods/:type/:id',
  'POST /v1/account/login-name',
  'PUT /v1/account/security/one-device',
  'POST /v1/wallets',
  'DELETE /v1/wallets/:id',
];

/**
 * Routes that act with the calling session as their authority on the account's, a session's, an
 * approval's or the security settings' state (review round 4, the class of R3-I1 and R4-I1): each
 * checks, inside the transaction that writes and under the account lock, that the calling session
 * is still live (`requireLiveSessionInTx`). Listed in
 * docs/coordination.md with the routes left out and why.
 */
/**
 * Trading routes that create or change obligations (review round 5 M2): take, posting and switching
 * offers, and trade events. Each re-checks its session with `requireLiveSessionInTx` in the
 * transaction that writes (the offer and take writes after the account lock they already take; a
 * trade event after its trade row lock, the order of `/v1/trades/:code/wallet`). A live session
 * still finishes every open trade. Covered by apps/api/test/take.test.ts.
 */
export const LIVE_SESSION_TRADING_ROUTES: readonly string[] = [
  'POST /v1/offers/:id/take',
  'POST /v1/offers',
  'PATCH /v1/offers/:id',
  'POST /v1/account/offers/status',
  // Owner 26 Nov 2026: the Away switch pauses and turns back on offers (offers/away.ts, through switchOfferStatus).
  'PUT /v1/account/away',
  'POST /v1/trades/:code/events',
];

export const LIVE_SESSION_ROUTES: readonly string[] = [
  ...SECURITY_CHANGE_ROUTES,
  ...LIVE_SESSION_TRADING_ROUTES,
  'POST /v1/account/approvals/:id',
  'DELETE /v1/account/sessions/:id',
  'POST /v1/account/push',
  'DELETE /v1/account/push',
  'POST /v1/account/alerts/:id/seen',
  'POST /v1/account/terms',
  // Session length (owner, 2 Nov 2026): the calling session's own length and "Stay logged in".
  'PUT /v1/account/session/length',
  'POST /v1/account/session/extend',
  // Owner demo note #226: renaming one of the account's wallets re-checks the session under the
  // account lock (wallets/routes.ts `renameHandler`).
  'PUT /v1/wallets/:id/label',
  // Plan 2 Task 18 (team members), classified at its landing next to Tasks 16-17: the account
  // owner's invites, role changes and removals (team/members.ts; the lock is the account's).
  'POST /v1/team/invites',
  'PATCH /v1/team/members/:id',
  'DELETE /v1/team/members/:id',
  // J-20: a member's trade-size band and working hours (team/limits.ts; the lock is the account's).
  'PUT /v1/team/members/:id/limits',
  // Ending a member's signed-in sessions from the Team screen (team/memberSessions.ts; the lock is
  // the account's, then the member's sessions, as a removal).
  'DELETE /v1/team/members/:id/sessions/:sessionId',
  'DELETE /v1/team/members/:id/sessions',
  // Owner 2 Nov 2026: switching to a vendor account (routes/accountType.ts; the lock is the account's).
  'PUT /v1/account/type',
  // Showing the recovery code that replaced a used one (recovery.ts).
  'POST /v1/account/recovery-code/reveal',
  // Plan 5 Task 10 review round 1 M3: the claim insert re-checks the session under the
  // account lock (as Task 18's ownerWriteGate).
  'POST /v1/account/past-rep/finish',
  // Owner rule p5-7: the Jabber alert set-up (jabber/routes.ts `writeGate`).
  ...JABBER_WRITE_ROUTES,
  // J-23 groundwork: the chat-key courier re-checks the session
  // under the account lock (auth/chatKeys.ts `strongCallerInTx`).
  ...CHAT_KEY_WRITE_ROUTES,
  // Owner 25 Nov security-key report; security review of wip/lead-seckey-fix: naming a key re-checks
  // the session under the account lock (auth/webauthn.ts `setKeyLabel`).
  'PUT /v1/account/webauthn/label',
  // Lien recovery (review B1/Q2): the creditor's signed address its recoveries are paid to
  // (disputes/lienRoutes.ts; the lock is the account's).
  'POST /v1/account/liens/:id/recovery-address',
];

/**
 * Every other route but GET that runs with a session, each with why it needs no live-session check
 * (review round 5 M1; it was the "left out" paragraph of docs/coordination.md). The tripwire in
 * apps/api/test/coolingOff.test.ts ("every route other than GET that runs with a session is
 * classified") lists the app's routes behind `requireSession`: a new one fails it until it is in
 * `LIVE_SESSION_ROUTES` (with a test row) or here with a reason. Routes with no `requireSession`
 * (`POST /v1/logout` revokes the cookie's own session; `POST /v1/login/approval/:id/poll` checks
 * its approval's granter instead, R4-M2) are not listed.
 */
export const LIVE_SESSION_EXEMPT: Readonly<Record<string, string>> = {
  'POST /v1/account/pgp/start': 'writes only an add-key challenge bound to this session; its finish is checked',
  'POST /v1/account/onboarding/end': "only clears this session's own sign-up window, which narrows what the session may do (review M1)",
  // S-085 (auth/deviceBound.ts): renewing this session's own bound cookie with its own browser key.
  'POST /v1/account/session/proof/challenge': "writes only a proof challenge bound to this session; changes no account, approval or security state",
  'POST /v1/account/session/proof': "renews this session's own bound cookie after a signature with the key the session was bound to at login; never extends the session, changes no account, approval or security state",
  'POST /v1/account/totp/start': 'writes only an enrolment challenge bound to this session; its finish is checked',
  'POST /v1/account/webauthn/start': 'writes only a registration challenge bound to this session; its finish is checked',
  'POST /v1/confirm/pgp/start': 'writes only a confirm challenge bound to this session',
  'POST /v1/confirm/pgp/finish': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/confirm/webauthn/start': 'writes only a confirm challenge bound to this session',
  'POST /v1/confirm/webauthn/finish': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/account/blocks': 'social: a block row only; no account, session, approval or security state, no obligation',
  'DELETE /v1/account/blocks/:tradeTag': 'social: removes a block row only; no account, session, approval or security state',
  'PUT /v1/account/blocks/:tradeTag/note': "social: the note on a block row of mine only (S-093); no account, session, approval or security state",
  'PUT /v1/account/nudges': "the caller's own nudge preferences; no session, approval or security state",
  'POST /v1/nudges': 'a nudge to a trade counterparty; no account, session, approval or security state',
  'POST /v1/method-suggestions': 'a method suggestion row only',
  // Plan 3 Task 20 (encrypted chat), classified at its landing next to Tasks 16-17.
  'POST /v1/chats': 'social: opens a pre-trade chat row on an offer; no account, session, approval or security state, no obligation',
  'POST /v1/chats/:chat/envelopes': 'an encrypted chat line in a chat the caller is in; no account, session, approval or security state',
  'POST /v1/chats/:chat/key': "the signed key record of a chat the caller is in (wraps only); no account, session, approval or security state",
  'POST /v1/chats/:chat/grant': "the caller's fallback grant of a disputed trade's chat key to the moderator (a wrap only); no account, session, approval or security state, no new obligation",
  'POST /v1/chats/:chat/identity': "the caller's chat identity key for one chat; no account, session, approval or security state",
  'POST /v1/trades/:code/chat': "a participant's chat for an open trade (R42: finishing open trades stays allowed); no new obligation",
  // Plan 5 Task 14.
  'PUT /v1/trades/:code/proofs/:id': "a participant's proof ciphertext for their own trade (R42: finishing open trades stays allowed); no account, session, approval or security state, no new obligation",
  'POST /v1/feedback/form': 'a feedback row only, open to held sessions on purpose (owner 2026-10-29)',
  // Plan 4 Task 30: support tickets (the account owner's own question to staff).
  'POST /v1/tickets': 'a support ticket row and its first message only; no account, session, approval or security state, no obligation',
  'POST /v1/tickets/:id/messages': "a message on the caller's own support ticket; no account, session, approval or security state, no obligation",
  'POST /v1/tickets/:id/close': "closes the caller's own support ticket; no account, session, approval or security state, no obligation",
  // Plan 5 Task 3 (reviews), classified at its merge with Tasks 16-17.
  'POST /v1/trades/:code/review': "a participant's one review of their own finished trade (a reviews row only); no account, session, approval or security state, no new obligation",
  'POST /v1/trades/:code/review/skip': "a participant's Skip review of their own finished trade (a review_skips row only); no account, session, approval or security state, no new obligation",
  // Plan 5 Task 19: a dispute of a review about the caller.
  'POST /v1/reviews/:id/dispute': "the subject's one dispute of a review about them (a review_disputes row only; the review shows Under review); no account, session, approval or security state, no obligation",
  // C12b (owner 2026-11-01/02): the opt-in "traded to date" profile line.
  'PUT /v1/account/profile/traded-total': "the caller's own profile display preference (one accounts column); no session, approval or security state, no obligation",
  // Plan 5 Tasks 5 and 12: badge visibility and showing the signed record (one badge_prefs row).
  'PUT /v1/account/badges': "the caller's own badge visibility (a badge_prefs row only; badges are earned, never set); no session, approval or security state, no obligation",
  'PUT /v1/account/record/public': "the caller's own record-on-profile preference (a badge_prefs column only); no session, approval or security state, no obligation",
  // Owner Q75 (6 Nov 2026): the idle reminder.
  'PUT /v1/account/idle-reminder': "the person's own reminder preference (one accounts column of their login); never ends or extends a session; no approval or security state, no obligation",
  // Plan 5 Task 4 (platform feedback), classified at its merge with Tasks 16-17.
  'POST /v1/feedback': 'a platform-feedback row only, holding nothing about the sender; no account, session, approval or security state, no obligation',
  'POST /v1/trades/:code/dispute': 'finishes an open trade (R42); creates no new obligation',
  'POST /v1/trades/:code/appeal': 'finishes an open trade (R42); creates no new obligation',
  'POST /v1/trades/:code/payment-proof': "the seller's proof of a payment a ruling ordered (Plan 4 Task 12); finishes an open dispute, creates no new obligation",
  'POST /v1/trades/:code/identity': "a participant's identity for an open trade; no new obligation",
  'POST /v1/trades/:code/wallet': "the poster's payout wallet for an open trade, from the account's own usable wallets",
  // Owner 17 Nov 2026 (note #6 Q1): the default payout wallet is only what the trade screen picks first.
  'PUT /v1/wallets/:id/default': "which of the account's own saved wallets the trade screen picks first; changes no address, wait or security state, and every take still names its wallet",
  // Plan 5 Task 10: past reputation. No login, session, approval, security or trading state: the
  // caller's own claim rows only (a moderator approves before anything shows).
  'POST /v1/account/past-rep/start': "writes only a past-rep challenge bound to the caller's account; its finish re-checks it",
  'DELETE /v1/account/past-rep/:id': "sets the caller's own past-rep claim to removed",
  // Escrow-key sync (migration 864): ciphertext rows the API cannot open. They change no login,
  // session, approval or security state and create no obligation; each takes the account lock.
  'PUT /v1/escrow-keys/reader': "the caller's own reader public key and unlock envelopes (ciphertext only); no account, session, approval or security state, no obligation",
  'PUT /v1/escrow-keys/trades/:code': "the holder's encrypted copy of its own trade's escrow record (ciphertext only); no account, session, approval or security state, no obligation",
  'DELETE /v1/escrow-keys/trades/:code': "deletes the holder's encrypted copy of its own trade's escrow record; no account, session, approval or security state",
  // Job 1c (J-10, S-094): notes on traders. Social, as blocks: a note row only (the add also re-checks
  // the session under the account lock and a member's boxes live, in its transaction).
  'POST /v1/account/notes': 'social: a private note row on another trader only; no account, session, approval or security state, no obligation',
  'DELETE /v1/account/notes/:id': "social: removes one of the account's own note rows (the account owner only); no account, session or security state",
  // P-012/P-013 (proof-check, classified at the batch 9 merge): the blur check. Anonymous by design.
  'POST /v1/trades/:code/proofs/:proofId/blur-check': "counts a participant's proof for the blur-check sample (blur_check_proofs/asks rows only); no account, session, approval or security state, no obligation",
  'POST /v1/trades/:code/blur-checks/:proofId': "a participant's anonymous blur-check answer (an answers row naming no one); no account, session, approval or security state, no obligation",
};

