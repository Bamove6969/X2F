import { randomBytes } from 'node:crypto';
import { normalizeTradeCode } from '@x2f/core';
import {
  AFTER_REFUND_OUTCOMES,
  BAN_REASON_CODES,
  ESCROW_OUTCOMES,
  canonicalJson,
  tapChallenge,
  GRANTABLE_PERMS,
  type AccountAction,
  type KeyTapIntent,
  type Perm,
} from '@x2f/staff';
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { verifyWebAuthnAssertion, webauthnAssertionOptions } from '../auth/webauthn.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

// Plan 4, Task 5: security-key taps bound to one intent (migration 203_key_taps.sql).
//
// A staff action that needs a tap (emergency stop, invites, switch-on, role changes, owner keys,
// settings, rulings) works in three steps:
// 1. `startKeyTap` stores the intent the person is about to authorise with a fresh nonce and answers
//    WebAuthn options whose challenge is `tapChallenge(intent, nonce)`, offering only the account's
//    attested security keys;
// 2. `finishKeyTap` verifies the key's assertion against that challenge and stores it;
// 3. the action route re-derives the intent from its own input (never from the client's tap) and
//    calls `consumeKeyTap` inside the transaction that performs the action, so the tap is used
//    exactly once, by exactly that action, or not at all.
// The stored tap (`StoredTap`) is what the moderation process re-verifies for a ruling (Task 13).

/** A tap is valid for 2 minutes from its start; at exactly 2:00 finish and consume refuse it. */
export const KEY_TAP_TTL_MS = 2 * 60_000;
/** Random bytes per tap (plan: 16, i.e. 128 bits; `tapChallenge` accepts 16 or more). */
const NONCE_BYTES = 16;
/** Bound on the stored assertion JSON (a real one is well under 2 KiB). */
const MAX_RESPONSE_CHARS = 16_384;
/** Lead review 7 Nov M4: tap starts per account per window (in memory). */
export const TAP_STARTS_PER_WINDOW = 20;
export const TAP_START_WINDOW_MS = 10 * 60_000;
/** RV5 m12: at most this many unfinished, unexpired taps per account at once. */
export const MAX_OPEN_TAPS = 5;
/**
 * Lead re-review item 5: the emergency stop and the resume are never held back by the cap (a burst
 * of other open taps, the person's own or a stolen session's, must not stop the owner stopping trading).
 */
const UNCAPPED: ReadonlySet<KeyTapIntent['kind']> = new Set(['emergency-stop', 'resume-trading']);
/** RV5 m8: an unfinished or unused tap is deleted a day after it started (a lead default; keep times for used taps are RV5 Q6, for the owner). */
export const KEY_TAP_PURGE_MS = 24 * 60 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
/** A v4 OpenPGP fingerprint, 40 hex characters. */
const FINGERPRINT = /^[0-9a-fA-F]{40}$/;
const B64URL_ID = /^[A-Za-z0-9_-]{16,1364}$/;
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const ATOMIC = /^(0|[1-9][0-9]{0,29})$/;
/** A standard Monero address's shape (95 base58 characters); the fee-sweep route checks it fully. */
const COLD_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{95}$/;
const INVITABLE = ['senior', 'mod', 'helper'] as const;

/** A finished tap as stored: exactly what the moderation process re-verifies. */
export interface StoredTap {
  id: string;
  accountId: string;
  /** base64url credential ID of the attested security key that answered. */
  credentialId: string;
  /** `canonicalJson` of the (normalised) intent, exactly as hashed into the challenge. */
  intent: string;
  /** The nonce, lower-case hex. Challenge = `tapChallenge(JSON.parse(intent), nonce)`. */
  nonceHex: string;
  response: AuthenticationResponseJSON;
}

const tapInvalid = (): ApiError => new ApiError(403, 'tap-invalid');
const webauthnFailed = (): ApiError => new ApiError(401, 'webauthn-failed');
const badRequest = (): ApiError => new ApiError(400, 'bad-request');

/** The intent with a ruling's trade code normalised (as `tapChallenge` hashes it); a bad code → null. */
function normalized(i: KeyTapIntent): KeyTapIntent | null {
  if (i.kind !== 'ruling') return i;
  const code = typeof i.code === 'string' ? normalizeTradeCode(i.code) : null;
  return code === null ? null : { ...i, code };
}

