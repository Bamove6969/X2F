import type { FastifyInstance, FastifyRequest } from 'fastify';
import { lockAccount, withTx } from '../auth/hold.js';
import { applyRemoval, listMethods } from '../auth/methods.js';
import { pgpAddKeyRoutesAt } from '../auth/pgp.js';
import { ApiError } from '../errors.js';
import { pushRoutesAt } from '../push/routes.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap, consumeSecondOwnerTap } from './keyTap.js';
import { attestedKeyCount, body, idParam, log, tapIdOf } from './members.js';
import { THREE_METHOD_ROLES } from './login.js';

// Lead re-review 6 Nov, items 1 and 2: staff and the owner are refused on the trader site (owner
// Q19, Q13), so their own account work moves here (perm `self`, every role, own account only):
//
// - `GET /staff/v1/account/methods` → the account's login methods (as the trader route).
// - `POST /staff/v1/account/pgp/start { publicKey }` → a challenge to the new key;
//   `POST /staff/v1/account/pgp/finish { challengeId, code, tapId }` → `{ fingerprint }`: the code
//   proves the key, a tap `add-pgp-key` (bound to the fingerprint) by one of the person's security
//   keys confirms it, the key is stored and `staff.method-added` logged, in one transaction.
// - `DELETE /staff/v1/account/methods/:type/:id { tapId }` (pgp, security-key, passkey) → 204: a
//   tap `remove-method` confirms; the account's login rule must still hold afterwards (409
//   `last-login-method`), and the owner keeps two security keys (409 `owner-needs-two-keys`); every
//   other session ends (as on the trader site) and `staff.method-removed` is logged.
// - `GET /staff/v1/account/sessions` and `DELETE /staff/v1/account/sessions/:id` → the account's
//   live sessions (both sites) and ending one (no tap: it only takes power away).
// - `GET /staff/v1/account/alerts` and `POST /staff/v1/account/alerts/:id/seen`.
// - `GET|POST|DELETE /staff/v1/account/push`: Web Push on the staff site (the owner's price-health
//   alerts, a new staff login); the owner's subscriptions belong to the account, a staff member's
//   to the session.

const REMOVABLE = ['pgp', 'security-key', 'passkey'] as const;
type Removable = (typeof REMOVABLE)[number];

