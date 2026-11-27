-- Jabber trade milestones (owner, 27 Nov 2026: "they can choose to be notified if someone starts a
-- new trade with them, if someone marks payment sent, if someone completes trade etc.... all the
-- important milestones"). New notice kinds through the same outbox (331), the same opt-in (a proven
-- address, switched on) and the same picks page (336, W-021). Each is a fixed sentence that names
-- no trade, amount, person, method or link (owner rule p5-7; jabber/sender.ts NOTICE_TEXT).
--
-- Who is told what (only the side that has something to do or learn):
--   trade-started       insert into trades              the poster (someone took their offer)
--   trade-funded        state -> secured                the buyer (the coins are locked; pay now)
--   trade-paid          state -> paid                   the seller (payment marked sent)
--   trade-cancel-asked  cancel_proposed_by set          the other side
--   trade-completed     state -> released               both sides
--   trade-cancelled     state -> cancelled/refunded/lapsed  both sides
--   trade-attention     insert into disputes            both sides (was the buyer only, lead default 2026-11-08)
--   trade-ruled         insert into dispute_rulings     both sides
-- Every new kind is on until the user turns it off (muted_kinds lists the ones off), like
-- trade-attention. None is a security notice (ALWAYS_ON_KINDS is unchanged).

alter table jabber_outbox drop constraint jabber_outbox_kind_check;
alter table jabber_outbox add constraint jabber_outbox_kind_check check (kind in (
  'account-change', 'trade-attention', 'team-member-first-login',
  'trade-started', 'trade-funded', 'trade-paid', 'trade-cancel-asked', 'trade-completed', 'trade-cancelled', 'trade-ruled'
));

alter table jabber_contacts drop constraint jabber_contacts_muted_kinds_check;
alter table jabber_contacts add constraint jabber_contacts_muted_kinds_check check (muted_kinds <@ array[
  'trade-attention', 'trade-started', 'trade-funded', 'trade-paid', 'trade-cancel-asked', 'trade-completed', 'trade-cancelled', 'trade-ruled'
]::text[]);

-- Queues kind k for the trade's buyer and/or seller, each only if they have Jabber on (jabber_queue
-- then skips a muted kind).
create function jabber_trade_queue(buyer uuid, seller uuid, who text, k text) returns void language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.account_id, c.jid_sealed from jabber_contacts c
     where c.enabled and c.jid_sealed is not null
       and ((who in ('buyer', 'both') and c.account_id = buyer) or (who in ('seller', 'both') and c.account_id = seller))
  loop
    perform jabber_queue(r.account_id, r.jid_sealed, k);
  end loop;
end
$$;

create function jabber_trade_milestone() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform jabber_trade_queue(new.buyer_account_id, new.seller_account_id, new.poster, 'trade-started');
    return null;
  end if;
  if new.state is distinct from old.state then
    if new.state = 'secured' then
      perform jabber_trade_queue(new.buyer_account_id, new.seller_account_id, 'buyer', 'trade-funded');
    elsif new.state = 'paid' then
      perform jabber_trade_queue(new.buyer_account_id, new.seller_account_id, 'seller', 'trade-paid');
    elsif new.state = 'released' then
      perform jabber_trade_queue(new.buyer_account_id, new.seller_account_id, 'both', 'trade-completed');
    elsif new.state in ('cancelled', 'refunded', 'lapsed') then
      perform jabber_trade_queue(new.buyer_account_id, new.seller_account_id, 'both', 'trade-cancelled');
    end if;
  end if;
  if new.cancel_proposed_by is not null and old.cancel_proposed_by is distinct from new.cancel_proposed_by then
    perform jabber_trade_queue(new.buyer_account_id, new.seller_account_id,
      case new.cancel_proposed_by when 'buyer' then 'seller' else 'buyer' end, 'trade-cancel-asked');
  end if;
  return null;
end
$$;

create trigger jabber_trade_milestone after insert or update on trades
  for each row execute function jabber_trade_milestone();

-- A dispute now tells both sides (Jess: "disputes opened" is one of the milestones).
create or replace function jabber_dispute_opened() returns trigger language plpgsql as $$
declare
  t record;
begin
  select buyer_account_id, seller_account_id into t from trades where code = new.code;
  if found then
    perform jabber_trade_queue(t.buyer_account_id, t.seller_account_id, 'both', 'trade-attention');
  end if;
  return null;
end
$$;

create function jabber_dispute_ruled() returns trigger language plpgsql as $$
declare
  t record;
begin
  select buyer_account_id, seller_account_id into t from trades where code = new.code;
  if found then
    perform jabber_trade_queue(t.buyer_account_id, t.seller_account_id, 'both', 'trade-ruled');
  end if;
  return null;
end
$$;

create trigger jabber_dispute_ruled after insert on dispute_rulings
  for each row execute function jabber_dispute_ruled();
