import { createHash } from 'node:crypto';
import { inviteRegistrationChallenge, keyCheckCode } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { assertNewNames, assertTermsAccepted, createAccount } from '../accounts.js';
import { deviceHash, ensureDeviceCookie } from '../auth/device.js';
import { lockAccount, withTx } from '../auth/hold.js';
import { PGP_BODY_LIMIT, checkTeamJoinCode, insertPgpKey, issueTeamJoinChallenge } from '../auth/pgp.js';
import { verifyWebAuthnRegistrationOnly, webauthnRegistrationOptions, type CredentialKind } from '../auth/webauthn.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { RetentionJob } from '../retention.js';
import { SIGNED_BODY_LIMIT, eraseTermsSignature } from '../termsSignature.js';
import type { StaffDeps } from './app.js';
import { requireStaff } from './guard.js';
import { THREE_METHOD_ROLES, holdsModeratorMethods } from './login.js';
import { consumeKeyTap } from './keyTap.js';
import { attestedKeyCount, body, hoursOf, idParam, lockTarget, log, roleOf, tapIdOf, unassignOpenCases, type InvitableRole } from './members.js';
import { endAllSessions } from '../auth/sessions.js';
import { addOwnerAlert } from '../alerts.js';
import { pushOwnerAlert } from '../push/ownerAlert.js';

// Plan 4 Task 7: staff invites (migration 205_staff_invites.sql).
//
// The owner's side (perm `staff.manage`):
// - `POST /staff/v1/invites { role, hours, inviteId, token, expiresAt, tapId }` → 201
//   `{ inviteId, link, expiresAt }`. The owner's browser makes the token (32 random bytes,
//   base64url), the invite id and the expiry (at most 24 hours ahead), because the owner's
//   `create-invite` tap must already be bound to the token's hash when the invite is created
//   (`{ kind: 'create-invite', inviteId, role, tokenHash, expiresAt }`, tokenHash = hex SHA-256 of
//   the token text). The server re-derives that intent from the request and consumes the tap in
//   the transaction that stores the invite. The token itself is never stored; the link is
//   `<staffOrigin>/invite/<token>`, shown once.
// - `DELETE /staff/v1/invites/:id` → 204 (404 when used, cancelled or unknown). If the invitee had
//   picked their names, that half-made account (disabled, never finished) is closed for good here:
//   its sealed Terms signature is erased (owner 9 Nov 2026, p11-13: "Erase it when the account
//   closes"). `purgeStaffInviteLeftovers` does the same for an invite that expired instead.
//
// The invitee's side (perm `public-invite`, no session; every step checks that the token's invite
// is unused, not cancelled and not expired, else 404 `invite-invalid`; only then does it spend the
// process-wide start or register budget, so made-up tokens cannot drain it for a real invitee):
// - `GET /staff/v1/terms` → `{ version }`: the Terms version to accept (the trader API's `GET /v1/terms`);
// - `GET /staff/v1/invites/accept/:token` → `{ role, hours, expiresAt }`;
// - `POST …/:token/account { displayName, loginName, acceptedTerms, termsSignature }` → 201: the
//   public name and the private login name (FU-D), once (409 `wrong-state` after that), with the
//   Terms accepted and signed (owner 9 Nov 2026, p11-14: everyone who gets a login signs;
//   `assertTermsAccepted`'s 400s, first). The account is created disabled: it cannot log in until
//   `finish`;
// - `POST …/:token/key/start { kind? }` → `{ options }`, challenge `inviteRegistrationChallenge(tokenHash)`
//   (default kind `security-key`, which must be attested; or `passkey`, PGP's partner for staff);
// - `POST …/:token/key/finish { kind?, response, label? }` → 201 `{ kind, keyCheckCode }`;
// - `POST …/:token/pgp/start { publicKey }` and `…/pgp/finish { challengeId, code }` → 201, from the
//   same browser (device cookie);
// - `POST …/:token/finish` → 201 `{ keyCheckCode }` (the first attested security key's, or null):
//   409 `two-factors-required` unless the account holds a staff login pair (PGP and a key or passkey,
//   or two PGP keys; spec 6.6), 409 `moderator-methods-required` for a senior or mod without a PGP
//   key and a passkey (D-070: the security key is optional); then the invite is used, the account enabled, the staff row
//   inserted and `staff.joined` logged, in one transaction.