/** The allowlist a stored key must still be on: the owner's for the owner, staff's otherwise (coordination M1). */
function listFor(accountKind: string): 'owner' | 'staff' {
  return accountKind === 'owner' ? 'owner' : 'staff';
}

/**
 * Starts a tap for `intent`: a fresh 16-byte nonce, challenge `tapChallenge(intent, nonce)`, and
 * `allowCredentials` = the account's attested security keys whose AAGUID is still on the account
 * kind's allowlist (no passkeys). None → 403 `method-not-allowed`. The tap expires 2 minutes after
 * it starts.
 */
export async function startKeyTap(
  deps: Deps,
  accountId: string,
  intent: KeyTapIntent,
  o: { sessionId?: string } = {},
): Promise<{ tapId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const norm = normalized(intent);
  if (norm === null) throw badRequest();
  let canonical: string;
  let challenge: Uint8Array;
  const nonce = randomBytes(NONCE_BYTES);
  try {
    canonical = canonicalJson(norm);
    challenge = tapChallenge(norm, nonce);
  } catch {
    throw badRequest();
  }
  const options = await webauthnAssertionOptions(deps, accountId, challenge, {
    only: (c) =>
      c.kind === 'security-key' && c.attested && c.aaguid !== null && deps.attestation.isAllowed(c.aaguid, 'packed', listFor(c.accountKind)),
  });
  // RV5 m12: one statement counts the account's open taps and inserts only under the cap, so a
  // burst of parallel starts can pass it by at most the requests already in flight, never grow
  // `key_taps` without bound. The per-account lock makes the count exact.
  const now = deps.clock();
  const client = await deps.db.connect();
  let id: string | undefined;
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtextextended('key_taps/' || $1, 0))", [accountId]);
    const { rows } = await client.query<{ id: string }>(
      `insert into key_taps (account_id, intent, nonce, started_at, session_id)
       select $1, $2, $3, $4, $5
        where $8::boolean or (select count(*) from key_taps where account_id = $1 and finished_at is null and started_at > $6) < $7
       returning id`,
      [accountId, canonical, nonce, now, o.sessionId ?? null, new Date(now.getTime() - KEY_TAP_TTL_MS), MAX_OPEN_TAPS, UNCAPPED.has(norm.kind)],
    );
    await client.query('commit');
    id = rows[0]?.id;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  if (id === undefined) throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.ceil(KEY_TAP_TTL_MS / 1000) });
  return { tapId: id, options };
}

interface TapRow {
  id: string;
  account_id: string;
  credential_id: string;
  intent: string;
  nonce: Buffer;
  response: AuthenticationResponseJSON;
}

const storedOf = (r: TapRow): StoredTap => ({
  id: r.id,
  accountId: r.account_id,
  credentialId: r.credential_id,
  intent: r.intent,
  nonceHex: r.nonce.toString('hex'),
  response: r.response,
});

/**
 * Verifies the assertion for an open tap of this account against the tap's own challenge and
 * stores it. Refusals: a tap that is unknown, another account's, already finished or 2 minutes old
 * → 403 `tap-invalid`; an assertion that does not verify, or one by a credential that is not an
 * attested security key still on the allowlist → 401 `webauthn-failed` (the tap stays open until
 * it expires, so the person can tap again).
 */
