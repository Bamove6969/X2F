import { TYPICAL_WINDOW } from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';

/**
 * P5-A8 typical times as running lists (migration 325, lead call 2026-10-29 for Plan 5 Task 20): when
 * a trade is released by its seller (not by a ruling), the buyer's payment time (`paid_at -
 * secured_at`, 0 when paid before secured) and the seller's release time (the `release-started`
 * event time `- paid_at`) are appended, in whole minutes rounded down, to each side's list of the
 * last 20. Once per trade (a `trade_totals_counted` row of kind 'action-times'). No trade code or
 * date is kept with the minutes, so they survive the 30-day trade delete. A trade released before
 * the buyer marked it paid has no times.
 *
 * Runs in the transaction that stores the `released` event (trades/store.ts `applyEvent`).
 */
export async function countActionTimes(q: Queryable, code: string): Promise<void> {
  await q.query(
    `with t as (
       select t.code, t.buyer_account_id, t.seller_account_id,
              greatest(0, floor(extract(epoch from (t.paid_at - t.secured_at)) / 60))::int as pay,
              greatest(0, floor(extract(epoch from (r.at - t.paid_at)) / 60))::int as release
         from trades t
         cross join lateral (select max(e.at) as at from trade_events e where e.code = t.code and e.event ->> 'type' = 'release-started') r
        where t.code = $1 and t.state = 'released' and t.settling = 'release' and t.dispute_by is null
          and t.paid_at is not null and t.secured_at is not null and r.at is not null
     ), mark as (
       insert into trade_totals_counted (trade_code, kind) select code, 'action-times' from t
       on conflict do nothing returning trade_code
     )
     insert into account_action_minutes (account_id, kind, minutes)
     select s.account_id, s.kind, array[s.minutes] from t join mark on mark.trade_code = t.code
       cross join lateral (values (t.buyer_account_id, 'pay', t.pay), (t.seller_account_id, 'release', t.release)) as s (account_id, kind, minutes)
     on conflict (account_id, kind) do update
       set minutes = (account_action_minutes.minutes || excluded.minutes)[greatest(1, cardinality(account_action_minutes.minutes) + 2 - $2::int):]`,
    [code, TYPICAL_WINDOW],
  );
}
