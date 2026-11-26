/**
 * Team members' routes (Plan 2 Task 18; spec 6.7, R44). See team/members.ts for the rules.
 *
 * The account owner's side (a full trader session of the account owner; a member gets 403
 * `owner-only` from `requireSession`, which lets no member through unless a route says so):
 * - `GET /v1/team` → `{ members, max }`.
 * - `POST /v1/team/invites { tradeTag, abilities, confirmToken }` (confirm `team-invite-abilities`,
 *   bound to the name and the boxes) → 201 `{ id, invite, expiresAt }`: `invite` is the one-time
 *   code, shown once. The old body `{ tradeTag, roles }` (confirm `team-invite`) still works: each
 *   role ticks the boxes it allowed (`ROLE_ABILITIES`). Owner p11-21 (S-104, 9 Nov 2026): from a
 *   username-and-password session the invite still goes out (201 with the code), with no boxes;
 *   the boxes are staged as that session's draft and the answer also carries `{ status: 'staged',
 *   changeId }`: they apply 24 h after they are submitted (hold v3), or at once if a strong login
 *   approves them. Each member's list entry carries `chatLabel` (S-105, team/label.ts).
 * - `PATCH /v1/team/members/:id { abilities, confirmToken }` (confirm `team-abilities`) → the member;
 *   the old `{ roles }` (confirm `team-roles`) still works. A box the owner's hard rules keep
 *   owner-only, an always-on one or an unknown id is 400 `bad-request` (team/abilities.ts). From a
 *   username-and-password session either shape is staged as the same boxes (`team-abilities`).
 * - `DELETE /v1/team/members/:id { confirmToken }` (confirm `team-remove`) → 204; the member's
 *   sessions end at once.
 * - `PUT /v1/team/members/:id/limits { band, hours, confirmToken }` (confirm `team-limits`, J-20) →
 *   the member: `band` null (no band) or `{ minAtomic, maxAtomic }` (XMR atomic units), `hours`
 *   "any" or `{ days, start, end, tz }` (team/limits.ts). Staged (202) from a username-and-password
 *   session, as a boxes change.
 * - The three writes re-check the session is live (401) and, owner 2026-10-30, are refused during a
 *   24-hour hold (403 `recovery-hold` `{ holdUntil }`, before the confirm token is spent). Owner
 *   1 Nov 2026 (landing review I1): no box reaches a member at once from a session that is not
 *   strong; S-104 (above) replaced the refusal of a weak invite with staging its boxes, except
 *   inside the sign-up window (403 `weak-session`, before the confirm token is spent, as a role
 *   change); a removal needs no strong session. Hold model v3 (owner
 *   2 Nov 2026): a role change by a username-and-password session is staged like the other changes of
 *   such a session (202 `{ status: 'staged', changeId }`, applied 24 h after it is submitted;
 *   hold.ts); inside the sign-up window it is still refused (403 `weak-session`). Owner 2 Nov 2026:
 *   team members are for vendor accounts only, so an invite or a role change by a trader account
 *   is 403 `not-vendor` (first, before the confirm token is spent; again under the lock).
 * - `GET /v1/team/members/:id/sessions` → `{ sessions }`: the member's signed-in sessions (device,
 *   signed in at, last seen), most recently seen first. `DELETE /v1/team/members/:id/sessions/:sessionId`
 *   → 204 ends one; `DELETE /v1/team/members/:id/sessions` → `{ ended }` ends every one of theirs.
 *   404 for a member of another account or removed, and for a session not that member's
 *   (team/memberSessions.ts). No confirm: an
 *   ending only takes access away, as `DELETE /v1/account/sessions/:id`. Each ending writes the
 *   team log's `session-ended` row (migration 855's trigger).
 * - `GET /v1/team/audit?from&to&member&trade` → the audit log, newest first (`trade`: one trade's
 *   team activity, e.g. a member's release, owner question trades-release).
 * - `GET /v1/team/permissions` (the owner and every member) → the abilities catalogue: groups,
 *   each box with its risk, availability, ruling and presets, the presets, and the hard rules.
 * - `GET /v1/team/me` (a member only; the account owner gets 403 `forbidden`) → the member's own
 *   access, read only: `{ name, chatLabel, lead: { tradeTag }, preset, groups, limits?, serverNow }`,
 *   `groups` the boxes they hold in the catalogue's words and `limits` their band and hours with
 *   `insideNow` and `workingUntil` (team/access.ts).
 *
 * The member's side (no session; every answer gives the browser a device cookie, and every step
 * after the first is bound to the device that took it):
 * - `POST /v1/team/invite { invite }` → `{ tradeTag, roles, expiresAt }` (404 for a wrong, used
 *   or expired code). It never names the team account: the vendor is named only inside the door
 *   (review 2026-11-08 F3).
 * - `POST /v1/team/join/start { invite, loginName, publicKey, acceptedTerms }` → a PGP challenge to
 *   the key; 400 `terms-not-accepted` `{ version }` unless `acceptedTerms` is the current version
 *   (the member signs the Terms themselves, review 2026-11-08 F1).
 * - `POST /v1/team/join/finish { challengeId, code, termsSignature }` → `{ setupId, needs, setupUntil }`: the
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
import { assertTermsVersion, openNames, sealNames } from '../accounts.js';
import { SIGNED_BODY_LIMIT, checkTermsSignature } from '../termsSignature.js';
import { ApiError } from '../errors.js';
import { consumeChallenge } from '../auth/challenges.js';
import { requireConfirm } from '../auth/confirm.js';
import { deviceHash, ensureDeviceCookie } from '../auth/device.js';
import { checkTeamJoinCode, insertPgpKey, issueTeamJoinChallenge, PGP_BODY_LIMIT } from '../auth/pgp.js';
import { requireSession, startSession } from '../auth/sessions.js';
import { verifyWebAuthnRegistrationOnly, webauthnRegistrationOptions, WEBAUTHN_TTL_MS } from '../auth/webauthn.js';
import { listAudit } from '../team/audit.js';
import { myAccess } from '../team/access.js';
import { endMemberSessions, listMemberSessions } from '../team/memberSessions.js';
import { normalizeTradeCode } from '@x2f/core';
import { assertVendor, requireVendor } from './accountType.js';
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
  setAbilities,
  setLimits,
  startMember,
} from '../team/members.js';
import { catalogueView, parseAbilities, parseRoles, rolesToAbilities, type TeamRole } from '../team/abilities.js';
import { MAX_TEAM_MEMBERS } from '../team/perms.js';
import { bandKey, hoursKey, insideHours, parseBand, parseHours, type MemberLimits } from '../team/limits.js';

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

function idParam(req: FastifyRequest, key: 'id' | 'sessionId' = 'id'): string {
  const id = (req.params as Record<string, unknown>)[key];
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

/**
 * The input of an invite or a boxes change, checked before `requireConfirm` (a refusal never uses
 * up a token, R17): `abilities` (the boxes), or the old `roles` (each role's boxes); never both.
 */
