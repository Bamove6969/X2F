-- Plan 3, Task 3: "Suggest a missing method" (spec 2.6, P3-M3). Stored WITHOUT the account that
-- sent it: no account id, no session, no device, and only the day it arrived (not the time), so
-- a row cannot be matched to a session's activity. The id is random (no sequence that orders rows).
create table method_suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  country text check (country ~ '^[A-Z]{2}$'),
  created_on date not null
);
