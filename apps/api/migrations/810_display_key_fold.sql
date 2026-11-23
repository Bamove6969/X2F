-- Security review of wip/lead-notes-all (23 Nov 2026), L3: a display name's key is a full case
-- fold (@x2f/accounts `displayKeyOf`: NFKC, upper then lower case, final sigma as sigma, NFKC
-- again, spaces trimmed and collapsed), so names that differ only by case or a compatibility form
-- (ΑΒΓΔΣ and αβγδσ, Straße and STRASSE, ﬀabcd and ffabcd) are one name. Keys stored before were
-- NFC lower case. display_key_fold is the same fold in SQL with ICU's full case mapping (the
-- "und-x-icu" collation; the C and builtin providers leave other letters alone), checked against
-- the app's on a corpus in apps/api/test/signup-rules.test.ts. rekey_display_names() recomputes
-- every stored key of accounts and live team members, and raises (rolling this migration back)
-- when two names would then share a key, naming how many: a person decides, nothing is merged.
create function display_key_fold(name text) returns text
language sql immutable strict parallel safe
as $$
  select normalize(
    replace(
      lower(upper(normalize(regexp_replace(btrim(normalize(name, NFC), ' '), ' {2,}', ' ', 'g'), NFKC) collate "und-x-icu") collate "und-x-icu"),
      'ς', 'σ'),
    NFKC)
$$;

create function rekey_display_names() returns void
language plpgsql
as $$
declare
  clashes int;
begin
  select count(*) into clashes from (
    select display_key_fold(display_name) from accounts group by 1 having count(*) > 1
  ) c;
  if clashes > 0 then
    raise exception 'display key collision: % folded keys are shared by more than one account', clashes;
  end if;
  select count(*) into clashes from (
    select account_id, display_key_fold(display_name) from team_members where removed_at is null group by 1, 2 having count(*) > 1
  ) c;
  if clashes > 0 then
    raise exception 'display key collision: % folded keys are shared by more than one live team member of a team', clashes;
  end if;
  update accounts set display_key = display_key_fold(display_name) where display_key is distinct from display_key_fold(display_name);
  update team_members set display_key = display_key_fold(display_name) where display_key is distinct from display_key_fold(display_name);
end $$;

select rekey_display_names();