export function staffAccountRoutes(app: FastifyInstance): void {
  const opts = { config: { perm: 'self' as const }, preHandler: requireStaff('self') };

  app.get('/staff/v1/account/methods', opts, async (req) => listMethods(req.server.deps.db, req.staff.accountId));

  pgpAddKeyRoutesAt(app, '/staff/v1/account/pgp', {
    config: opts.config,
    preHandler: [...opts.preHandler],
    async inTx(c, req, fingerprint) {
      await consumeKeyTap(c, tapIdOf(body(req)), req.staff.accountId, { kind: 'add-pgp-key', fingerprint: fingerprint.toLowerCase() }, req.server.deps.clock(), {
        sessionId: req.auth.sessionId,
      });
      await log(c as Parameters<typeof log>[0], req, 'staff.method-added', { method: 'pgp' });
    },
  });

  app.delete('/staff/v1/account/methods/:type/:id', opts, async (req, reply) => {
    const { type } = req.params as { type: string };
    if (!(REMOVABLE as readonly string[]).includes(type)) throw new ApiError(404, 'not-found');
    const methodType = type as Removable;
    const id = idParam(req);
    const tapId = tapIdOf(body(req));
    const { db, config, clock } = req.server.deps;
    const me = req.staff.accountId;
    const now = clock();
    await withTx(db, async (c) => {
      await lockAccount(c, me);
      const intent = { kind: 'remove-method' as const, methodType, methodId: id };
      const first = await consumeKeyTap(c, tapId, me, intent, now, { sessionId: req.auth.sessionId });
      if (methodType === 'security-key') {
        const { rows } = await c.query("select 1 from webauthn_credentials where id = $1 and account_id = $2 and kind = 'security-key' and attested", [id, me]);
        const keys = rows.length > 0 ? await attestedKeyCount(c, me) : Infinity;
        if (req.staff.role === 'owner' && keys <= 2) throw new ApiError(409, 'owner-needs-two-keys');
        // Lead review 7 Nov I-2: a moderator or senior moderator taps rulings with a security key;
        // without one they could never tap again.
        if ((req.staff.role === 'mod' || req.staff.role === 'senior') && keys <= 1) throw new ApiError(409, 'security-key-required');
      }
      // Owner G4: removing one of the owner's keys is tapped by both owner keys.
      if (req.staff.role === 'owner' && methodType === 'security-key') {
        await consumeSecondOwnerTap(c, body(req).secondTapId, first, intent, now, { sessionId: req.auth.sessionId });
      }
      // Owner G3 (7 Nov): a moderator or senior keeps all three methods; one of a kind may go only
      // while another of that kind stays.
      if (THREE_METHOD_ROLES.includes(req.staff.role)) {
        const sameKind = methodType === 'pgp'
          ? (await c.query<{ n: number }>('select count(*)::int as n from pgp_keys where account_id = $1', [me])).rows[0]!.n
          : (await c.query<{ n: number }>(
              `select count(*)::int as n from webauthn_credentials where account_id = $1 and kind = $2 and (kind <> 'security-key' or attested)`,
              [me, methodType],
            )).rows[0]!.n;
        if (sameKind <= 1) throw new ApiError(409, methodType === 'security-key' ? 'security-key-required' : 'all-three-methods-required');
      }
      await applyRemoval(c, config, me, methodType, id, req.auth.sessionId, now);
      // Keep staff_members.has_security_key true to what is stored (202's column).
      await c.query('update staff_members set has_security_key = $2 where account_id = $1', [me, (await attestedKeyCount(c, me)) > 0]);
      await log(c, req, 'staff.method-removed', { method: methodType });
    });
    // The other sessions' streams end once the revocations have committed.
    req.server.events.closeAccount(me);
    return reply.code(204).send();
  });

  app.get('/staff/v1/account/sessions', opts, async (req) => {
    const { db, clock } = req.server.deps;
    const { rows } = await db.query<{ id: string; device_label: string; app: string; created_at: Date; last_seen_at: Date }>(
      `select id, device_label, app, created_at, last_seen_at from sessions
        where account_id = $1 and revoked_at is null and expires_at > $2
        order by last_seen_at desc, created_at desc, id`,
      [req.staff.accountId, clock()],
    );
    return rows.map((s) => ({
      id: s.id,
      deviceLabel: s.device_label,
      site: s.app,
      createdAt: s.created_at.toISOString(),
      lastSeenAt: s.last_seen_at.toISOString(),
      current: s.id === req.auth.sessionId,
    }));
  });

  app.delete('/staff/v1/account/sessions/:id', opts, async (req, reply) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    const ended = await withTx(db, async (c) => {
      const { rows } = await c.query('select 1 from sessions where id = $1 and account_id = $2', [id, req.staff.accountId]);
      if (rows.length === 0) throw new ApiError(404, 'not-found');
      const r = await c.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [id, clock()]);
      if ((r.rowCount ?? 0) > 0) await log(c, req, 'staff.session-ended', {});
      return (r.rowCount ?? 0) > 0;
    });
    if (ended) req.server.events.closeSession(req.staff.accountId, id);
    return reply.code(204).send();
  });

  app.get('/staff/v1/account/alerts', opts, async (req) => {
    const { rows } = await req.server.deps.db.query<{ id: string; kind: string; detail: unknown; created_at: Date; seen_at: Date | null }>(
      'select id, kind, detail, created_at, seen_at from alerts where account_id = $1 order by created_at desc, id desc limit 50',
      [req.staff.accountId],
    );
    return rows.map((a) => ({ id: a.id, kind: a.kind, detail: a.detail, createdAt: a.created_at.toISOString(), seenAt: a.seen_at?.toISOString() ?? null }));
  });

  app.post('/staff/v1/account/alerts/:id/seen', opts, async (req: FastifyRequest, reply) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    await withTx(db, async (c) => {
      const r = await c.query('update alerts set seen_at = coalesce(seen_at, $3) where id = $1 and account_id = $2 and seen_at is null', [id, req.staff.accountId, clock()]);
      if ((r.rowCount ?? 0) === 0) {
        const { rows } = await c.query('select 1 from alerts where id = $1 and account_id = $2', [id, req.staff.accountId]);
        if (rows.length === 0) throw new ApiError(404, 'not-found');
        return;
      }
      // Lead review 7 Nov M1: hiding an alert is logged, so a stolen session can't silence one unseen.
      await log(c, req, 'staff.alert-seen', {});
    });
    return reply.code(204).send();
  });

  pushRoutesAt(app, '/staff/v1/account/push', opts, {
    // Lead review 7 Nov M1: on the staff site a bare DELETE drops only this session's subscriptions
    // (the owner's other devices keep theirs), and every unsubscribe is logged.
    sessionOnlyDelete: true,
    onDelete: (c, req) => log(c, req, 'staff.push-removed', {}),
  });
}
