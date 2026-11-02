/**
 * Team members' routes (Plan 2 Task 18; spec 6.7, R44). See team/members.ts for the rules.
 *
 * The account owner's side (a full trader session of the account owner; a member gets 403
 * `owner-only` from `requireSession`, which lets no member through unless a route says so):
 * - `GET /v1/team` → `{ members, max }`.
 * - `POST /v1/team/invites { displayName, roles, confirmToken }` (confirm `team-invite`, bound to the name and roles) → 201
 *   `{ id, invite, expiresAt }`: `invite` is the one-time code, shown once.
 * - `PATCH /v1/team/members/:id { roles, confirmToken }` (confirm `team-roles`) → the member.
 * - `DELETE /v1/team/members/:id { confirmToken }` (confirm `team-remove`) → 204; the member's
 *   sessions end at once.
 * - The three writes re-check the session is live (401) and, owner 2026-10-30, are refused during a
 *   24-hour hold (403 `recovery-hold` `{ holdUntil }`, before the confirm token is spent). Owner
 *   1 Nov 2026 (landing review I1): an invite or a role change needs a strong session, at any time
 *   (403 `weak-session`, before the confirm token is spent); a removal does not. Owner 2 Nov 2026:
 *   team members are for vendor accounts only, so an invite or a role change by a trader account
 *   is 403 `not-vendor` (first, before the confirm token is spent; again under the lock).
 * - `GET /v1/team/audit?from&to&member` → the audit log, newest first.
 *
 * The member's side (no session; every answer gives the browser a device cookie, and every step
 * after the first is bound to the device that took it):
 * - `POST /v1/team/invite { invite }` → `{ team, displayName, roles, expiresAt }` (404 for a
 *   wrong, used or expired code).
 * - `POST /v1/team/join/start { invite, loginName, publicKey }` → a PGP challenge to the key.
 * - `POST /v1/team/join/finish { challengeId, code }` → `{ setupId, needs, setupUntil }`: the
 *   member's login exists with that key and the invite is used up; no session yet.
 * - `POST /v1/team/join/second/webauthn/start { setupId, kind }` and
 *   `.../finish { setupId, challengeId, response, deviceLabel, label? }`, or
 *   `POST /v1/team/join/second/pgp/start { setupId, publicKey }` and
 *   `.../finish { setupId, challengeId, code, deviceLabel }` → 201 `{ status: 'ok' }` and the
 *   member's first session.
 */
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { openNames, sealNames } from '../accounts.js';
import { ApiError } from '../errors.js';
import { consumeChallenge } from '../auth/challenges.js';
import { requireConfirm } from '../auth/confirm.js';
import { requireNotHeld, settleOf, weakRefusal } from '../auth/hold.js';
import { deviceHash, ensureDeviceCookie } from '../auth/device.js';
import { checkTeamJoinCode, insertPgpKey, issueTeamJoinChallenge, PGP_BODY_LIMIT } from '../auth/pgp.js';
import { requireSession, startSession } from '../auth/sessions.js';
import { waits, type LoginStrength } from '../auth/strength.js';
import { verifyWebAuthnRegistrationOnly, webauthnRegistrationOptions, WEBAUTHN_TTL_MS } from '../auth/webauthn.js';
import { listAudit } from '../team/audit.js';
import { requireVendor } from './accountType.js';
import {
  type Caller,
  checkMemberLoginName,
  checkMemberName,
  createInvite,
  finishMember,
  inviteView,
  listMembers,
  memberNames,
  openInvite,
  removeMember,
  setRoles,
  startMember,
} from '../team/members.js';
import { MAX_TEAM_MEMBERS, parseRoles, type TeamRole } from '../team/perms.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a member's second factor may be: the staff rule's partners of PGP. */
const SECOND_FACTORS = ['security-key', 'passkey', 'pgp'] as const;

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  return b as Record<string, unknown>;
}

function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id.toLowerCase();
}

async function inTransaction<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
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

