import { randomBytes } from 'node:crypto';
import type { Deps } from '../../src/app.js';
import { seedAccount } from './accounts.js';

/**
 * Plan 4 Task 26: an approved account limit on `accountId`, written as the decide route writes it
 * (a recommendation by one staff account, approved by another, and its `account_limits` row).
 */
export async function approvedLimit(deps: Deps, accountId: string, l: { capUsd: number } | { stage: 'starter' | 'building' }): Promise<void> {
  const name = () => `st${randomBytes(5).toString('hex')}`;
  const staff = await seedAccount(deps, { loginName: name(), kind: 'staff' });
  const senior = await seedAccount(deps, { loginName: name(), kind: 'staff' });
  const capUsd = 'capUsd' in l ? l.capUsd : null;
  const stage = 'stage' in l ? l.stage : null;
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into limit_recommendations (account_id, cap_usd, stage, reason, recommended_by, created_at, status, decided_by, decided_at)
     values ($1, $2, $3, $4, $5, $6, 'approved', $7, $6) returning id`,
    [accountId, capUsd, stage, 'x'.repeat(40), staff, deps.clock(), senior],
  );
  await deps.db.query(
    'insert into account_limits (account_id, cap_usd, stage, set_by, recommendation_id, created_at) values ($1, $2, $3, $4, $5, $6)',
    [accountId, capUsd, stage, senior, rows[0]!.id, deps.clock()],
  );
}