/** An invite link works for 24 hours (spec 6.6). */
export const INVITE_TTL_MS = 24 * 3_600_000;
/** How far the owner's browser clock may run ahead when it sets the expiry. */
export const INVITE_CLOCK_SKEW_MS = 5 * 60_000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** Hex SHA-256 of the token text: what the owner's tap binds and the moderation gate re-derives. */
export const inviteTokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

const invalid = (): ApiError => new ApiError(404, 'invite-invalid');

interface OpenInvite {
  id: string;
  /** `reset`: D-032's re-enrolment link for an existing staff member (account_id set from the start). */
  kind: 'invite' | 'reset';
  token_hash: string;
  role: InvitableRole;
  hours: unknown;
  expires_at: Date;
  account_id: string | null;
}

/** The open invite a token names (`lock`: `for update`, in a transaction); else 404 `invite-invalid`. */
async function openInvite(q: Queryable, token: unknown, now: Date, lock = false): Promise<OpenInvite> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw invalid();
  const { rows } = await q.query<OpenInvite>(
    `select id, kind, token_hash, role, hours, expires_at, account_id from staff_invites
      where token_hash = $1 and used_at is null and cancelled_at is null and expires_at > $2
      ${lock ? 'for update' : ''}`,
    [inviteTokenHash(token), now],
  );
  if (!rows[0]) throw invalid();
  return rows[0];
}

const tokenOf = (req: FastifyRequest): unknown => (req.params as { token?: unknown }).token;

/** The invitee's account (picked at `account`); 409 `wrong-state` before that. */
function accountOfInvite(i: OpenInvite): string {
  if (i.account_id === null) throw new ApiError(409, 'wrong-state');
  return i.account_id;
}

/** The invite again, locked, with the same account, then the account row locked: every write's start. */
async function lockInvite(c: Queryable, req: FastifyRequest, accountId: string): Promise<OpenInvite> {
  const i = await openInvite(c, tokenOf(req), req.server.deps.clock(), true);
  if (i.account_id !== accountId) throw invalid();
  await lockAccount(c, accountId);
  return i;
}

function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

function credentialKind(v: unknown): CredentialKind {
  if (v === undefined) return 'security-key';
  if (v !== 'security-key' && v !== 'passkey') throw new ApiError(400, 'bad-request');
  return v;
}

/** The checked fields of a new invite; 400 `bad-request` otherwise. */
function newInviteOf(b: Record<string, unknown>, now: Date) {
  const role = roleOf(b.role);
  const hours = hoursOf(b.hours);
  return { role, hours, ...linkOf(b, now) };
}

/** The link fields the owner's browser makes (an invite's, or a security reset's); 400 `bad-request` otherwise. */
function linkOf(b: Record<string, unknown>, now: Date) {
  const inviteId = typeof b.inviteId === 'string' && UUID.test(b.inviteId) ? b.inviteId.toLowerCase() : null;
  const token = typeof b.token === 'string' && TOKEN.test(b.token) && Buffer.from(b.token, 'base64url').length === 32 ? b.token : null;
  const expiresAt = typeof b.expiresAt === 'string' && ISO_UTC.test(b.expiresAt) ? b.expiresAt : null;
  const at = expiresAt === null ? NaN : Date.parse(expiresAt);
  if (inviteId === null || token === null || !Number.isFinite(at)) throw new ApiError(400, 'bad-request');
  if (at <= now.getTime() || at > now.getTime() + INVITE_TTL_MS + INVITE_CLOCK_SKEW_MS) throw new ApiError(400, 'bad-request');
  return { inviteId, token, expiresAt: expiresAt!, at: new Date(at), tapId: tapIdOf(b) };
}

/** How long past an invite's expiry the sweep waits before it treats the half-made account as closed. */
export const INVITE_LEFTOVER_GRACE_MS = 3_600_000;

