// Plan 4 Task 27: an active ban row as the staff route stores it (tests of the trader-side checks).
import type { Deps } from '../../src/app.js';

export async function insertBan(
  deps: Pick<Deps, 'db' | 'clock'>,
  accountId: string,
  kind: 'trade' | 'site',
  until: Date | null = new Date(deps.clock().getTime() + 7 * 86_400_000),
): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into account_bans (id, account_id, kind, rule_id, reason_code, until, placed_by, created_at)
     values (gen_random_uuid(), $1, $2, 'abuse', 'abuse', $3, $1, $4) returning id`,
    [accountId, kind, until, deps.clock()],
  );
  return rows[0]!.id;
}
