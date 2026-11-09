-- Jabber notices get a kind (lead default, design's suggestion for owner p11-16; the owner called
-- such notices "Jabber worthy" in p11-4). Behind the same opt-in as 331: only an account with a
-- proven, switched-on Jabber address is ever queued. Each kind is one fixed sentence chosen by the
-- sender (apps/api/src/jabber/sender.ts NOTICE_KINDS), never any detail of the trade or change:
--   account-change   331's notice: "An account change was made on your X2F account."
--   trade-attention  a dispute was opened on a trade where this account pays (the buyer), by the
--                    other side or by X2F: the payer must not send money now.
-- The column is the only path for both: the outbox worker reads it and sends that kind's sentence.
-- 332: 331 is wip/lead-jabber-notices'; nothing else uses 33x.

alter table jabber_outbox add column kind text not null default 'account-change'
  check (kind in ('account-change', 'trade-attention'));

-- One notice per (account, transaction, kind): a dispute that also changes an account sends both.
alter table jabber_outbox drop constraint jabber_outbox_account_id_txid_key;
alter table jabber_outbox add constraint jabber_outbox_account_id_txid_kind_key unique (account_id, txid, kind);

-- 331's queue, against the new unique key (the kind is its default, account-change).
create or replace function jabber_queue(acct uuid, sealed bytea) returns void language sql as $$
  insert into jabber_outbox (account_id, jid_sealed, txid) values (acct, sealed, txid_current())
  on conflict (account_id, txid, kind) do nothing
$$;

-- A trade of `acct`'s needs their attention: queued in the caller's transaction, so a rollback
-- queues nothing; nothing when the account has no switched-on Jabber address.
create function jabber_queue_trade_attention(acct uuid) returns void language sql as $$
  insert into jabber_outbox (account_id, jid_sealed, txid, kind)
  select c.account_id, c.jid_sealed, txid_current(), 'trade-attention'
    from jabber_contacts c
   where c.account_id = acct and c.enabled and c.jid_sealed is not null
  on conflict (account_id, txid, kind) do nothing
$$;
