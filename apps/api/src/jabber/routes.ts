/**
 * Owner rule p5-7, boards JabberSetup and Alerts: setting up secure Jabber (XMPP) account-change
 * alerts. Three steps: the address (`POST /v1/account/jabber/test` sends a six-digit code to it),
 * the code (`POST /v1/account/jabber/verify`), done. Then the Alerts switch
 * (`PUT /v1/account/jabber/enabled`) and Turn off (`DELETE /v1/account/jabber`).
 * `GET /v1/account/jabber` gives the state, with the address masked only.
 *
 * Every write: the account owner's trader session (members get `owner-only`), live under the
 * account lock (`requireLiveSessionInTx`), no running 24-hour hold (403 `recovery-hold`) and a
 * session that does not wait (`weakOf`: 403 `weak-session`, so a weak foothold cannot point the
 * notices elsewhere or silence them). Turning it off, deleting it or proving a new address tells
 * the address that was on (migration 331's `jabber_contact_changed`).
 *
 * Limits (test codes go to any address a user types, so they are capped): one test message per
 * account per `RESEND_WAIT_S`, `TESTS_PER_DAY` per account per UTC day and `TESTS_PER_DAY_SITE`
 * for the whole site (429 `slow-down` `{ retryAfterSeconds }`); a code lives `CODE_TTL_MS` and
 * `CODE_TRIES` wrong entries end it (409 `challenge-expired`).
 *
 * W-021 (owner p11-27): the Jabber notifications settings page. `GET /v1/account/jabber/events`
 * lists every notice kind (`NOTICE_KINDS`) with whether it is on; `PUT /v1/account/jabber/events`
 * `{ kind, on }` turns one on or off (404 `not-found` until an address is proven). Each is on until
 * turned off, except the security notices in `ALWAYS_ON_KINDS` (review F1: 409
 * `jabber-event-always-on`; listed with `canTurnOff: false`). The write has the same gate as the others, and a change of the picks is told to the
 * address that is on (migration 336's `jabber_contact_changed`).
 *
 * The address is never logged (buildApi redacts request bodies; nothing here logs it) and never
 * answered in full. The test message is sent after commit and never awaited by the request.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireLiveSessionInTx, withTx } from '../auth/liveSession.js';
import { requireSession } from '../auth/sessions.js';
import { dailyCap } from '../auth/throttle.js';
import { ApiError } from '../errors.js';
import { codeHash, codeMatches, maskJid, newTestCode, normalizeJid, openJid, sealJid } from './address.js';
import { SEND_TIMEOUT_MS, withTimeout } from './outbox.js';
import { ALWAYS_ON_KINDS, NOTICE_KINDS, type NoticeKind } from './sender.js';

export const RESEND_WAIT_S = 60;
export const TESTS_PER_DAY = 5;
export const TESTS_PER_DAY_SITE = 2_000;
export const CODE_TTL_MS = 15 * 60_000;
export const CODE_TRIES = 5;

export { JABBER_WRITE_ROUTES } from './routeList.js';

export interface JabberStatus {
  /** False until the deployment has X2F_JABBER_KEYS and a sending account (GAP: not set up yet). */
  available: boolean;
  /**
   * `off`: no proven address; `on` / `paused`: proven, switch on / off; `broken`: proven, but sealed
   * under a key X2F_JABBER_KEYS no longer holds, so no notice can go to it (review M4): it needs
   * setting up again.
   */
  state: 'off' | 'on' | 'paused' | 'broken';
  address: string | null;
  /** A new address waiting for its code. */
  pendingAddress: string | null;
  lastSentAt: string | null;
}

interface ContactRow {
  jid_sealed: Buffer | null;
  enabled: boolean;
  last_sent_at: Date | null;
  pending_sealed: Buffer | null;
  pending_code_hash: Buffer | null;
  pending_sent_at: Date | null;
  pending_expires_at: Date | null;
  pending_tries: number;
}

const unavailable = () => new ApiError(503, 'jabber-unavailable');

