-- Owner, 8 Nov 2026 (Post an offer, "Minimum completed trades": "This will be 5, 10, 25, 50"): the
-- minimum is a fixed choice, no minimum (the default) or 5, 10, 25 or 50 completed trades. No
-- minimum is stored as null (it was 0). Any other value an offer holds goes down to the next lower
-- allowed one (lead rule, 8 Nov), so no offer becomes harder to take than its poster asked: 0-4 →
-- no minimum, 5-9 → 5, 10-24 → 10, 25-49 → 25, 50 and up → 50.
alter table offers drop constraint offers_min_trades_check;
alter table offers alter column min_trades drop not null;
update offers set min_trades = case
    when min_trades < 5 then null
    when min_trades < 10 then 5
    when min_trades < 25 then 10
    when min_trades < 50 then 25
    else 50
  end
  where min_trades is not null;
alter table offers add constraint offers_min_trades_check check (min_trades in (5, 10, 25, 50));