/** The input of an invite or a roles change, checked before `requireConfirm` (a refusal never uses up a token, R17). */
const checked = new WeakMap<FastifyRequest, { name?: { name: string; key: string }; roles: TeamRole[] }>();

const checkInvite: preHandlerAsyncHookHandler = async function (req) {
  const b = body(req);
  const roles = parseRoles(b.roles);
  const name = await checkMemberName(req.server.deps.db, b.displayName);
  checked.set(req, { name, roles });
};

const checkRoles: preHandlerAsyncHookHandler = async function (req) {
  idParam(req);
  checked.set(req, { roles: parseRoles(body(req).roles) });
};

const checkId: preHandlerAsyncHookHandler = async function (req) {
  idParam(req);
};

function input(req: FastifyRequest): { name?: { name: string; key: string }; roles: TeamRole[] } {
  const v = checked.get(req);
  if (!v) throw new ApiError(400, 'bad-request');
  return v;
}

/** The open setup a `setupId` names, from this device: the member's login account. */
async function openSetup(req: FastifyRequest, setupId: unknown): Promise<{ id: string; memberAccountId: string }> {
  const deps = req.server.deps;
  const device = deviceHash(req);
  if (typeof setupId !== 'string' || !UUID.test(setupId) || device === null) throw new ApiError(400, 'challenge-expired');
  const { rows } = await deps.db.query<{ account_id: string }>(
    `select account_id from challenges
      where id = $1 and purpose = 'team-setup' and method = 'pair' and device_hash = $2 and used_at is null and expires_at > $3`,
    [setupId, device, deps.clock()],
  );
  const row = rows[0];
  if (!row) throw new ApiError(400, 'challenge-expired');
  return { id: setupId, memberAccountId: row.account_id };
}

/** Uses up the setup (inside the joining transaction); 400 `challenge-expired` when a parallel finish took it first. */
async function useSetup(c: pg.PoolClient, setupId: string, now: Date): Promise<void> {
  const r = await c.query(`update challenges set used_at = $2 where id = $1 and purpose = 'team-setup' and used_at is null and expires_at > $2`, [setupId, now]);
  if ((r.rowCount ?? 0) === 0) throw new ApiError(400, 'challenge-expired');
}

/** The calling session and its settle deps, for the team writes' gate (`ownerWriteGate`). */
const caller = (req: FastifyRequest): Caller => ({ accountId: req.auth.accountId, sessionId: req.auth.sessionId, settle: settleOf(req) });

/**
 * preHandler after `requireSession` and before `requireConfirm` (owner 1 Nov 2026, landing review
 * I1): 403 `weak-session` unless the calling session is strong (strength.ts), so a weak session is
 * refused before it spends a confirm token. Re-checked under the account lock in the write's
 * transaction (`ownerWriteGate`).
 */
const requireStrongSession: preHandlerAsyncHookHandler = async function (req) {
  const { rows } = await req.server.deps.db.query<{ strength: LoginStrength | null }>('select strength from sessions where id = $1', [req.auth.sessionId]);
  if (waits(rows[0]?.strength)) throw weakRefusal();
};