interface Checked {
  name?: { name: string; key: string };
  abilities: string[];
  /** Set when the body used the old `roles` (the confirm is then the old `team-invite` / `team-roles`). */
  roles?: TeamRole[];
}
const checked = new WeakMap<FastifyRequest, Checked>();

function boxes(b: Record<string, unknown>): Pick<Checked, 'abilities' | 'roles'> {
  if (b.abilities !== undefined && b.roles !== undefined) throw new ApiError(400, 'bad-request');
  if (b.abilities !== undefined) return { abilities: parseAbilities(b.abilities) };
  const roles = parseRoles(b.roles);
  return { abilities: rolesToAbilities(roles), roles };
}

const checkInvite: preHandlerAsyncHookHandler = async function (req) {
  const b = body(req);
  const set = boxes(b);
  const name = await checkMemberName(req.server.deps.db, b.tradeTag);
  checked.set(req, { name, ...set });
};

const checkRoles: preHandlerAsyncHookHandler = async function (req) {
  idParam(req);
  checked.set(req, boxes(body(req)));
};

/** J-20: the limits of `PUT /v1/team/members/:id/limits`, checked before `requireConfirm` (a refusal never spends a token). */
const checkedLimits = new WeakMap<FastifyRequest, MemberLimits>();

const checkLimits: preHandlerAsyncHookHandler = async function (req) {
  idParam(req);
  const b = body(req);
  if (!Object.hasOwn(b, 'band') || !Object.hasOwn(b, 'hours')) throw new ApiError(400, 'bad-request');
  checkedLimits.set(req, { band: parseBand(b.band), hours: parseHours(b.hours) });
};

function limitsInput(req: FastifyRequest): MemberLimits {
  const v = checkedLimits.get(req);
  if (!v) throw new ApiError(400, 'bad-request');
  return v;
}

const checkId: preHandlerAsyncHookHandler = async function (req) {
  idParam(req);
};