export async function finishKeyTap(deps: Deps, accountId: string, tapId: string, response: unknown): Promise<StoredTap> {
  if (!UUID.test(tapId)) throw tapInvalid();
  // RV5 m11: refused before the assertion is verified, so the key's counter does not move.
  if (JSON.stringify(response ?? null).includes('\\u0000')) throw badRequest();
  const now = deps.clock();
  const cutoff = new Date(now.getTime() - KEY_TAP_TTL_MS);
  const { rows } = await deps.db.query<{ intent: string; nonce: Buffer }>(
    `select intent, nonce from key_taps
      where id = $1 and account_id = $2 and finished_at is null and started_at > $3`,
    [tapId, accountId, cutoff],
  );
  const open = rows[0];
  if (!open) throw tapInvalid();
  const challenge = tapChallenge(JSON.parse(open.intent) as KeyTapIntent, open.nonce);
  const verified = await verifyWebAuthnAssertion(deps, accountId, response, challenge);
  if (verified.kind !== 'security-key' || !verified.attested) throw webauthnFailed();
  const { rows: cred } = await deps.db.query<{ aaguid: string | null; account_kind: string }>(
    `select c.aaguid, a.kind as account_kind from webauthn_credentials c join accounts a on a.id = c.account_id
      where c.credential_id = $1 and c.account_id = $2`,
    [Buffer.from(verified.credentialId, 'base64url'), accountId],
  );
  const c = cred[0];
  if (!c || c.aaguid === null || !deps.attestation.isAllowed(c.aaguid, 'packed', listFor(c.account_kind))) throw webauthnFailed();
  const { rows: done } = await deps.db.query<TapRow>(
    `update key_taps set credential_id = $3, response = $4, finished_at = $5
      where id = $1 and account_id = $2 and finished_at is null and started_at > $6
      returning id, account_id, credential_id, intent, nonce, response`,
    [tapId, accountId, verified.credentialId, JSON.stringify(assertionFields(response)), now, cutoff],
  );
  if (!done[0]) throw tapInvalid(); // a parallel finish won, or the tap expired meanwhile
  return storedOf(done[0]);
}

/**
 * RV5 m11 (lead re-review item 5): only the fields of a WebAuthn assertion that verification read,
 * and that the moderation process re-verifies, are stored; anything else the client sent is dropped.
 * Called after the assertion verified, so the fields are there and are strings.
 */
function assertionFields(response: unknown): AuthenticationResponseJSON {
  const r = response as AuthenticationResponseJSON;
  const a = r.response;
  return {
    id: r.id,
    rawId: r.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: a.clientDataJSON,
      authenticatorData: a.authenticatorData,
      signature: a.signature,
      ...(typeof a.userHandle === 'string' ? { userHandle: a.userHandle } : {}),
    },
  };
}

/**
 * Uses a finished tap for the action `expect`, through `client` (the caller's transaction: a
 * rollback leaves the tap unused). 403 `tap-invalid` unless the tap exists, belongs to
 * `accountId`, is finished, unused and less than 2 minutes old at `now`, and its stored intent is
 * `canonicalJson(expect)` (a ruling's code normalised). One conditional UPDATE, so two parallel
 * consumes of one tap cannot both win.
 */
export async function consumeKeyTap(
  client: Queryable,
  tapId: string,
  accountId: string,
  expect: KeyTapIntent,
  now: Date,
  o: { sessionId?: string } = {},
): Promise<StoredTap> {
  if (typeof tapId !== 'string' || !UUID.test(tapId)) throw tapInvalid();
  const norm = normalized(expect);
  if (norm === null) throw tapInvalid();
  let canonical: string;
  try {
    canonical = canonicalJson(norm);
  } catch {
    throw tapInvalid();
  }
  // RV5 m9: the key that answered must still be registered to the account (one removed as lost
  // after the finish can't authorise the action). RV5 m10: a tap started in a known session is
  // used only from that session.
  const { rows } = await client.query<TapRow>(
    `update key_taps t set used_at = $3
      where t.id = $1 and t.account_id = $2 and t.used_at is null and t.finished_at is not null
        and t.started_at > $4 and t.intent = $5
        and (t.session_id is null or t.session_id = $6::uuid)
        and exists (
          select 1 from webauthn_credentials c
           where c.account_id = t.account_id and c.kind = 'security-key'
             and c.credential_id = decode(rpad(translate(t.credential_id, '-_', '+/'), ((char_length(t.credential_id) + 3) / 4) * 4, '='), 'base64'))
      returning t.id, t.account_id, t.credential_id, t.intent, t.nonce, t.response`,
    [tapId, accountId, now, new Date(now.getTime() - KEY_TAP_TTL_MS), canonical, o.sessionId && UUID.test(o.sessionId) ? o.sessionId : null],
  );
  if (!rows[0]) throw tapInvalid();
  return storedOf(rows[0]);
}

/**
 * Owner G4 (7 Nov): a major change to the owner's account (adding or removing one of the owner's
 * security keys or PGP keys) needs both of the owner's keys: after the first tap is consumed, a second tap for
 * the same intent by a different security key. 409 `both-owner-keys-required` when the second tap
 * is missing or came from the same key; an invalid second tap is 403 `tap-invalid`.
 */