export function teamRoutes(app: FastifyInstance): void {
  // The account owner only: a trader's full session with no member (members get `owner-only`).
  const owner = requireSession({ kinds: ['trader'] });

  app.get('/v1/team', { preHandler: owner }, async (req) => {
    const deps = req.server.deps;
    return { members: await listMembers(deps.db, req.auth.accountId, deps.clock()), max: MAX_TEAM_MEMBERS };
  });

  app.post(
    '/v1/team/invites',
    { preHandler: [owner, checkInvite, requireVendor, requireNotHeld, requireStrongSession, requireConfirm((req) => ({ kind: 'team-invite', name: input(req).name!.name, roles: input(req).roles.join(',') }))] },
    async (req, reply) => {
      const deps = req.server.deps;
      const { name, roles } = input(req);
      const r = await createInvite(deps, caller(req), { name: name!, roles });
      return reply.code(201).send({ id: r.id, invite: r.code, expiresAt: r.expiresAt });
    },
  );

  app.patch(
    '/v1/team/members/:id',
    { preHandler: [owner, checkRoles, requireVendor, requireNotHeld, requireStrongSession, requireConfirm((req) => ({ kind: 'team-roles', memberId: idParam(req), roles: input(req).roles.join(',') }))] },
    async (req) => setRoles({ ...req.server.deps, events: req.server.events }, caller(req), idParam(req), input(req).roles),
  );

  app.delete(
    '/v1/team/members/:id',
    { preHandler: [owner, checkId, requireNotHeld, requireConfirm((req) => ({ kind: 'team-remove', memberId: idParam(req) }))] },
    async (req, reply) => {
      await removeMember({ ...req.server.deps, events: req.server.events }, caller(req), idParam(req));
      return reply.code(204).send();
    },
  );

  app.get('/v1/team/audit', { preHandler: owner }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const date = (v: unknown): Date | undefined => {
      if (v === undefined) return undefined;
      const d = typeof v === 'string' ? new Date(v) : new Date(Number.NaN);
      if (Number.isNaN(d.getTime())) throw new ApiError(400, 'bad-request');
      return d;
    };
    const member = q.member;
    if (member !== undefined && (typeof member !== 'string' || !UUID.test(member))) throw new ApiError(400, 'bad-request');
    const from = date(q.from);
    const to = date(q.to);
    return listAudit(req.server.deps.db, req.auth.accountId, {
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(typeof member === 'string' ? { memberId: member.toLowerCase() } : {}),
    });
  });

  // ---- The member's side ----

  app.post('/v1/team/invite', async (req, reply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.start.take();
    const deps = req.server.deps;
    return inviteView(await openInvite(deps.db, { code: body(req).invite }, deps.clock()));
  });

  app.post('/v1/team/join/start', { bodyLimit: PGP_BODY_LIMIT }, async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.start.take();
    const deps = req.server.deps;
    const b = body(req);
    const invite = await openInvite(deps.db, { code: b.invite }, deps.clock());
    const loginName = await checkMemberLoginName(deps.db, b.loginName);
    // FU-D: the login name waits in the challenge only sealed, never in clear.
    const names = sealNames(deps.config, memberNames(loginName.key));
    return issueTeamJoinChallenge(deps, req, {
      accountId: null, publicKey: str(b, 'publicKey'), payload: { step: 'first', inviteId: invite.id, names },
    });
  });

  app.post('/v1/team/join/finish', async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.register.take();
    const deps = req.server.deps;
    const b = body(req);
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), null);
    const p = proved.payload as { step?: unknown; inviteId?: unknown; names?: unknown };
    if (p.step !== 'first' || typeof p.inviteId !== 'string') throw new ApiError(400, 'challenge-expired');
    const names = openNames(deps.config, p.names);
    const inviteId = p.inviteId;
    const now = deps.clock();
    const device = deviceHash(req)!;
    const setup = await inTransaction(deps.db, async (c) => {
      const m = await startMember(c, deps.config, {
        inviteId, names, now,
        addKey: (memberAccountId) => insertPgpKey(c, deps.config, { accountId: memberAccountId, fingerprint: proved.fingerprint, armored: proved.armored, now }),
      });
      const { rows } = await c.query<{ id: string }>(
        `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
         values ($1, $2, 'team-setup', 'pair', '{}', $3, $4) returning id`,
        [m.memberAccountId, device, now, m.setupUntil],
      );
      return { setupId: rows[0]!.id, setupUntil: m.setupUntil };
    });
    return reply.code(201).send({ setupId: setup.setupId, needs: [...SECOND_FACTORS], setupUntil: setup.setupUntil.toISOString() });
  });

  app.post('/v1/team/join/second/webauthn/start', async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.start.take();
    const deps = req.server.deps;
    const b = body(req);
    const kind = b.kind;
    if (kind !== 'passkey' && kind !== 'security-key') throw new ApiError(400, 'bad-request');
    const setup = await openSetup(req, b.setupId);
    const options = await webauthnRegistrationOptions(deps, setup.memberAccountId, { kind });
    const now = deps.clock();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, device_hash, purpose, method, webauthn_challenge, payload, created_at, expires_at)
       values ($1, $2, 'team-setup-key', $3, $4, $5, $6, $7) returning id`,
      [setup.memberAccountId, deviceHash(req), kind, options.challenge, JSON.stringify({ setupId: setup.id }), now, new Date(now.getTime() + WEBAUTHN_TTL_MS)],
    );
    return { challengeId: rows[0]!.id, options };
  });

  app.post('/v1/team/join/second/webauthn/finish', async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.register.take();
    const deps = req.server.deps;
    const b = body(req);
    const deviceLabel = str(b, 'deviceLabel');
    const label = b.label === undefined ? undefined : str(b, 'label');
    const setup = await openSetup(req, b.setupId);
    const ch = await consumeChallenge(deps.db, str(b, 'challengeId'), deps.clock());
    const device = deviceHash(req);
    if (
      !ch || ch.purpose !== 'team-setup-key' || (ch.method !== 'passkey' && ch.method !== 'security-key') || ch.webauthn_challenge === null ||
      ch.account_id !== setup.memberAccountId || ch.payload.setupId !== setup.id || device === null || ch.device_hash === null || !ch.device_hash.equals(device)
    ) {
      throw new ApiError(400, 'challenge-expired');
    }
    const kind = ch.method;
    // Verifies the attestation by the staff rule (a security key must be attested; R1). The
    // credential is stored only in the transaction that wins the setup (review M9(e)): a lost race
    // or a member removed meanwhile leaves nothing behind.
    const cred = await verifyWebAuthnRegistrationOnly(deps, setup.memberAccountId, b.response as RegistrationResponseJSON, ch.webauthn_challenge, {
      kind, ...(label !== undefined ? { label } : {}),
    });
    const now = deps.clock();
    await inTransaction(deps.db, async (c) => {
      await useSetup(c, setup.id, now);
      await finishMember(c, setup.memberAccountId, now);
      await cred.store(c);
    });
    // Landing review M1: two factors were just proven, so the member's first session is strong
    // (as every member login, login.ts), whatever the second factor's method default.
    await startSession(deps, req, reply, { accountId: setup.memberAccountId, level: 'full', deviceLabel, method: kind, firstSession: true, strength: 'strong' });
    return reply.code(201).send({ status: 'ok' });
  });

  app.post('/v1/team/join/second/pgp/start', { bodyLimit: PGP_BODY_LIMIT }, async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.start.take();
    const deps = req.server.deps;
    const b = body(req);
    const setup = await openSetup(req, b.setupId);
    return issueTeamJoinChallenge(deps, req, { accountId: setup.memberAccountId, publicKey: str(b, 'publicKey'), payload: { step: 'second', setupId: setup.id } });
  });

  app.post('/v1/team/join/second/pgp/finish', async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.register.take();
    const deps = req.server.deps;
    const b = body(req);
    const deviceLabel = str(b, 'deviceLabel');
    const setup = await openSetup(req, b.setupId);
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), setup.memberAccountId);
    if (proved.payload.step !== 'second' || proved.payload.setupId !== setup.id) throw new ApiError(400, 'challenge-expired');
    const now = deps.clock();
    await inTransaction(deps.db, async (c) => {
      await useSetup(c, setup.id, now);
      // A second, different key: the same fingerprint is `key-in-use` (two PGP factors need disjoint keys).
      await insertPgpKey(c, deps.config, { accountId: setup.memberAccountId, fingerprint: proved.fingerprint, armored: proved.armored, now });
      await finishMember(c, setup.memberAccountId, now);
    });
    // Landing review M1: two PGP keys were just proven, so the member's first session is strong.
    await startSession(deps, req, reply, { accountId: setup.memberAccountId, level: 'full', deviceLabel, method: 'pgp', firstSession: true, strength: 'strong' });
    return reply.code(201).send({ status: 'ok' });
  });
}