/**
 * Retention (security review 2026-11-09, minor 3), every 10 minutes with the other jobs
 * (retentionJobs.ts): erases the sealed Terms signature of every half-made staff account whose
 * invite will never finish, because it was cancelled or expired over `INVITE_LEFTOVER_GRACE_MS`
 * ago (owner 9 Nov 2026, p11-13: "Erase it when the account closes"; the account is disabled from
 * `account` until `finish`, so nothing else ever logs it in). An invite that was used is a staff
 * member's: their signature stays until removal (staff/members.ts). The hour's grace keeps the
 * sweep, on the trader process's clock, clear of a `finish` racing the deadline on the staff
 * process's; a finish past the deadline fails `openInvite` anyway. Cancelled invites are erased at
 * cancel; the sweep covers them again for rows cancelled before this landed. Returns the rows touched.
 */
export const purgeStaffInviteLeftovers: RetentionJob = {
  name: 'purgeStaffInviteLeftovers',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const r = await db.query(
      `update accounts a set terms_signature = null from staff_invites i
        where i.account_id = a.id and i.kind = 'invite' and a.terms_signature is not null and i.used_at is null
          and (i.cancelled_at is not null or i.expires_at <= $1)`,
      [new Date(now.getTime() - INVITE_LEFTOVER_GRACE_MS)],
    );
    return r.rowCount ?? 0;
  },
};

