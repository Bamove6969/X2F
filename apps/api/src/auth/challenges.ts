import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import { deviceHash } from './device.js';
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
 * it. A login `finish` (or second step) skips the global start budget only when it names an open
 * challenge (unused, unexpired) of this `purpose` and one of `methods`, started from this very
 * device (the browser's device-cookie hash, which every login start records), and only once per
 * challenge: the exemption is claimed atomically (`payload.budgetFree`), so parallel or repeated
 * finishes of one challenge, and any retry after a refusal, take a token as before. Every other
 * finish (unknown, used, expired, another device, no device cookie, another method) takes a
 * token, so a flood of made-up finishes is still counted. The route consumes the challenge
 * afterwards as usual.
 */
export async function takeStartBudgetUnlessOpen(
  req: FastifyRequest,
  challengeId: unknown,
  c: { purpose: string; methods: readonly string[] },
): Promise<void> {
  const deps = req.server.deps;
  const device = deviceHash(req);
  if (typeof challengeId === 'string' && UUID.test(challengeId) && device !== null) {
    const { rows } = await deps.db.query(
      `update challenges set payload = payload || '{"budgetFree": true}'::jsonb
        where id = $1 and purpose = $2 and method = any($3::text[]) and device_hash = $4
          and used_at is null and expires_at > $5 and not (payload ? 'budgetFree')
        returning 1`,
      [challengeId, c.purpose, c.methods, device, deps.clock()],
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
 * 1 hour ago (Task 5); login approvals expired over 1 hour ago (Task 16).
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
      // Task 16: approvals live minutes; the account's alerts keep the record.
      ['delete from login_approvals where expires_at < $1', [ago(HOUR)]],
    ];
    let total = 0;
    for (const [sql, params] of statements) total += (await db.query(sql, params)).rowCount ?? 0;
    return total;
  },
};
