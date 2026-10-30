// TRIPWIRES for Plan 7 Task 2 (the whole-trade purge, apps/api/src/retention/tradePurge.ts). Each
// looks at this checkout only and fails once the named work lands without the purge following it.
// (Tables with a foreign key to trades, such as Plan 5's `reviews` and `trade_proofs` or Task 20's
// `chats`, are caught by tradePurge.test.ts's foreign-key test instead.)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API = fileURLToPath(new URL('../', import.meta.url));
const migrations = readdirSync(`${API}migrations`).map((f) => readFileSync(`${API}migrations/${f}`, 'utf8')).join('\n');
const purge = readFileSync(`${API}src/retention/tradePurge.ts`, 'utf8');
const jobs = readFileSync(`${API}src/retentionJobs.ts`, 'utf8');

describe('Plan 7 Task 2 seams', () => {
  it('NEEDS_TASK_38_AWAITING: a buyer-cancel refund waiting for the seller\'s Confirm cancel is never purged', () => {
    // Plan 3 Task 38 (116_fund_started.sql) adds `cancel_confirmed_at`. When it lands, `factsSql` in
    // tradePurge.ts must read it and set `awaitingAction` (= @x2f/trade awaitingCancelConfirm), and
    // REFUND_DISPUTE_WINDOW_MS (packages/trade/src/retention.ts) moves to disputeAfterRefundHours.
    if (/cancel_confirmed_at/.test(migrations)) expect(purge).toMatch(/cancel_confirmed_at/);
  });

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
