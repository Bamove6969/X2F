-- Plan 4, Task 6: owner first-run setup.
--
-- One row, created at the staff app's first start while no owner exists. The setup code is never
-- stored: `code_hash` is the SHA-256 of the grouped code, and `code_salt` is the random input the
-- server derives the code from with its own key (HMAC), so every restart prints the same code until
-- setup finishes while the database alone cannot give it back. `locked_at` is set once, in the
-- transaction that finishes setup; from then on the row can never change again (trigger below),
-- and every setup route answers 404 `setup-locked`.
create table owner_setup (
  id int primary key check (id = 1),
  code_hash bytea not null check (octet_length(code_hash) = 32),
  code_salt bytea not null check (octet_length(code_salt) = 32),
  created_at timestamptz not null,
  locked_at timestamptz
);

create function owner_setup_locked() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'TRUNCATE' then
    if exists (select 1 from owner_setup where locked_at is not null) then
      raise exception 'owner_setup: setup is locked for good' using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;
  if old.locked_at is not null then
    raise exception 'owner_setup: setup is locked for good' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger owner_setup_locked
  before update or delete on owner_setup
  for each row execute function owner_setup_locked();

create trigger owner_setup_no_truncate
  before truncate on owner_setup
  for each statement execute function owner_setup_locked();

-- Tries of the setup code, for the global limit of 10 per hour (rows older than an hour are
-- deleted as new tries come in, and all of them once setup finishes). No column says who tried.
create table owner_setup_tries (
  at timestamptz not null
);
create index owner_setup_tries_at on owner_setup_tries (at);
