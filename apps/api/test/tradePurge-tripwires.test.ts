// TRIPWIRES for Plan 7 Task 2 (the whole-trade purge, apps/api/src/retention/tradePurge.ts). Each
// looks at this checkout only and fails once the named work lands without the purge following it.
// (Tables with a foreign key to trades, such as Plan 5's `reviews` and `trade_proofs` or Task 20's
// `chats`, are caught by tradePurge.test.ts's foreign-key test instead.)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API = fileURLToPath(new URL('../', import.meta.url));
// NEEDS_TASK_38_AWAITING retired 2026-10-30: Task 38 landed and tradePurge sets awaitingAction
// from cancel_confirmed_at (tested in tradePurge.test.ts). The purge stays off by default
// (X2F_TRADE_PURGE) until the two checks below are met.
const migrations = readdirSync(`${API}migrations`).map((f) => readFileSync(`${API}migrations/${f}`, 'utf8')).join('\n');
const purge = readFileSync(`${API}src/retention/tradePurge.ts`, 'utf8');
const jobs = readFileSync(`${API}src/retentionJobs.ts`, 'utf8');

describe('Plan 7 Task 2 seams', () => {
  it('NEEDS_PLAN_4_TASK_32_LEDGER: the revenue ledger holds a trade before it is purged', () => {
    if (/create table revenue_ledger/i.test(migrations)) expect(purge).toMatch(/revenue_ledger/);
  });

  it('NEEDS_PLAN_7_TASK_14_STATS: daily statistics are collected before every purge', () => {
    if (/create table daily_stats/i.test(migrations)) {
      expect(jobs.indexOf('collectDailyStats')).toBeGreaterThan(-1);
      expect(jobs.indexOf('collectDailyStats')).toBeLessThan(jobs.indexOf('purgeTradesJob,'));
    }
  });
});
