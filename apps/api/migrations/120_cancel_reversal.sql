-- Owner 8 Nov (p6-1, p9-2, p9-4), reversing the 15-minute final alert: once the buyer's time to
-- pay has passed without "I've paid", the seller's cancel starts the refund at once (the trade goes
-- straight to `settling` as `auto-refund`). The `refund_requested` state is retired.
--
-- A trade still in `refund_requested` goes back to `secured`: nothing moves from this migration.
-- Its buyer may still tap "I've paid" (the time to pay is not a hard end), and its seller sees
-- "Cancel and get refund" again; a new tap starts the refund at once under the new rule. The
-- moderation service moves its own copy of such a trade the same way when it loads it (desk.ts
-- `reviveShadow`), and its new process (deployed together) holds no refund handed out under the
-- old rule. A trade whose signing window would return it to `refund_requested` returns to
-- `secured` instead.
update trades set state = 'secured', final_alert_at = null where state = 'refund_requested';
update trades set settle_from = 'secured' where settle_from = 'refund_requested';

alter table trades drop constraint trades_state_check;
alter table trades add constraint trades_state_check check (state in (
  'setup', 'funding', 'securing', 'secured', 'paid', 'settling', 'released', 'refunded', 'lapsed',
  'cancelled', 'disputed'
));

-- final_alert_at, final_alert_delivered and final_alert_seen_at are no longer read or written;
-- they stay for old rows (dropping them is a later clean-up).
