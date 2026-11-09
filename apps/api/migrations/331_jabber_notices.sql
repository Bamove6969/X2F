-- Owner rule p5-7 (2026-11-07): a user who has set up secure Jabber (XMPP) alerts gets one discreet
-- message, "An account change was made on your X2F account.", for every change to their account.
-- The message never says what changed. Boards: JabberSetup and Alerts (wip/design-brief).
--
-- The choke point is the database: every table that holds part of an account's settings, login
-- methods, wallets, team or holds carries the row trigger `jabber_note_change`, so no route, job or
-- tool can change one without queueing a notice in the same transaction (a rollback queues
-- nothing). apps/api/src/jabber/changePaths.ts lists those tables, the columns whose writes are
-- login bookkeeping rather than changes (a password rehash, a sign counter, a key rotation), and
-- every other table that refers to an account with the reason it is not an account change;
-- apps/api/test/jabber-paths.test.ts fails when a table or column is not classified.
--
-- No column holds an address in clear: `jid_sealed` and `pending_sealed` are SecretBox blobs under
-- X2F_JABBER_KEYS (auth/keystore.ts), bound to `x2f/jabber-address/<account id>`.
-- 331: 3xx numbers up to 324 are taken on other branches.

create table jabber_contacts (
  account_id uuid primary key references accounts (id) on delete cascade,
  -- The proven address, sealed; null until a test code was entered for it.
  jid_sealed bytea,
  verified_at timestamptz,
  -- The switch on Alerts. Off keeps the address; Turn off deletes the row.
  enabled boolean not null default false,
  last_sent_at timestamptz,
  -- An address waiting for its test code (first set-up, or a change of address). The proven
  -- address above keeps getting the notices until the new one is proven.
  pending_sealed bytea,
  -- HMAC-SHA-256 of the six-digit code under a subkey of X2F_JABBER_KEYS (never the code).
  pending_code_hash bytea,
  pending_sent_at timestamptz,
  pending_expires_at timestamptz,
  pending_tries smallint not null default 0 check (pending_tries >= 0),
  check ((jid_sealed is null) = (verified_at is null)),
  check (not enabled or jid_sealed is not null),
  check ((pending_sealed is null) = (pending_code_hash is null)),
  check ((pending_sealed is null) = (pending_expires_at is null))
);

-- Notices waiting to be sent by the worker (jabber/outbox.ts). One per (account, transaction, kind): a
-- change that writes several rows sends one message. No foreign key: a notice queued by the
-- deletion of an account must not make that deletion fail. Rows hold no detail of the change.
create table jabber_outbox (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  jid_sealed bytea not null,
  txid bigint not null,
  -- Which fixed sentence (jabber/sender.ts `NOTICE_TEXT`): an account change, or (lead default,
  -- 2026-11-08) a dispute opened on one of the account's trades, to the payer.
  kind text not null default 'account-change' check (kind in ('account-change', 'trade-attention')),
  attempts smallint not null default 0,
  -- Null: due now. Set (server clock) only for a retry after a failed send.
  next_at timestamptz,
  unique (account_id, txid, kind)
);

create function jabber_queue(acct uuid, sealed bytea, k text default 'account-change') returns void language sql as $$
  insert into jabber_outbox (account_id, jid_sealed, txid, kind) values (acct, sealed, txid_current(), k)
  on conflict (account_id, txid, kind) do nothing
$$;

-- Row trigger. tg_argv[0]: the column naming the account; tg_argv[1..]: columns whose writes alone
-- are not a change. A login-only account of a team member (accounts.kind = 'member') notifies its
-- team account. Never raises: it only reads and inserts.
create function jabber_note_change() returns trigger language plpgsql as $$
declare
  col text := tg_argv[0];
  ignored text[] := coalesce(tg_argv[1:], '{}');
  acct uuid;
  r record;
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - ignored) = (to_jsonb(new) - ignored) then
    return null;
  end if;
  for acct in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then (to_jsonb(old) ->> col)::uuid end,
      case when tg_op <> 'DELETE' then (to_jsonb(new) ->> col)::uuid end
    ]) as x where x is not null
  loop
    for r in
      select c.account_id, c.jid_sealed from jabber_contacts c
       where c.enabled
         and (c.account_id = acct
              or c.account_id in (select tm.account_id from team_members tm where tm.member_account_id = acct))
    loop
      perform jabber_queue(r.account_id, r.jid_sealed);
    end loop;
  end loop;
  return null;
end
$$;

-- The Jabber setting is itself an account change: turning it off, deleting it or proving a new
-- address tells the address that was getting the notices (so a thief cannot silence it quietly).
-- Sending a test code, a wrong code and `last_sent_at` are not changes.
create function jabber_contact_changed() returns trigger language plpgsql as $$
begin
  if old.enabled and old.jid_sealed is not null
     and (tg_op = 'DELETE' or not new.enabled or new.jid_sealed is distinct from old.jid_sealed) then
    perform jabber_queue(old.account_id, old.jid_sealed);
  end if;
  return null;
end
$$;

create trigger jabber_contact_changed after update or delete on jabber_contacts
  for each row execute function jabber_contact_changed();

-- The change paths (keep in step with CHANGE_TABLES in apps/api/src/jabber/changePaths.ts).
create trigger jabber_note_change after update on accounts for each row
  execute function jabber_note_change('id', 'had_wallet', 'webauthn_user_id', 'login_tag', 'login_tag_key_id', 'login_name', 'login_key');
create trigger jabber_note_change after insert or update or delete on passwords for each row
  execute function jabber_note_change('account_id', 'hash', 'pepper_id');
create trigger jabber_note_change after insert or update or delete on totp for each row
  execute function jabber_note_change('account_id', 'secret_enc', 'last_step');
create trigger jabber_note_change after insert or update or delete on recovery_codes for each row
  execute function jabber_note_change('account_id', 'used_at');
create trigger jabber_note_change after insert or update or delete on webauthn_credentials for each row
  execute function jabber_note_change('account_id', 'counter', 'last_used_at');
create trigger jabber_note_change after insert or update or delete on pgp_keys for each row
  execute function jabber_note_change('account_id', 'armored_enc', 'last_used_at');
create trigger jabber_note_change after insert or update or delete on wallets for each row
  execute function jabber_note_change('account_id', 'address');
create trigger jabber_note_change after insert or update or delete on team_members for each row
  execute function jabber_note_change('account_id');
create trigger jabber_note_change after insert or update or delete on account_holds for each row
  execute function jabber_note_change('account_id');
create trigger jabber_note_change after insert or update or delete on trading_holds for each row
  execute function jabber_note_change('account_id');
create trigger jabber_note_change after insert or update or delete on nudge_settings for each row
  execute function jabber_note_change('account_id');
create trigger jabber_note_change after insert or update or delete on account_blocks for each row
  execute function jabber_note_change('account_id');
create trigger jabber_note_change after insert or update or delete on past_reputation for each row
  execute function jabber_note_change('account_id');

-- Lead default (2026-11-08), behind the same opt-in: a dispute opened on a trade (by either trader
-- or by the system) tells the payer, the trade's buyer, that a trade of theirs needs attention.
-- The sentence names no trade, amount, person or reason.
create function jabber_dispute_opened() returns trigger language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.account_id, c.jid_sealed from trades t join jabber_contacts c on c.account_id = t.buyer_account_id
     where t.code = new.code and c.enabled
  loop
    perform jabber_queue(r.account_id, r.jid_sealed, 'trade-attention');
  end loop;
  return null;
end
$$;

create trigger jabber_dispute_opened after insert on disputes
  for each row execute function jabber_dispute_opened();
