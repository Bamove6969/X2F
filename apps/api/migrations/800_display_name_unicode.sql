-- Signup round 3 (lead call, 13 Nov 2026): a display name may hold letters of any script (see
-- `checkDisplayName` in @x2f/accounts). Its key is made by that one function (NFC, then JavaScript
-- lower case), which the database's lower() matches only for ASCII on some locales (the C and
-- builtin providers leave other letters alone), so the two checks that compared them move into
-- the app: every write of `display_key` takes it from `checkDisplayName`. Numbered 610 on
-- wip/third-demo-r3; 800 when merged onto main a981b348 (main has 790).
alter table accounts drop constraint accounts_display_key_lower;
-- team_members' check was declared inline (015), so it is found by what it says.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'team_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%lower(display_name)%'
  loop
    execute format('alter table team_members drop constraint %I', c);
  end loop;
end $$;