function available(app: FastifyInstance): boolean {
  return app.deps.config.jabberKeys !== null && app.deps.jabberSender !== undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Exactly the keys named, else 400. */
function body(req: FastifyRequest, keys: string[]): Record<string, unknown> {
  const b = req.body;
  if (!isObject(b) || Object.keys(b).some((k) => !keys.includes(k))) throw new ApiError(400, 'bad-request');
  return b;
}

async function contactOf(db: pg.PoolClient | pg.Pool, accountId: string, lock: boolean): Promise<ContactRow | null> {
  const { rows } = await db.query<ContactRow>(
    `select jid_sealed, enabled, last_sent_at, pending_sealed, pending_code_hash, pending_sent_at, pending_expires_at, pending_tries
       from jabber_contacts where account_id = $1${lock ? ' for update' : ''}`,
    [accountId],
  );
  return rows[0] ?? null;
}

function statusOf(app: FastifyInstance, accountId: string, c: ContactRow | null): JabberStatus {
  const ring = app.deps.config.jabberKeys;
  const shown = (sealed: Buffer | null) => {
    if (sealed === null || ring === null) return null;
    try {
      return maskJid(openJid(ring, accountId, sealed));
    } catch {
      return null;
    }
  };
  const address = shown(c?.jid_sealed ?? null);
  return {
    available: available(app),
    state: c?.jid_sealed ? (ring !== null && address === null ? 'broken' : c.enabled ? 'on' : 'paused') : 'off',
    address,
    pendingAddress: shown(c?.pending_sealed ?? null),
    lastSentAt: c?.last_sent_at?.toISOString() ?? null,
  };
}

/** First in each write's transaction (as team/members.ts `ownerWriteGate`). */
async function writeGate(c: pg.PoolClient, req: FastifyRequest): Promise<void> {
  const now = req.server.deps.clock();
  await requireLiveSessionInTx(c, req.auth, now);
}

export interface JabberEvents {
  /** Every notice kind, in `NOTICE_KINDS` order. */
  events: Array<{ kind: NoticeKind; on: boolean; canTurnOff: boolean }>;
}

const eventsOf = (muted: readonly string[]): JabberEvents => ({
  events: NOTICE_KINDS.map((kind) => {
    const canTurnOff = !ALWAYS_ON_KINDS.includes(kind);
    return { kind, on: !canTurnOff || !muted.includes(kind), canTurnOff };
  }),
});

async function mutedOf(db: pg.PoolClient | pg.Pool, accountId: string): Promise<string[]> {
  const { rows } = await db.query<{ muted_kinds: string[] }>('select muted_kinds from jabber_contacts where account_id = $1', [accountId]);
  return rows[0]?.muted_kinds ?? [];
}

export function jabberRoutes(app: FastifyInstance): void {
  const owner = requireSession({ kinds: ['trader'] });
  const writes = { preHandler: [owner] };

  app.get('/v1/account/jabber', { preHandler: owner }, async (req) =>
    statusOf(app, req.auth.accountId, await contactOf(app.deps.db, req.auth.accountId, false)),
  );

  app.post('/v1/account/jabber/test', writes, async (req, reply) => {
    if (!available(app)) throw unavailable();
    const jid = normalizeJid(body(req, ['address']).address);
    if (jid === null) throw new ApiError(400, 'jabber-address-invalid');
    const { db, clock, config } = app.deps;
    const accountId = req.auth.accountId;
    const code = newTestCode();
    await withTx(db, async (c) => {
      await writeGate(c, req);
      const now = clock();
      const row = await contactOf(c, accountId, true);
      const waitMs = row?.pending_sent_at ? row.pending_sent_at.getTime() + RESEND_WAIT_S * 1000 - now.getTime() : 0;
      if (waitMs > 0) throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.ceil(waitMs / 1000) });
      // In this transaction: a refusal later in it rolls the counts back too. (dailyCap only calls `query`.)
      const inTx = { db: c as unknown as pg.Pool, clock };
      await dailyCap(inTx, `jabber-test:${accountId}`, TESTS_PER_DAY);
      await dailyCap(inTx, 'jabber-test', TESTS_PER_DAY_SITE);
      await c.query(
        `insert into jabber_contacts (account_id, pending_sealed, pending_code_hash, pending_sent_at, pending_expires_at, pending_tries)
         values ($1, $2, $3, $4, $5, 0)
         on conflict (account_id) do update set pending_sealed = excluded.pending_sealed, pending_code_hash = excluded.pending_code_hash,
           pending_sent_at = excluded.pending_sent_at, pending_expires_at = excluded.pending_expires_at, pending_tries = 0`,
        [accountId, sealJid(config.jabberKeys!, accountId, jid), codeHash(config, accountId, code), now, new Date(now.getTime() + CODE_TTL_MS)],
      );
    });
    // After commit, never awaited: a slow or failing Jabber server does not hold the request, and
    // its error (which could quote the address) is dropped.
    void withTimeout(app.deps.jabberSender!.send(jid, { kind: 'test-code', code }), SEND_TIMEOUT_MS).catch(() => {
      req.log.warn({ jabber: 'test-not-sent' }, 'jabber test message not sent');
    });
    return reply.code(202).send({ pendingAddress: maskJid(jid), resendAfterSeconds: RESEND_WAIT_S });
  });

  app.post('/v1/account/jabber/verify', writes, async (req) => {
    if (!available(app)) throw unavailable();
    const raw = body(req, ['code']).code;
    if (typeof raw !== 'string' || !/^[0-9]{6}$/.test(raw.trim())) throw new ApiError(400, 'code-invalid');
    const code = raw.trim();
    const { db, clock, config } = app.deps;
    const accountId = req.auth.accountId;
    // A wrong code's counted try must stick, so the refusal is decided inside and thrown after commit.
    const outcome = await withTx(db, async (c) => {
      await writeGate(c, req);
      const now = clock();
      const row = await contactOf(c, accountId, true);
      if (!row?.pending_code_hash || !row.pending_expires_at || row.pending_expires_at.getTime() <= now.getTime() || row.pending_tries >= CODE_TRIES) {
        return 'expired' as const;
      }
      if (!codeMatches(config, accountId, code, row.pending_code_hash)) {
        await c.query('update jabber_contacts set pending_tries = pending_tries + 1 where account_id = $1', [accountId]);
        return row.pending_tries + 1 >= CODE_TRIES ? ('expired' as const) : ('wrong' as const);
      }
      // Proven: the new address takes over (the old one, if it was on, is told by the trigger).
      await c.query(
        `update jabber_contacts set jid_sealed = pending_sealed, verified_at = $2, enabled = true,
           pending_sealed = null, pending_code_hash = null, pending_expires_at = null, pending_sent_at = null, pending_tries = 0
          where account_id = $1`,
        [accountId, now],
      );
      return 'ok' as const;
    });
    if (outcome === 'wrong') throw new ApiError(400, 'code-invalid');
    if (outcome === 'expired') throw new ApiError(409, 'challenge-expired');
    return statusOf(app, accountId, await contactOf(db, accountId, false));
  });

  app.put('/v1/account/jabber/enabled', writes, async (req) => {
    const on = body(req, ['on']).on;
    if (typeof on !== 'boolean') throw new ApiError(400, 'bad-request');
    const { db } = app.deps;
    const accountId = req.auth.accountId;
    await withTx(db, async (c) => {
      await writeGate(c, req);
      const r = await c.query('update jabber_contacts set enabled = $2 where account_id = $1 and jid_sealed is not null', [accountId, on]);
      if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'not-found');
    });
    return statusOf(app, accountId, await contactOf(db, accountId, false));
  });

  app.get('/v1/account/jabber/events', { preHandler: owner }, async (req) => eventsOf(await mutedOf(app.deps.db, req.auth.accountId)));

  app.put('/v1/account/jabber/events', writes, async (req) => {
    const b = body(req, ['kind', 'on']);
    const { kind, on } = b;
    if (typeof kind !== 'string' || typeof on !== 'boolean') throw new ApiError(400, 'bad-request');
    // Review F1: a security notice stays on, also one this build does not send yet (J-20's first
    // login). Asking for it on is a no-op, below.
    if (!on && ALWAYS_ON_KINDS.includes(kind)) throw new ApiError(409, 'jabber-event-always-on');
    if (!(NOTICE_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, 'bad-request');
    const accountId = req.auth.accountId;
    const muted = await withTx(app.deps.db, async (c) => {
      await writeGate(c, req);
      // Sorted and without duplicates, so setting a pick to what it is writes nothing (and tells nobody).
      const { rows } = await c.query<{ muted_kinds: string[] }>(
        `update jabber_contacts set muted_kinds = array(
             select distinct k from unnest(case when $3::boolean then array_remove(muted_kinds, $2::text) else array_append(muted_kinds, $2::text) end) k order by k)
          where account_id = $1 and jid_sealed is not null
          returning muted_kinds`,
        [accountId, kind, on],
      );
      if (rows.length === 0) throw new ApiError(404, 'not-found');
      return rows[0]!.muted_kinds;
    });
    return eventsOf(muted);
  });

  app.delete('/v1/account/jabber', writes, async (req, reply) => {
    await withTx(app.deps.db, async (c) => {
      await writeGate(c, req);
      await c.query('delete from jabber_contacts where account_id = $1', [req.auth.accountId]);
    });
    return reply.code(204).send();
  });
}