function input(req: FastifyRequest): Checked {
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

/**
 * J-20 (owner p7-11): joining ends in the member's first session, so outside the working hours the
 * lead set on the invite the last step is refused (403 `outside-login-hours`) before it uses the
 * setup: the member finishes inside their hours.
 */
async function assertJoinInsideHours(req: FastifyRequest, memberAccountId: string): Promise<void> {
  const deps = req.server.deps;
  const { rows } = await deps.db.query<{ hours: unknown }>('select hours from team_members where member_account_id = $1', [memberAccountId]);
  if (rows[0] && !insideHours(rows[0].hours, deps.clock())) throw new ApiError(403, 'outside-login-hours');
}

/** Uses up the setup (inside the joining transaction); 400 `challenge-expired` when a parallel finish took it first. */
async function useSetup(c: pg.PoolClient, setupId: string, now: Date): Promise<void> {
  const r = await c.query(`update challenges set used_at = $2 where id = $1 and purpose = 'team-setup' and used_at is null and expires_at > $2`, [setupId, now]);
  if ((r.rowCount ?? 0) === 0) throw new ApiError(400, 'challenge-expired');
}

/** The calling session, for the team writes' gate (`ownerWriteGate`). */
const caller = (req: FastifyRequest): Caller => ({ accountId: req.auth.accountId, sessionId: req.auth.sessionId });

export function teamRoutes(app: FastifyInstance): void {
  // The account owner only: a trader's full session with no member (members get `owner-only`).
  const owner = requireSession({ kinds: ['trader'] });

  app.get('/v1/team', { preHandler: owner }, async (req) => {
    const deps = req.server.deps;
    return { members: await listMembers(deps.db, req.auth.accountId, deps.clock()), max: MAX_TEAM_MEMBERS };
  });

  app.post(
    '/v1/team/invites',
    {
      preHandler: [owner, checkInvite, requireVendor, requireConfirm((req) => {
        const i = input(req);
        return i.roles
          ? { kind: 'team-invite', name: i.name!.name, roles: i.roles.join(',') }
          : { kind: 'team-invite-abilities', name: i.name!.name, abilities: i.abilities.join(',') };
      })],
    },
    async (req, reply) => {
      const deps = req.server.deps;
      const { name, abilities } = input(req);
      const r = await createInvite(deps, caller(req), { name: name!, abilities });
      return reply.code(201).send({ id: r.id, invite: r.code, expiresAt: r.expiresAt });
    },
  );

  app.patch(
    '/v1/team/members/:id',
    {
      preHandler: [owner, checkRoles, requireVendor, requireConfirm((req) => {
        const i = input(req);
        return i.roles
          ? { kind: 'team-roles', memberId: idParam(req), roles: i.roles.join(',') }
          : { kind: 'team-abilities', memberId: idParam(req), abilities: i.abilities.join(',') };
      })],
    },
    async (req) => {
      const deps = req.server.deps;
      // Both body shapes end here as the same boxes (`{ roles }` mapped by `rolesToAbilities`).
      const { abilities } = input(req);
      return setAbilities({ ...deps, events: req.server.events }, caller(req), idParam(req), abilities);
    },
  );

  // J-20 (owner p7-4, p7-11): a member's trade-size band and working hours, bound by the confirm to
  // exactly these.
  app.put(
    '/v1/team/members/:id/limits',
    {
      preHandler: [owner, checkLimits, requireVendor, requireConfirm((req) => {
        const l = limitsInput(req);
        return { kind: 'team-limits', memberId: idParam(req), band: bandKey(l.band), hours: hoursKey(l.hours) };
      })],
    },
    async (req) => {
      const deps = req.server.deps;
      return setLimits({ ...deps, events: req.server.events }, caller(req), idParam(req), limitsInput(req));
    },
  );

  app.delete(
    '/v1/team/members/:id',
    { preHandler: [owner, checkId, requireConfirm((req) => ({ kind: 'team-remove', memberId: idParam(req) }))] },
    async (req, reply) => {
      await removeMember({ ...req.server.deps, events: req.server.events }, caller(req), idParam(req));
      return reply.code(204).send();
    },
  );

  // A member's signed-in sessions (team/memberSessions.ts): the owner sees each and ends any of them.
  app.get('/v1/team/members/:id/sessions', { preHandler: [owner, checkId] }, async (req) => {
    const deps = req.server.deps;
    return { sessions: await listMemberSessions(deps.db, req.auth.accountId, idParam(req), deps.clock()) };
  });

  app.delete('/v1/team/members/:id/sessions/:sessionId', { preHandler: [owner, checkId] }, async (req, reply) => {
    await endMemberSessions({ ...req.server.deps, events: req.server.events }, caller(req), idParam(req), idParam(req, 'sessionId'));
    return reply.code(204).send();
  });

  app.delete('/v1/team/members/:id/sessions', { preHandler: [owner, checkId] }, async (req) => {
    const ended = await endMemberSessions({ ...req.server.deps, events: req.server.events }, caller(req), idParam(req), null);
    return { ended: ended.length };
  });

  // The catalogue the boxes come from: static, for the owner's screen and for a member to see what they may do.
  app.get('/v1/team/permissions', { preHandler: requireSession({ kinds: ['trader'], allowStaleTerms: true, touch: false, member: 'any' }) }, async () => catalogueView());

  // A member's own access, read only: their boxes in the catalogue's words, their band and hours
  // (and whether they are inside them now) and their team lead (team/access.ts). The account owner
  // holds every permission and has no lead: 403 `forbidden`.
  app.get('/v1/team/me', { preHandler: requireSession({ kinds: ['trader'], touch: false, member: 'any' }) }, async (req) => {
    if (req.auth.memberId === null) throw new ApiError(403, 'forbidden');
    const deps = req.server.deps;
    const view = await myAccess(deps.db, req.auth.accountId, req.auth.memberId, deps.clock());
    if (view === null) throw new ApiError(401, 'not-authenticated');
    return view;
  });

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
    const trade = q.trade === undefined ? undefined : typeof q.trade === 'string' ? normalizeTradeCode(q.trade) : null;
    if (trade === null) throw new ApiError(400, 'bad-request');
    const from = date(q.from);
    const to = date(q.to);
    const page = await listAudit(req.server.deps.db, req.auth.accountId, {
      // Review 26 Nov (finding 7): this older route stays the members' work only.
      categories: ['work'],
      ...(from ? { from } : {}), ...(to ? { to } : {}), ...(typeof member === 'string' ? { members: [member.toLowerCase()] } : {}),
      ...(trade !== undefined ? { tradeCode: trade } : {}),
    });
    return page.entries;
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
    // Review 2026-11-08 F1: a member signs the agreement like every trader (the front door), before
    // anything is made; the version rides in the challenge to the account `join/finish` creates.
    const terms = assertTermsVersion(deps, b.acceptedTerms);
    const loginName = await checkMemberLoginName(deps.db, b.loginName);
    // FU-D: the login name waits in the challenge only sealed, never in clear.
    const names = sealNames(deps.config, memberNames(loginName.key));
    return issueTeamJoinChallenge(deps, req, {
      accountId: null, publicKey: str(b, 'publicKey'), payload: { step: 'first', inviteId: invite.id, names, terms },
    });
  });

  // Owner 9 Nov 2026 (p11-14): the member's signature comes with the finish, as a trader's does
  // with their register finish; it is sealed to the login account made here, never kept in the
  // challenge.
  app.post('/v1/team/join/finish', { bodyLimit: SIGNED_BODY_LIMIT }, async (req: FastifyRequest, reply: FastifyReply) => {
    ensureDeviceCookie(req, reply);
    req.server.budgets.register.take();
    const deps = req.server.deps;
    const b = body(req);
    // The signature is checked before the code is used, so a bad one costs the member no new code.
    const signature = checkTermsSignature(b.termsSignature);
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), null);
    const p = proved.payload as { step?: unknown; inviteId?: unknown; names?: unknown; terms?: unknown };
    if (p.step !== 'first' || typeof p.inviteId !== 'string') throw new ApiError(400, 'challenge-expired');
    // The Terms accepted at `join/start` must still be the current ones.
    const terms = { version: assertTermsVersion(deps, p.terms), signature };
    const names = openNames(deps.config, p.names);
    const inviteId = p.inviteId;
    const now = deps.clock();
    const device = deviceHash(req)!;
    const setup = await inTransaction(deps.db, async (c) => {
      const m = await startMember(c, deps.config, {
        inviteId, names, now, terms,
        addKey: (memberAccountId) => insertPgpKey(c, deps.config, { accountId: memberAccountId, fingerprint: proved.fingerprint, armored: proved.armored, now, proved: proved.proved }),
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
    await assertJoinInsideHours(req, setup.memberAccountId);
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
    await startSession(deps, req, reply, { accountId: setup.memberAccountId, level: 'full', deviceLabel, method: kind, firstSession: true });
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
    await assertJoinInsideHours(req, setup.memberAccountId);
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), setup.memberAccountId);
    if (proved.payload.step !== 'second' || proved.payload.setupId !== setup.id) throw new ApiError(400, 'challenge-expired');
    const now = deps.clock();
    await inTransaction(deps.db, async (c) => {
      await useSetup(c, setup.id, now);
      // A second, different key: the same fingerprint is `key-in-use` (two PGP factors need disjoint keys).
      await insertPgpKey(c, deps.config, { accountId: setup.memberAccountId, fingerprint: proved.fingerprint, armored: proved.armored, now, proved: proved.proved });
      await finishMember(c, setup.memberAccountId, now);
    });
    // Landing review M1: two PGP keys were just proven, so the member's first session is strong.
    await startSession(deps, req, reply, { accountId: setup.memberAccountId, level: 'full', deviceLabel, method: 'pgp', firstSession: true });
    return reply.code(201).send({ status: 'ok' });
  });
}