export async function consumeSecondOwnerTap(
  client: Queryable,
  secondTapId: unknown,
  first: StoredTap,
  expect: KeyTapIntent,
  now: Date,
  o: { sessionId?: string } = {},
): Promise<StoredTap> {
  if (typeof secondTapId !== 'string' || secondTapId === '') throw new ApiError(409, 'both-owner-keys-required');
  const second = await consumeKeyTap(client, secondTapId, first.accountId, expect, now, o);
  if (second.credentialId === first.credentialId) throw new ApiError(409, 'both-owner-keys-required');
  return second;
}

/**
 * RV5 m8: deletes the taps that were never finished or never used, a day after they started
 * (`KEY_TAP_PURGE_MS`). Used taps stay: how long they are kept is the owner's (RV5 Q6; recommended:
 * a ruling's taps as long as the ruling record, others 90 days). Returns the number deleted.
 */
export async function purgeKeyTaps(db: Queryable, now: Date): Promise<number> {
  const { rowCount } = await db.query('delete from key_taps where used_at is null and started_at < $1', [new Date(now.getTime() - KEY_TAP_PURGE_MS)]);
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------------------------
// The intent a client sends to `taps/start`

function rec(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw badRequest();
  return v as Record<string, unknown>;
}

function exactKeys(r: Record<string, unknown>, keys: readonly string[]): void {
  const have = Object.keys(r);
  if (have.length !== keys.length || !have.every((k) => keys.includes(k))) throw badRequest();
}

function match(r: Record<string, unknown>, key: string, re: RegExp): string {
  const v = r[key];
  if (typeof v !== 'string' || !re.test(v)) throw badRequest();
  return v;
}

function oneOf<T extends string>(r: Record<string, unknown>, key: string, values: readonly T[]): T {
  const v = r[key];
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw badRequest();
  return v as T;
}

function amount(r: Record<string, unknown>, key: string, o: { integer?: boolean } = {}): number {
  const v = r[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || Object.is(v, -0) || (o.integer && !Number.isInteger(v))) throw badRequest();
  return v;
}

function accountAction(v: unknown): AccountAction {
  const r = rec(v);
  if (r.kind === 'none' || r.kind === 'freeze') {
    exactKeys(r, ['kind']);
    return { kind: r.kind };
  }
  exactKeys(r, ['kind', 'until', 'reasonCode']);
  const kind = oneOf(r, 'kind', ['trade-ban', 'site-ban'] as const);
  const until = r.until === null ? null : match(r, 'until', ISO_UTC);
  return { kind, until, reasonCode: oneOf(r, 'reasonCode', BAN_REASON_CODES) };
}

/**
 * Checks what a client sent as a tap's intent: one of `KeyTapIntent`'s kinds with exactly its keys
 * and well-formed values; a ruling's trade code comes back normalised. Anything else → 400
 * `bad-request`. Only the shape is checked here: whether the person may take the action, and what
 * the action really is, is decided by the action route, which re-derives the intent itself.
 */
export function parseKeyTapIntent(v: unknown): KeyTapIntent {
  const r = rec(v);
  switch (r.kind) {
    case 'emergency-stop':
    case 'resume-trading':
      exactKeys(r, ['kind']);
      return { kind: r.kind };
    case 'create-invite':
      exactKeys(r, ['kind', 'inviteId', 'role', 'tokenHash', 'expiresAt']);
      return {
        kind: 'create-invite',
        inviteId: match(r, 'inviteId', UUID).toLowerCase(),
        role: oneOf(r, 'role', INVITABLE),
        tokenHash: match(r, 'tokenHash', TOKEN_HASH),
        expiresAt: match(r, 'expiresAt', ISO_UTC),
      };
    case 'switch-on':
    case 'set-role':
      exactKeys(r, ['kind', 'accountId', 'role']);
      return { kind: r.kind, accountId: match(r, 'accountId', UUID).toLowerCase(), role: oneOf(r, 'role', INVITABLE) };
    case 'remove-staff':
      exactKeys(r, ['kind', 'accountId']);
      return { kind: 'remove-staff', accountId: match(r, 'accountId', UUID).toLowerCase() };
    case 'add-pgp-key':
      exactKeys(r, ['kind', 'fingerprint']);
      return { kind: 'add-pgp-key', fingerprint: match(r, 'fingerprint', FINGERPRINT).toLowerCase() };
    case 'remove-method':
      exactKeys(r, ['kind', 'methodType', 'methodId']);
      return {
        kind: 'remove-method',
        methodType: oneOf(r, 'methodType', ['pgp', 'security-key', 'passkey'] as const),
        methodId: match(r, 'methodId', UUID).toLowerCase(),
      };
    case 'set-grants': {
      exactKeys(r, ['kind', 'accountId', 'grants']);
      const g = r.grants;
      if (!Array.isArray(g) || g.some((x) => typeof x !== 'string' || !(GRANTABLE_PERMS as readonly string[]).includes(x))) throw badRequest();
      const grants = [...new Set(g as string[])].sort();
      if (grants.length !== g.length) throw badRequest();
      return { kind: 'set-grants', accountId: match(r, 'accountId', UUID).toLowerCase(), grants };
    }
    case 'add-owner-key':
      exactKeys(r, ['kind', 'credentialId', 'publicKeySha256']);
      return { kind: 'add-owner-key', credentialId: match(r, 'credentialId', B64URL_ID), publicKeySha256: match(r, 'publicKeySha256', HEX64) };
    case 'settings':
      exactKeys(r, ['kind', 'largeTradeLimitUsd', 'firstResponseH', 'appealWindowH']);
      return {
        kind: 'settings',
        largeTradeLimitUsd: amount(r, 'largeTradeLimitUsd'),
        firstResponseH: amount(r, 'firstResponseH'),
        appealWindowH: amount(r, 'appealWindowH'),
      };
    case 'fee-sweep': {
      exactKeys(r, ['kind', 'thresholdAtomic', 'floatAtomic', 'coldAddress']);
      const opt = (key: string, re: RegExp): string | null => (r[key] === null ? null : match(r, key, re));
      return { kind: 'fee-sweep', thresholdAtomic: opt('thresholdAtomic', ATOMIC), floatAtomic: opt('floatAtomic', ATOMIC), coldAddress: opt('coldAddress', COLD_ADDRESS) };
    }
    case 'ruling': {
      exactKeys(r, ['kind', 'step', 'rulingId', 'code', 'round', 'outcome', 'accountAction', 'amountAtomic', 'reasonSha256', 'evidenceSha256']);
      const code = typeof r.code === 'string' ? normalizeTradeCode(r.code) : null;
      if (code === null) throw badRequest();
      if (r.round !== 1 && r.round !== 2) throw badRequest();
      return {
        kind: 'ruling',
        step: oneOf(r, 'step', ['propose', 'approve'] as const),
        rulingId: match(r, 'rulingId', UUID).toLowerCase(),
        code,
        round: r.round,
        outcome: oneOf(r, 'outcome', [...ESCROW_OUTCOMES, ...AFTER_REFUND_OUTCOMES]),
        accountAction: accountAction(r.accountAction),
        amountAtomic: match(r, 'amountAtomic', ATOMIC),
        reasonSha256: match(r, 'reasonSha256', HEX64),
        evidenceSha256: match(r, 'evidenceSha256', HEX64),
      };
    }
    default:
      throw badRequest();
  }
}

// ---------------------------------------------------------------------------------------------
// Routes (they plug into Task 4's staff app)

/**
 * RV5 m7 (lead queue 6 Nov): what a staff member must hold to start a tap for an intent, so a
 * signed approval never exists for someone who can't take the action. A ruling's proposal needs
 * `disputes.handle`, its approval `rulings.approve`; the emergency stop and resume `site.control`;
 * invites, switch-on and role changes `staff.manage`; settings `settings.write`; a new owner key
 * the owner role itself. The action route still checks its own perm and re-derives the intent.
 */
export function tapPermOf(i: KeyTapIntent): Perm | 'owner' {
  switch (i.kind) {
    case 'ruling':
      return i.step === 'approve' ? 'rulings.approve' : 'disputes.handle';
    case 'emergency-stop':
    case 'resume-trading':
      return 'site.control';
    case 'create-invite':
    case 'switch-on':
    case 'set-role':
    case 'set-grants':
    case 'remove-staff':
      return 'staff.manage';
    case 'settings':
    case 'fee-sweep':
      return 'settings.write';
    case 'add-owner-key':
      return 'owner';
    case 'add-pgp-key':
    case 'remove-method':
      // One's own login methods: any staff member or the owner, for their own account only (the
      // action route binds the tap to the signed-in account).
      return 'self';
  }
}

export interface KeyTapRouteOptions {
  /** The staff app's `requireStaff('self')` (Task 4: an array of preHandlers, kept as is so its perm check sees it). */
  guard: preHandlerAsyncHookHandler | preHandlerAsyncHookHandler[];
  /** The signed-in staff member's account (Task 4: `req.staff.accountId`). */
  accountOf(req: FastifyRequest): string;
  /**
   * RV5 m10: the staff session (Task 4: `req.auth.sessionId`). When given, a tap is bound to the
   * session that started it, and the action route must pass the same `sessionId` to `consumeKeyTap`.
   */
  sessionOf?(req: FastifyRequest): string;
  /**
   * RV5 m7: whether the signed-in member holds `tapPermOf(intent)` (Task 4: `can(req.staff.role,
   * perm, req.staff.grants)`, and the owner role for 'owner'). False → 403 `forbidden`, nothing stored.
   */
  allows(req: FastifyRequest, need: Perm | 'owner'): boolean;
}

/**
 * `POST /staff/v1/taps/start` (perm `self`): the body is the intent (`parseKeyTapIntent`); the
 * member must hold the intent's own perm (`tapPermOf`, RV5 m7; else 403 `forbidden`) →
 * `{ tapId, options }`. `POST /staff/v1/taps/:id/finish` (perm `self`) `{ response }` → `{ tapId }`.
 * The action route that needs the tap takes `tapId` and calls `consumeKeyTap` with the intent it
 * derives from its own input, so the client cannot get a tap for one action accepted by another.
 * Uses `app.deps` (the staff app's, with the staff origin and relying party).
 */
/** Every app's tap-start windows (one map per registered app), so tests can start each case fresh. */
const TAP_START_WINDOWS = new Set<Map<string, number[]>>();

/** Clears every tap-start window (in memory); for tests, as `newBudgets` is for the other in-memory budgets. */
export function resetTapStarts(): void {
  for (const m of TAP_START_WINDOWS) m.clear();
}

export function keyTapRoutes(app: FastifyInstance, o: KeyTapRouteOptions): void {
  const config = { perm: 'self' as const };
  // Lead review 7 Nov M4: starts per account in a sliding window, in memory (one API process at
  // launch). The emergency stop and resume are never held back (as the open-taps cap, m12).
  const starts = new Map<string, number[]>();
  TAP_START_WINDOWS.add(starts);
  const rateLimit = (accountId: string, now: number): void => {
    const recent = (starts.get(accountId) ?? []).filter((t) => t > now - TAP_START_WINDOW_MS);
    if (recent.length >= TAP_STARTS_PER_WINDOW) {
      starts.set(accountId, recent);
      throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + TAP_START_WINDOW_MS - now) / 1000)) });
    }
    recent.push(now);
    starts.set(accountId, recent);
  };
  app.post('/staff/v1/taps/start', { config, preHandler: o.guard }, async (req) => {
    const intent = parseKeyTapIntent(req.body);
    if (!o.allows(req, tapPermOf(intent))) throw new ApiError(403, 'forbidden');
    if (!UNCAPPED.has(intent.kind)) rateLimit(o.accountOf(req), req.server.deps.clock().getTime());
    const sessionId = o.sessionOf?.(req);
    return startKeyTap(req.server.deps, o.accountOf(req), intent, sessionId !== undefined ? { sessionId } : {});
  });
  app.post('/staff/v1/taps/:id/finish', { config, preHandler: o.guard }, async (req) => {
    const body = rec(req.body);
    exactKeys(body, ['response']);
    const response = rec(body.response);
    const json = JSON.stringify(response);
    if (json.length > MAX_RESPONSE_CHARS) throw badRequest();
    // RV5 m11: Postgres jsonb refuses a NUL, which would be a 500 after the key's counter moved.
    if (json.includes('\\u0000')) throw badRequest();
    const { id } = req.params as { id: string };
    const tap = await finishKeyTap(req.server.deps, o.accountOf(req), id, response);
    return { tapId: tap.id };
  });
}