export function staffInviteRoutes(app: FastifyInstance): void {
  const perm = 'staff.manage' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  const pub = { config: { perm: 'public-invite' as const } };

  app.post('/staff/v1/invites', opts, async (req, reply) => {
    const { db, clock } = req.server.deps;
    const now = clock();
    const n = newInviteOf(body(req), now);
    const tokenHash = inviteTokenHash(n.token);
    await withTx(db, async (c) => {
      const tap = await consumeKeyTap(c, n.tapId, req.staff.accountId, { kind: 'create-invite', inviteId: n.inviteId, role: n.role, tokenHash, expiresAt: n.expiresAt }, now, { sessionId: req.auth.sessionId });
      const r = await c.query(
        `insert into staff_invites (id, token_hash, role, hours, created_by, created_at, expires_at, tap_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
        [n.inviteId, tokenHash, n.role, JSON.stringify(n.hours), req.staff.accountId, now, n.at, tap.id],
      );
      if ((r.rowCount ?? 0) === 0) throw new ApiError(400, 'bad-request'); // the id or the token is taken
      await log(c, req, 'staff.invite-created', { inviteId: n.inviteId, role: n.role });
    });
    const origin = (req.server.deps as StaffDeps).staffOrigin;
    return reply.code(201).send({ inviteId: n.inviteId, link: `${origin}/invite/${n.token}`, expiresAt: n.at.toISOString() });
  });

  app.delete('/staff/v1/invites/:id', opts, async (req, reply) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    await withTx(db, async (c) => {
      const r = await c.query<{ account_id: string | null; kind: 'invite' | 'reset' }>(
        'update staff_invites set cancelled_at = $2 where id = $1 and used_at is null and cancelled_at is null returning account_id, kind',
        [id, clock()],
      );
      const cancelled = r.rows[0];
      if (!cancelled) throw new ApiError(404, 'not-found');
      // The invitee's half-made account, if the names were picked: disabled, and now it never
      // finishes, so this is its close (owner p11-13). The Terms version and time stay, as at removal.
      // A security-reset link (D-032) belongs to a staff member, whose account is not closed by it.
      if (cancelled.account_id !== null && cancelled.kind === 'invite') await eraseTermsSignature(c, cancelled.account_id);
      await log(c, req, 'staff.invite-cancelled', { inviteId: id });
    });
    return reply.code(204).send();
  });

  // D-032 (owner G60, 7 Nov): "If they don't have their recovery code, they have to reach out to the
  // owner. The owner will have to vet them, and ... he will be able to help them log back in by
  // resetting their security parameters ... and then they can set up the additional security
  // methods." `POST /staff/v1/members/:id/reset-security { inviteId, token, expiresAt, tapId }` →
  // 201 `{ inviteId, link, expiresAt }`: the owner's browser makes the link as for an invite, and
  // his tap `reset-staff-security` binds the person, the link's id, the token's hash and the expiry.
  // In one transaction: the person's security keys, passkeys, PGP keys and known devices are
  // deleted (a found or stolen key must not work again), the account is disabled until the link is
  // used, their open cases go back to the queue, an earlier open reset link of theirs ends, and
  // `staff.security-reset` is logged; then every session of theirs ends. The link opens the invite
  // pages at the key step (names, role, hours and the signed Terms stay theirs); its finish asks
  // for what an invite's does and re-enables the account. Lead reading, owner question: a link,
  // not "a username and a password" (staff have no passwords; Q-B3).
  app.post('/staff/v1/members/:id/reset-security', opts, async (req, reply) => {
    // Review MF1: the owner role's own power, whatever perms a grant may ever add (the tap needs the owner too).
    if (req.staff.role !== 'owner') throw new ApiError(403, 'forbidden');
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    const now = clock();
    const n = linkOf(body(req), now);
    const tokenHash = inviteTokenHash(n.token);
    await withTx(db, async (c) => {
      const target = await lockTarget(c, id);
      const tap = await consumeKeyTap(
        c, n.tapId, req.staff.accountId,
        { kind: 'reset-staff-security', accountId: id, inviteId: n.inviteId, tokenHash, expiresAt: n.expiresAt },
        now, { sessionId: req.auth.sessionId },
      );
      await c.query("update staff_invites set cancelled_at = $2 where account_id = $1 and kind = 'reset' and used_at is null and cancelled_at is null", [id, now]);
      const r = await c.query(
        `insert into staff_invites (id, kind, token_hash, role, hours, created_by, created_at, expires_at, tap_id, account_id)
         select $1, 'reset', $2, m.role, m.hours, $3, $4, $5, $6, m.account_id from staff_members m where m.account_id = $7
         on conflict do nothing`,
        [n.inviteId, tokenHash, req.staff.accountId, now, n.at, tap.id, id],
      );
      if ((r.rowCount ?? 0) === 0) throw new ApiError(400, 'bad-request'); // the id or the token is taken
      await c.query('delete from webauthn_credentials where account_id = $1', [id]);
      await c.query('delete from pgp_keys where account_id = $1', [id]);
      await c.query('delete from trusted_devices where account_id = $1', [id]);
      // Review S1: nothing half-done of theirs survives either: unused taps, open login challenges,
      // pending login approvals. TRIPWIRE: when staff recovery codes land (D-032's "recovery code,
      // else"), delete recovery_codes here too.
      await c.query('delete from key_taps where account_id = $1 and used_at is null', [id]);
      await c.query('delete from challenges where account_id = $1 and used_at is null', [id]);
      await c.query('delete from login_approvals where account_id = $1 and used_at is null', [id]);
      await c.query('update accounts set disabled_at = coalesce(disabled_at, $2) where id = $1', [id, now]);
      await c.query('update staff_members set has_security_key = false where account_id = $1', [id]);
      if (!target.switchedOff) await unassignOpenCases(c, id, req);
      await log(c, req, 'staff.security-reset', { staffId: id, inviteId: n.inviteId });
      await addOwnerAlert(c, 'staff-security-reset', { staffId: id }, now);
    });
    await endAllSessions({ db, clock, events: req.server.events }, id);
    await pushOwnerAlert({ db, push: req.server.push }, 'staff-security-reset').catch(() => undefined);
    const origin = (req.server.deps as StaffDeps).staffOrigin;
    return reply.code(201).send({ inviteId: n.inviteId, link: `${origin}/invite/${n.token}`, expiresAt: n.at.toISOString() });
  });

  // ------------------------------------------------------------------------------------------
  // The invitee

  app.get('/staff/v1/invites/accept/:token', pub, async (req) => {
    const db = req.server.deps.db;
    const i = await openInvite(db, tokenOf(req), req.server.deps.clock());
    req.server.budgets.start.take();
    // A return visit (the account was made earlier on this link): what is in so far, so the page
    // carries on at the keys with the right counts (attested security keys, passkeys, PGP keys).
    let resume: { keys: number; passkeys: number; pgp: number; keyCheckCode: string | null } | null = null;
    if (i.account_id !== null) {
      const { rows } = await db.query<{ passkeys: number; pgp: number; first: Buffer | null }>(
        `select (select count(*)::int from webauthn_credentials w where w.account_id = $1 and w.kind = 'passkey') as passkeys,
                (select count(*)::int from pgp_keys p where p.account_id = $1) as pgp,
                (select w.public_key from webauthn_credentials w where w.account_id = $1 and w.kind = 'security-key' and w.attested
                  order by w.created_at, w.id limit 1) as first`,
        [i.account_id],
      );
      const r = rows[0]!;
      resume = { keys: await attestedKeyCount(db, i.account_id), passkeys: r.passkeys, pgp: r.pgp, keyCheckCode: r.first ? keyCheckCode(new Uint8Array(r.first)) : null };
    }
    return { role: i.role, hours: i.hours, expiresAt: i.expires_at.toISOString(), resume, ...(i.kind === 'reset' ? { reset: true } : {}) };
  });

  // The Terms version an invitee must accept (owner 9 Nov 2026, p11-14: everyone who gets a login
  // signs): the staff origin's answer to the trader API's `GET /v1/terms`, the same
  // `X2F_TERMS_VERSION`, so the staff web's Terms step (apps/staff-web, Plan 4 Task 16) checks its
  // bundled text against it the way the trader app's Terms screen does. Public: it is read before
  // any account exists, and it names nothing but the version.
  app.get('/staff/v1/terms', pub, async (req) => ({ version: req.server.deps.config.termsVersion }));

  // The staff web's invite page (apps/staff-web/src/screens/Invite.tsx) shows the Terms with the
  // signature pad first and sends `acceptedTerms` and `termsSignature` with the names (tripwire in
  // test/staff/members.test.ts).
  app.post('/staff/v1/invites/accept/:token/account', { ...pub, bodyLimit: SIGNED_BODY_LIMIT }, async (req, reply) => {
    const deps = req.server.deps;
    const open = await openInvite(deps.db, tokenOf(req), deps.clock());
    if (open.account_id !== null) throw new ApiError(409, 'wrong-state');
    req.server.budgets.register.take();
    const b = body(req);
    const terms = assertTermsAccepted(deps, b.acceptedTerms, b.termsSignature);
    const names = await assertNewNames(deps.db, b.displayName, b.loginName);
    const now = deps.clock();
    await withTx(deps.db, async (c) => {
      const i = await openInvite(c, tokenOf(req), now, true);
      if (i.account_id !== null) throw new ApiError(409, 'wrong-state');
      const accountId = await createAccount(c, deps.config, { ...names, kind: 'staff', termsVersion: terms.version, termsSignature: terms.signature, now });
      // Disabled until `finish`: a half-made staff login can never log in.
      await c.query('update accounts set disabled_at = $2 where id = $1', [accountId, now]);
      await c.query('update staff_invites set account_id = $2 where id = $1', [i.id, accountId]);
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/staff/v1/invites/accept/:token/key/start', pub, async (req) => {
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.start.take();
    const kind = credentialKind(body(req).kind);
    const options = await webauthnRegistrationOptions(deps, accountId, { kind, challenge: inviteRegistrationChallenge(i.token_hash) });
    return { options };
  });

  app.post('/staff/v1/invites/accept/:token/key/finish', pub, async (req, reply) => {
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.register.take();
    const b = body(req);
    const kind = credentialKind(b.kind);
    const label = b.label === undefined ? undefined : str(b, 'label');
    const cred = await verifyWebAuthnRegistrationOnly(deps, accountId, b.response, inviteRegistrationChallenge(i.token_hash), {
      kind, ...(label !== undefined ? { label } : {}),
    });
    await withTx(deps.db, async (c) => {
      await lockInvite(c, req, accountId);
      await cred.store(c);
    });
    const attestedKey = cred.kind === 'security-key' && cred.attested;
    return reply.code(201).send({ kind: cred.kind, keyCheckCode: attestedKey ? keyCheckCode(cred.publicKey) : null });
  });

  app.post('/staff/v1/invites/accept/:token/pgp/start', { ...pub, bodyLimit: PGP_BODY_LIMIT }, async (req, reply) => {
    ensureDeviceCookie(req, reply);
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.start.take();
    const publicKey = str(body(req), 'publicKey');
    const issued = await issueTeamJoinChallenge(deps, req, { accountId, publicKey, payload: { inviteId: i.id }, purpose: 'staff-join' });
    return { challengeId: issued.challengeId, encryptedMessage: issued.encryptedMessage, expiresAt: issued.expiresAt };
  });

  app.post('/staff/v1/invites/accept/:token/pgp/finish', pub, async (req, reply) => {
    ensureDeviceCookie(req, reply);
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.register.take();
    const b = body(req);
    if (deviceHash(req) === null) throw new ApiError(400, 'challenge-expired');
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), accountId, 'staff-join');
    if (proved.payload.inviteId !== i.id) throw new ApiError(400, 'challenge-expired');
    const now = deps.clock();
    await withTx(deps.db, async (c) => {
      await lockInvite(c, req, accountId);
      await insertPgpKey(c, deps.config, { accountId, fingerprint: proved.fingerprint, armored: proved.armored, now, proved: proved.proved });
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/staff/v1/invites/accept/:token/finish', pub, async (req, reply) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const first = await openInvite(deps.db, tokenOf(req), now);
    const accountId = accountOfInvite(first);
    req.server.budgets.register.take();
    const code = await withTx(deps.db, async (c) => {
      const i = await lockInvite(c, req, accountId);
      const keys = await attestedKeyCount(c, accountId);
      const { rows } = await c.query<{ webauthn: number; pgp: number }>(
        `select (select count(*)::int from webauthn_credentials w
                  where w.account_id = $1 and ((w.kind = 'security-key' and w.attested) or w.kind = 'passkey')) as webauthn,
                (select count(*)::int from pgp_keys p where p.account_id = $1) as pgp`,
        [accountId],
      );
      const { webauthn, pgp } = rows[0]!;
      if (!((pgp >= 1 && webauthn >= 1) || pgp >= 2)) throw new ApiError(409, 'two-factors-required');
      // D-070 (owner p11-19, changing G3): a moderator holds a PGP key and a passkey; a security key is optional.
      if (THREE_METHOD_ROLES.includes(i.role) && !(await holdsModeratorMethods(c, accountId))) throw new ApiError(409, 'moderator-methods-required');
      await c.query('update staff_invites set used_at = $2 where id = $1', [i.id, now]);
      if (i.kind === 'reset') {
        // D-032: the same staff member, set up again. A member switched off meanwhile stays off;
        // one removed meanwhile cannot get here (removal cancels the link).
        await c.query(
          `update accounts a set disabled_at = null from staff_members m
            where a.id = $1 and m.account_id = a.id and m.switched_off_at is null and m.removed_at is null`,
          [accountId],
        );
        await c.query('update staff_members set has_security_key = $2 where account_id = $1', [accountId, keys > 0]);
      } else {
        await c.query('update accounts set disabled_at = null where id = $1', [accountId]);
        await c.query(
          `insert into staff_members (account_id, role, hours, grants, has_security_key, switched_off_at, joined_at)
           values ($1, $2, $3, '{}', $4, null, $5)`,
          [accountId, i.role, JSON.stringify(i.hours), keys > 0, now],
        );
      }
      const { rows: k } = await c.query<{ public_key: Buffer }>(
        `select public_key from webauthn_credentials where account_id = $1 and kind = 'security-key' and attested order by created_at, id limit 1`,
        [accountId],
      );
      await appendLog(c, {
        at: now, actor: { kind: 'staff', id: accountId, role: i.role }, tradeCode: null,
        ...(i.kind === 'reset'
          ? { action: 'staff.security-reset-finished' as const, detail: { staffId: accountId } }
          : { action: 'staff.joined' as const, detail: { staffId: accountId, role: i.role } }),
      });
      if (i.kind === 'reset') await addOwnerAlert(c, 'staff-security-reset-finished', { staffId: accountId }, now);
      return k[0] ? keyCheckCode(new Uint8Array(k[0].public_key)) : null;
    });
    if (first.kind === 'reset') await pushOwnerAlert({ db: deps.db, push: req.server.push }, 'staff-security-reset-finished').catch(() => undefined);
    return reply.code(201).send({ keyCheckCode: code });
  });
}
