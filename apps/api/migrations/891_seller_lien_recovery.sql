-- Seller lien recovery (owner 27 Nov 2026, option (a) of docs/lien-recovery.md "Debtor is the
-- seller"): "Extra XMR on each sale: they keep selling, but each sale's escrow must also hold the
-- lien payment, which goes to the person owed until it's paid off."
--
-- 1. lien_recovery_holds.debtor_side: which party of the trade owes the lien the hold reserves for.
--    'buyer' (every hold before this migration): part of the buyer's proceeds. 'seller': extra the
--    seller funds on top of amount + fee. A trade may hold one of each (both parties owe a lien);
--    the holds and the ledger (lien_recoveries) are shared, so a trader who both buys and sells
--    reserves against one remainder (`free = remaining − open holds`, under the lien's row lock).
--    One hold per trade and side; the side, like the lien, trade and amount, never changes.
alter table lien_recovery_holds add column debtor_side text not null default 'buyer' check (debtor_side in ('buyer', 'seller'));
alter table lien_recovery_holds drop constraint lien_recovery_holds_trade_code_key;
alter table lien_recovery_holds add constraint lien_recovery_holds_trade_side_key unique (trade_code, debtor_side);

create or replace function lien_recovery_holds_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'recovery holds are never deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.lien_id <> old.lien_id or new.trade_code <> old.trade_code or new.debtor_side <> old.debtor_side
     or new.amount_atomic <> old.amount_atomic or new.rate_bps <> old.rate_bps or new.created_at <> old.created_at
     or old.status <> 'open' then
    raise exception 'a recovery hold only closes, once' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

-- 2. trades.seller_lien_recovery_atomic: the extra the seller funds for its lien, fixed at take
--    (the seller hold's amount, and the signed terms' `sellerLienRecovery`). The escrow must hold it
--    on top of amount + fee: it is part of `seller_funds_atomic` (@x2f/trade escrowPlan), and growth
--    never counts it. 0: none. Written once by the take, never changed (the trigger below), so the
--    funding plan stays what the seller accepted even when the hold is later released.
alter table trades add column seller_lien_recovery_atomic numeric(30, 0) not null default 0 check (seller_lien_recovery_atomic >= 0);

create function trades_seller_lien_fixed() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if new.seller_lien_recovery_atomic is distinct from old.seller_lien_recovery_atomic then
    raise exception 'a trade''s seller recovery never changes' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;
create trigger trades_seller_lien_fixed before update on trades for each row execute function trades_seller_lien_fixed();
