import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import type { RetentionJob } from '../retention.js';

/** A row of `challenges`: a login code, WebAuthn challenge or pending second factor. */
export interface ChallengeRow {
  id: string;
  account_id: string | null;
  session_id: string | null;
  device_hash: Buffer | null;
  purpose: string;
  method: string;
  secret_hash: Buffer | null;
  webauthn_challenge: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks the challenge used and returns it, or null when it is unknown, used or expired (at
 * exactly `expires_at` it is expired). The only way any code reads a challenge, so each one is
 * handed out at most once even to parallel requests.
 */
export async function consumeChallenge(db: Queryable, id: string, now: Date): Promise<ChallengeRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await db.query<ChallengeRow>(
    'update challenges set used_at = $2 where id = $1 and used_at is null and expires_at > $2 returning *',
    [id, now],
  );
  return rows[0] ?? null;
}

/**
 * F1 (owner, 2026-10-23, "busy logins"): someone who has already started a login can always finish
 * it. A login `finish` (or second step) whose challenge is open (exists, unused, unexpired, with
 * this `purpose`) never takes from the global start budget; one naming no open challenge takes a
 * token as before, so a flood of made-up finishes is still counted. Read only: the route consumes
 * the challenge afterwards as usual.
 */
export async function takeStartBudgetUnlessOpen(req: FastifyRequest, challengeId: unknown, purpose: string): Promise<void> {
  const deps = req.server.deps;
  if (typeof challengeId === 'string' && UUID.test(challengeId)) {
    const { rows } = await deps.db.query(
      'select 1 from challenges where id = $1 and purpose = $2 and used_at is null and expires_at > $3',
      [challengeId, purpose, deps.clock()],
    );
    if (rows.length > 0) return;
  }
  req.server.budgets.start.take();
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Every 10 minutes (registered in `main.ts`): challenges expired over 1 hour ago; sessions past
 * `expires_at` or revoked over 1 hour ago; throttle rows idle over 1 hour; daily counts older than
 * 2 days; trusted devices unused 90 days; alerts older than 90 days; confirm tokens expired over
 * 1 hour ago (Task 5).
 */
export const purgeExpired: RetentionJob = {
  name: 'purgeExpired',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const today = now.toISOString().slice(0, 10);
    const statements: Array<[string, unknown[]]> = [
      ['delete from challenges where expires_at < $1', [ago(HOUR)]],
      ['delete from sessions where expires_at < $1 or revoked_at < $2', [now, ago(HOUR)]],
      ['delete from login_throttle where last_failure_at < $1', [ago(HOUR)]],
      [`delete from daily_counts where day < $1::date - 2`, [today]],
      ['delete from trusted_devices where last_used_at < $1', [ago(90 * DAY)]],
      ['delete from alerts where created_at < $1', [ago(90 * DAY)]],
      ['delete from confirm_tokens where expires_at < $1', [ago(HOUR)]],
    ];
    let total = 0;
    for (const [sql, params] of statements) total += (await db.query(sql, params)).rowCount ?? 0;
    return total;
  },
};
